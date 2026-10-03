import { db } from "../database/db.js";

const WINDOW_MS = 15 * 60_000;
const MAX_PER_IP = 10;
const MAX_PER_ACCOUNT = 5;

export function isLoginRateLimited(ip: string, email: string) {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const ipRow = db.prepare("SELECT COUNT(*) as count FROM login_attempts WHERE ip_address=? AND created_at>=?").get(ip, since) as any;
  const accountRow = db.prepare("SELECT COUNT(*) as count FROM login_attempts WHERE account_key=? AND created_at>=?").get(email.toLowerCase(), since) as any;
  return Number(ipRow.count) >= MAX_PER_IP || Number(accountRow.count) >= MAX_PER_ACCOUNT;
}

export function recordLoginAttempt(ip: string, email: string) {
  db.prepare("INSERT INTO login_attempts (ip_address, account_key, created_at) VALUES (?, ?, ?)").run(ip, email.toLowerCase(), new Date().toISOString());
}

export function clearLoginAttempts(email: string) {
  db.prepare("DELETE FROM login_attempts WHERE account_key=?").run(email.toLowerCase());
}
