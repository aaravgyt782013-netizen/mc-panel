import { WebSocketServer } from "ws";
import type { Server } from "node:http";
import { env } from "../config/env.js";
import { getSession } from "../auth/session.js";
import { timingSafeEqualText } from "../auth/crypto.js";
import type { MinecraftProcessManager } from "../minecraft/process-manager.js";

function cookies(header: string | undefined) {
 const result: Record<string,string> = {}; for (const part of (header ?? "").split(";")) { const i=part.indexOf("="); if(i>0) result[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim()); } return result;
}
export function attachWebSocket(server: Server, manager: MinecraftProcessManager) {
 const wss = new WebSocketServer({ noServer: true });
 server.on("upgrade",(request,socket,head)=>{
  if(request.headers.origin!==env.panelOrigin || request.url!=="/ws"){socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");socket.destroy();return;}
  const c=cookies(request.headers.cookie); const sessionToken=c.mc_session; if(!sessionToken || !getSession(sessionToken)){socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");socket.destroy();return;}
  wss.handleUpgrade(request,socket,head,ws=>{
   const send=(payload: unknown)=>{if(ws.readyState===1)ws.send(JSON.stringify(payload));};
   send({type:"connection:ready",status:manager.status()});
   const onConsole=(entry: unknown)=>send({type:"console",...(entry as object)}); const onStatus=(status: unknown)=>send({type:"status",status});
   manager.on("console",onConsole); manager.on("status",onStatus);
   ws.on("message",raw=>{ try { const message=JSON.parse(String(raw)) as {type?:string;command?:string;csrf?:string};
    if(message.type!=="console:command" || typeof message.command!=="string") return send({type:"error",error:"Invalid WebSocket message"});
    if(!c.mc_csrf || typeof message.csrf!=="string" || !timingSafeEqualText(c.mc_csrf,message.csrf)) return send({type:"error",error:"CSRF validation failed"});
    manager.sendCommand(message.command);
   } catch(error){send({type:"error",error:error instanceof Error?error.message:"Unable to process WebSocket message"});} });
   ws.on("close",()=>{manager.off("console",onConsole);manager.off("status",onStatus);});
  });
 });
 return wss;
}