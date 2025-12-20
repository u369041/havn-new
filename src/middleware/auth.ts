import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

type JwtPayload = {
  sub: number | string;
  role?: "admin" | "user";
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * Reads Authorization: Bearer <token>
 * Verifies JWT and attaches req.user
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = (req.header("authorization") || "").trim();
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ ok: false, message: "Missing Bearer token" });

    const token = m[1];
    const secret = requireEnv("JWT_SECRET");

    const decoded = jwt.verify(token, secret) as JwtPayload;

    const userId = Number(decoded?.sub);
    if (!userId || !Number.isFinite(userId)) {
      return res.status(401).json({ ok: false, message: "Invalid token subject" });
    }

    // Optional hardening: confirm the user still exists in DB
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, name: true, createdAt: true }
    });

    if (!user) return res.status(401).json({ ok: false, message: "User not found" });

    // Attach for downstream handlers
    (req as any).user = user;

    return next();
  } catch (err: any) {
    return res.status(401).json({ ok: false, message: err?.message || "Unauthorized" });
  }
}
