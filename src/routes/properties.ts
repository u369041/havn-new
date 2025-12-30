import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

/**
 * GET /api/properties
 * Public listings
 */
router.get("/", async (_req, res) => {
  const items = await prisma.property.findMany({
    where: {
      listingStatus: "PUBLISHED",
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({ items });
});

/**
 * GET /api/properties/mine
 * Logged-in user's listings
 */
router.get("/mine", requireAuth, async (req, res) => {
  const userId = req.user!.id;

  const items = await prisma.property.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  res.json({ items });
});

/**
 * GET /api/properties/:slug
 * Get property by slug (auth optional)
 */
router.get("/:slug", async (req, res) => {
  const { slug } = req.params;

  const item = await prisma.property.findUnique({
    where: { slug },
  });

  if (!item) {
    return res.status(404).json({ message: "Property not found" });
  }

  res.json({ item });
});

/**
 * POST /api/properties
 * Create draft
 */
router.post("/", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const data = req.body;

  try {
    const property = await prisma.property.create({
      data: {
        ...data,
        userId,
        listingStatus: "DRAFT",
      },
    });

    res.json({ property });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(409).json({ message: "Slug already exists" });
    }
    throw err;
  }
});

/**
 * PATCH /api/properties/:id
 * Update draft
 */
router.patch("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const userId = req.user!.id;

  const existing = await prisma.property.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ message: "Not found" });
  }

  if (existing.userId !== userId) {
    return res.status(403).json({ message: "Forbidden" });
  }

  if (existing.listingStatus !== "DRAFT") {
    return res.status(409).json({ message: "Only drafts can be edited" });
  }

  try {
    const property = await prisma.property.update({
      where: { id },
      data: req.body,
    });

    res.json({ property });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(409).json({ message: "Slug already exists" });
    }
    throw err;
  }
});

/**
 * ✅ POST /api/properties/:id/submit
 * Submit draft for admin approval
 */
router.post("/:id/submit", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const userId = req.user!.id;

  const existing = await prisma.property.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ message: "Not found" });
  }

  if (existing.userId !== userId) {
    return res.status(403).json({ message: "Forbidden" });
  }

  if (existing.listingStatus !== "DRAFT") {
    return res.status(409).json({
      message: `Cannot submit listing in status ${existing.listingStatus}`,
    });
  }

  const updated = await prisma.property.update({
    where: { id },
    data: {
      listingStatus: "PENDING",
    },
  });

  res.json({ item: updated });
});

export default router;
