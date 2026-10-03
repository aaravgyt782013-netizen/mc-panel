import type { RequestHandler } from "express";
import { CSRF_COOKIE } from "./session.js";
import { randomToken, timingSafeEqualText } from "./crypto.js";

export function issueCsrf(res: any) {
  const token = randomToken(32);
  res.cookie(CSRF_COOKIE, token, { httpOnly: false, secure: true, sameSite: "strict", path: "/" });
  return token;
}

export const csrfProtection: RequestHandler = (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get("x-csrf-token");
  if (!cookie || !header || !timingSafeEqualText(cookie, header)) return res.status(403).json({ error: "CSRF validation failed" });
  next();
};
