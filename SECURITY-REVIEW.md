# Final security review

Reviewed authentication, CSRF/origin controls, WebSocket upgrade path, process manager, installer, file sandbox, backups, plugins, monitoring, webhooks, routes, deployment files, and CI on the dev branch.

## Controls confirmed

- .env and database files are ignored; webhook encryption uses a runtime environment key.
- Protected application routes use session middleware; owner-only areas use owner middleware.
- POST/PUT/PATCH/DELETE requests require the CSRF cookie and header; WebSocket console commands require CSRF.
- WebSocket Origin must exactly match PANEL_ORIGIN and a valid session is required.
- File traversal, absolute paths, symlinks, ZIP traversal/symlinks, duplicate targets, and extraction limits are checked.
- Minecraft downloads use HTTPS and official hosts; required upstream checksums are verified.
- Java/installer execution uses shell:false; production Minecraft runs as non-root minecraft.
- Backups are outside the Minecraft/file-manager tree; restore requires stopped server and a safety backup.
- Plugin mutations are owner-only; names, Modrinth IDs/hosts, size, and SHA-512 are validated.
- Webhooks are official HTTPS Discord URLs, encrypted at rest, masked in responses, and failures do not break control.
- CORS is restricted to the configured exact panel origin.
- Deployment includes systemd hardening, nginx HTTPS/WebSocket proxying, UFW, fail2ban, and swap.

## Remaining issues / production decisions

1. No package lock is committed yet. CI falls back to npm install until package-lock.json is committed; then it automatically uses npm ci.
2. General API rate limiting is not enabled. Login/setup and webhook test are rate-limited, but authenticated API routes are not globally rate-limited.
3. /api/versions/eula, /api/versions/ram, and /api/versions/install currently require authentication, not owner role. Decide whether managers should have these destructive/configuration permissions.
4. Some operational errors can include upstream/process text. Installer errors include a bounded Java stderr tail and some handlers return filesystem/process errors; consider request IDs plus server-side logs for production.
5. The console endpoint intentionally permits arbitrary Minecraft console commands to authenticated users; keep manager access limited to trusted operators.
6. Production certificates remain an operational dependency; use trusted HTTPS or controlled Tailscale/self-signed HTTPS, never plain HTTP.

No plaintext production secret, default owner password, or root Minecraft process was found in the reviewed repository files.
