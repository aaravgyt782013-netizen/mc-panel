import { Router, type Request, type Response } from "express";
import { requireAuth } from "../auth/middleware.js";
import type { MonitoringService } from "../monitoring/service.js";
export function createMonitoringRoutes(monitoring:MonitoringService){const router=Router();router.use(requireAuth);router.get("/metrics",(_req:Request,res:Response)=>{res.json({history:monitoring.getHistory(),onlinePlayers:monitoring.getOnlinePlayers()});});return router;}
