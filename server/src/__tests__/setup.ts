import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-panel-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = path.join(testRoot, "panel.db");
process.env.MINECRAFT_ROOT = path.join(testRoot, "minecraft");
process.env.BACKUP_ROOT = path.join(testRoot, "backups");
fs.mkdirSync(process.env.MINECRAFT_ROOT, { recursive: true });
fs.mkdirSync(process.env.BACKUP_ROOT, { recursive: true });
