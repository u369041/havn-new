import { Request, Response, NextFunction } from "express";

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token || token !== process.env.ADMIN_KEY) {
    return res.status(401).json({
      ok: false,
      error: "unauthorized",
      message: "Missing or invalid Authorization header",
    });
  }

  next();
}
