# Production VPS setup

This guide is written for a phone. Run each section in order on a fresh Ubuntu VPS. The panel and Minecraft Java process run as the same single non-root user: minecraft.

## 1. Update Ubuntu and create directories
~~~bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx ufw fail2ban ca-certificates unzip
sudo useradd --system --create-home --home-dir /home/minecraft --shell /usr/sbin/nologin minecraft || true
sudo install -d -o minecraft -g minecraft -m 0750 /srv/minecraft
sudo install -d -o minecraft -g minecraft -m 0750 /srv/minecraft-backups
sudo install -d -o minecraft -g minecraft -m 0750 /opt/mc-panel/server/data
~~~
The backup directory is outside /srv/minecraft and is not reachable through the panel file manager. Never symlink or bind-mount it into /srv/minecraft.

## 2. Install Node.js 22 LTS and Java
Install Node.js 22 LTS and the Java runtime required by the Minecraft version you select. Verify with node --version and java -version.

## 3. Install the panel
~~~bash
sudo git clone --branch dev https://github.com/aaravgyt782013-netizen/mc-panel.git /opt/mc-panel
sudo chown -R minecraft:minecraft /opt/mc-panel
cd /opt/mc-panel
sudo -u minecraft npm ci
sudo -u minecraft npm run build
sudo -u minecraft cp .env.example .env
sudo -u minecraft chmod 600 .env
~~~
Edit /opt/mc-panel/.env:
~~~dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
PANEL_ORIGIN=https://panel.example.com
DATABASE_PATH=/opt/mc-panel/server/data/panel.db
MINECRAFT_ROOT=/srv/minecraft
BACKUP_ROOT=/srv/minecraft-backups
MINECRAFT_USER=minecraft
WEBHOOK_ENCRYPTION_KEY=PASTE_OUTPUT_OF_OPENSSL_RAND_BASE64_32
~~~
Generate the key with:
~~~bash
openssl rand -base64 32
~~~
Never commit .env or the webhook encryption key.

## 4. systemd
~~~bash
sudo cp deploy/mc-panel.service /etc/systemd/system/mc-panel.service
sudo systemctl daemon-reload
sudo systemctl enable --now mc-panel
sudo systemctl status mc-panel --no-pager
sudo journalctl -u mc-panel -n 100 --no-pager
~~~
The service uses User=minecraft, NoNewPrivileges, ProtectSystem, ProtectHome, PrivateTmp, and explicit ReadWritePaths for panel data, /srv/minecraft, and /srv/minecraft-backups.

## 5. nginx and HTTPS
Replace panel.example.com in deploy/nginx.conf with your domain, then:
~~~bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/mc-panel
sudo ln -sf /etc/nginx/sites-available/mc-panel /etc/nginx/sites-enabled/mc-panel
sudo nginx -t
sudo systemctl reload nginx
~~~
Issue your normal ACME/Let's Encrypt certificate and reload nginx. The config proxies /api and /ws, supports WebSocket upgrades, limits request bodies to 10 MB, and sends security headers.

## 6. No-domain option
Option A: use Tailscale between the VPS and your phone. Keep the panel behind HTTPS and set PANEL_ORIGIN to the HTTPS Tailscale hostname/address you use.
Option B: use the VPS IP with a self-signed certificate whose SAN contains that IP. Set PANEL_ORIGIN=https://YOUR_SERVER_IP and configure nginx with that certificate. Your browser will show a warning until the certificate is trusted on the phone. Do not use plain HTTP for production.

## 7. Firewall
Before enabling the firewall, make sure SSH works in another session.
~~~bash
sudo bash /opt/mc-panel/deploy/ufw.sh
~~~
Only SSH 22, HTTPS 443, and Minecraft 25565 are allowed inbound.

## 8. fail2ban
~~~bash
sudo cp /opt/mc-panel/deploy/fail2ban-jail.local /etc/fail2ban/jail.local
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
~~~

## 9. 2 GB swap
~~~bash
sudo bash /opt/mc-panel/deploy/swap.sh
free -h
swapon --show
~~~

## 10. First login
Open the HTTPS panel URL. The one-time setup token is printed once in the systemd journal:
~~~bash
sudo journalctl -u mc-panel | grep -i 'setup token'
~~~
Use it for owner setup, then change the owner password.

## 11. Verify
~~~bash
systemctl show mc-panel -p User -p Group -p NoNewPrivileges -p ProtectSystem -p PrivateTmp
sudo ss -lntp
sudo ufw status
sudo fail2ban-client status sshd
~~~
Expected: panel only on localhost:3000, HTTPS on 443, Minecraft on 25565, and systemd User/Group both minecraft.

## 12. Discord webhooks
Webhook settings are owner-only. URLs are validated as official Discord HTTPS webhook URLs, encrypted in SQLite with WEBHOOK_ENCRYPTION_KEY, masked in API responses, and the test endpoint is rate-limited. Webhook failures never break Minecraft start/stop/crash control.
