import { Router } from "express";
import { db } from "../database/db.js";
import { audit } from "../auth/audit.js";
import { hashPassword, PASSWORD_MIN_LENGTH, randomToken, sha256, timingSafeEqualText, verifyPassword } from "../auth/crypto.js";
import { createOwner, consumeSetupToken, setupStatus } from "../auth/setup.js";
import { authRateLimit } from "../middleware/security.js";
import { createSession, CSRF_COOKIE, SESSION_COOKIE, revokeAllSessions, revokeSessionByToken } from "../auth/session.js";
import { issueCsrf } from "../auth/csrf.js";
import { clearLoginAttempts, isLoginRateLimited, recordLoginAttempt } from "../auth/rate-limit.js";
import { requireAuth } from "../auth/middleware.js";

const router = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.6j5L7f0jvWwW3lV7jW2mX6W1Q8Jf0uS";

router.get("/csrf", (_req, res) => {
  res.json({ token: issueCsrf(res) });
});

router.get("/setup-status", (_req, res) => res.json({ setupLocked: setupStatus() }));

router.post("/setup", authRateLimit, async (req, res) => {
  const { setupToken, email, password } = req.body ?? {};
  if (setupStatus()) return res.status(409).json({ error: "Setup is locked" });
  if (typeof setupToken !== "string" || typeof email !== "string" || typeof password !== "string" || !emailPattern.test(email) || password.length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({ error: "Invalid setup details" });
  }
  if (!await consumeSetupToken(setupToken)) return res.status(403).json({ error: "Invalid setup token" });
  try {
    const userId = await createOwner(email, password);
    audit("ADD_ADMIN", userId, req, email.toLowerCase(), { role: "owner", initialSetup: true });
    const session = createSession(userId, req);
    res.cookie(SESSION_COOKIE, session.token, { httpOnly: true, secure: true, sameSite: "strict", path: "/" });
    res.status(201).json({ ok: true, user: { id: userId, email: email.toLowerCase(), role: "owner" } });
  } catch {
    res.status(409).json({ error: "Setup is locked" });
  }
});

router.post("/login", authRateLimit, async (req, res) => {
  const { email, password } = req.body ?? {};
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  const ip = req.ip;
  const generic = "Invalid email or password";
  if (!normalized || typeof password !== "string") {
    audit("LOGIN_FAILED", null, req, normalized || undefined);
    return res.status(401).json({ error: generic });
  }
  if (isLoginRateLimited(ip, normalized)) return res.status(429).json({ error: generic });
  const user = db.prepare("SELECT id,email,password_hash,role,active FROM users WHERE email=?").get(normalized) as any;
  const valid = user ? await verifyPassword(password, user.password_hash) : await verifyPassword(password, DUMMY_HASH);
  if (!user || !user.active || !valid) {
    recordLoginAttempt(ip, normalized);
    audit("LOGIN_FAILED", user?.id ?? null, req, normalized);
    return res.status(401).json({ error: generic });
  }
  clearLoginAttempts(normalized);
  db.prepare("UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?").run(user.id);
  const session = createSession(user.id, req);
  res.cookie(SESSION_COOKIE, session.token, { httpOnly: true, secure: true, sameSite: "strict", path: "/" });
  audit("LOGIN", user.id, req);
  res.json({ ok: true, user: { id: user.id, email: user.email, role: user.role } });
});

router.post("/logout", requireAuth, (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) revokeSessionByToken(token);
  audit("LOGOUT", req.authUser!.id, req);
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: "strict", path: "/" });
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => res.json({ user: req.authUser }));

router.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || newPassword.length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({ error: "Invalid password" });
  }
  const user = db.prepare("SELECT password_hash FROM users WHERE id=?").get(req.authUser!.id) as any;
  if (!user || !await verifyPassword(currentPassword, user.password_hash)) return res.status(400).json({ error: "Current password is incorrect" });
  const nextHash = await hashPassword(newPassword);
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(nextHash, req.authUser!.id);
  revokeAllSessions(req.authUser!.id);
  audit("PASSWORD_CHANGE", req.authUser!.id, req);
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: "strict", path: "/" });
  res.json({ ok: true });
});

router.post("/accept-invite", async (req, res) => {
  const { token, email, password } = req.body ?? {};
  if (typeof token !== "string" || typeof email !== "string" || typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) return res.status(400).json({ error: "Invalid invitation details" });
  const invite = db.prepare("SELECT * FROM invites WHERE token_hash=? AND used_at IS NULL AND expires_at>?").get(sha256(token), new Date().toISOString()) as any;
  if (!invite || (invite.email && invite.email.toLowerCase() !== email.trim().toLowerCase())) return res.status(400).json({ error: "Invalid or expired invitation" });
  const passwordHash = await hashPassword(password);
  try {
    const result = db.transaction(() => {
      const user = db.prepare("INSERT INTO users (email,password_hash,role) VALUES (?,?, 'admin')").run(email.trim().toLowerCase(), passwordHash);
      db.prepare("UPDATE invites SET used_at=CURRENT_TIMESTAMP WHERE id=?").run(invite.id);
      return Number(user.lastInsertRowid);
    })();
    audit("ADD_ADMIN", result, req, email.toLowerCase());
    res.status(201).json({ ok: true });
  } catch {
    res.status(409).json({ error: "Account already exists" });
  }
});

export default router;
