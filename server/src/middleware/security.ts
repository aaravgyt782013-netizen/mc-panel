import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

export const authRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

export const mutationOriginCheck: RequestHandler = (req, res, next) => {
  if (!["POST","PUT","PATCH","DELETE"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (origin && origin !== env.panelOrigin) { res.status(403).json({ error: "Invalid request origin" }); return; }
  next();
};
