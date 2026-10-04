import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { requireAuth } from "../auth/middleware.js";
import { db } from "../database/db.js";
import { audit } from "../auth/audit.js";
import { env } from "../config/env.js";

const router=Router(); router.use(requireAuth);
const root=()=>path.resolve(process.env.MINECRAFT_ROOT?.trim()||env.minecraftRoot);
const file=()=>path.join(root(),"server.properties");
const keyRe=/^[A-Za-z0-9._-]{1,64}$/;

export function validateProperties(properties: unknown): properties is Record<string,string> {
  if(!properties||typeof properties!=="object"||Array.isArray(properties)) return false;
  const entries=Object.entries(properties);
  if(entries.length>256) return false;
  return entries.every(([key,value])=>keyRe.test(key)&&typeof value==="string"&&value.length<=512&&!/[\r\n]/.test(value));
}

function readProperties(){
  const out:Record<string,string>={};
  if(!fs.existsSync(file())) return out;
  for(const line of fs.readFileSync(file(),"utf8").split(/\r?\n/)){
    if(!line||line.startsWith("#")) continue;
    const i=line.indexOf("=");
    if(i>0) out[line.slice(0,i).trim()]=line.slice(i+1);
  }
  return out;
}

router.get("/",(_req,res)=>res.json({properties:readProperties()}));

router.post("/",(req,res)=>{
  const status=(db.prepare("SELECT status FROM server_status WHERE id=1").get() as {status:string}).status;
  if(status!=="offline") return res.status(409).json({error:"Stop the Minecraft server before editing server.properties"});
  const properties=req.body?.properties;
  if(!validateProperties(properties)) return res.status(400).json({error:"Invalid property entry"});
  const entries=Object.entries(properties);
  fs.mkdirSync(root(),{recursive:true});
  const body=entries.sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n")+"\n";
  fs.writeFileSync(file(),body,{encoding:"utf8",mode:0o640});
  audit("SERVER_PROPERTIES_UPDATE",req.authUser!.id,req,undefined,{count:entries.length});
  res.json({ok:true,properties:readProperties()});
});
export default router;
