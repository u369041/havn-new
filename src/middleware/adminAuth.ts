// src/middleware/adminAuth.ts
import { Request, Response, NextFunction } from "express";

const ADMIN_KEY = (process.env.ADMIN_KEY || "").trim();

export default function adminAuth(req: Request, res: Response, next: NextFunction) {
  // Expect "Authorization: Bearer <ADMIN_KEY>"
  const authHeader = req.headers["authorization"];
  const header = Array.isArray(authHeader) ? authHeader[0] : (authHeader || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!ADMIN_KEY) {
    return res.status(500).json({
      ok: false,
      error: "admin_key_not_set",
      message: "ADMIN_KEY missing on server",
    });
  }
  if (!token || token !== ADMIN_KEY) {
    return res.status(401).json({
      ok: false,
      error: "unauthorized",
      message: "Missing or invalid Authorization header",
    });
  }
  return next();
}
