# Deployment notes

## Minecraft and backup storage

Create the backup directory before starting the panel:

```bash
sudo install -d -o minecraft -g minecraft -m 0750 /srv/minecraft-backups
sudo chown -R minecraft:minecraft /srv/minecraft-backups
```

The backup directory is deliberately **outside** `/srv/minecraft`. The panel file manager is sandboxed to `/srv/minecraft`, so `/srv/minecraft-backups` is not reachable through file-manager browse, edit, upload, delete, mkdir, or extraction operations. Do not bind-mount or symlink the backup directory into `/srv/minecraft`.

The panel systemd service and Minecraft Java process both run as the single non-root `minecraft` user. Ensure the user can read/write both `/srv/minecraft` and `/srv/minecraft-backups`.
