import type { Request, Response, NextFunction } from "express";

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const key = req.header("x-admin-key") || "";
  if (!process.env.DEBUG_KEY) {
    // If no key configured, block by default in production
    return res.status(403).json({ ok: false, error: "debug-disabled" });
  }
  if (key !== process.env.DEBUG_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

