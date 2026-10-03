import type { RequestHandler } from "express";
import { getSession, SESSION_COOKIE } from "./session.js";

export const requireAuth: RequestHandler = (req, res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: "Authentication required" });
  const session = getSession(token);
  if (!session) return res.status(401).json({ error: "Authentication required" });
  req.authUser = { id: session.userId, email: session.email, role: session.role };
  req.sessionId = session.id;
  next();
};

export const requireOwner: RequestHandler = (req, res, next) => {
  if (req.authUser?.role !== "owner") return res.status(403).json({ error: "Owner access required" });
  next();
};
