# MC Panel

Private Minecraft server management panel foundation.

## Stack

- Node.js 20
- Express
- SQLite
- React + Vite + Tailwind
- WebSocket (ws)

Minecraft runtime data lives outside this repository at /srv/minecraft.
The panel will spawn Java as the dedicated minecraft user; there is no Minecraft systemd unit.

## Branch policy

- main: release branch
- dev: active development branch

Do not deploy unfinished dev changes to production.
