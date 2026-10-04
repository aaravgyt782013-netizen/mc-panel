import { Router } from "express";
import type { MinecraftProcessManager } from "../minecraft/process-manager.js";
import { requireOwner } from "../auth/middleware.js";
import { audit } from "../auth/audit.js";
import { backupPath, createBackup, enforceRetention, listBackups, restoreBackup, validateBackupId } from "../minecraft/backups.js";
import { env } from "../config/env.js";
import fs from "node:fs";

export function createBackupRoutes(manager: MinecraftProcessManager) {
  const router = Router(); router.use(requireOwner);
  router.get("/", (_req,res) => res.json({ backups: listBackups(), retention: env.backupRetention }));
  router.post("/create", async (req,res) => {
    try { const result = await createBackup(manager); const removed = enforceRetention(); audit("BACKUP_CREATE", req.authUser!.id, req, result.id, {size:result.size,removed}); res.status(201).json({ok:true,...result,removed}); }
    catch (e) { try { manager.sendCommand("save-on"); } catch {} res.status(409).json({error:e instanceof Error?e.message:"Backup failed"}); }
  });
  router.post("/restore", async (req,res) => {
    try { const id=validateBackupId(req.body?.id); const result=await restoreBackup(manager,id); const removed=enforceRetention(); audit("BACKUP_RESTORE",req.authUser!.id,req,id,{safetyBackupId:result.safetyBackupId,removed}); res.json({ok:true,id,...result,removed}); }
    catch (e) { res.status(409).json({error:e instanceof Error?e.message:"Restore failed"}); }
  });
  router.delete("/:id",(req,res)=>{try{const id=validateBackupId(req.params.id),file=backupPath(id);if(!fs.existsSync(file))return res.status(404).json({error:"Backup not found"});fs.rmSync(file);audit("BACKUP_DELETE",req.authUser!.id,req,id);res.json({ok:true,id});}catch(e){res.status(400).json({error:e instanceof Error?e.message:"Delete failed"});}});
  return router;
}
export function startBackupScheduler(manager: MinecraftProcessManager): NodeJS.Timeout | null {
  if (env.backupIntervalMinutes < 1) return null;
  const timer=setInterval(async()=>{try{const status=manager.status().status;if(status==="offline"||status==="crash-loop")return;const result=await createBackup(manager);const removed=enforceRetention();audit("BACKUP_SCHEDULED",null,{},result.id,{size:result.size,removed});}catch{}},env.backupIntervalMinutes*60000);
  timer.unref(); return timer;
}
