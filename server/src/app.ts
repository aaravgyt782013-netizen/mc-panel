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
 // nginx is the only reverse proxy and runs on the same host.
 // Trust only loopback so req.ip uses nginx's X-Forwarded-For client address
 // and req.protocol correctly reflects nginx's X-Forwarded-Proto.
 app.set("trust proxy","loopback");
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
