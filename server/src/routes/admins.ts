import { Router } from "express";
import { db } from "../database/db.js";
import { requireAuth, requireOwner } from "../auth/middleware.js";
import { randomToken, sha256 } from "../auth/crypto.js";
import { audit } from "../auth/audit.js";

const router = Router();
router.use(requireAuth, requireOwner);

router.get("/", (_req, res) => {
  const admins = db.prepare("SELECT id,email,role,active,created_at,last_login_at FROM users ORDER BY id").all();
  res.json({ admins });
});

router.post("/invite", (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const token = randomToken(32);
  if (!email) return res.status(400).json({ error: "Email is required" });
  if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email)) return res.status(409).json({ error: "Account already exists" });
  const expires = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  db.prepare("INSERT INTO invites (token_hash,created_by,email,expires_at) VALUES (?,?,?,?)").run(sha256(token), req.authUser!.id, email, expires);
  res.status(201).json({ email, token, expiresAt: expires });
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare("SELECT id,email,role FROM users WHERE id=?").get(id) as any;
  if (!target || target.role === "owner") return res.status(404).json({ error: "Admin not found" });
  db.transaction(() => {
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
    db.prepare("DELETE FROM users WHERE id=?").run(id);
  })();
  audit("REMOVE_ADMIN", req.authUser!.id, req, target.email, { removedUserId: id });
  res.json({ ok: true });
});

export default router;
