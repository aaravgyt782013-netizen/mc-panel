import express, { Router, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { requireAuth } from "../auth/middleware.js";
import { audit } from "../auth/audit.js";
import { env } from "../config/env.js";

export const MAX_UPLOAD_BYTES = env.maxUploadBytes;
const MAX_EXTRACTED_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 1000;
const router = Router();
router.use(requireAuth);

function rootPath(): string { return path.resolve(process.env.MINECRAFT_ROOT?.trim() || env.minecraftRoot); }

function relativeInput(value: unknown): string {
  if (typeof value !== "string" || value.includes("\0") || value.length > 1024) throw new Error("Invalid file path");
  const normalized = value.replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)) throw new Error("Absolute paths are not allowed");
  if (normalized.split("/").some(part => part === "..")) throw new Error("Path traversal is not allowed");
  return normalized.replace(/^\.\//, "");
}

export function resolveSandboxPath(input: unknown, allowMissing = false): string {
  const relative = relativeInput(input);
  fs.mkdirSync(rootPath(), { recursive: true });
  const realRoot = fs.realpathSync(rootPath());
  let current = realRoot;
  const parts = relative ? relative.split("/").filter(Boolean) : [];
  for (let i = 0; i < parts.length; i += 1) {
    const next = path.join(current, parts[i]);
    try {
      const stat = fs.lstatSync(next);
      if (stat.isSymbolicLink()) throw new Error("Symlinks are not allowed");
      current = fs.realpathSync(next);
      if (!current.startsWith(realRoot + path.sep) && current !== realRoot) throw new Error("Path escapes Minecraft sandbox");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && allowMissing) return path.join(fs.realpathSync(current), ...parts.slice(i));
      throw error;
    }
  }
  return current;
}

function auditFile(action: string, req: Request, target: string, metadata?: unknown): void {
  audit(action, req.authUser!.id, req, target, metadata);
}

function writeAtomic(filePath: string, data: string | Buffer): void {
  const parent = fs.realpathSync(path.dirname(filePath));
  const temp = path.join(parent, ".mc-panel-" + process.pid + "-" + Date.now() + ".tmp");
  try { fs.writeFileSync(temp, data, { mode: 0o640 }); fs.renameSync(temp, filePath); }
  finally { fs.rmSync(temp, { force: true }); }
}

function safeZipEntry(entryName: string): string {
  const normalized = entryName.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) throw new Error("ZIP contains an absolute path");
  const parts = normalized.split("/");
  if (parts.some((part, index) => part === ".." || (part === "" && index !== parts.length - 1))) throw new Error("ZIP contains an unsafe path");
  return normalized.replace(/^\.\//, "");
}

export function extractZipSafely(buffer: Buffer, destination: string): number {
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error("Upload exceeds size limit");
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  if (entries.length > MAX_ZIP_ENTRIES) throw new Error("ZIP contains too many entries");
  const base = resolveSandboxPath(destination);
  if (!fs.statSync(base).isDirectory()) throw new Error("ZIP destination must be a directory");
  let extracted = 0;
  for (const entry of entries) {
    const relative = safeZipEntry(entry.entryName);
    if (!relative) continue;
    const baseRelative = path.relative(rootPath(), base).replace(/\\/g, "/");
    const target = resolveSandboxPath(path.posix.join(baseRelative, relative), true);
    if (entry.isDirectory) { fs.mkdirSync(target, { recursive: true, mode: 0o750 }); continue; }
    const data = entry.getData();
    extracted += data.length;
    if (extracted > MAX_EXTRACTED_BYTES) throw new Error("ZIP extracted size exceeds limit");
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o750 });
    writeAtomic(target, data);
  }
  return extracted;
}

router.get("/", (req, res) => {
  try {
    const target = resolveSandboxPath(req.query.path ?? "");
    if (!fs.statSync(target).isDirectory()) return res.status(400).json({ error: "Path is not a directory" });
    const entries = fs.readdirSync(target).map(name => {
      const stat = fs.lstatSync(path.join(target, name));
      return { name, type: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file", size: stat.size };
    });
    res.json({ path: req.query.path ?? "", entries });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Unable to browse files" }); }
});

router.get("/edit", (req, res) => {
  try {
    const target = resolveSandboxPath(req.query.path);
    const stat = fs.lstatSync(target);
    if (!stat.isFile()) return res.status(400).json({ error: "Path is not a file" });
    if (stat.size > 2 * 1024 * 1024) return res.status(413).json({ error: "File is too large to edit" });
    res.json({ path: req.query.path, content: fs.readFileSync(target, "utf8") });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Unable to read file" }); }
});

router.put("/edit", (req, res) => {
  try {
    const target = resolveSandboxPath(req.body?.path, true);
    if (typeof req.body?.content !== "string" || req.body.content.length > 2 * 1024 * 1024) return res.status(400).json({ error: "Invalid file content" });
    if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) return res.status(400).json({ error: "Path is not a regular file" });
    writeAtomic(target, req.body.content); auditFile("FILE_EDIT", req, String(req.body.path)); res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Unable to edit file" }); }
});

router.post("/mkdir", (req, res) => {
  try {
    const target = resolveSandboxPath(req.body?.path, true);
    if (fs.existsSync(target)) return res.status(409).json({ error: "Path already exists" });
    fs.mkdirSync(target, { mode: 0o750 }); auditFile("FILE_MKDIR", req, String(req.body.path)); res.status(201).json({ ok: true });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create directory" }); }
});

router.delete("/", (req, res) => {
  try {
    const target = resolveSandboxPath(req.query.path);
    if (target === fs.realpathSync(rootPath())) return res.status(400).json({ error: "Cannot delete sandbox root" });
    const stat = fs.lstatSync(target); fs.rmSync(target, { recursive: stat.isDirectory(), force: false });
    auditFile("FILE_DELETE", req, String(req.query.path)); res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Unable to delete path" }); }
});

router.put("/upload", express.raw({ type: "application/octet-stream", limit: MAX_UPLOAD_BYTES }), (req: Request, res: Response) => {
  try {
    const target = resolveSandboxPath(req.query.path, true);
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body)) return res.status(400).json({ error: "Binary upload body required" });
    if (fs.existsSync(target) && fs.lstatSync(target).isDirectory()) return res.status(400).json({ error: "Upload target is a directory" });
    writeAtomic(target, body); auditFile("FILE_UPLOAD", req, String(req.query.path), { bytes: body.length });
    res.status(201).json({ ok: true, bytes: body.length });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Unable to upload file" }); }
});

router.post("/extract", express.raw({ type: "application/octet-stream", limit: MAX_UPLOAD_BYTES }), (req: Request, res: Response) => {
  try {
    const destination = resolveSandboxPath(req.query.path ?? "");
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body)) return res.status(400).json({ error: "Binary ZIP body required" });
    const bytes = extractZipSafely(body, destination); auditFile("FILE_ZIP_EXTRACT", req, String(req.query.path ?? ""), { bytes });
    res.status(201).json({ ok: true, bytes });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Unable to extract ZIP" }); }
});
export default router;