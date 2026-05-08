// src/routes/admin.ts
import { Router } from "express";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth";

const router = Router();

function requireAdmin(req: any, res: any, next: any) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ ok: false, error: "Admin only" });
  }
  next();
}

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

function normalizePayload(body: any) {
  if (!body) return {};

  if (typeof body === "string") {
    const s = body.trim();
    if (!s) return {};
    try {
      return JSON.parse(s);
    } catch {
      return {};
    }
  }

  if (typeof body === "object") return body;
  return {};
}

function asOptionalDate(raw: any): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

router.get("/ping", (_req, res) => {
  res.json({ ok: true, route: "admin", ts: Date.now() });
});

router.get("/properties", requireAuth, requireAdmin, async (req, res) => {
  try {
    const statusFilter = String(req.query.status || "").trim().toUpperCase();
    const q = String(req.query.q || "").trim().toLowerCase();

    const items = await prisma.property.findMany({
      orderBy: [
        { isFeatured: "desc" },
        { updatedAt: "desc" },
      ],
      take: 300,
    });

    let filtered = items as any[];

    if (statusFilter && statusFilter !== "ALL") {
      filtered = filtered.filter((p) => normalizeListingStatus(p.listingStatus) === statusFilter);
    }

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
    console.error("GET /api/admin/properties error:", err);
    res.status(500).json({ ok: false, error: err?.message || "Failed to load admin properties" });
  }
});

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
    console.error("GET /api/admin/statuses error:", err);
    res.status(500).json({ ok: false, error: err?.message || "Failed to load status counts" });
  }
});

router.patch("/properties/:id", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid property id" });
    }

    const payload = normalizePayload(req.body);
    const nextStatus = normalizeListingStatus(payload.listingStatus);

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ ok: false, message: "Property not found" });
    }

    const data: any = {};

    if (nextStatus !== "OTHER") {
      data.listingStatus = nextStatus;
    }

    if (payload.adminNote || payload.reason) {
      data.rejectedReason = String(payload.adminNote || payload.reason).trim();
    }

    const updated = await prisma.property.update({
      where: { id },
      data,
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("PATCH /api/admin/properties/:id error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.post("/properties/:id/approve", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid property id" });
    }

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ ok: false, message: "Property not found" });
    }

    const now = new Date();

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "PUBLISHED",
        publishedAt: existing.publishedAt || now,
        approvedAt: now,
        approvedById: req.user.userId,
        rejectedAt: null,
        rejectedById: null,
        rejectedReason: null,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /api/admin/properties/:id/approve error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.post("/properties/:id/reject", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid property id" });
    }

    const payload = normalizePayload(req.body);
    const reason = String(payload.reason || payload.adminNote || "").trim() || null;

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ ok: false, message: "Property not found" });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "REJECTED",
        rejectedAt: new Date(),
        rejectedById: req.user.userId,
        rejectedReason: reason,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /api/admin/properties/:id/reject error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.post("/properties/:id/feature", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid property id" });
    }

    const payload = normalizePayload(req.body);
    const featuredUntil = asOptionalDate(payload.featuredUntil);

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ ok: false, message: "Property not found" });
    }

    if (existing.listingStatus !== "PUBLISHED") {
      return res.status(409).json({ ok: false, message: "Only published listings can be featured" });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        isFeatured: true,
        featuredUntil,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /api/admin/properties/:id/feature error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.post("/properties/:id/unfeature", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid property id" });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        isFeatured: false,
        featuredUntil: null,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /api/admin/properties/:id/unfeature error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.post("/properties/:id/close", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid property id" });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "CLOSED",
        archivedAt: new Date(),
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /api/admin/properties/:id/close error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.post("/properties/:id/reopen", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid property id" });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "PUBLISHED",
        archivedAt: null,
        publishedAt: new Date(),
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /api/admin/properties/:id/reopen error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;