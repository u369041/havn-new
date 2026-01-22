import { Router } from "express";
import prisma from "../prisma"; // ✅ default import (matches your baseline)

const router = Router();

/**
 * Admin Properties router
 * Supports admin.html moderation actions:
 *  - POST   /api/admin/properties/:id/approve
 *  - POST   /api/admin/properties/:id/reject
 *  - POST   /api/admin/properties/:id/moderate
 *  - PATCH  /api/admin/properties/:id
 *
 * NOTE: ListingStatus enum in your schema does NOT include "PENDING".
 * The "Pending" moderation queue corresponds to "SUBMITTED".
 */

async function findPropertyByIdOrSlug(idOrSlug: string) {
  const byId = await prisma.property.findUnique({
    where: { id: idOrSlug as any },
  });
  if (byId) return byId;

  const bySlug = await prisma.property.findUnique({
    where: { slug: idOrSlug as any },
  });
  return bySlug;
}

async function requireProperty(req: any, res: any) {
  const key = String(req.params.id || "");
  const prop = await findPropertyByIdOrSlug(key);
  if (!prop) {
    res.status(404).json({ ok: false, error: "PROPERTY_NOT_FOUND" });
    return null;
  }
  return prop;
}

/** Approve -> PUBLISHED */
router.post("/:id/approve", async (req, res) => {
  const prop = await requireProperty(req, res);
  if (!prop) return;

  const updated = await prisma.property.update({
    where: { id: prop.id },
    data: { listingStatus: "PUBLISHED" },
  });

  res.json({ ok: true, property: updated });
});

/** Reject -> REJECTED */
router.post("/:id/reject", async (req, res) => {
  const prop = await requireProperty(req, res);
  if (!prop) return;

  const updated = await prisma.property.update({
    where: { id: prop.id },
    data: { listingStatus: "REJECTED" },
  });

  res.json({ ok: true, property: updated });
});

/**
 * Moderate -> SUBMITTED
 * (this is the "Pending" queue in the UI; your enum does not support "PENDING")
 */
router.post("/:id/moderate", async (req, res) => {
  const prop = await requireProperty(req, res);
  if (!prop) return;

  const updated = await prisma.property.update({
    where: { id: prop.id },
    data: { listingStatus: "SUBMITTED" },
  });

  res.json({ ok: true, property: updated });
});

/** Generic admin patch (used by UI edit flows) */
router.patch("/:id", async (req, res) => {
  const prop = await requireProperty(req, res);
  if (!prop) return;

  const updated = await prisma.property.update({
    where: { id: prop.id },
    data: req.body || {},
  });

  res.json({ ok: true, property: updated });
});

export default router;
