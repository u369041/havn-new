import { Router, Request, Response } from "express";
import prisma from "../prisma"; // ✅ default import (your project uses this)
import requireAuth from "../middlewares/requireAuth"; // ✅ PLURAL path (FIX)

const router = Router();

/**
 * Helper to safely read req.user added by requireAuth
 */
const getUserId = (req: Request): number => {
  const u = (req as any).user;
  if (!u || !u.id) {
    throw new Error("Authenticated user missing on request");
  }
  return u.id;
};

/**
 * GET /api/properties
 * Public listings (published only)
 */
router.get("/", async (_req: Request, res: Response) => {
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
 */
router.get("/mine", requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);

  const items = await prisma.property.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  res.json({ items });
});

/**
 * GET /api/properties/:slug
 */
router.get("/:slug", async (req: Request, res: Response) => {
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
 * Create new listing draft
 */
router.post("/", requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);
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
 * Update existing draft
 */
router.patch("/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const userId = getUserId(req);

  const existing = await prisma.property.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ message: "Not found" });

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
 * Draft → Pending
 */
router.post("/:id/submit", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const userId = getUserId(req);

  const existing = await prisma.property.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ message: "Not found" });

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
