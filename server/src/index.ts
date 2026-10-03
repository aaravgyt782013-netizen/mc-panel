import "dotenv/config";
import http from "node:http";
import { env } from "./config/env.js";
import { db } from "./database/db.js";
import { ensureSetupToken } from "./auth/setup.js";
import { createApp } from "./app.js";
import { attachWebSocket } from "./websocket/index.js";

await ensureSetupToken();
const app=createApp();
const server=http.createServer(app);
attachWebSocket(server);
server.listen(env.port,env.host,()=>{console.log("MC Panel listening on http://"+env.host+":"+env.port);console.log("Minecraft root: "+env.minecraftRoot);console.log("Minecraft runtime user: "+env.minecraftUser);});
process.on("SIGTERM",()=>{db.close();server.close(()=>process.exit(0));});
