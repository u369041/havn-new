import type { Request, Response, NextFunction } from "express";

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
