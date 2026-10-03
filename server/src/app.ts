import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import cors from "cors";
import { env } from "./config/env.js";
import { mutationOriginCheck } from "./middleware/security.js";
import { csrfProtection } from "./auth/csrf.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admins.js";

export function createApp(){
 const app=express();
 app.disable("x-powered-by");
 app.use(helmet());
 app.use(express.json({limit:"2mb"}));
 app.use(cookieParser());
 app.use(cors({origin:env.panelOrigin,credentials:true}));
 app.use(mutationOriginCheck);
 app.use(csrfProtection);
 app.get("/api/health",(_req,res)=>res.json({ok:true,service:"mc-panel",database:"ok"}));
 app.use("/api/auth",authRoutes);
 app.use("/api/admins",adminRoutes);
 return app;
}
