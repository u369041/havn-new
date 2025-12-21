// src/routes/properties.ts
import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { ListingStatus } from "@prisma/client";
import { requireAuth, optionalAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/adminAuth";

const router = Router();

function isOwnerOrAdmin(req: Request, userId: number | null): boolean {
  const u = (req as any).user as { id: number; role?: string } | undefined;
  if (!u) return false;
  if (u.role === "admin") return true;
  return userId != null && u.id === userId;
}

/**
 * AUTH: GET /api/properties/mine
 * All listings for logged-in user (draft + published)
 * IMPORTANT: must be defined BEFORE "/:slug"
 */
router.get("/mine", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as { id: number };

    const items = await prisma.property.findMany({
      where: { userId: user.id },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        slug: true,
        title: true,
        city: true,
        county: true,
        price: true,
        photos: true,
        listingStatus: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({ ok: true, items });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Failed to load listings" });
  }
});

/**
 * PUBLIC: GET /api/properties
 * PUBLISHED only
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const items = await prisma.property.findMany({
      where: { listingStatus: ListingStatus.PUBLISHED },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        slug: true,
        title: true,
        address1: true,
        address2: true,
        city: true,
        county: true,
        eircode: true,
        lat: true,
        lng: true,
        price: true,
        bedrooms: true,
        bathrooms: true,
        propertyType: true,
        ber: true,
        berNo: true,
        saleType: true,
        marketStatus: true,
        photos: true,
        createdAt: true,
        updatedAt: true,
        publishedAt: true,
      },
    });

    return res.json({ ok: true, items });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Failed to list properties" });
  }
});

/**
 * ADMIN: GET /api/properties/_admin/all
 * Draft + Published
 * IMPORTANT: defined BEFORE "/:slug"
 */
router.get("/_admin/all", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const items = await prisma.property.findMany({
      orderBy: [{ updatedAt: "desc" }],
    });
    return res.json({ ok: true, items });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Failed" });
  }
});

/**
 * GET /api/properties/:slug
 * Detail:
 * - If PUBLISHED => public
 * - If DRAFT => only owner/admin (otherwise 404)
 */
router.get("/:slug", optionalAuth, async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, message: "Missing slug" });

    const item = await prisma.property.findUnique({ where: { slug } });
    if (!item) return res.status(404).json({ ok: false, message: "Property not found" });

    if (item.listingStatus === ListingStatus.PUBLISHED) {
      return res.json({ ok: true, item });
    }

    // Draft: return 404 unless owner/admin (avoid leaking existence)
    if (!isOwnerOrAdmin(req, item.userId ?? null)) {
      return res.status(404).json({ ok: false, message: "Property not found" });
    }

    return res.json({ ok: true, item });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Failed to fetch property" });
  }
});

/**
 * POST /api/properties
 * Create property (AUTH)
 * - Always creates as DRAFT
 */
router.post("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const b: any = req.body || {};

    const slug = String(b.slug || "").trim();
    const title = String(b.title || "").trim();
    const address1 = String(b.address1 || "").trim();
    const address2 = b.address2 != null ? String(b.address2).trim() : null;
    const city = String(b.city || "").trim();
    const county = String(b.county || "").trim();
    const eircode = b.eircode != null ? String(b.eircode).trim() : null;

    const price = Number(b.price);
    const bedrooms = b.bedrooms != null ? Number(b.bedrooms) : null;
    const bathrooms = b.bathrooms != null ? Number(b.bathrooms) : null;

    const propertyType = String(b.propertyType || "").trim();
    const ber = b.ber != null ? String(b.ber).trim() : null;
    const berNo = b.berNo != null ? String(b.berNo).trim() : null;
    const saleType = b.saleType != null ? String(b.saleType).trim() : null;

    const marketStatus = b.marketStatus != null ? String(b.marketStatus).trim() : null;

    const description = b.description != null ? String(b.description) : null;
    const lat = b.lat != null && b.lat !== "" ? Number(b.lat) : null;
    const lng = b.lng != null && b.lng !== "" ? Number(b.lng) : null;

    const features = Array.isArray(b.features) ? b.features.map(String) : [];
    const photos = Array.isArray(b.photos) ? b.photos.map(String) : [];

    if (!slug || !title || !address1 || !city || !county || !propertyType) {
      return res.status(400).json({ ok: false, message: "Missing required fields" });
    }
    if (!Number.isFinite(price)) {
      return res.status(400).json({ ok: false, message: "price must be a number" });
    }

    const user = (req as any).user as { id: number } | undefined;

    const created = await prisma.property.create({
      data: {
        slug,
        title,
        address1,
        address2,
        city,
        county,
        eircode,
        lat,
        lng,
        price,
        bedrooms,
        bathrooms,
        propertyType,
        ber,
        berNo,
        saleType,
        marketStatus,
        description,
        features,
        photos,
        userId: user?.id ?? null,
        listingStatus: ListingStatus.DRAFT,
        publishedAt: null,
      },
    });

    return res.status(201).json({ ok: true, item: created });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ ok: false, message: "Slug already exists" });
    }
    return res.status(500).json({ ok: false, message: err?.message || "Create failed" });
  }
});

/**
 * PATCH /api/properties/:id
 * Update property (AUTH, owner/admin)
 */
router.patch("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Property not found" });

    if (!isOwnerOrAdmin(req, existing.userId ?? null)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const b: any = req.body || {};
    const data: any = {};

    const setString = (k: string) => {
      if (b[k] !== undefined) data[k] = b[k] === null ? null : String(b[k]).trim();
    };

    setString("slug");
    setString("title");
    setString("address1");
    setString("address2");
    setString("city");
    setString("county");
    setString("eircode");
    setString("propertyType");
    setString("ber");
    setString("berNo");
    setString("saleType");
    setString("marketStatus");
    setString("description");

    if (b.price !== undefined) data.price = Number(b.price);
    if (b.lat !== undefined) data.lat = b.lat === null ? null : Number(b.lat);
    if (b.lng !== undefined) data.lng = b.lng === null ? null : Number(b.lng);
    if (b.bedrooms !== undefined) data.bedrooms = b.bedrooms === null ? null : Number(b.bedrooms);
    if (b.bathrooms !== undefined) data.bathrooms = b.bathrooms === null ? null : Number(b.bathrooms);

    if (b.features !== undefined) data.features = Array.isArray(b.features) ? b.features.map(String) : [];
    if (b.photos !== undefined) data.photos = Array.isArray(b.photos) ? b.photos.map(String) : [];

    delete data.listingStatus;
    delete data.publishedAt;

    const updated = await prisma.property.update({
      where: { id },
      data,
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ ok: false, message: "Slug already exists" });
    }
    return res.status(500).json({ ok: false, message: err?.message || "Update failed" });
  }
});

/**
 * POST /api/properties/:id/publish
 */
router.post("/:id/publish", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Property not found" });

    if (!isOwnerOrAdmin(req, existing.userId ?? null)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    if (existing.listingStatus === ListingStatus.PUBLISHED) {
      return res.status(409).json({ ok: false, message: "Already published" });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: ListingStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Publish failed" });
  }
});

/**
 * POST /api/properties/:id/unpublish
 */
router.post("/:id/unpublish", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Property not found" });

    if (!isOwnerOrAdmin(req, existing.userId ?? null)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    if (existing.listingStatus === ListingStatus.DRAFT) {
      return res.status(409).json({ ok: false, message: "Already draft" });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: ListingStatus.DRAFT,
        publishedAt: null,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Unpublish failed" });
  }
});

export default router;
