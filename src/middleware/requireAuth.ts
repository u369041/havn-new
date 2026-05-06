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

function parseBearerToken(req: any): string | null {
  const header = String(req.headers.authorization || "").trim();
  if (!header) return null;

  const parts = header.split(/\s+/);
  if (parts.length !== 2) return null;

  const scheme = parts[0];
  const token = parts[1];

  if (scheme.toLowerCase() !== "bearer" || !token) return null;

  return token;
}

function decodeUserFromToken(token: string): UserPayload {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET missing");
  }

  const decoded = jwt.verify(token, secret);
  const payload: any = decoded;

  const rawId = payload.sub ?? payload.userId ?? payload.id;
  const userId = toInt(rawId);

  if (!Number.isFinite(userId)) {
    throw new Error("Invalid token payload");
  }

  return {
    userId,
    role: payload.role || "user",
    email: payload.email || null,
    raw: payload,
  };
}

/**
 * Strict auth middleware.
 * Requires Authorization: Bearer <token>
 */
const requireAuth: AuthMiddleware = ((req: any, res: Response, next: NextFunction) => {
  try {
    const token = parseBearerToken(req);

    if (!token) {
      return res.status(401).json({ ok: false, message: "Missing token" });
    }

    req.user = decodeUserFromToken(token);

    return next();
  } catch (err: any) {
    if (err?.message === "JWT_SECRET missing") {
      console.error("JWT_SECRET missing");
      return res.status(500).json({ ok: false, message: "Server misconfigured" });
    }

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
    const token = parseBearerToken(req);
    if (!token) return next();

    req.user = decodeUserFromToken(token);
    return next();
  } catch {
    return next();
  }
};

export default requireAuth;