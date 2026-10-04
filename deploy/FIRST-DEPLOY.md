# First deploy

Phone-friendly first-deploy path. For full hardening, see deploy/PRODUCTION-CHECKLIST.md and deploy/README.md.

1. Create the minecraft user and directories shown in deploy/README.md.
2. Install Node.js 22 LTS, Java, nginx, UFW, fail2ban, and CA certificates.
3. Clone the approved release branch into /opt/mc-panel and chown it to minecraft:minecraft.
4. Copy .env.example to .env. Set PANEL_ORIGIN, paths, a strong session secret, and a 32-byte base64 webhook key.
5. Build as minecraft. Use npm ci if package-lock.json exists; otherwise npm install until the lockfile is committed.
6. Install/enable deploy/mc-panel.service and configure nginx HTTPS/WebSocket proxying.
7. Start the service and read the one-time setup token with: sudo journalctl -u mc-panel | grep -i 'setup token'
8. Open the HTTPS panel, create the owner account with the setup token, then change the owner password.
9. Accept the Minecraft EULA, select/install the server version, and verify start/stop/console.
10. Create the first manual backup and verify it under /srv/minecraft-backups.
11. If Minecraft crashes, inspect the panel console and journal, identify the bad plugin/mod/configuration, and restore the latest good backup only while Minecraft is stopped.
