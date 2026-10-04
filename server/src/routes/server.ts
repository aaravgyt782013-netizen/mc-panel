import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import type { MinecraftProcessManager } from "../minecraft/process-manager.js";
import { operationalError } from "../middleware/errors.js";

export function createServerRoutes(manager: MinecraftProcessManager) {
  const router = Router();
  router.use(requireAuth);
  router.get("/status", (_req,res) => res.json(manager.status()));
  router.post("/start", async (_req,res) => { try { res.json(await manager.start()); } catch (error) { operationalError(res,error,409,"Unable to start Minecraft"); } });
  router.post("/stop", async (_req,res) => { try { res.json(await manager.stop()); } catch (error) { operationalError(res,error,409,"Unable to stop Minecraft"); } });
  router.post("/restart", async (_req,res) => { try { res.json(await manager.restart()); } catch (error) { operationalError(res,error,409,"Unable to restart Minecraft"); } });
  router.post("/kill", async (_req,res) => { try { res.json(await manager.kill()); } catch (error) { operationalError(res,error,409,"Unable to kill Minecraft"); } });
  router.post("/console", (req,res) => { try { if (typeof req.body?.command !== "string") return res.status(400).json({ error: "Command is required" }); manager.sendCommand(req.body.command); res.status(204).end(); } catch (error) { operationalError(res,error,409,"Unable to send command"); } });
  return router;
}