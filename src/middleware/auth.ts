// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

export type AuthedUser = {
  id: number;
  email: string;
  role: "admin" | "user";
  name: string | null;
  createdAt: Date;
};

type JwtPayload = {
  sub: number | string;
  role?: "admin" | "user";
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getBearerToken(req: Request): string | null {
  const auth = (req.header("authorization") || "").trim();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function attachUserFromToken(token: string): Promise<AuthedUser> {
  const secret = requireEnv("JWT_SECRET");
  const decoded = jwt.verify(token, secret) as JwtPayload;

  const userId = Number(decoded?.sub);
  if (!userId || !Number.isFinite(userId)) {
    throw new Error("Invalid token subject");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, name: true, createdAt: true },
  });

  if (!user) throw new Error("User not found");
  return user as AuthedUser;
}

/**
 * Requires Authorization: Bearer <token>
 * Verifies JWT and attaches req.user
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ ok: false, message: "Missing Bearer token" });

    const user = await attachUserFromToken(token);
    (req as any).user = user;

    return next();
  } catch (err: any) {
    return res.status(401).json({ ok: false, message: err?.message || "Unauthorized" });
  }
}

/**
 * Optional auth:
 * - If bearer token is present and valid, attaches req.user
 * - If missing/invalid, continues as anonymous (never 401)
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = getBearerToken(req);
  if (!token) return next();

  try {
    const user = await attachUserFromToken(token);
    (req as any).user = user;
  } catch {
    // Ignore invalid tokens for optional-auth routes
  }

  return next();
}

/**
 * Requires admin user (JWT)
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  await requireAuth(req, res, () => {
    const user = (req as any).user as AuthedUser | undefined;
    if (!user) return res.status(401).json({ ok: false, message: "Unauthorized" });
    if (user.role !== "admin") return res.status(403).json({ ok: false, message: "Forbidden" });
    return next();
  });
}
