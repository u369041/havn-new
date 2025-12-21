import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

type JwtPayloadLike = {
  userId?: string;
  id?: string;
  sub?: string;
  email?: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __havn_auth_declared: boolean | undefined;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: {
      id: string;
      email?: string;
    };
  }
}

function getBearerToken(req: Request): string {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing token" });

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: "JWT_SECRET not set" });

    const decoded = jwt.verify(token, secret) as JwtPayloadLike;

    const id = String(decoded.userId || decoded.id || decoded.sub || "").trim();
    if (!id) return res.status(401).json({ error: "Invalid token payload" });

    req.user = {
      id,
      email: decoded.email ? String(decoded.email) : undefined,
    };

    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
