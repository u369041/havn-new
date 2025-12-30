import { Router } from "express";
import requireAdminAuth from "../middleware/adminAuth";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * GET /api/admin/submitted
 * Admin-only: returns submitted listings.
 */
router.get("/submitted", requireAdminAuth, async (_req, res) => {
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
 * ✅ POST /api/admin/properties/:id/approve
 * SUBMITTED → PUBLISHED
 */
router.post("/properties/:id/approve", requireAdminAuth, async (req, res) => {
  const id = Number(req.params.id);

  try {
    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (existing.listingStatus !== "SUBMITTED") {
      return res.status(409).json({
        ok: false,
        message: `Cannot approve listing in status ${existing.listingStatus}`,
      });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "PUBLISHED",
        publishedAt: new Date(),
        rejectionReason: null,
        rejectedAt: null,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /admin/properties/:id/approve error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ✅ POST /api/admin/properties/:id/reject
 * SUBMITTED → REJECTED
 */
router.post("/properties/:id/reject", requireAdminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const reason = String(req.body?.reason || "").trim();

  if (!reason) {
    return res.status(400).json({ ok: false, message: "Rejection reason is required" });
  }

  try {
    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (existing.listingStatus !== "SUBMITTED") {
      return res.status(409).json({
        ok: false,
        message: `Cannot reject listing in status ${existing.listingStatus}`,
      });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "REJECTED",
        rejectionReason: reason,
        rejectedAt: new Date(),
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /admin/properties/:id/reject error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ✅ POST /api/admin/properties/:id/archive
 * PUBLISHED → ARCHIVED
 */
router.post("/properties/:id/archive", requireAdminAuth, async (req, res) => {
  const id = Number(req.params.id);

  try {
    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (existing.listingStatus !== "PUBLISHED") {
      return res.status(409).json({
        ok: false,
        message: `Cannot archive listing in status ${existing.listingStatus}`,
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
 * ✅ POST /api/admin/properties/:id/restore
 * ARCHIVED → PUBLISHED
 */
router.post("/properties/:id/restore", requireAdminAuth, async (req, res) => {
  const id = Number(req.params.id);

  try {
    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (existing.listingStatus !== "ARCHIVED") {
      return res.status(409).json({
        ok: false,
        message: `Cannot restore listing in status ${existing.listingStatus}`,
      });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "PUBLISHED",
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
