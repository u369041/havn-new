import express from "express";
import prisma from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/adminAuth";
import { ListingStatus } from "@prisma/client";

const router = express.Router();

/**
 * GET /api/properties/mine
 */
router.get("/mine", requireAuth, async (req, res) => {
  const userId = Number(req.user.id);

  const items = await prisma.property.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });

  res.json({ items });
});

/**
 * POST /api/properties/:id/submit
 * DRAFT | REJECTED → SUBMITTED
 */
router.post("/:id/submit", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const userId = Number(req.user.id);

  const property = await prisma.property.findFirst({
    where: { id, userId },
  });

  if (!property) {
    return res.status(404).json({ ok: false, message: "Property not found" });
  }

  if (
    property.listingStatus !== ListingStatus.DRAFT &&
    property.listingStatus !== ListingStatus.REJECTED
  ) {
    return res.status(400).json({
      ok: false,
      message: "Only draft or rejected listings can be submitted",
    });
  }

  await prisma.property.update({
    where: { id },
    data: {
      listingStatus: ListingStatus.SUBMITTED,
      submittedAt: new Date(),
      rejectionReason: null,
      rejectedAt: null,
      rejectedById: null,
    },
  });

  res.json({ ok: true });
});

/**
 * POST /api/properties/:id/reject
 * SUBMITTED → REJECTED
 */
router.post("/:id/reject", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const adminId = Number(req.user.id);
  const { reason } = req.body;

  if (!reason || typeof reason !== "string") {
    return res.status(400).json({
      ok: false,
      message: "Rejection reason is required",
    });
  }

  const property = await prisma.property.findUnique({
    where: { id },
  });

  if (!property) {
    return res.status(404).json({ ok: false, message: "Property not found" });
  }

  if (property.listingStatus !== ListingStatus.SUBMITTED) {
    return res.status(400).json({
      ok: false,
      message: "Only pending listings can be rejected",
    });
  }

  await prisma.property.update({
    where: { id },
    data: {
      listingStatus: ListingStatus.REJECTED,
      rejectionReason: reason,
      rejectedAt: new Date(),
      rejectedById: adminId,
    },
  });

  res.json({ ok: true });
});

/**
 * POST /api/properties/:id/approve
 * SUBMITTED → PUBLISHED
 */
router.post("/:id/approve", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const adminId = Number(req.user.id);

  const property = await prisma.property.findUnique({
    where: { id },
  });

  if (!property) {
    return res.status(404).json({ ok: false, message: "Property not found" });
  }

  if (property.listingStatus !== ListingStatus.SUBMITTED) {
    return res.status(400).json({
      ok: false,
      message: "Only pending listings can be approved",
    });
  }

  await prisma.property.update({
    where: { id },
    data: {
      listingStatus: ListingStatus.PUBLISHED,
      approvedAt: new Date(),
      approvedById: adminId,
    },
  });

  res.json({ ok: true });
});

export default router;
