// src/routes/properties.ts
import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { ListingStatus } from "@prisma/client";
import { requireAuth, optionalAuth, requireAdmin } from "../middleware/auth";

const router = Router();

function isOwnerOrAdmin(req: Request, userId: number | null): boolean {
  const u = (req as any).user as { id: number; role?: string } | undefined;
  if (!u) return false;
  if (u.role === "admin") return true;
  return userId != null && u.id === userId;
}

/**
 * GET /api/properties
 * Public list: PUBLISHED only
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

        // Legacy DB column "status" is now exposed as marketStatus
        marketStatus: true,

        photos: true,
        createdAt: true,
        updatedAt: true,
        publishedAt: true,
      },
    });

    return res.json({ ok: true, items });
  } catch (err: any) {
    return res
      .status(500)
      .json({ ok: false, message: err?.message || "Failed to list properties" });
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
    return res
      .status(500)
      .json({ ok: false, message: err?.message || "Failed to fetch property" });
  }
});

/**
 * POST /api/properties
 * Create property (AUTH)
 * - Always creates as DRAFT (listingStatus)
 * - marketStatus is optional and maps to legacy DB column "status"
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

    // Rename: use marketStatus (not status) now
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

        // Force draft on create
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
 * POST /api/properties/:id/publish
 * Owner or admin can publish
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
      data: { listingStatus: ListingStatus.PUBLISHED, publishedAt: new Date() },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Publish failed" });
  }
});

/**
 * POST /api/properties/:id/unpublish
 * Owner or admin can unpublish (back to draft)
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
      data: { listingStatus: ListingStatus.DRAFT, publishedAt: null },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Unpublish failed" });
  }
});

/**
 * Optional admin utility (delete if you don't want it):
 * GET /api/properties/_admin/all  (draft + published)
 */
router.get("/_admin/all", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const items = await prisma.property.findMany({ orderBy: [{ updatedAt: "desc" }] });
    return res.json({ ok: true, items });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Failed" });
  }
});

export default router;
