import { Response, NextFunction } from "express";
import requireAuth from "./requireAuth";

/**
 * requireAdminAuth:
 * - Requires valid JWT
 * - Requires req.user.role === 'admin'
 */
export default function requireAdminAuth(req: any, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({ ok: false, message: "Admin access required" });
    }
    return next();
  });
}
