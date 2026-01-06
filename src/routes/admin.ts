import { Router } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * ✅ Minimal auth middleware (JWT)
 * - Expects Authorization: Bearer <token>
 * - Decodes token and attaches req.user
 */
function requireAuth(req: any, res: any, next: any) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    if (!token) return res.status(401).json({ ok: false, error: "Missing token" });

    const secret = process.env.JWT_SECRET || "";
    if (!secret) return res.status(500).json({ ok: false, error: "JWT_SECRET missing" });

    const decoded = jwt.verify(token, secret) as any;
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
}

/**
 * ✅ Admin-only middleware
 * - Requires req.user.role === "admin"
 */
function requireAdmin(req: any, res: any, next: any) {
  const role = req.user?.role;
  if (role !== "admin") return res.status(403).json({ ok: false, error: "Admin only" });
  next();
}

/**
 * ✅ GET /api/admin/properties
 * Returns ALL properties for admin view, newest first.
 *
 * NOTE:
 * This endpoint exists so admin.html can fetch a single list
 * and do filtering client-side.
 */
router.get("/properties", requireAuth, requireAdmin, async (req, res) => {
  try {
    const items = await prisma.property.findMany({
      orderBy: { updatedAt: "desc" },
      take: 200, // safety cap for UI
    });

    res.json({ ok: true, items });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message || "Failed to load properties" });
  }
});

/**
 * ✅ GET /api/admin/statuses
 * Returns distinct Property.status values + counts.
 * This is the SINGLE SOURCE OF TRUTH for what the DB actually contains.
 */
router.get("/statuses", requireAuth, requireAdmin, async (req, res) => {
  try {
    const grouped = await prisma.property.groupBy({
      by: ["status"],
      _count: { status: true },
      orderBy: { status: "asc" },
    });

    res.json({
      ok: true,
      statuses: grouped.map((g) => ({
        status: g.status,
        count: g._count.status,
      })),
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message || "Failed to read statuses" });
  }
});

export default router;
