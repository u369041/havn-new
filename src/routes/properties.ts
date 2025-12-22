import express from "express";
import prisma from "../prisma"; // ✅ DEFAULT import (fixes Render error)
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/adminAuth";

const router = express.Router();

/**
 * GET /api/properties/mine
 * Returns all listings belonging to the logged-in user
 */
router.get("/mine", requireAuth, async (req, res) => {
  const userId = req.user.id;

  const items = await prisma.property.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });

  res.json({ items });
});

/**
 * POST /api/properties/:id/submit
 * Owner submits a listing for moderation
 * Allowed: DRAFT → SUBMITTED, REJECTED → SUBMITTED
 */
router.post("/:id/submit", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const userId = req.user.id;

  const property = await prisma.property.findFirst({
    where: { id, userId },
  });

  if (!property) {
    return res.status(404).json({ ok: false, message: "Property not found" });
  }

  if (
    property.listingStatus !== "DRAFT" &&
    property.listingStatus !== "REJECTED"
  ) {
    return res.status(400).json({
      ok: false,
      message: "Only draft or rejected listings can be submitted",
    });
  }

  await prisma.property.update({
    where: { id },
    data: {
      listingStatus: "SUBMITTED",
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
 * Admin rejects a submitted listing
 * Allowed: SUBMITTED → REJECTED
 */
router.post("/:id/reject", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
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

  if (property.listingStatus !== "SUBMITTED") {
    return res.status(400).json({
      ok: false,
      message: "Only pending listings can be rejected",
    });
  }

  await prisma.property.update({
    where: { id },
    data: {
      listingStatus: "REJECTED", // ✅ FIXED
      rejectionReason: reason,
      rejectedAt: new Date(),
      rejectedById: req.user.id,
    },
  });

  res.json({ ok: true });
});

/**
 * POST /api/properties/:id/approve
 * Admin approves a submitted listing
 * Allowed: SUBMITTED → PUBLISHED
 */
router.post("/:id/approve", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);

  const property = await prisma.property.findUnique({
    where: { id },
  });

  if (!property) {
    return res.status(404).json({ ok: false, message: "Property not found" });
  }

  if (property.listingStatus !== "SUBMITTED") {
    return res.status(400).json({
      ok: false,
      message: "Only pending listings can be approved",
    });
  }

  await prisma.property.update({
    where: { id },
    data: {
      listingStatus: "PUBLISHED",
      approvedAt: new Date(),
      approvedById: req.user.id,
    },
  });

  res.json({ ok: true });
});

export default router;
