The panel and Minecraft runtime both run as the single non-root `minecraft` user.

- Create the `minecraft` user/group before deployment.
- Ensure `/opt/mc-panel` and `/srv/minecraft` are owned/writable by `minecraft:minecraft`.
- Install the systemd unit as `minecraft`; there is no separate `mc-panel` account and no uid/gid switching in the Node process.
- Minecraft itself is intentionally NOT a separate systemd service: the panel starts Java directly as its own `minecraft` user.
- The service uses `ReadWritePaths=/opt/mc-panel /srv/minecraft` because the panel needs to persist its database/configuration and manage Minecraft files.

After installing, run `systemctl daemon-reload`, then `systemctl enable --now mc-panel.service`.