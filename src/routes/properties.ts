import { Router } from "express";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth"; // ✅ DEFAULT import

const router = Router();

function isOwnerOrAdmin(user: any, ownerId: number) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return user.userId === ownerId;
}

/**
 * GET /api/properties/mine
 * Returns all listings owned by user (admins see all)
 */
router.get("/mine", requireAuth, async (req: any, res) => {
  try {
    const user = req.user;

    const where =
      user.role === "admin"
        ? {}
        : {
            userId: user.userId,
          };

    const items = await prisma.property.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });

    return res.json({ ok: true, items });
  } catch (err: any) {
    console.error("GET /mine error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * GET /api/properties
 * Public browse endpoint: returns PUBLISHED listings only.
 * Supports optional filters & pagination.
 */
router.get("/", async (req, res) => {
  try {
    const page = Math.max(parseInt(String(req.query.page || "1"), 10), 1);
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || "12"), 10), 1),
      50
    );

    const where: any = {
      listingStatus: "PUBLISHED",
    };

    // optional filters
    const q = String(req.query.q || "").trim();
    const county = String(req.query.county || "").trim();
    const city = String(req.query.city || "").trim();
    const type = String(req.query.type || "").trim();
    const minPrice = req.query.minPrice ? parseInt(String(req.query.minPrice), 10) : null;
    const maxPrice = req.query.maxPrice ? parseInt(String(req.query.maxPrice), 10) : null;

    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { county: { contains: q, mode: "insensitive" } },
        { eircode: { contains: q, mode: "insensitive" } },
      ];
    }

    if (county) where.county = { contains: county, mode: "insensitive" };
    if (city) where.city = { contains: city, mode: "insensitive" };
    if (type) where.propertyType = type;

    if (minPrice !== null || maxPrice !== null) {
      where.price = {};
      if (minPrice !== null) where.price.gte = minPrice;
      if (maxPrice !== null) where.price.lte = maxPrice;
    }

    const [total, items] = await Promise.all([
      prisma.property.count({ where }),
      prisma.property.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { publishedAt: "desc" },
      }),
    ]);

    return res.json({ ok: true, page, limit, total, items });
  } catch (err: any) {
    console.error("GET /api/properties error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * GET /api/properties/:slug
 * Public: published only.
 * Owners/admin: can view drafts/archived etc.
 */
router.get("/:slug", requireAuth.optional, async (req: any, res) => {
  try {
    const slug = String(req.params.slug);
    const user = req.user || null;

    const property = await prisma.property.findUnique({
      where: { slug },
    });

    if (!property) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    if (property.listingStatus !== "PUBLISHED") {
      if (!user || !isOwnerOrAdmin(user, property.userId)) {
        return res.status(404).json({ ok: false, message: "Not found" });
      }
    }

    return res.json({ ok: true, item: property });
  } catch (err: any) {
    console.error("GET /properties/:slug error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/properties
 * Create new draft listing (owner = logged in user)
 */
router.post("/", requireAuth, async (req: any, res) => {
  try {
    const user = req.user;

    const payload = req.body || {};
    const slug = String(payload.slug || "").trim();
    if (!slug) {
      return res.status(400).json({ ok: false, message: "Missing slug" });
    }

    const created = await prisma.property.create({
      data: {
        slug,
        title: payload.title || "Untitled listing",
        address1: payload.address1 || "",
        address2: payload.address2 || null,
        city: payload.city || "",
        county: payload.county || "",
        eircode: payload.eircode || null,
        price: payload.price || 0,
        ber: payload.ber || null,
        berNo: payload.berNo || null,
        bedrooms: payload.bedrooms || null,
        bathrooms: payload.bathrooms || null,
        propertyType: payload.propertyType || "house",
        saleType: payload.saleType || null,
        marketStatus: payload.marketStatus || null,
        description: payload.description || null,
        features: Array.isArray(payload.features) ? payload.features : [],
        photos: Array.isArray(payload.photos) ? payload.photos : [],
        listingStatus: "DRAFT",
        userId: user.userId,
      },
    });

    return res.json({ ok: true, item: created });
  } catch (err: any) {
    console.error("POST /properties error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * PATCH /api/properties/:id
 * Update draft listing
 */
router.patch("/:id", requireAuth, async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const user = req.user;

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    if (!isOwnerOrAdmin(user, existing.userId)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    if (existing.listingStatus === "PUBLISHED") {
      return res
        .status(400)
        .json({ ok: false, message: "Published listings cannot be edited directly." });
    }

    const payload = req.body || {};

    const updated = await prisma.property.update({
      where: { id },
      data: {
        title: payload.title ?? existing.title,
        address1: payload.address1 ?? existing.address1,
        address2: payload.address2 ?? existing.address2,
        city: payload.city ?? existing.city,
        county: payload.county ?? existing.county,
        eircode: payload.eircode ?? existing.eircode,
        price: payload.price ?? existing.price,
        ber: payload.ber ?? existing.ber,
        berNo: payload.berNo ?? existing.berNo,
        bedrooms: payload.bedrooms ?? existing.bedrooms,
        bathrooms: payload.bathrooms ?? existing.bathrooms,
        propertyType: payload.propertyType ?? existing.propertyType,
        saleType: payload.saleType ?? existing.saleType,
        marketStatus: payload.marketStatus ?? existing.marketStatus,
        description: payload.description ?? existing.description,
        features: Array.isArray(payload.features) ? payload.features : existing.features,
        photos: Array.isArray(payload.photos) ? payload.photos : existing.photos,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("PATCH /properties/:id error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;
