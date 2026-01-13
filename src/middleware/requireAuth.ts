import { Response, NextFunction } from "express";
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

function toInt(value: any): number {
  const n = parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Strict auth middleware.
 * Requires Authorization: Bearer <token>
 */
const requireAuth: AuthMiddleware = ((req: any, res: Response, next: NextFunction) => {
  try {
    const header = String(req.headers.authorization || "");
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({ ok: false, message: "Missing token" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error("JWT_SECRET missing");
      return res.status(500).json({ ok: false, message: "Server misconfigured" });
    }

    const decoded = jwt.verify(token, secret);
    const payload: any = decoded;

    // ✅ Accept user id from common fields, ALWAYS coerce to number
    const rawId = payload.sub ?? payload.userId ?? payload.id;
    const userId = toInt(rawId);

    if (!Number.isFinite(userId)) {
      console.error("Invalid userId in token payload:", payload);
      return res.status(401).json({ ok: false, message: "Invalid token payload" });
    }

    req.user = {
      userId,
      role: payload.role || "user",
      email: payload.email || null,
      raw: payload
    } satisfies UserPayload;

    return next();
  } catch (err: any) {
    console.error("Auth error:", err?.message || err);
    return res.status(401).json({ ok: false, message: "Invalid token" });
  }
}) as AuthMiddleware;

/**
 * Optional auth middleware.
 * If token exists and valid, sets req.user.
 * If not, continues without req.user.
 */
requireAuth.optional = (req: any, res: Response, next: NextFunction) => {
  try {
    const header = String(req.headers.authorization || "");
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) return next();

    const secret = process.env.JWT_SECRET;
    if (!secret) return next();

    const decoded = jwt.verify(token, secret);
    const payload: any = decoded;

    const rawId = payload.sub ?? payload.userId ?? payload.id;
    const userId = toInt(rawId);
    if (!Number.isFinite(userId)) return next();

    req.user = {
      userId,
      role: payload.role || "user",
      email: payload.email || null,
      raw: payload
    } satisfies UserPayload;

    return next();
  } catch {
    return next();
  }
};

export default requireAuth;
