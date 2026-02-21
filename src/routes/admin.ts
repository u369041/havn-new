// src/routes/admin.ts
import { Router } from "express";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth";

const router = Router();

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
 * ✅ Normalize listingStatus for reporting + UI.
 * Does NOT alter DB — only for counts/UI grouping.
 */
function normalizeListingStatus(raw: any) {
  const s = String(raw || "").trim().toUpperCase();

  if (s === "SUBMITTED" || s === "PENDING") return "SUBMITTED";
  if (s === "PUBLISHED" || s === "LIVE" || s === "APPROVED") return "PUBLISHED";
  if (s === "REJECTED") return "REJECTED";
  if (s === "DRAFT") return "DRAFT";
  if (s === "CLOSED") return "CLOSED";
  if (s === "ARCHIVED") return "ARCHIVED";

  return "OTHER";
}

/**
 * ✅ Ping (admin route health)
 */
router.get("/ping", (_req, res) => {
  res.json({ ok: true, route: "admin", ts: Date.now() });
});

/**
 * ✅ GET /api/admin/properties
 * Returns listings (admin only).
 * Supports optional query filters:
 *   ?status=SUBMITTED|PUBLISHED|DRAFT|REJECTED|CLOSED|ARCHIVED|OTHER|ALL
 *   ?q=search text
 *
 * NOTE: This is not your primary admin list endpoint (you also have /api/properties/_admin).
 * This exists as a safe, schema-correct admin utility route.
 */
router.get("/properties", requireAuth, requireAdmin, async (req, res) => {
  try {
    const statusFilter = String(req.query.status || "").trim().toUpperCase();
    const q = String(req.query.q || "").trim().toLowerCase();

    const items = await prisma.property.findMany({
      orderBy: { updatedAt: "desc" },
      take: 300,
    });

    let filtered = items as any[];

    // ✅ Apply status filter (normalized)
    if (statusFilter && statusFilter !== "ALL") {
      filtered = filtered.filter((p) => normalizeListingStatus(p.listingStatus) === statusFilter);
    }

    // ✅ Apply search filter
    if (q) {
      filtered = filtered.filter((p) => {
        const hay = [
          p.id,
          p.slug,
          p.title,
          p.address1,
          p.address2,
          p.city,
          p.county,
          p.eircode,
          p.listingStatus,
          p.marketStatus,
        ]
          .map((x: any) => String(x || "").toLowerCase())
          .join(" · ");
        return hay.includes(q);
      });
    }

    res.json({ ok: true, items: filtered });
  } catch (err: any) {
    console.error("GET /admin/properties error:", err);
    res.status(500).json({ ok: false, error: err?.message || "Failed to load admin properties" });
  }
});

/**
 * ✅ GET /api/admin/statuses
 * Returns counts by normalized listingStatus.
 */
router.get("/statuses", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const items = await prisma.property.findMany({
      select: { listingStatus: true },
      take: 5000,
    });

    const counts: Record<string, number> = {
      ALL: items.length,
      SUBMITTED: 0,
      PUBLISHED: 0,
      DRAFT: 0,
      REJECTED: 0,
      CLOSED: 0,
      ARCHIVED: 0,
      OTHER: 0,
    };

    for (const it of items as any[]) {
      const s = normalizeListingStatus(it.listingStatus);
      counts[s] = (counts[s] || 0) + 1;
    }

    res.json({ ok: true, counts });
  } catch (err: any) {
    console.error("GET /admin/statuses error:", err);
    res.status(500).json({ ok: false, error: err?.message || "Failed to load status counts" });
  }
});

export default router;