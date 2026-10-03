import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import type { MinecraftProcessManager } from "../minecraft/process-manager.js";

export function createServerRoutes(manager: MinecraftProcessManager) {
  const router = Router();
  router.use(requireAuth);
  router.get("/status", (_req,res) => res.json(manager.status()));
  router.post("/start", async (_req,res) => { try { res.json(await manager.start()); } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Unable to start Minecraft" }); } });
  router.post("/stop", async (_req,res) => { try { res.json(await manager.stop()); } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Unable to stop Minecraft" }); } });
  router.post("/restart", async (_req,res) => { try { res.json(await manager.restart()); } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Unable to restart Minecraft" }); } });
  router.post("/kill", async (_req,res) => { try { res.json(await manager.kill()); } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Unable to kill Minecraft" }); } });
  router.post("/console", (req,res) => { try { if (typeof req.body?.command !== "string") return res.status(400).json({ error: "Command is required" }); manager.sendCommand(req.body.command); res.status(204).end(); } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Unable to send command" }); } });
  return router;
}