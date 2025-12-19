import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

export type AuthedRequest = Request & {
  user?: { id: string };
};

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers?.authorization ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing token" });
    }

    const secret = process.env.JWT_SECRET || "";
    if (!secret) {
      return res.status(500).json({ ok: false, error: "JWT_SECRET not set" });
    }

    const decoded = jwt.verify(token, secret) as JwtPayload;

    const userId =
      typeof decoded?.sub === "string"
        ? decoded.sub
        : typeof (decoded as any)?.userId === "string"
        ? (decoded as any).userId
        : null;

    if (!userId) {
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }

    (req as AuthedRequest).user = { id: userId };
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
}
