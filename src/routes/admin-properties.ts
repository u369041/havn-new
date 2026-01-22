import { Router } from "express";
import { prisma } from "../prisma";

const router = Router();

/**
 * Admin Properties router
 * Provides endpoints used by admin.html/admin.js:
 *  - POST   /api/admin/properties/:id/approve
 *  - POST   /api/admin/properties/:id/reject
 *  - POST   /api/admin/properties/:id/moderate
 *  - PATCH  /api/admin/properties/:id
 *
 * Tries :id as Property.id first, then as slug.
 */

async function findPropertyByIdOrSlug(idOrSlug: string) {
  // Try by id
  const byId = await prisma.property.findUnique({
    where: { id: idOrSlug as any },
  });
  if (byId) return byId;

  // Try by slug
  const bySlug = await prisma.property.findUnique({
    where: { slug: idOrSlug as any },
  });
  return bySlug;
}

async function requireExistingProperty(req: any, res: any) {
  const idOrSlug = String(req.params.id || "");
  const prop = await findPropertyByIdOrSlug(idOrSlug);

  if (!prop) {
    res.status(404).json({ ok: false, error: "PROPERTY_NOT_FOUND", idOrSlug });
    return null;
  }
  return prop;
}

/**
 * PATCH /api/admin/properties/:id
 * Generic admin edit (safe allowlist)
 */
router.patch("/:id", async (req, res) => {
  const prop = await requireExistingProperty(req, res);
  if (!prop) return;

  const body = req.body || {};

  const data: any = {};
  if (typeof body.title === "string") data.title = body.title;
  if (typeof body.description === "string") data.description = body.description;
  if (typeof body.price === "number") data.price = body.price;
  if (typeof body.address === "string") data.address = body.address;
  if (typeof body.eircode === "string") data.eircode = body.eircode;
  if (typeof body.mode === "string") data.mode = body.mode; // BUY/RENT/SHARE

  if (Object.keys(data).length === 0) {
    return res.json({ ok: true, updated: false, property: prop });
  }

  const updated = await prisma.property.update({
    where: { id: prop.id as any },
    data,
  });

  res.json({ ok: true, updated: true, property: updated });
});

/**
 * POST /api/admin/properties/:id/approve
 */
router.post("/:id/approve", async (req, res) => {
  const prop = await requireExistingProperty(req, res);
  if (!prop) return;

  // Keep schema-safe: ONLY update listingStatus unless you're 100% sure other fields exist
  const updated = await prisma.property.update({
    where: { id: prop.id as any },
    data: {
      listingStatus: "PUBLISHED",
    } as any,
  });

  res.json({ ok: true, action: "approve", property: updated });
});

/**
 * POST /api/admin/properties/:id/reject
 * Body: { reason?: string }
 */
router.post("/:id/reject", async (req, res) => {
  const prop = await requireExistingProperty(req, res);
  if (!prop) return;

  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

  // Schema-safe: set listingStatus only. If your schema has rejectedReason, we can add it later.
  const updated = await prisma.property.update({
    where: { id: prop.id as any },
    data: {
      listingStatus: "REJECTED",
    } as any,
  });

  res.json({
    ok: true,
    action: "reject",
    property: updated,
    note: reason ? "Reason received (not stored yet)." : undefined,
  });
});

/**
 * POST /api/admin/properties/:id/moderate
 * Moves listing back to PENDING
 */
router.post("/:id/moderate", async (req, res) => {
  const prop = await requireExistingProperty(req, res);
  if (!prop) return;

  const updated = await prisma.property.update({
    where: { id: prop.id as any },
    data: {
      listingStatus: "PENDING",
    } as any,
  });

  res.json({ ok: true, action: "moderate", property: updated });
});

export default router;
