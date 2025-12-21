// src/routes/properties.ts
import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { ListingStatus } from "@prisma/client";
import { requireAuth, optionalAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/adminAuth";

const router = Router();

function getUser(req: Request): { id: number; role?: string } | null {
  return ((req as any).user as any) || null;
}

function isOwnerOrAdmin(req: Request, userId: number | null): boolean {
  const u = getUser(req);
  if (!u) return false;
  if (u.role === "admin") return true;
  return userId != null && u.id === userId;
}

function isAdmin(req: Request): boolean {
  const u = getUser(req);
  return !!u && u.role === "admin";
}

const mineSelect = {
  id: true,
  slug: true,
  title: true,
  city: true,
  county: true,
  price: true,
  photos: true,
  listingStatus: true,
  publishedAt: true,
  archivedAt: true,
  submittedAt: true,
  approvedAt: true,
  rejectedAt: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
  revisionOfId: true,
} as const;

/**
 * AUTH: GET /api/properties/mine
 */
router.get("/mine", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = getUser(req)!;

    const published = await prisma.property.findMany({
      where: { userId: user.id, listingStatus: ListingStatus.PUBLISHED },
      orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
      select: mineSelect,
    });

    const pending = await prisma.property.findMany({
      where: { userId: user.id, listingStatus: ListingStatus.PENDING },
      orderBy: [{ submittedAt: "desc" }, { updatedAt: "desc" }],
      select: mineSelect,
    });

    const drafts = await prisma.property.findMany({
      where: { userId: user.id, listingStatus: ListingStatus.DRAFT },
      orderBy: [{ updatedAt: "desc" }],
      select: mineSelect,
    });

    const archived = await prisma.property.findMany({
      where: { userId: user.id, listingStatus: ListingStatus.ARCHIVED },
      orderBy: [{ archivedAt: "desc" }, { updatedAt: "desc" }],
      select: mineSelect,
    });

    return res.json({ ok: true, items: [...published, ...pending, ...drafts, ...archived] });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Failed to load listings" });
  }
});

/**
 * ADMIN: GET /api/properties/_admin/pending
 */
router.get("/_admin/pending", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const items = await prisma.property.findMany({
      where: { listingStatus: ListingStatus.PENDING },
      orderBy: [{ submittedAt: "desc" }, { updatedAt: "desc" }],
      select: {
        ...mineSelect,
        userId: true,
        user: { select: { id: true, email: true, name: true } },
      },
    });
    return res.json({ ok: true, items });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Failed" });
  }
});

/**
 * ADMIN: GET /api/properties/_admin/all
 */
router.get("/_admin/all", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const items = await prisma.property.findMany({ orderBy: [{ updatedAt: "desc" }] });
    return res.json({ ok: true, items });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Failed" });
  }
});

/**
 * POST /api/properties/:id/start-edit
 */
router.post("/:id/start-edit", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Property not found" });

    if (!isOwnerOrAdmin(req, existing.userId ?? null)) return res.status(403).json({ ok: false, message: "Forbidden" });

    if (existing.listingStatus === ListingStatus.ARCHIVED) {
      return res.status(409).json({ ok: false, message: "Archived. Unarchive first." });
    }
    if (existing.listingStatus === ListingStatus.PENDING) {
      return res.status(409).json({ ok: false, message: "Pending review. Admin must approve/reject first." });
    }
    if (existing.listingStatus === ListingStatus.DRAFT) {
      return res.json({ ok: true, item: existing, reused: true });
    }

    const priorDraft = await prisma.property.findFirst({
      where: {
        revisionOfId: existing.id,
        listingStatus: ListingStatus.DRAFT,
        userId: existing.userId,
      },
      orderBy: [{ updatedAt: "desc" }],
    });

    if (priorDraft) return res.json({ ok: true, item: priorDraft, reused: true });

    const revisionSlug = `${existing.slug}--draft-${Date.now()}`;

    const draft = await prisma.property.create({
      data: {
        slug: revisionSlug,
        title: existing.title,
        address1: existing.address1,
        address2: existing.address2,
        city: existing.city,
        county: existing.county,
        eircode: existing.eircode,
        lat: existing.lat,
        lng: existing.lng,
        price: existing.price,
        bedrooms: existing.bedrooms,
        bathrooms: existing.bathrooms,
        propertyType: existing.propertyType,
        ber: existing.ber,
        berNo: existing.berNo,
        saleType: existing.saleType,
        marketStatus: existing.marketStatus,
        description: existing.description,
        features: existing.features,
        photos: existing.photos,

        listingStatus: ListingStatus.DRAFT,
        publishedAt: null,
        archivedAt: null,

        submittedAt: null,
        approvedAt: null,
        approvedById: null,
        rejectedAt: null,
        rejectedById: null,
        rejectionReason: null,

        userId: existing.userId,
        revisionOfId: existing.id,
      },
    });

    return res.json({ ok: true, item: draft, reused: false });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Start-edit failed" });
  }
});

