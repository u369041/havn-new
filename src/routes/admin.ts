import { Router } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * ✅ Minimal JWT auth middleware
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
 */
function requireAdmin(req: any, res: any, next: any) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ ok: false, error: "Admin only" });
  }
  next();
}

/**
 * ✅ Public ping to confirm router is deployed
 * GET /api/admin/ping
 */
router.get("/ping", (req, res) => {
  res.json({ ok: true, route: "admin", ts: new Date().toISOString() });
});

/**
 * ✅ GET /api/admin/properties
 * Returns ALL properties for admin moderation view
 */
router.get("/properties", requireAuth, requireAdmin, async (req, res) => {
  try {
    const items = await prisma.property.findMany({
      orderBy: { updatedAt: "desc" },
      take: 300,
    });

    res.json({ ok: true, items });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message || "Failed to load properties" });
  }
});

/**
 * ✅ GET /api/admin/statuses
 * Returns EXACT DB truth: distinct statuses + counts
 *
 * ⚠️ Uses raw SQL instead of Prisma groupBy to avoid TS recursion errors on Render builds.
 */
router.get("/statuses", requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await prisma.$queryRaw<
      Array<{ status: string | null; count: number }>
    >`SELECT status, COUNT(*)::int AS count
      FROM "Property"
      GROUP BY status
      ORDER BY status ASC;`;

    res.json({
      ok: true,
      statuses: rows.map((r) => ({
        status: r.status ?? "NULL",
        count: r.count ?? 0,
      })),
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message || "Failed to read statuses" });
  }
});

export default router;
