// src/routes/admin.ts
import { Router } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * ✅ Minimal JWT auth middleware
 * NOTE: Replace with your canonical auth middleware later
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
 * ✅ Normalize status for counts in case DB uses unexpected values.
 * This does NOT alter the DB — only for reporting + UI.
 */
function normalizeStatus(raw: any) {
  const s = String(raw || "").trim().toUpperCase();

  if (s === "SUBMITTED" || s === "PENDING") return "SUBMITTED";
  if (s === "PUBLISHED" || s === "LIVE" || s === "APPROVED") return "PUBLISHED";
  if (s === "REJECTED") return "REJECTED";
  if (s === "DRAFT") return "DRAFT";

  // Unknown / null
  return "OTHER";
}

/**
 * ✅ Ping (admin route health)
 */
router.get("/ping", (req, res) => {
  res.json({ ok: true, route: "admin", ts: Date.now() });
});

/**
 * ✅ GET /api/admin/properties
 * Returns all listings (admin only).
 * Supports optional query filters:
 *   ?status=SUBMITTED|PUBLISHED|DRAFT|REJECTED|OTHER
 *   ?q=search text
 */
router.get("/properties", requireAuth, requireAdmin, async (req, res) => {
  try {
    const statusFilter = String(req.query.status || "").trim().toUpperCase();
    const q = String(req.query.q || "").trim().toLowerCase();

    // ✅ Grab a reasonable amount (you can paginate later)
    const items = await prisma.property.findMany({
      orderBy: { createdAt: "desc" } as any, // in case createdAt exists
      take: 300,
    });

    let filtered = items as any[];

    // ✅ Apply status filter (normalized)
    if (statusFilter && statusFilter !== "ALL") {
      filtered = filtered.filter((p) => normalizeStatus(p.status) === statusFilter);
    }

    // ✅ Apply search filter
    if (q) {
      filtered = filtered.filter((p) => {
        const hay = [
          p.id,
          p.slug,
          p.title,
          p.address,
          p.address2,
          p.city,
          p.county,
          p.eircode,
          p.status,
        ]
          .map((x: any) => String(x || "").toLowerCase())
          .join(" · ");
        return hay.includes(q);
      });
    }

    res.json({ ok: true, items: filtered });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message || "Failed to load admin properties" });
  }
});

/**
 * ✅ GET /api/admin/statuses
 * Returns counts by normalized status.
 */
router.get("/statuses", requireAuth, requireAdmin, async (req, res) => {
  try {
    const items = await prisma.property.findMany({
      select: { status: true } as any,
      take: 2000,
    });

    const counts = {
      ALL: items.length,
      SUBMITTED: 0,
      PUBLISHED: 0,
      DRAFT: 0,
      REJECTED: 0,
      OTHER: 0,
    };

    for (const it of items as any[]) {
      const s = normalizeStatus(it.status);
      (counts as any)[s] = ((counts as any)[s] || 0) + 1;
    }

    res.json({ ok: true, counts });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message || "Failed to load status counts" });
  }
});

export default router;