/**
 * PATCH /api/properties/:id
 */
router.patch("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Property not found" });

    if (!isOwnerOrAdmin(req, existing.userId ?? null)) return res.status(403).json({ ok: false, message: "Forbidden" });

    if (existing.listingStatus === ListingStatus.ARCHIVED) {
      return res.status(409).json({ ok: false, message: "Archived. Unarchive first." });
    }
    if (existing.listingStatus === ListingStatus.PENDING) {
      return res.status(409).json({ ok: false, message: "Pending review. Admin must approve/reject first." });
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
    delete data.archivedAt;
    delete data.revisionOfId;
    delete data.submittedAt;
    delete data.approvedAt;
    delete data.approvedById;
    delete data.rejectedAt;
    delete data.rejectedById;
    delete data.rejectionReason;

    const updated = await prisma.property.update({ where: { id }, data });
    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    if (err?.code === "P2002") return res.status(409).json({ ok: false, message: "Slug already exists" });
    return res.status(500).json({ ok: false, message: err?.message || "Update failed" });
  }
});

/**
 * ✅ Step 6: submit
 */
router.post("/:id/submit", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Property not found" });

    if (!isOwnerOrAdmin(req, existing.userId ?? null)) return res.status(403).json({ ok: false, message: "Forbidden" });

    if (existing.listingStatus === ListingStatus.ARCHIVED) {
      return res.status(409).json({ ok: false, message: "Archived. Unarchive first." });
    }

    if (existing.listingStatus !== ListingStatus.DRAFT) {
      return res.status(409).json({ ok: false, message: "Only drafts can be submitted." });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: ListingStatus.PENDING,
        submittedAt: new Date(),
        rejectedAt: null,
        rejectedById: null,
        rejectionReason: null,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Submit failed" });
  }
});

/**
 * ✅ Step 6: approve (ADMIN)
 */
router.post("/:id/approve", requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = getUser(req)!;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Property not found" });

    if (existing.listingStatus !== ListingStatus.PENDING) {
      return res.status(409).json({ ok: false, message: "Only pending listings can be approved." });
    }

    if (existing.revisionOfId) {
      const parent = await prisma.property.findUnique({ where: { id: existing.revisionOfId } });
      if (parent && parent.listingStatus === ListingStatus.PUBLISHED) {
        if (parent.userId !== existing.userId) return res.status(400).json({ ok: false, message: "Revision owner mismatch" });
        await prisma.property.update({
          where: { id: parent.id },
          data: { listingStatus: ListingStatus.DRAFT, publishedAt: null },
        });
      }
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: ListingStatus.PUBLISHED,
        publishedAt: new Date(),
        archivedAt: null,

        approvedAt: new Date(),
        approvedById: admin.id,

        rejectedAt: null,
        rejectedById: null,
        rejectionReason: null,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Approve failed" });
  }
});

/**
 * ✅ Step 6: reject (ADMIN)
 */
router.post("/:id/reject", requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = getUser(req)!;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Property not found" });

    if (existing.listingStatus !== ListingStatus.PENDING) {
      return res.status(409).json({ ok: false, message: "Only pending listings can be rejected." });
    }

    const reason = req.body?.reason ? String(req.body.reason) : "Needs changes";

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: ListingStatus.DRAFT,
        submittedAt: null,
        publishedAt: null,

        rejectedAt: new Date(),
        rejectedById: admin.id,
        rejectionReason: reason,

        approvedAt: null,
        approvedById: null,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Reject failed" });
  }
});

/**
 * POST /api/properties/:id/publish
 * ✅ Now admin-only direct publish
 */
