import { Router } from "express";
import requireAuth from "../middleware/requireAuth";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * ✅ GET /api/properties
 * Public feed: PUBLISHED only
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
 * Auth-only: returns user's listings
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
 * ✅ GET /api/properties/:id  (NUMERIC ONLY)
 * Returns:
 * - PUBLISHED to everyone
 * - DRAFT/SUBMITTED only to owner/admin
 *
 * IMPORTANT:
 * This MUST come BEFORE the slug route.
 */
router.get("/:id(\\d+)", requireAuth.optional, async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const item = await prisma.property.findUnique({ where: { id } });
    if (!item) return res.status(404).json({ ok: false, message: "Not found" });

    // PUBLISHED is public
    if (item.listingStatus === "PUBLISHED") {
      return res.json({ ok: true, item });
    }

    // Everything else requires owner/admin
    const userId = Number(req.user?.userId);
    const role = String(req.user?.role || "user").toLowerCase();
    const isAdmin = role === "admin";
    const isOwner = Number.isFinite(userId) && userId === item.userId;

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    return res.json({ ok: true, item });
  } catch (err: any) {
    console.error("GET /properties/:id error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ✅ GET /api/properties/:slug
 * Public slug detail (PUBLISHED only)
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
 * Create draft
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
 * Update draft
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
