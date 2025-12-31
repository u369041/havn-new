import { Router } from "express";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth";
import requireAdminAuth from "../middleware/adminAuth";

const router = Router();

/**
 * Helpers
 */
function isOwnerOrAdmin(user: any, ownerId: number) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return user.userId === ownerId;
}

function safeListing(item: any) {
  // Return the property exactly as stored
  return item;
}

/**
 * GET /api/properties
 * Public: returns published listings.
 * Supports ?limit=
 */
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);

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
 * GET /api/properties/mine
 * Auth: returns all listings owned by user (admins see all)
 */
router.get("/mine", requireAuth, async (req: any, res) => {
  try {
    const user = req.user;

    const where =
      user?.role === "admin"
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
    console.error("GET /properties/mine error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * GET /api/properties/:slug
 * Public (but draft/submitted require ownership or admin)
 */
router.get("/:slug", requireAuth, async (req: any, res) => {
  try {
    const slug = String(req.params.slug || "").trim();

    const item = await prisma.property.findUnique({
      where: { slug },
    });

    if (!item) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    // PUBLISHED listings can be viewed by anyone (but this route is auth-protected right now)
    // We keep auth-protected for now since frontend uses auth to load draft data too.
    if (item.listingStatus !== "PUBLISHED") {
      // must be owner or admin
      if (!isOwnerOrAdmin(req.user, item.userId)) {
        return res.status(403).json({ ok: false, message: "Forbidden" });
      }
    }

    return res.json({ ok: true, item: safeListing(item) });
  } catch (err: any) {
    console.error("GET /properties/:slug error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/properties
 * Auth: create draft listing
 */
router.post("/", requireAuth, async (req: any, res) => {
  try {
    const user = req.user;
    const payload = req.body || {};

    const slug = String(payload.slug || "").trim();
    if (!slug) {
      return res.status(400).json({ ok: false, message: "Missing slug" });
    }

    const exists = await prisma.property.findUnique({ where: { slug } });
    if (exists) {
      return res.status(409).json({ ok: false, message: "Slug already exists" });
    }

    const created = await prisma.property.create({
      data: {
        slug,
        title: String(payload.title || "").trim(),
        address1: String(payload.address1 || "").trim(),
        address2: payload.address2 ? String(payload.address2).trim() : null,
        city: String(payload.city || "").trim(),
        county: String(payload.county || "").trim(),
        eircode: payload.eircode ? String(payload.eircode).trim() : null,
        price: Number(payload.price) || 0,

        ber: payload.ber ? String(payload.ber).trim() : null,
        berNo: payload.berNo ? String(payload.berNo).trim() : null,
        bedrooms: payload.bedrooms != null ? Number(payload.bedrooms) : null,
        bathrooms: payload.bathrooms != null ? Number(payload.bathrooms) : null,
        propertyType: payload.propertyType ? String(payload.propertyType) : "house",
        saleType: payload.saleType ? String(payload.saleType) : null,
        marketStatus: payload.marketStatus ? String(payload.marketStatus) : (payload.status ? String(payload.status) : null),

        description: payload.description ? String(payload.description) : null,
        features: Array.isArray(payload.features) ? payload.features : [],
        photos: Array.isArray(payload.photos) ? payload.photos : [],

        listingStatus: "DRAFT",
        userId: user.userId,
      },
    });

    return res.json({ ok: true, item: safeListing(created) });
  } catch (err: any) {
    console.error("POST /properties error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * PATCH /api/properties/:id
 * Auth: update draft only
 */
router.patch("/:id", requireAuth, async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const user = req.user;
    const payload = req.body || {};

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    if (!isOwnerOrAdmin(user, existing.userId)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    if (existing.listingStatus !== "DRAFT") {
      return res.status(409).json({
        ok: false,
        message: "Only DRAFT listings can be edited",
      });
    }

    // if slug change requested, enforce uniqueness
    if (payload.slug && payload.slug !== existing.slug) {
      const slug = String(payload.slug || "").trim();
      const exists = await prisma.property.findUnique({ where: { slug } });
      if (exists) {
        return res.status(409).json({ ok: false, message: "Slug already exists" });
      }
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        slug: payload.slug ? String(payload.slug).trim() : existing.slug,
        title: payload.title != null ? String(payload.title).trim() : existing.title,
        address1: payload.address1 != null ? String(payload.address1).trim() : existing.address1,
        address2: payload.address2 != null ? String(payload.address2).trim() : existing.address2,
        city: payload.city != null ? String(payload.city).trim() : existing.city,
        county: payload.county != null ? String(payload.county).trim() : existing.county,
        eircode: payload.eircode != null ? String(payload.eircode).trim() : existing.eircode,
        price: payload.price != null ? Number(payload.price) : existing.price,

        ber: payload.ber != null ? String(payload.ber).trim() : existing.ber,
        berNo: payload.berNo != null ? String(payload.berNo).trim() : existing.berNo,
        bedrooms: payload.bedrooms != null ? Number(payload.bedrooms) : existing.bedrooms,
        bathrooms: payload.bathrooms != null ? Number(payload.bathrooms) : existing.bathrooms,
        propertyType: payload.propertyType != null ? String(payload.propertyType) : existing.propertyType,
        saleType: payload.saleType != null ? String(payload.saleType) : existing.saleType,
        marketStatus:
          payload.marketStatus != null
            ? String(payload.marketStatus)
            : (payload.status != null ? String(payload.status) : existing.marketStatus),

        description: payload.description != null ? String(payload.description) : existing.description,
        features: Array.isArray(payload.features) ? payload.features : existing.features,
        photos: Array.isArray(payload.photos) ? payload.photos : existing.photos,
      },
    });

    return res.json({ ok: true, item: safeListing(updated) });
  } catch (err: any) {
    console.error("PATCH /properties/:id error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ✅ POST /api/properties/:id/submit
 * Auth: submit a draft for admin approval
 */
router.post("/:id/submit", requireAuth, async (req: any, res) => {
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

    if (existing.listingStatus !== "DRAFT") {
      return res.status(409).json({
        ok: false,
        message: `Only DRAFT listings can be submitted (current: ${existing.listingStatus})`,
      });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "SUBMITTED",
        submittedAt: new Date(),
      },
    });

    return res.json({ ok: true, item: safeListing(updated) });
  } catch (err: any) {
    console.error("POST /properties/:id/submit error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/properties/:id/approve
 * Admin: approve submitted listing → publish
 */
router.post("/:id/approve", requireAdminAuth, async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const admin = req.user;

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    if (existing.listingStatus !== "SUBMITTED") {
      return res.status(409).json({
        ok: false,
        message: `Only SUBMITTED listings can be approved (current: ${existing.listingStatus})`,
      });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "PUBLISHED",
        publishedAt: new Date(),
        approvedAt: new Date(),
        approvedById: admin.userId,
        rejectionReason: null,
        rejectedAt: null,
        rejectedById: null,
      },
    });

    return res.json({ ok: true, item: safeListing(updated) });
  } catch (err: any) {
    console.error("POST /properties/:id/approve error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/properties/:id/reject
 * Admin: reject submitted listing
 */
router.post("/:id/reject", requireAdminAuth, async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const admin = req.user;
    const reason = String(req.body?.reason || "").trim();

    if (!reason) {
      return res.status(400).json({ ok: false, message: "Rejection reason required" });
    }

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    if (existing.listingStatus !== "SUBMITTED") {
      return res.status(409).json({
        ok: false,
        message: `Only SUBMITTED listings can be rejected (current: ${existing.listingStatus})`,
      });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "REJECTED",
        rejectedAt: new Date(),
        rejectedById: admin.userId,
        rejectionReason: reason,
      },
    });

    return res.json({ ok: true, item: safeListing(updated) });
  } catch (err: any) {
    console.error("POST /properties/:id/reject error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/properties/:id/archive
 * Admin: archive published listing
 */
router.post("/:id/archive", requireAdminAuth, async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    if (existing.listingStatus !== "PUBLISHED") {
      return res.status(409).json({
        ok: false,
        message: `Only PUBLISHED listings can be archived (current: ${existing.listingStatus})`,
      });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "ARCHIVED",
        archivedAt: new Date(),
      },
    });

    return res.json({ ok: true, item: safeListing(updated) });
  } catch (err: any) {
    console.error("POST /properties/:id/archive error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/properties/:id/restore
 * Admin: restore archived listing → published again
 */
router.post("/:id/restore", requireAdminAuth, async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    if (existing.listingStatus !== "ARCHIVED") {
      return res.status(409).json({
        ok: false,
        message: `Only ARCHIVED listings can be restored (current: ${existing.listingStatus})`,
      });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "PUBLISHED",
        archivedAt: null,
        publishedAt: new Date(),
      },
    });

    return res.json({ ok: true, item: safeListing(updated) });
  } catch (err: any) {
    console.error("POST /properties/:id/restore error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;
