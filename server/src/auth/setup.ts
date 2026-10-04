import { db } from "../database/db.js";
import { hashPassword, randomToken, sha256, timingSafeEqualText } from "./crypto.js";

const SETUP_HASH_KEY = "setup_token_hash";
const SETUP_USED_KEY = "setup_token_used";

export async function ensureSetupToken() {
  if (db.prepare("SELECT 1 FROM users WHERE role='owner' LIMIT 1").get()) return;
  const existing = db.prepare("SELECT value FROM settings WHERE key=?").get(SETUP_HASH_KEY) as any;
  if (existing) return;
  const token = randomToken(32);
  db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)").run(SETUP_HASH_KEY, sha256(token));
  db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)").run(SETUP_USED_KEY, "0");
  console.log("MC PANEL SETUP TOKEN (print-once): " + token);
}

export async function consumeSetupToken(token: string) {
  const hashRow = db.prepare("SELECT value FROM settings WHERE key=?").get(SETUP_HASH_KEY) as any;
  const usedRow = db.prepare("SELECT value FROM settings WHERE key=?").get(SETUP_USED_KEY) as any;
  if (!hashRow || usedRow?.value === "1" || db.prepare("SELECT 1 FROM users WHERE role='owner' LIMIT 1").get()) return false;
  if (!timingSafeEqualText(sha256(token), String(hashRow.value))) return false;
  db.prepare("UPDATE settings SET value='1', updated_at=CURRENT_TIMESTAMP WHERE key=?").run(SETUP_USED_KEY);
  return true;
}

export function setupStatus() {
  return Boolean(db.prepare("SELECT 1 FROM users WHERE role='owner' LIMIT 1").get());
}

export async function createOwner(email: string, password: string) {
  const passwordHash = await hashPassword(password);
  const result = db.prepare("INSERT INTO users (email,password_hash,role) VALUES (?,?, 'owner')").run(email.trim().toLowerCase(), passwordHash);
  return Number(result.lastInsertRowid);
}
