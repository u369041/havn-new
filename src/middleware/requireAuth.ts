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
 * Sets req.user = decoded JWT payload.
 */
const requireAuth = (function (req: any, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({ ok: false, message: "Missing Bearer token" });
    }

    const token = header.replace("Bearer ", "").trim();
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      console.error("JWT_SECRET missing");
      return res.status(500).json({ ok: false, message: "Server misconfigured" });
    }

    const decoded = jwt.verify(token, secret);
    const payload: any = decoded;

    const userId = payload.sub ? parseInt(payload.sub, 10) : payload.userId;

    req.user = {
      userId,
      role: payload.role || "user",
      email: payload.email || null,
      raw: payload,
    } satisfies UserPayload;

    return next();
  } catch (err: any) {
    return res.status(401).json({ ok: false, message: "Invalid token" });
  }
}) as AuthMiddleware;

/**
 * Optional auth middleware.
 * If valid token => req.user set
 * If no token/invalid => req.user = null, continues
 */
requireAuth.optional = function optionalAuth(req: any, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
      req.user = null;
      return next();
    }

    const token = header.replace("Bearer ", "").trim();
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      req.user = null;
      return next();
    }

    const decoded = jwt.verify(token, secret);
    const payload: any = decoded;

    const userId = payload.sub ? parseInt(payload.sub, 10) : payload.userId;

    req.user = {
      userId,
      role: payload.role || "user",
      email: payload.email || null,
      raw: payload,
    } satisfies UserPayload;

    return next();
  } catch (err) {
    req.user = null;
    return next();
  }
};

export default requireAuth;
