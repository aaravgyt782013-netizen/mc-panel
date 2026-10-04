import crypto from "node:crypto";
import { db } from "../database/db.js";

export type WebhookEvent="start"|"stop"|"crash"|"test";
const WEBHOOK_PATH=/^\/api\/webhooks\/[0-9]+\/[^/?#]+\/?$/;

export function validateDiscordWebhookUrl(input:string):URL{
  if(/^https:\/\/[^/?#]+:\d+(?:[/?#]|$)/.test(input)||/[\s\u0000-\u001F\u007F]/.test(input))throw new Error("Invalid Discord webhook URL");
  try{
    const u=new URL(input);
    if(u.protocol!=="https:"||(u.hostname!=="discord.com"&&u.hostname!=="discordapp.com")||u.username||u.password||u.port||u.search||u.hash||!WEBHOOK_PATH.test(u.pathname)){
      throw new Error("Webhook URL must be an HTTPS Discord webhook URL");
    }
    return u;
  }catch(error){
    if(error instanceof Error&&error.message==="Webhook URL must be an HTTPS Discord webhook URL")throw error;
    throw new Error("Invalid Discord webhook URL");
  }
}
export function maskDiscordWebhookUrl(value:string):string{const u=validateDiscordWebhookUrl(value);const parts=u.pathname.split("/").filter(Boolean);return u.origin+"/api/webhooks/"+parts[2]+"/***";}
function encryptionKey():Buffer{const raw=process.env.WEBHOOK_ENCRYPTION_KEY?.trim();if(!raw)throw new Error("WEBHOOK_ENCRYPTION_KEY is not configured");const key=Buffer.from(raw,"base64");if(key.length!==32)throw new Error("WEBHOOK_ENCRYPTION_KEY must be base64 for exactly 32 bytes");return key;}
export function encryptWebhookUrl(value:string):string{const u=validateDiscordWebhookUrl(value);const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv("aes-256-gcm",encryptionKey(),iv);const ciphertext=Buffer.concat([cipher.update(u.toString(),"utf8"),cipher.final()]);return [iv.toString("base64"),cipher.getAuthTag().toString("base64"),ciphertext.toString("base64")].join(".");}
export function decryptWebhookUrl(value:string):string{const parts=value.split(".");if(parts.length!==3)throw new Error("Invalid encrypted webhook value");const decipher=crypto.createDecipheriv("aes-256-gcm",encryptionKey(),Buffer.from(parts[0],"base64"));decipher.setAuthTag(Buffer.from(parts[1],"base64"));const plaintext=Buffer.concat([decipher.update(Buffer.from(parts[2],"base64")),decipher.final()]).toString("utf8");return validateDiscordWebhookUrl(plaintext).toString();}
function webhookSettings(){return db.prepare("SELECT enabled,webhook_url_encrypted,notify_start,notify_stop,notify_crash FROM webhook_settings WHERE id=1").get() as {enabled:number;webhook_url_encrypted:string|null;notify_start:number;notify_stop:number;notify_crash:number};}
export function maskedWebhookSettings(){const row=webhookSettings();let url:string|null=null;if(row.webhook_url_encrypted){try{url=maskDiscordWebhookUrl(decryptWebhookUrl(row.webhook_url_encrypted));}catch{url=null;}}return {enabled:Boolean(row.enabled),configured:Boolean(row.webhook_url_encrypted),url,notifyStart:Boolean(row.notify_start),notifyStop:Boolean(row.notify_stop),notifyCrash:Boolean(row.notify_crash)};}
export async function notifyWebhook(event:WebhookEvent,message?:string):Promise<boolean>{try{const row=webhookSettings();if(!row.enabled||!row.webhook_url_encrypted)return false;if(event==="start"&&!row.notify_start||event==="stop"&&!row.notify_stop||event==="crash"&&!row.notify_crash)return false;const url=decryptWebhookUrl(row.webhook_url_encrypted);const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),5000);try{const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content:message??("Minecraft server "+event),allowed_mentions:{parse:[]}}),signal:controller.signal});return response.ok;}finally{clearTimeout(timeout);}}catch{return false;}}
