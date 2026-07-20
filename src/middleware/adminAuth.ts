import { Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";

/**
 * Database-backed admin authorization.
 *
 * This middleware must be used after requireAuth.
 * It verifies the user's current role in the database rather than
 * relying solely on the role stored inside the JWT.
 */
export default async function requireAdminAuth(
  req: any,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = Number(req.user?.userId);

    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({
        ok: false,
        message: "Authentication required",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        ok: false,
        message: "Account not found",
      });
    }

    if (String(user.role).toLowerCase() !== "admin") {
      return res.status(403).json({
        ok: false,
        message: "Admin access required",
      });
    }

    // Replace the JWT role with the current database role.
    req.user.role = user.role;

    return next();
  } catch (err) {
    console.error("Admin authorization error:", err);

    return res.status(500).json({
      ok: false,
      message: "Could not verify admin access",
    });
  }
}