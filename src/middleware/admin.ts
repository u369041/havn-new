// src/middleware/admin.ts
import type { Request, Response, NextFunction } from "express";

const ADMIN_KEY = process.env.ADMIN_KEY || "";

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const got = req.header("X-Admin-Key") || req.query.admin_key || "";
    if (!ADMIN_KEY || got !== ADMIN_KEY) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    return next();
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
}
