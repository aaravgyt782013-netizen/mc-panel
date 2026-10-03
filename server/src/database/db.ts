import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { schema } from "./schema.js";

const dbPath = path.resolve(env.databasePath);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(schema);
const columns = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
const names = new Set(columns.map(c => c.name));
if (!names.has("absolute_expires_at")) db.exec("ALTER TABLE sessions ADD COLUMN absolute_expires_at TEXT");
if (!names.has("last_activity_at")) db.exec("ALTER TABLE sessions ADD COLUMN last_activity_at TEXT");
db.exec("UPDATE sessions SET absolute_expires_at=expires_at WHERE absolute_expires_at IS NULL");
db.exec("UPDATE sessions SET last_activity_at=created_at WHERE last_activity_at IS NULL");
