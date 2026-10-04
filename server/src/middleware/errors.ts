import type { Response } from "express";

export function operationalError(res: Response, error: unknown, status: number, fallback: string): Response {
  console.error("[mc-panel] operational error", error);
  return res.status(status).json({ error: fallback });
}
