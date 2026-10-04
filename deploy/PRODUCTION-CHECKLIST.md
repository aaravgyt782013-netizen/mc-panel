# Production checklist

- [ ] Ubuntu updated; Node.js 22 LTS and required Java installed.
- [ ] Non-root minecraft user created.
- [ ] /srv/minecraft, /srv/minecraft-backups, and /opt/mc-panel/server/data owned by minecraft:minecraft.
- [ ] Backup directory is outside the Minecraft/file-manager tree and is not symlinked or bind-mounted into it.
- [ ] Approved release branch deployed; unfinished dev changes are not deployed.
- [ ] .env contains strong SESSION_SECRET and 32-byte base64 WEBHOOK_ENCRYPTION_KEY.
- [ ] PANEL_ORIGIN exactly matches the HTTPS URL used by the browser.
- [ ] Nginx HTTPS/WebSocket proxy and certificate configured.
- [ ] systemd runs as minecraft.
- [ ] UFW allows only SSH 22, HTTPS 443, and Minecraft 25565.
- [ ] fail2ban and 2 GB swap are active.
- [ ] Setup token retrieved; owner setup completed; owner password changed.
- [ ] Login, start, stop, console, file manager, backup, restore, and plugin controls tested.
- [ ] Manual backup created and restore test performed before important world data is stored.
- [ ] Backup retention/schedule reviewed.
- [ ] Discord webhook test completed if notifications are enabled.
- [ ] After lockfile commit, CI/deploy use npm ci.

## Updating

1. Create a backup.
2. Stop Minecraft if required by the release.
3. Pull the approved release commit/branch.
4. Run npm ci when package-lock.json is present.
5. Run npm run build.
6. Restart mc-panel.
7. Check systemctl status mc-panel and journalctl -u mc-panel -n 100 --no-pager.
8. Verify login and server status.

## If Minecraft crashes

1. Note the crash time and inspect the panel console.
2. Check sudo journalctl -u mc-panel -n 200 --no-pager and Minecraft logs under /srv/minecraft.
3. If status is crash-loop, stop repeated restarts and fix the plugin/mod/configuration causing the crash.
4. Restore the newest known-good backup only while Minecraft is stopped.
5. Start Minecraft and watch for clean startup.
6. Keep failed logs/backup until the cause is understood.
