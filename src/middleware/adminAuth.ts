// src/middleware/adminAuth.ts
import { Request, Response, NextFunction } from "express";
import { requireAuth } from "./auth";

/**
 * Requires a valid JWT and user.role === "admin"
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  return requireAuth(req, res, () => {
    const user = (req as any).user as { role?: string } | undefined;
    if (!user) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }
    if (user.role !== "admin") {
      return res.status(403).json({ ok: false, message: "Admin only" });
    }
    return next();
  });
}
