import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import type { MinecraftProcessManager } from "./process-manager.js";
import { env } from "../config/env.js";

export const DEFAULT_BACKUP_ROOT = "/srv/minecraft-backups";
const ID_RE = /^backup-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$/;

export function backupRoot(): string { return path.resolve(process.env.BACKUP_ROOT?.trim() || env.backupRoot); }
export function validateBackupId(value: unknown): string {
  if (typeof value !== "string" || !ID_RE.test(value)) throw new Error("Invalid backup ID");
  return value;
}
export function backupFilename(id: string): string { validateBackupId(id); return id + ".zip"; }
export function backupPath(id: string): string { return path.join(backupRoot(), backupFilename(id)); }
export function freeBytes(target = backupRoot()): number {
  fs.mkdirSync(target, { recursive: true });
  const stat = fs.statfsSync(target);
  return Number(stat.bavail) * Number(stat.bsize);
}
function minecraftRoot(): string { return path.resolve(process.env.MINECRAFT_ROOT?.trim() || env.minecraftRoot); }
function newId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return "backup-" + stamp + "-" + Math.random().toString(16).slice(2, 10).padStart(8, "0").slice(0, 8);
}
export function listBackups() {
  fs.mkdirSync(backupRoot(), { recursive: true });
  return fs.readdirSync(backupRoot()).filter(n => /^backup-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}\.zip$/.test(n)).map(filename => {
    const stat = fs.statSync(path.join(backupRoot(), filename));
    return { id: filename.slice(0, -4), filename, size: stat.size, createdAt: stat.mtime.toISOString() };
  }).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
}
export function enforceRetention(limit = env.backupRetention): string[] {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid backup retention limit");
  const removed = listBackups().slice(limit);
  for (const item of removed) fs.rmSync(path.join(backupRoot(), item.filename), { force: true });
  return removed.map(x => x.id);
}
function enoughSpace(required: number): void {
  const free = freeBytes();
  if (free < Math.max(64 * 1024 * 1024, Math.ceil(required * 1.1))) throw new Error("Insufficient free disk space for backup");
}
function zipMinecraftRoot(destination: string): void {
  const root = minecraftRoot(), zip = new AdmZip();
  const walk = (dir: string, rel = "") => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "session.lock") continue;
      const full = path.join(dir, entry.name), child = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) walk(full, child);
      else if (entry.isFile()) zip.addLocalFile(full, rel || undefined, entry.name);
    }
  };
  walk(root);
  zip.writeZip(destination);
}
export async function createBackup(manager: MinecraftProcessManager, requiredBytes = 256 * 1024 * 1024) {
  const root = minecraftRoot();
  if (!fs.existsSync(root)) throw new Error("Minecraft root does not exist");
  fs.mkdirSync(backupRoot(), { recursive: true });
  enoughSpace(requiredBytes);
  let saveLocked = false;
  try {
    manager.sendCommand("save-off"); saveLocked = true;
    manager.sendCommand("save-all flush");
    await new Promise(resolve => setTimeout(resolve, 250));
    enoughSpace(requiredBytes);
    const backupId = newId(), destination = backupPath(backupId), temp = destination + ".tmp";
    try { zipMinecraftRoot(temp); fs.renameSync(temp, destination); }
    finally { fs.rmSync(temp, { force: true }); }
    return { id: backupId, filename: path.basename(destination), size: fs.statSync(destination).size };
  } finally {
    if (saveLocked) { try { manager.sendCommand("save-on"); } catch {} }
  }
}
async function createSafetyBackup(): Promise<string> {
  const backupId = newId(), destination = backupPath(backupId), temp = destination + ".tmp";
  enoughSpace(256 * 1024 * 1024);
  try { zipMinecraftRoot(temp); fs.renameSync(temp, destination); }
  finally { fs.rmSync(temp, { force: true }); }
  return backupId;
}
export async function restoreBackup(manager: MinecraftProcessManager, id: string) {
  validateBackupId(id);
  if (manager.status().status !== "offline") throw new Error("Server must be stopped before restore");
  const source = backupPath(id);
  if (!fs.existsSync(source)) throw new Error("Backup not found");
  const safetyBackupId = await createSafetyBackup();
  const root = minecraftRoot(), safeRoot = fs.realpathSync(root), zip = new AdmZip(source);
  for (const entry of zip.getEntries()) {
    const n = entry.entryName.replace(/\\/g, "/");
    if (!n || n.startsWith("/") || /^[A-Za-z]:/.test(n) || n.split("/").some(p => !p || p === "." || p === "..")) throw new Error("Backup contains unsafe path");
    const target = path.resolve(root, n);
    if (target !== safeRoot && !target.startsWith(safeRoot + path.sep)) throw new Error("Backup escapes Minecraft root");
  }
  fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root, { recursive: true });
  for (const entry of zip.getEntries()) {
    const target = path.join(root, entry.entryName);
    if (entry.isDirectory) fs.mkdirSync(target, { recursive: true, mode: 0o750 });
    else { fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o750 }); fs.writeFileSync(target, entry.getData(), { mode: 0o640 }); }
  }
  return { safetyBackupId };
}
