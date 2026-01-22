import { Router } from "express";
import prisma from "../prisma";

const router = Router();

/**
 * Admin Properties router (release-safe)
 * Endpoints:
 *  - POST   /api/admin/properties/:id/approve      -> PUBLISHED
 *  - POST   /api/admin/properties/:id/reject       -> REJECTED
 *  - POST   /api/admin/properties/:id/moderate     -> SUBMITTED (Pending queue)
 *  - POST   /api/admin/properties/:id/close        -> CLOSED
 *  - PATCH  /api/admin/properties/:id              -> allowlist patch (safe)
 *
 * Key fixes:
 *  - Numeric id lookup to match Int id schemas
 *  - Async wrapper to prevent 502/500 from unhandled promise errors
 *  - Strict allowlist patch so Prisma won’t blow up on unknown fields
 */

function wrap(fn: any) {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const ALLOWED_STATUSES = new Set([
  "DRAFT",
  "SUBMITTED",
  "PUBLISHED",
  "REJECTED",
  "CLOSED",
]);

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
      data: { listingStatus: "PUBLISHED" as any },
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
      data: { listingStatus: "REJECTED" as any },
    });

    res.json({ ok: true, action: "reject", property: updated });
  })
);

/** Moderate -> SUBMITTED (Pending queue) */
router.post(
  "/:id/moderate",
  wrap(async (req: any, res: any) => {
    const prop = await requireProperty(req, res);
    if (!prop) return;

    const updated = await prisma.property.update({
      where: { id: prop.id as any },
      data: { listingStatus: "SUBMITTED" as any },
    });

    res.json({ ok: true, action: "moderate", property: updated });
  })
);

/** Close listing -> CLOSED (dedicated endpoint, avoids PATCH ambiguity) */
router.post(
  "/:id/close",
  wrap(async (req: any, res: any) => {
    const prop = await requireProperty(req, res);
    if (!prop) return;

    const updated = await prisma.property.update({
      where: { id: prop.id as any },
      data: { listingStatus: "CLOSED" as any },
    });

    res.json({ ok: true, action: "close", property: updated });
  })
);

/**
 * PATCH /api/admin/properties/:id
 * Safe allowlist patch: only update fields we explicitly allow.
 * This prevents Prisma from 500-ing on unknown fields.
 */
router.patch(
  "/:id",
  wrap(async (req: any, res: any) => {
    const prop = await requireProperty(req, res);
    if (!prop) return;

    const b = req.body || {};
    const data: any = {};

    // Allowlist fields (expand later if needed)
    if (typeof b.title === "string") data.title = b.title;
    if (typeof b.description === "string") data.description = b.description;
    if (typeof b.price === "number") data.price = b.price;
    if (typeof b.address === "string") data.address = b.address;
    if (typeof b.eircode === "string") data.eircode = b.eircode;
    if (typeof b.mode === "string") data.mode = b.mode;

    if (typeof b.listingStatus === "string") {
      const s = b.listingStatus.toUpperCase();
      if (!ALLOWED_STATUSES.has(s)) {
        return res.status(400).json({
          ok: false,
          error: "INVALID_LISTING_STATUS",
          allowed: Array.from(ALLOWED_STATUSES),
        });
      }
      data.listingStatus = s;
    }

    // No-op
    if (Object.keys(data).length === 0) {
      return res.json({ ok: true, action: "patch", updated: false, property: prop });
    }

    const updated = await prisma.property.update({
      where: { id: prop.id as any },
      data,
    });

    res.json({ ok: true, action: "patch", updated: true, property: updated });
  })
);

export default router;
