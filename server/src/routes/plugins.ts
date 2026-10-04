import express, { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { requireAuth, requireOwner } from "../auth/middleware.js";
import { audit } from "../auth/audit.js";
import { env } from "../config/env.js";

export type PluginKind = "plugin" | "mod";
const MODRINTH_API = "https://api.modrinth.com";
const MODRINTH_CDN = "https://cdn.modrinth.com";
const MAX_PLUGIN_BYTES = Math.min(env.maxUploadBytes, 50 * 1024 * 1024);
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.jar$/;
const ID_RE = /^[A-Za-z0-9]{8}$/;
const router = Router();
router.use(requireAuth);

function kind(value: unknown): PluginKind {
  if (value !== "plugin" && value !== "mod") throw new Error("Invalid plugin/mod kind");
  return value;
}
export function validateModrinthId(value: unknown): string {
  if (typeof value !== "string" || !ID_RE.test(value)) throw new Error("Invalid Modrinth project/version ID");
  return value;
}
export function validateJarName(value: unknown): string {
  if (typeof value !== "string" || !NAME_RE.test(value) || value.includes("..") || value.includes("/") || value.includes("\\") || value.includes("\0")) throw new Error("Invalid JAR filename");
  return value;
}
export function assertModrinthDownloadUrl(value: unknown): URL {
  if (typeof value !== "string") throw new Error("Invalid Modrinth download URL");
  const url = new URL(value);
  if (url.protocol !== "https:" || ![new URL(MODRINTH_CDN).hostname, new URL(MODRINTH_API).hostname].includes(url.hostname)) throw new Error("Download host is not an official Modrinth HTTPS host");
  if (url.hostname !== new URL(MODRINTH_CDN).hostname) throw new Error("Modrinth file downloads must use the official CDN");
  return url;
}
export function verifySha512(data: Buffer, expected: unknown): void {
  if (typeof expected !== "string" || !/^[a-f0-9]{128}$/i.test(expected)) throw new Error("Missing or invalid Modrinth SHA-512");
  const actual = crypto.createHash("sha512").update(data).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected.toLowerCase(), "hex"))) throw new Error("Modrinth SHA-512 mismatch");
}
function rootPath(): string { return path.resolve(process.env.MINECRAFT_ROOT?.trim() || env.minecraftRoot); }
function targetDir(k: PluginKind): string { return path.join(rootPath(), k === "plugin" ? "plugins" : "mods"); }
function installed(k: PluginKind) {
  const dir = targetDir(k); fs.mkdirSync(dir, { recursive: true });
  return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && (NAME_RE.test(e.name) || /^.+\.jar\.disabled$/.test(e.name))).map(e => ({ name:e.name, enabled:e.name.endsWith(".jar"), size:fs.statSync(path.join(dir,e.name)).size }));
}
async function modrinthJson<T>(url: string): Promise<T> {
  const parsed = new URL(url); if (parsed.protocol !== "https:" || parsed.hostname !== new URL(MODRINTH_API).hostname) throw new Error("Invalid Modrinth API URL");
  const response = await fetch(parsed, { headers: { "User-Agent": "aaravgyt782013-netizen/mc-panel/1.0" } });
  if (!response.ok) throw new Error("Modrinth request failed: " + response.status);
  return await response.json() as T;
}
export async function downloadAndVerifyModrinth(url: string, expectedHash: string, expectedSize: number | undefined, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const parsed = assertModrinthDownloadUrl(url);
  const response = await fetchImpl(parsed, { headers: { "User-Agent": "aaravgyt782013-netizen/mc-panel/1.0" } });
  if (!response.ok) throw new Error("Modrinth download failed: " + response.status);
  const length = response.headers.get("content-length"); if (length && Number(length) > MAX_PLUGIN_BYTES) throw new Error("Modrinth file exceeds size limit");
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > MAX_PLUGIN_BYTES) throw new Error("Modrinth file exceeds size limit");
  if (expectedSize !== undefined && Number.isInteger(expectedSize) && data.length !== expectedSize) throw new Error("Modrinth file size mismatch");
  verifySha512(data, expectedHash);
  return data;
}
router.get("/installed", (req,res) => {
  try { const k=kind(req.query.kind); res.json({kind:k,files:installed(k)}); } catch(e) { res.status(400).json({error:e instanceof Error?e.message:"Invalid request"}); }
});
router.get("/modrinth/search", async (req,res) => {
  try {
    const k=kind(req.query.kind), q=typeof req.query.q==="string"?req.query.q.trim():"";
    if (!q || q.length>100) return res.status(400).json({error:"Search query must be 1-100 characters"});
    const facets=encodeURIComponent(JSON.stringify([[k==="plugin"?"all_project_types:plugin":"project_type:mod"]]));
    const data=await modrinthJson<{hits:unknown[];total_hits:number}>(MODRINTH_API+"/v2/search?query="+encodeURIComponent(q)+"&facets="+facets+"&limit=20");
    res.json({kind:k,...data});
  } catch(e) { res.status(502).json({error:e instanceof Error?e.message:"Modrinth search failed"}); }
});
router.post("/upload", requireOwner, express.raw({type:"application/octet-stream",limit:MAX_PLUGIN_BYTES}), (req:Request,res:Response) => {
  try {
    const k=kind(req.query.kind), filename=validateJarName(req.query.filename), body=req.body as Buffer;
    if (!Buffer.isBuffer(body)) return res.status(400).json({error:"Binary JAR body required"});
    if (body.length>MAX_PLUGIN_BYTES) return res.status(413).json({error:"JAR exceeds size limit"});
    const dir=targetDir(k), target=path.join(dir,filename);
    fs.mkdirSync(dir,{recursive:true});
    if (fs.existsSync(target)) return res.status(409).json({error:"JAR already exists"});
    const temp=path.join(dir,".mc-panel-upload-"+process.pid+"-"+Date.now()+".tmp");
    try { fs.writeFileSync(temp,body,{mode:0o640}); fs.renameSync(temp,target); } finally { fs.rmSync(temp,{force:true}); }
    audit("PLUGIN_UPLOAD",req.authUser!.id,req,filename,{kind:k,bytes:body.length});
    res.status(201).json({ok:true,kind:k,name:filename,bytes:body.length});
  } catch(e) { res.status(400).json({error:e instanceof Error?e.message:"Unable to upload JAR"}); }
});
router.post("/toggle", requireOwner, (req,res) => {
  try {
    const k=kind(req.body?.kind), name=validateJarName(req.body?.name), enable=req.body?.enabled;
    if (typeof enable!=="boolean") return res.status(400).json({error:"enabled must be boolean"});
    const dir=targetDir(k), source=path.join(dir,enable?name:name+".disabled"), target=path.join(dir,enable?name:name.replace(/\.jar$/,".jar.disabled"));
    if (!fs.existsSync(source)) return res.status(404).json({error:"JAR not found"});
    if (fs.existsSync(target)) return res.status(409).json({error:"Target JAR already exists"});
    fs.renameSync(source,target); audit(enable?"PLUGIN_ENABLE":"PLUGIN_DISABLE",req.authUser!.id,req,name,{kind:k});
    res.json({ok:true,kind:k,name:target.split(path.sep).pop(),enabled:enable});
  } catch(e) { res.status(400).json({error:e instanceof Error?e.message:"Unable to toggle JAR"}); }
});
router.post("/modrinth/install", requireOwner, async (req,res) => {
  try {
    const k=kind(req.body?.kind), projectId=validateModrinthId(req.body?.projectId), versionId=validateModrinthId(req.body?.versionId);
    const project=await modrinthJson<{project_type?:string;all_project_types?:string[]}>(MODRINTH_API+"/v2/project/"+projectId);
    const compatibleProject=k==="plugin" ? project.project_type==="plugin" || project.all_project_types?.includes("plugin") : project.project_type==="mod";
    if (!compatibleProject) throw new Error("Modrinth project type does not match installation target");
    const version=await modrinthJson<{project_id:string;files:Array<{url:string;filename:string;hashes:{sha512?:string};primary?:boolean;size?:number}>}>(MODRINTH_API+"/v2/version/"+versionId);
    if (version.project_id!==projectId) throw new Error("Modrinth project/version mismatch");
    const file=version.files.find(f=>f.primary) ?? version.files[0];
    if (!file) throw new Error("Modrinth version has no downloadable file");
    const filename=validateJarName(file.filename);
    const data=await downloadAndVerifyModrinth(file.url,file.hashes?.sha512 ?? "",file.size);
    const dir=targetDir(k); fs.mkdirSync(dir,{recursive:true}); const target=path.join(dir,filename);
    if (fs.existsSync(target)) return res.status(409).json({error:"JAR already exists"});
    const temp=path.join(dir,".mc-panel-modrinth-"+process.pid+"-"+Date.now()+".tmp");
    try { fs.writeFileSync(temp,data,{mode:0o640}); fs.renameSync(temp,target); } finally { fs.rmSync(temp,{force:true}); }
    audit("MODRINTH_INSTALL",req.authUser!.id,req,projectId,{kind:k,versionId,filename,bytes:data.length,sha512:file.hashes.sha512});
    res.status(201).json({ok:true,kind:k,projectId,versionId,name:filename,bytes:data.length});
  } catch(e) { res.status(400).json({error:e instanceof Error?e.message:"Unable to install Modrinth file"}); }
});
export default router;