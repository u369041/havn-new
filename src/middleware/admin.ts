// src/middleware/admin.ts
import { Request, Response, NextFunction } from "express";

const ADMIN_KEY = process.env.ADMIN_KEY || "havn_8c1d6e0e5b9e4d7f";

export function adminOnly(req: Request, res: Response, next: NextFunction) {
  const key = req.header("x-admin-key");
  if (key && key === ADMIN_KEY) {
    return next();
  }
  return res.status(401).json({ ok: false, error: "Unauthorized" });
}
