import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { requireAuth } from "../auth/middleware.js";
import { audit } from "../auth/audit.js";
import { env } from "../config/env.js";
import type { MinecraftProcessManager } from "../minecraft/process-manager.js";
import { operationalError } from "../middleware/errors.js";

const nameRe=/^[A-Za-z0-9_]{3,16}$/;
const reasonRe=/^[^\r\n]{0,256}$/;
const router=Router(); router.use(requireAuth);
const root=()=>path.resolve(process.env.MINECRAFT_ROOT?.trim()||env.minecraftRoot);

function readJson(name:string){
  const p=path.join(root(),name);
  if(!fs.existsSync(p)) return [];
  try { const v=JSON.parse(fs.readFileSync(p,"utf8")); return Array.isArray(v)?v:[]; } catch { return []; }
}
export function validatePlayerName(value: unknown): value is string { return typeof value==="string"&&nameRe.test(value); }
function checkReason(value:unknown):value is string { return typeof value==="string"&&reasonRe.test(value); }

export function createPlayerRoutes(manager:MinecraftProcessManager){
  router.get("/",(_req,res)=>res.json({
    whitelist:readJson("whitelist.json"),
    ops:readJson("ops.json"),
    bans:readJson("banned-players.json")
  }));
  router.post("/whitelist/add",(req,res)=>command(manager,req,res,"whitelist add","WHITELIST_ADD"));
  router.post("/whitelist/remove",(req,res)=>command(manager,req,res,"whitelist remove","WHITELIST_REMOVE"));
  router.post("/op",(req,res)=>command(manager,req,res,"op","OP"));
  router.post("/deop",(req,res)=>command(manager,req,res,"deop","DEOP"));
  router.post("/ban",(req,res)=>command(manager,req,res,"ban","BAN",true));
  router.post("/pardon",(req,res)=>command(manager,req,res,"pardon","PARDON"));
  router.post("/kick",(req,res)=>command(manager,req,res,"kick","KICK",true));
  return router;
}

function command(manager: MinecraftProcessManager, req: Request, res: Response, prefix: string, auditAction: string, withReason = false){
  const name=req.body?.name;
  if(!validatePlayerName(name)) return res.status(400).json({error:"Invalid player name"});
  const reason=req.body?.reason;
  if(withReason&&reason!==undefined&&!checkReason(reason)) return res.status(400).json({error:"Invalid reason"});
  try{
    manager.sendCommand(prefix+" "+name+(withReason&&reason?" "+reason:""));
    audit(auditAction,req.authUser!.id,req,name,reason?{reason}:undefined);
    res.json({ok:true});
  }catch(e){operationalError(res,e,409,"Unable to execute player command")}
}
export default router;
