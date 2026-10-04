import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import cors from "cors";
import { env } from "./config/env.js";
import { mutationOriginCheck } from "./middleware/security.js";
import { csrfProtection } from "./auth/csrf.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admins.js";
import { createServerRoutes } from "./routes/server.js";
import { MinecraftProcessManager } from "./minecraft/process-manager.js";
import versionsRoutes from "./routes/versions.js";
import propertiesRoutes from "./routes/properties.js";
import { createPlayerRoutes } from "./routes/players.js";
import filesRoutes from "./routes/files.js";
import pluginsRoutes from "./routes/plugins.js";
import { createBackupRoutes, startBackupScheduler } from "./routes/backups.js";
export function createApp(manager: MinecraftProcessManager = new MinecraftProcessManager()){
 const app=express(); app.disable("x-powered-by"); app.set("trust proxy","loopback"); app.use(helmet()); app.use(express.json({limit:"2mb"})); app.use(cookieParser()); app.use(cors({origin:env.panelOrigin,credentials:true})); app.use(mutationOriginCheck); app.use(csrfProtection);
 app.get("/api/health",(_req,res)=>res.json({ok:true,service:"mc-panel",database:"ok"})); app.use("/api/auth",authRoutes); app.use("/api/admins",adminRoutes); app.use("/api/server",createServerRoutes(manager)); app.use("/api/versions",versionsRoutes); app.use("/api/properties",propertiesRoutes); app.use("/api/players",createPlayerRoutes(manager)); app.use("/api/files",filesRoutes); app.use("/api/plugins",pluginsRoutes); app.use("/api/backups",createBackupRoutes(manager)); startBackupScheduler(manager); return app;
}
