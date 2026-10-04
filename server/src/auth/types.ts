import type { Request } from "express";

export type AuthUser = {
  id: number;
  email: string;
  role: "owner" | "admin";
};

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
      sessionId?: number;
    }
  }
}
