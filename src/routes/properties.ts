import express from "express";
import prisma from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/adminAuth";
import { ListingStatus, Prisma } from "@prisma/client";

const router = express.Router();

// ---------- helpers ----------
function asInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function isOwnerOrAdmin(req: any, ownerId: number) {
  const uid = Number(req.user?.id);
  const role = String(req.user?.role || "");
  return uid === ownerId || role === "admin";
}

// ---------- PUBLIC: GET /api/properties ----------
/**
 * Public listings endpoint used by:
 * - homepage latest listings
 * - browse results
 *
 * Returns PUBLISHED listings only.
 *
 * Query:
 * - limit (default 24)
 * - page (default 1)
 * - q (search string)
 * - county
 * - city
 * - type (propertyType)
 * - minPrice / maxPrice
 * - beds / baths
 * - sort = newest | price_asc | price_desc
 */
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(asInt(req.query.limit, 24), 100);
    const page = Math.max(asInt(req.query.page, 1), 1);
    const skip = (page - 1) * limit;

    const q = String(req.query.q || "").trim();
    const county = String(req.query.county || "").trim();
    const city = String(req.query.city || "").trim();
    const type = String(req.query.type || "").trim();
    const minPrice = req.query.minPrice ? asInt(req.query.minPrice, 0) : null;
    const maxPrice = req.query.maxPrice ? asInt(req.query.maxPrice, 0) : null;
    const beds = req.query.beds ? asInt(req.query.beds, 0) : null;
    const baths = req.query.baths ? asInt(req.query.baths, 0) : null;

    const sort = String(req.query.sort || "newest");

    const where: Prisma.PropertyWhereInput = {
      listingStatus: ListingStatus.PUBLISHED,
      archivedAt: null,
    };

    if (county) where.county = county;
    if (city) where.city = city;
    if (type) where.propertyType = type;

    if (minPrice != null || maxPrice != null) {
      where.price = {};
      if (minPrice != null) where.price.gte = minPrice;
      if (maxPrice != null) where.price.lte = maxPrice;
    }

    if (beds != null) where.bedrooms = { gte: beds };
    if (baths != null) where.bathrooms = { gte: baths };

    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { address1: { contains: q, mode: "insensitive" } },
        { address2: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { county: { contains: q, mode: "insensitive" } },
        { eircode: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
      ];
    }

    const orderBy: Prisma.PropertyOrderByWithRelationInput =
      sort === "price_asc"
        ? { price: "asc" }
        : sort === "price_desc"
        ? { price: "desc" }
        : { publishedAt: "desc" };

    const [items, total] = await Promise.all([
      prisma.property.findMany({
        where,
        orderBy,
        skip,
        take: limit,
      }),
      prisma.property.count({ where }),
    ]);

    res.json({
      ok: true,
      page,
      limit,
      total,
      items,
    });
  } catch (e) {
    console.error("[GET /properties] error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

// ---------- PUBLIC: GET /api/properties/:slug ----------
/**
 * Public property detail.
 * Published only.
 */
router.get("/:slug", async (req, res, next) => {
  // prevent clashes with /mine etc
  const slug = String(req.params.slug || "");
  if (slug === "mine") return next();

  try {
    const item = await prisma.property.findUnique({
      where: { slug },
    });

    if (!item) return res.status(404).json({ ok: false, message: "Not found" });

    if (item.listingStatus !== ListingStatus.PUBLISHED || item.archivedAt) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    res.json({ ok: true, item });
  } catch (e) {
    console.error("[GET /properties/:slug] error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

// ---------- AUTH: GET /api/properties/mine ----------
/**
 * Returns properties for the logged in user.
 * Admins can see all.
 * Includes drafts + archived + rejected.
 */
router.get("/mine", requireAuth, async (req: any, res) => {
  try {
    const uid = Number(req.user.id);
    const role = String(req.user.role || "");

    const where: Prisma.PropertyWhereInput =
      role === "admin"
        ? {}
        : {
            userId: uid,
          };

    const items = await prisma.property.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });

    res.json({ ok: true, items });
  } catch (e) {
    console.error("[GET /properties/mine] error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

// ---------- MODERATION: Submit ----------
router.post("/:id/submit", requireAuth, async (req: any, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

  try {
    const prop = await prisma.property.findUnique({ where: { id } });
    if (!prop) return res.status(404).json({ ok: false, message: "Not found" });

    if (!isOwnerOrAdmin(req, prop.userId)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    if (prop.listingStatus !== ListingStatus.DRAFT && prop.listingStatus !== ListingStatus.REJECTED) {
      return res.status(400).json({ ok: false, message: "Only draft/rejected listings can be submitted." });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: ListingStatus.SUBMITTED,
        submittedAt: new Date(),
        rejectionReason: null,
        rejectedAt: null,
        rejectedById: null,
      },
    });

    res.json({ ok: true, item: updated });
  } catch (e) {
    console.error("[POST /properties/:id/submit] error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

// ---------- MODERATION: Approve ----------
router.post("/:id/approve", requireAuth, requireAdmin, async (req: any, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

  try {
    const prop = await prisma.property.findUnique({ where: { id } });
    if (!prop) return res.status(404).json({ ok: false, message: "Not found" });

    if (prop.listingStatus !== ListingStatus.SUBMITTED) {
      return res.status(400).json({ ok: false, message: "Only submitted listings can be approved." });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: ListingStatus.PUBLISHED,
        publishedAt: new Date(),
        approvedAt: new Date(),
        approvedById: Number(req.user.id),
        rejectionReason: null,
        rejectedAt: null,
        rejectedById: null,
      },
    });

    res.json({ ok: true, item: updated });
  } catch (e) {
    console.error("[POST /properties/:id/approve] error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

// ---------- MODERATION: Reject ----------
router.post("/:id/reject", requireAuth, requireAdmin, async (req: any, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

  const reason = String(req.body?.reason || "").trim();
  if (!reason) return res.status(400).json({ ok: false, message: "Rejection reason required." });

  try {
    const prop = await prisma.property.findUnique({ where: { id } });
    if (!prop) return res.status(404).json({ ok: false, message: "Not found" });

    if (prop.listingStatus !== ListingStatus.SUBMITTED) {
      return res.status(400).json({ ok: false, message: "Only submitted listings can be rejected." });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: ListingStatus.REJECTED,
        rejectedAt: new Date(),
        rejectedById: Number(req.user.id),
        rejectionReason: reason,
      },
    });

    res.json({ ok: true, item: updated });
  } catch (e) {
    console.error("[POST /properties/:id/reject] error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

// ---------- Archive ----------
router.post("/:id/archive", requireAuth, async (req: any, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

  try {
    const prop = await prisma.property.findUnique({ where: { id } });
    if (!prop) return res.status(404).json({ ok: false, message: "Not found" });

    if (!isOwnerOrAdmin(req, prop.userId)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: ListingStatus.ARCHIVED,
        archivedAt: new Date(),
      },
    });

    res.json({ ok: true, item: updated });
  } catch (e) {
    console.error("[POST /properties/:id/archive] error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

// ---------- Restore ----------
router.post("/:id/restore", requireAuth, async (req: any, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

  try {
    const prop = await prisma.property.findUnique({ where: { id } });
    if (!prop) return res.status(404).json({ ok: false, message: "Not found" });

    if (!isOwnerOrAdmin(req, prop.userId)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: ListingStatus.DRAFT,
        archivedAt: null,
      },
    });

    res.json({ ok: true, item: updated });
  } catch (e) {
    console.error("[POST /properties/:id/restore] error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;
