import { Router } from "express";
import requireAdminAuth from "../middleware/adminAuth";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * GET /api/admin/submitted
 * Admin-only: returns submitted listings (legacy endpoint)
 */
router.get("/submitted", requireAdminAuth, async (req, res) => {
  try {
    const items = await prisma.property.findMany({
      where: { listingStatus: "SUBMITTED" },
      orderBy: { submittedAt: "desc" },
    });

    return res.json({ ok: true, items });
  } catch (err: any) {
    console.error("GET /admin/submitted error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * GET /api/admin/properties/submitted
 * Admin-only: submitted listings (preferred)
 */
router.get("/properties/submitted", requireAdminAuth, async (req, res) => {
  try {
    const items = await prisma.property.findMany({
      where: { listingStatus: "SUBMITTED" },
      orderBy: { submittedAt: "desc" },
    });
    return res.json({ ok: true, items });
  } catch (err: any) {
    console.error("GET /admin/properties/submitted error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/admin/properties/:id/approve
 * Admin-only moderation: SUBMITTED -> PUBLISHED
 */
router.post("/properties/:id/approve", requireAdminAuth, async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (existing.listingStatus !== "SUBMITTED") {
      return res.status(409).json({
        ok: false,
        message: `Cannot approve from status ${existing.listingStatus}`,
      });
    }

    const now = new Date();

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "PUBLISHED",
        approvedAt: now,
        approvedById: req.user?.userId ?? null,
        publishedAt: now,

        // ✅ Clear any previous rejection data
        rejectedAt: null,
        rejectedById: null,
        rejectedReason: null,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /admin/properties/:id/approve error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/admin/properties/:id/reject
 * Admin-only moderation: SUBMITTED -> REJECTED
 * Requires { reason }
 */
router.post("/properties/:id/reject", requireAdminAuth, async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const reason = String(req.body?.reason || "").trim();
    if (!reason) return res.status(400).json({ ok: false, message: "Rejection reason required" });

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (existing.listingStatus !== "SUBMITTED") {
      return res.status(409).json({
        ok: false,
        message: `Cannot reject from status ${existing.listingStatus}`,
      });
    }

    const now = new Date();

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "REJECTED",
        rejectedAt: now,
        rejectedById: req.user?.userId ?? null,

        // ✅ FIX: matches schema.prisma
        rejectedReason: reason,

        // ✅ Clear any publish/approval data
        approvedAt: null,
        approvedById: null,
        publishedAt: null,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /admin/properties/:id/reject error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/admin/properties/:id/archive
 * Admin-only: PUBLISHED -> ARCHIVED
 */
router.post("/properties/:id/archive", requireAdminAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (existing.listingStatus !== "PUBLISHED") {
      return res.status(409).json({
        ok: false,
        message: `Cannot archive from status ${existing.listingStatus}`,
      });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "ARCHIVED",
        archivedAt: new Date(),
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /admin/properties/:id/archive error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/admin/properties/:id/restore
 * Admin-only: ARCHIVED -> PUBLISHED (if previously published) else -> DRAFT
 */
router.post("/properties/:id/restore", requireAdminAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (existing.listingStatus !== "ARCHIVED") {
      return res.status(409).json({
        ok: false,
        message: `Cannot restore from status ${existing.listingStatus}`,
      });
    }

    const restoreTo = existing.publishedAt ? "PUBLISHED" : "DRAFT";

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: restoreTo as any,
        archivedAt: null,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /admin/properties/:id/restore error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;
