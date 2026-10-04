# MC Panel

Private Minecraft server management panel foundation.

## Stack

- Node.js 22 LTS
- Express
- SQLite
- React + Vite + Tailwind
- WebSocket (ws)

Minecraft runtime data lives outside this repository at /srv/minecraft.
The panel service and Minecraft Java process both run as the single non-root `minecraft` user. There is no separate `mc-panel` user, no uid/gid switching in Node, and no Minecraft systemd unit.

## Branch policy

- main: release branch
- dev: active development branch

Do not deploy unfinished dev changes to production.


## Admin console-command access

Anyone with admin access can send arbitrary Minecraft console commands through the panel. Treat admin accounts as trusted server operators: a console command can change server configuration, permissions, worlds, and other server state.
