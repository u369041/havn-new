import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

type UserPayload = {
  userId: number;
  role: string;
  email?: string | null;
  raw?: any;
};

type AuthMiddleware = ((req: any, res: Response, next: NextFunction) => any) & {
  optional: (req: any, res: Response, next: NextFunction) => any;
};

/**
 * Strict auth middleware.
 * Requires Authorization: Bearer <token>
 */
const requireAuth: AuthMiddleware = (req: any, res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization || "";
    const parts = header.split(" ");

    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return res.status(401).json({ ok: false, message: "Missing token" });
    }

    const token = parts[1];
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      console.error("JWT_SECRET missing");
      return res.status(500).json({ ok: false, message: "Server misconfigured" });
    }

    const decoded = jwt.verify(token, secret);
    const payload: any = decoded;

    /**
     * ✅ IMPORTANT FIX:
     * Some JWTs use:
     * - sub
     * - userId
     * - id
     *
     * We support all of them and force numeric.
     */
    const rawId =
      payload.sub ??
      payload.userId ??
      payload.id ??
      null;

    const userId = rawId ? parseInt(String(rawId), 10) : NaN;

    if (!Number.isFinite(userId)) {
      console.error("Invalid userId in token payload:", payload);
      return res.status(401).json({ ok: false, message: "Invalid token payload" });
    }

    req.user = {
      userId,
      role: payload.role || "user",
      email: payload.email || null,
      raw: payload,
    } as UserPayload;

    return next();
  } catch (err: any) {
    console.error("Auth error:", err?.message || err);
    return res.status(401).json({ ok: false, message: "Invalid token" });
  }
};

/**
 * Optional auth middleware.
 * If token exists, sets req.user. If not, continues.
 */
requireAuth.optional = (req: any, res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization || "";
    const parts = header.split(" ");

    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return next();
    }

    const token = parts[1];
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      return next();
    }

    const decoded = jwt.verify(token, secret);
    const payload: any = decoded;

    const rawId =
      payload.sub ??
      payload.userId ??
      payload.id ??
      null;

    const userId = rawId ? parseInt(String(rawId), 10) : NaN;
    if (!Number.isFinite(userId)) return next();

    req.user = {
      userId,
      role: payload.role || "user",
      email: payload.email || null,
      raw: payload,
    } as UserPayload;

    return next();
  } catch {
    return next();
  }
};

export default requireAuth;
