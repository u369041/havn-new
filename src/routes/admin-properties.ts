import { Router } from "express";
import prisma from "../prisma";

const router = Router();

/**
 * Admin Properties router (crash-proof)
 * Endpoints:
 *  - POST   /api/admin/properties/:id/approve
 *  - POST   /api/admin/properties/:id/reject
 *  - POST   /api/admin/properties/:id/moderate
 *  - PATCH  /api/admin/properties/:id
 *
 * Key fixes:
 *  - If Property.id is Int, only query by id when the param is numeric.
 *  - Wrap all async handlers so Express never drops errors / causes 502.
 *  - "Pending" queue uses ListingStatus = "SUBMITTED" (not "PENDING").
 */

function wrap(fn: any) {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

async function findPropertyByIdOrSlug(idOrSlug: string) {
  // If numeric, try by Int id first
  if (/^\d+$/.test(idOrSlug)) {
    const intId = Number(idOrSlug);
    const byId = await prisma.property.findUnique({
      where: { id: intId as any },
    });
    if (byId) return byId;
  }

  // Then try slug
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
router.post(
  "/:id/approve",
  wrap(async (req: any, res: any) => {
    const prop = await requireProperty(req, res);
    if (!prop) return;

    const updated = await prisma.property.update({
      where: { id: prop.id as any },
      data: { listingStatus: "PUBLISHED" },
    });

    res.json({ ok: true, action: "approve", property: updated });
  })
);

/** Reject -> REJECTED */
router.post(
  "/:id/reject",
  wrap(async (req: any, res: any) => {
    const prop = await requireProperty(req, res);
    if (!prop) return;

    const updated = await prisma.property.update({
      where: { id: prop.id as any },
      data: { listingStatus: "REJECTED" },
    });

    res.json({ ok: true, action: "reject", property: updated });
  })
);

/** Moderate -> SUBMITTED (this is your "Pending" queue) */
router.post(
  "/:id/moderate",
  wrap(async (req: any, res: any) => {
    const prop = await requireProperty(req, res);
    if (!prop) return;

    const updated = await prisma.property.update({
      where: { id: prop.id as any },
      data: { listingStatus: "SUBMITTED" },
    });

    res.json({ ok: true, action: "moderate", property: updated });
  })
);

/** Generic admin patch (keep permissive for now; we can lock later) */
router.patch(
  "/:id",
  wrap(async (req: any, res: any) => {
    const prop = await requireProperty(req, res);
    if (!prop) return;

    const updated = await prisma.property.update({
      where: { id: prop.id as any },
      data: req.body || {},
    });

    res.json({ ok: true, action: "patch", property: updated });
  })
);

export default router;
