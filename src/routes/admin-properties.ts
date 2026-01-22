import { Router } from "express";
import prisma from "../prisma"; // ✅ DEFAULT IMPORT — matches working baseline

const router = Router();

/**
 * Admin Properties router
 * Supports admin.html moderation actions
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

router.post("/:id/approve", async (req, res) => {
  const prop = await requireProperty(req, res);
  if (!prop) return;

  const updated = await prisma.property.update({
    where: { id: prop.id },
    data: { listingStatus: "PUBLISHED" },
  });

  res.json({ ok: true, property: updated });
});

router.post("/:id/reject", async (req, res) => {
  const prop = await requireProperty(req, res);
  if (!prop) return;

  const updated = await prisma.property.update({
    where: { id: prop.id },
    data: { listingStatus: "REJECTED" },
  });

  res.json({ ok: true, property: updated });
});

router.post("/:id/moderate", async (req, res) => {
  const prop = await requireProperty(req, res);
  if (!prop) return;

  const updated = await prisma.property.update({
    where: { id: prop.id },
    data: { listingStatus: "PENDING" },
  });

  res.json({ ok: true, property: updated });
});

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