router.post("/:id/publish", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ ok: false, message: "Publishing requires admin approval. Use /submit." });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Property not found" });

    if (existing.listingStatus === ListingStatus.ARCHIVED) return res.status(409).json({ ok: false, message: "Archived. Unarchive first." });
    if (existing.listingStatus === ListingStatus.PUBLISHED) return res.status(409).json({ ok: false, message: "Already published" });

    if (existing.revisionOfId) {
      const parent = await prisma.property.findUnique({ where: { id: existing.revisionOfId } });
      if (parent && parent.listingStatus === ListingStatus.PUBLISHED) {
        if (parent.userId !== existing.userId) return res.status(400).json({ ok: false, message: "Revision owner mismatch" });
        await prisma.property.update({
          where: { id: parent.id },
          data: { listingStatus: ListingStatus.DRAFT, publishedAt: null },
        });
      }
    }

    const admin = getUser(req)!;

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: ListingStatus.PUBLISHED,
        publishedAt: new Date(),
        archivedAt: null,
        approvedAt: new Date(),
        approvedById: admin.id,
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

    if (!isOwnerOrAdmin(req, existing.userId ?? null)) return res.status(403).json({ ok: false, message: "Forbidden" });

    if (existing.listingStatus === ListingStatus.PENDING) return res.status(409).json({ ok: false, message: "Pending review. Admin must approve/reject first." });
    if (existing.listingStatus === ListingStatus.DRAFT) return res.status(409).json({ ok: false, message: "Already draft" });
    if (existing.listingStatus === ListingStatus.ARCHIVED) return res.status(409).json({ ok: false, message: "Archived. Unarchive first." });

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
 * Step 5: archive/unarchive
 */
router.post("/:id/archive", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Property not found" });

    if (!isOwnerOrAdmin(req, existing.userId ?? null)) return res.status(403).json({ ok: false, message: "Forbidden" });

    if (existing.listingStatus === ListingStatus.ARCHIVED) return res.status(409).json({ ok: false, message: "Already archived" });

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: ListingStatus.ARCHIVED,
        archivedAt: new Date(),
        publishedAt: null,
        submittedAt: null,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Archive failed" });
  }
});

router.post("/:id/unarchive", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Property not found" });

    if (!isOwnerOrAdmin(req, existing.userId ?? null)) return res.status(403).json({ ok: false, message: "Forbidden" });

    if (existing.listingStatus !== ListingStatus.ARCHIVED) return res.status(409).json({ ok: false, message: "Not archived" });

    const updated = await prisma.property.update({
      where: { id },
      data: { listingStatus: ListingStatus.DRAFT, archivedAt: null, publishedAt: null, submittedAt: null },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Unarchive failed" });
  }
});

/**
 * POST /api/properties (create)
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
    if (!Number.isFinite(price)) return res.status(400).json({ ok: false, message: "price must be a number" });

    const user = getUser(req);

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
        archivedAt: null,
        submittedAt: null,
        approvedAt: null,
        approvedById: null,
        rejectedAt: null,
        rejectedById: null,
        rejectionReason: null,
        revisionOfId: null,
      },
    });

    return res.status(201).json({ ok: true, item: created });
  } catch (err: any) {
    if (err?.code === "P2002") return res.status(409).json({ ok: false, message: "Slug already exists" });
    return res.status(500).json({ ok: false, message: err?.message || "Create failed" });
  }
});

/**
 * PUBLIC: list (published only)
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const items = await prisma.property.findMany({
      where: { listingStatus: ListingStatus.PUBLISHED },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    });
    return res.json({ ok: true, items });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Failed to list properties" });
  }
});

/**
 * GET /api/properties/:slug (catch-all LAST)
 */
router.get("/:slug", optionalAuth, async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, message: "Missing slug" });

    const item = await prisma.property.findUnique({ where: { slug } });
    if (!item) return res.status(404).json({ ok: false, message: "Property not found" });

    if (item.listingStatus === ListingStatus.PUBLISHED) return res.json({ ok: true, item });

    if (!isOwnerOrAdmin(req, item.userId ?? null)) {
      return res.status(404).json({ ok: false, message: "Property not found" });
    }

    return res.json({ ok: true, item });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Failed to fetch property" });
  }
});

export default router;
