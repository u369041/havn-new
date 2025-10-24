import type { Request, Response, NextFunction } from "express";

/**
 * Require header: x-admin-key: <ADMIN_KEY>
 * Set ADMIN_KEY in your .env and in Render’s environment.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.ADMIN_KEY;
  const got = req.header("x-admin-key");

  if (!expected) {
    return res
      .status(500)
      .json({ ok: false, error: "server-misconfigured: ADMIN_KEY missing" });
  }
  if (!got || got !== expected) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}
