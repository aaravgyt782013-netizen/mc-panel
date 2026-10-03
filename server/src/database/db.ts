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
