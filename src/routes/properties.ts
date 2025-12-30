import { Router } from "express";
import requireAuth from "../middleware/requireAuth";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * ✅ DEBUG: ownership check (TEMP)
 * GET /api/properties/:id/_debug-owner
 *
 * Returns:
 * - req.user.userId
 * - property.userId
 * - isOwner boolean
 *
 * We will remove this after fixing.
 */
router.get("/:id/_debug-owner", requireAuth, async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const property = await prisma.property.findUnique({
      where: { id },
      select: { id: true, userId: true, slug: true, listingStatus: true },
    });

    if (!property) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    const userId = Number(req.user?.userId);
    const isOwner = userId === property.userId;

    return res.json({
      ok: true,
      tokenUser: req.user,
      property,
      computed: {
        userId,
        ownerId: property.userId,
        isOwner,
      },
    });
  } catch (err: any) {
    console.error("DEBUG OWNER ERROR", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ✅ GET /api/properties
 * Public listings feed
 */
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 12), 50);

    const items = await prisma.property.findMany({
      where: { listingStatus: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      take: limit,
    });

    return res.json({ ok: true, items });
  } catch (err: any) {
    console.error("GET /properties error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ✅ GET /api/properties/mine
 * Auth-only: returns user's properties
 */
router.get("/mine", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.userId;

    const items = await prisma.property.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });

    return res.json({ ok: true, items });
  } catch (err: any) {
    console.error("GET /properties/mine error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ✅ GET /api/properties/:slug
 * Public property detail
 */
router.get("/:slug", async (req, res) => {
  try {
    const slug = String(req.params.slug);

    const item = await prisma.property.findUnique({
      where: { slug },
    });

    if (!item) return res.status(404).json({ ok: false, message: "Not found" });

    if (item.listingStatus !== "PUBLISHED") {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    return res.json({ ok: true, item });
  } catch (err: any) {
    console.error("GET /properties/:slug error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ✅ POST /api/properties
 * Create DRAFT listing
 */
router.post("/", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.userId;

    const {
      slug,
      title,
      address1,
      address2,
      city,
      county,
      eircode,
      price,
      status,
      propertyType,
      bedrooms,
      bathrooms,
      size,
      sizeUnits,
      features,
      description,
      photos,
    } = req.body || {};

    if (!slug || !title || !address1 || !city || !county || !eircode || !price) {
      return res.status(400).json({ ok: false, message: "Missing required fields" });
    }

    const existingSlug = await prisma.property.findUnique({ where: { slug } });
    if (existingSlug) {
      return res.status(409).json({ ok: false, message: "Slug already exists" });
    }

    const created = await prisma.property.create({
      data: {
        userId,
        slug,
        title,
        address1,
        address2,
        city,
        county,
        eircode,
        price: Number(price),
        marketStatus: status || "for-sale",
        propertyType: propertyType || "house",
        bedrooms: bedrooms != null ? Number(bedrooms) : null,
        bathrooms: bathrooms != null ? Number(bathrooms) : null,
        features: Array.isArray(features) ? features : [],
        description: description || "",
        photos: Array.isArray(photos) ? photos : [],
        listingStatus: "DRAFT",
      },
    });

    return res.json({ ok: true, property: created });
  } catch (err: any) {
    console.error("POST /properties error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ✅ PATCH /api/properties/:id
 * Update DRAFT listing
 */
router.patch("/:id", requireAuth, async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    const userId = req.user.userId;

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (existing.userId !== userId) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    if (existing.listingStatus !== "DRAFT") {
      return res.status(409).json({ ok: false, message: "Only drafts can be edited" });
    }

    const payload = req.body || {};

    const updated = await prisma.property.update({
      where: { id },
      data: {
        slug: payload.slug ?? existing.slug,
        title: payload.title ?? existing.title,
        address1: payload.address1 ?? existing.address1,
        address2: payload.address2 ?? existing.address2,
        city: payload.city ?? existing.city,
        county: payload.county ?? existing.county,
        eircode: payload.eircode ?? existing.eircode,
        price: payload.price != null ? Number(payload.price) : existing.price,
        marketStatus: payload.status ?? existing.marketStatus,
        propertyType: payload.propertyType ?? existing.propertyType,
        bedrooms: payload.bedrooms != null ? Number(payload.bedrooms) : existing.bedrooms,
        bathrooms: payload.bathrooms != null ? Number(payload.bathrooms) : existing.bathrooms,
        features: Array.isArray(payload.features) ? payload.features : existing.features,
        description: payload.description ?? existing.description,
        photos: Array.isArray(payload.photos) ? payload.photos : existing.photos,
      },
    });

    return res.json({ ok: true, property: updated });
  } catch (err: any) {
    console.error("PATCH /properties/:id error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;
