import { Router } from "express";
import requireAuth from "../middleware/requireAuth";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * Helpers
 */
const okItem = (data: any) => data?.item || data?.property || data?.data || data;

function isOwnerOrAdmin(user: any, property: any) {
  if (!user || !property) return false;
  if (user.role === "ADMIN") return true;
  return Number(property.userId) === Number(user.id);
}

/**
 * ✅ GET /api/properties
 * Public listings feed — only PUBLISHED should be returned publicly.
 */
router.get("/", async (req, res) => {
  try {
    const limit = Number(req.query.limit || 24);
    const safeLimit = Math.max(1, Math.min(100, limit));

    const items = await prisma.property.findMany({
      where: { listingStatus: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      take: safeLimit,
    });

    return res.json({ ok: true, items });
  } catch (err: any) {
    console.error("GET /properties error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ✅ GET /api/properties/mine
 * Auth required — returns listings for current user (admin gets all).
 */
router.get("/mine", requireAuth, async (req: any, res) => {
  try {
    const user = req.user;

    const where =
      user.role === "ADMIN"
        ? {}
        : { userId: user.id };

    const items = await prisma.property.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return res.json({ ok: true, items });
  } catch (err: any) {
    console.error("GET /properties/mine error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ✅ GET /api/properties/:slug
 * Public detail page — if published, return publicly.
 * If not published, allow owner/admin via token.
 */
router.get("/:slug", async (req: any, res) => {
  const slug = String(req.params.slug || "").trim();

  try {
    const item = await prisma.property.findUnique({ where: { slug } });
    if (!item) return res.status(404).json({ ok: false, message: "Not found" });

    // Published listings are public
    if (item.listingStatus === "PUBLISHED") {
      return res.json({ ok: true, item });
    }

    // Otherwise require auth + owner/admin
    // We attempt to read token via Authorization header if present
    const auth = req.headers.authorization || "";
    const hasBearer = auth.toLowerCase().startsWith("bearer ");

    if (!hasBearer) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    // Reuse requireAuth logic by importing it? (we can't here because it's middleware)
    // So easiest: ask frontend to use /mine when editing.
    // For safety we still block direct access here for non-published listings:
    return res.status(401).json({ ok: false, message: "Unauthorized" });

  } catch (err: any) {
    console.error("GET /properties/:slug error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ✅ POST /api/properties
 * Create draft listing
 */
router.post("/", requireAuth, async (req: any, res) => {
  try {
    const user = req.user;
    const payload = req.body || {};

    // Basic slug uniqueness enforced at DB level
    const created = await prisma.property.create({
      data: {
        userId: user.id,
        slug: payload.slug,
        title: payload.title,
        address1: payload.address1,
        address2: payload.address2 || null,
        city: payload.city,
        county: payload.county,
        eircode: payload.eircode,
        price: payload.price,
        marketStatus: payload.marketStatus || payload.status || "for-sale",
        propertyType: payload.propertyType || "house",
        bedrooms: payload.bedrooms ?? null,
        bathrooms: payload.bathrooms ?? null,
        features: Array.isArray(payload.features) ? payload.features : [],
        description: payload.description || "",
        photos: Array.isArray(payload.photos) ? payload.photos : [],
        listingStatus: "DRAFT",
      },
    });

    return res.json({ ok: true, item: created });
  } catch (err: any) {
    // Unique constraint slug error
    if (String(err?.code) === "P2002") {
      return res.status(409).json({ ok: false, message: "Slug already exists" });
    }
    console.error("POST /properties error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ✅ PATCH /api/properties/:id
 * Update listing (only DRAFT or REJECTED should be editable)
 */
router.patch("/:id", requireAuth, async (req: any, res) => {
  const id = Number(req.params.id);
  const payload = req.body || {};

  try {
    const user = req.user;

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (!isOwnerOrAdmin(user, existing)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const status = String(existing.listingStatus || "DRAFT").toUpperCase();
    if (status !== "DRAFT" && status !== "REJECTED") {
      return res.status(409).json({ ok: false, message: `Cannot edit listing in status ${status}` });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        slug: payload.slug,
        title: payload.title,
        address1: payload.address1,
        address2: payload.address2 || null,
        city: payload.city,
        county: payload.county,
        eircode: payload.eircode,
        price: payload.price,
        marketStatus: payload.marketStatus || payload.status || existing.marketStatus,
        propertyType: payload.propertyType || existing.propertyType,
        bedrooms: payload.bedrooms ?? null,
        bathrooms: payload.bathrooms ?? null,
        features: Array.isArray(payload.features) ? payload.features : [],
        description: payload.description || "",
        photos: Array.isArray(payload.photos) ? payload.photos : [],
        // Do not change listingStatus here
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    if (String(err?.code) === "P2002") {
      return res.status(409).json({ ok: false, message: "Slug already exists" });
    }
    console.error("PATCH /properties/:id error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ✅ POST /api/properties/:id/submit
 * DRAFT → SUBMITTED
 * ✅ REJECTED → SUBMITTED (resubmission flow)
 */
router.post("/:id/submit", requireAuth, async (req: any, res) => {
  const id = Number(req.params.id);

  try {
    const user = req.user;

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (!isOwnerOrAdmin(user, existing)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const status = String(existing.listingStatus || "DRAFT").toUpperCase();

    // ✅ Allow submit from DRAFT or REJECTED only
    if (status !== "DRAFT" && status !== "REJECTED") {
      return res.status(409).json({
        ok: false,
        message: `Cannot submit listing in status ${status}`,
      });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "SUBMITTED",
        submittedAt: new Date(),

        // ✅ clear rejection state when resubmitting
        rejectionReason: null,
        rejectedAt: null,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /properties/:id/submit error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;
