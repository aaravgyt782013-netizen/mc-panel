import { db } from "../database/db.js";
import { env } from "../config/env.js";
import { randomToken, sha256 } from "./crypto.js";

export const SESSION_COOKIE = "mc_session";
export const CSRF_COOKIE = "mc_csrf";

const absoluteDays = 7;
const idleMinutes = 60;

export function createSession(userId: number, req: { ip?: string; headers: { "user-agent"?: string } }) {
  const token = randomToken(32);
  const now = Date.now();
  const idleExpiry = new Date(now + idleMinutes * 60_000);
  const absoluteExpiry = new Date(now + absoluteDays * 86_400_000);
  const expiresAt = new Date(Math.min(idleExpiry.getTime(), absoluteExpiry.getTime())).toISOString();
  db.prepare("INSERT INTO sessions (user_id, token_hash, expires_at, absolute_expires_at, last_activity_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(userId, sha256(token), expiresAt, absoluteExpiry.toISOString(), new Date(now).toISOString(), req.ip ?? null, req.headers["user-agent"] ?? null);
  return { token, expiresAt };
}

export function getSession(token: string) {
  const row = db.prepare(`SELECT s.*, u.email, u.role, u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(sha256(token)) as any;
  if (!row || !row.active) return null;
  const now = Date.now();
  const absolute = Date.parse(row.absolute_expires_at);
  const lastActivity = Date.parse(row.last_activity_at);
  if (now >= absolute || now - lastActivity >= idleMinutes * 60_000) {
    db.prepare("DELETE FROM sessions WHERE id=?").run(row.id);
    return null;
  }
  const newExpiry = new Date(Math.min(now + idleMinutes * 60_000, absolute)).toISOString();
  db.prepare("UPDATE sessions SET last_activity_at=?, expires_at=? WHERE id=?").run(new Date(now).toISOString(), newExpiry, row.id);
  return { id: row.id, userId: row.user_id, email: row.email, role: row.role as "owner" | "admin" };
}

export function revokeSessionByToken(token: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash=?").run(sha256(token));
}

export function revokeAllSessions(userId: number) {
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
}
