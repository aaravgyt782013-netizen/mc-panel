import { db } from "../database/db.js";

export function audit(action: string, userId: number | null, req: { ip?: string }, target?: string, metadata?: unknown) {
  db.prepare("INSERT INTO audit_logs (user_id, action, target, metadata, ip_address) VALUES (?, ?, ?, ?, ?)")
    .run(userId, action, target ?? null, metadata ? JSON.stringify(metadata) : null, req.ip ?? null);
}
