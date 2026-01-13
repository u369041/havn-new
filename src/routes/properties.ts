import { Router } from "express";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth"; // default import
import { sendAdminNewSubmissionEmail, sendUserListingEmail } from "../lib/mail";

const router = Router();

function isOwnerOrAdmin(user: any, ownerId: number) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return user.userId === ownerId;
}

function slugify(input: string) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function generateUniqueSlug(base: string) {
  const clean = slugify(base) || "listing";
  let candidate = clean;
  let n = 2;

  while (true) {
    const existing = await prisma.property.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
    candidate = `${clean}-${n}`;
    n++;
    if (n > 50) candidate = `${clean}-${Date.now()}`;
  }
}

async function getUserEmailById(userId: number): Promise<string | null> {
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return u?.email || null;
  } catch {
    return null;
  }
}

/**
 * GET /api/properties/mine
 * Returns all listings owned by user (admins see all)
 */
router.get("/mine", requireAuth, async (req: any, res) => {
  try {
    const user = req.user;

    if (!user || !Number.isFinite(Number(user.userId))) {
      return res.status(401).json({ ok: false, message: "Invalid auth session" });
    }

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
    console.error("GET /api/properties/mine error", {
      message: err?.message,
      code: err?.code,
      meta: err?.meta,
      stack: err?.stack,
      name: err?.name,
    });

    return res.status(500).json({
      ok: false,
      message: "Server error",
      error: err?.message || String(err),
      code: err?.code || null,
      meta: err?.meta || null,
      hint:
        "Likely Prisma/DB drift. Check Render logs for full stack. Common causes: missing column, wrong type for text[] (photos/features), or migration drift.",
    });
  }
});

/**
 * ✅ GET /api/properties/_admin
 */
router.get("/_admin", requireAuth, async (req: any, res) => {
  try {
    const user = req.user;

    if (!user || user.role !== "admin") {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const idRaw = req.query.id;
    const slugRaw = req.query.slug;

    if (idRaw || slugRaw) {
      let item: any = null;

      if (idRaw) {
        const id = parseInt(String(idRaw), 10);
        if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });
        item = await prisma.property.findUnique({ where: { id } });
      } else if (slugRaw) {
        const slug = String(slugRaw);
        item = await prisma.property.findUnique({ where: { slug } });
      }

      if (!item) return res.status(404).json({ ok: false, message: "Not found" });
      return res.json({ ok: true, item });
    }

    const page = Math.max(parseInt(String(req.query.page || "1"), 10), 1);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "25"), 10), 1), 100);

    const where: any = {};

    const q = String(req.query.q || "").trim();
    const county = String(req.query.county || "").trim();
    const city = String(req.query.city || "").trim();
    const type = String(req.query.type || "").trim();

    const statusRaw = String(req.query.listingStatus || "").trim().toUpperCase();
    const status = statusRaw === "PENDING" ? "SUBMITTED" : statusRaw;

    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { county: { contains: q, mode: "insensitive" } },
        { eircode: { contains: q, mode: "insensitive" } },
        { address1: { contains: q, mode: "insensitive" } },
        { address2: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
      ];
    }

    if (county) where.county = { contains: county, mode: "insensitive" };
    if (city) where.city = { contains: city, mode: "insensitive" };
    if (type) where.propertyType = type;
    if (status) where.listingStatus = status;

    const [total, items] = await Promise.all([
      prisma.property.count({ where }),
      prisma.property.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { updatedAt: "desc" },
      }),
    ]);

    return res.json({ ok: true, page, limit, total, items });
  } catch (err: any) {
    console.error("GET /api/properties/_admin error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * GET /api/properties
 * Public browse endpoint: returns PUBLISHED listings only.
 */
router.get("/", requireAuth.optional, async (req: any, res) => {
  try {
    const where: any = { listingStatus: "PUBLISHED" };

    const page = Math.max(parseInt(String(req.query.page || "1"), 10), 1);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "12"), 10), 1), 50);

    const q = String(req.query.q || "").trim();
    const county = String(req.query.county || "").trim();
    const city = String(req.query.city || "").trim();
    const type = String(req.query.type || "").trim();

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
 * Owners/admin: can view non-published.
 */
router.get("/:slug", requireAuth.optional, async (req: any, res) => {
  try {
    const slug = String(req.params.slug);
    const user = req.user || null;

    const property = await prisma.property.findUnique({ where: { slug } });
    if (!property) return res.status(404).json({ ok: false, message: "Not found" });

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

    const title = String(payload.title || "Untitled listing").trim();
    const city = String(payload.city || "").trim();
    const eircode = String(payload.eircode || "").trim();

    let slug = String(payload.slug || "").trim();
    if (!slug) {
      const base = [title, city, eircode].filter(Boolean).join(" ");
      slug = await generateUniqueSlug(base);
    } else {
      const existing = await prisma.property.findUnique({ where: { slug } });
      if (existing) return res.status(409).json({ ok: false, message: "Slug already exists" });
    }

    const created = await prisma.property.create({
      data: {
        slug,
        title,
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
        marketStatus: payload.marketStatus || payload.status || null,
        description: payload.description || null,
        features: Array.isArray(payload.features) ? payload.features : [],
        photos: Array.isArray(payload.photos) ? payload.photos : [],
        listingStatus: "DRAFT",
        userId: user.userId,
      },
    });

    // ✅ EMAIL (customer): draft created (fire-and-forget)
    void (async () => {
      const to = user?.email || (await getUserEmailById(user.userId));
      if (!to) return;

      await sendUserListingEmail({
        to,
        event: "DRAFT_CREATED",
        listingTitle: (created as any).title || "Untitled listing",
        slug: (created as any).slug,
        listingId: (created as any).id,
        myListingsUrl: "https://havn.ie/my-listings.html",
      });
    })();

    return res.json({ ok: true, item: created });
  } catch (err: any) {
    console.error("POST /properties error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * PATCH /api/properties/:id
 * Update draft listing (owner/admin)
 */
router.patch("/:id", requireAuth, async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const user = req.user;
    const existing = await prisma.property.findUnique({ where: { id } });

    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });
    if (!isOwnerOrAdmin(user, existing.userId)) return res.status(403).json({ ok: false, message: "Forbidden" });

    if (existing.listingStatus === "PUBLISHED") {
      return res.status(400).json({ ok: false, message: "Published listings cannot be edited directly." });
    }
    if (existing.listingStatus === "SUBMITTED") {
      return res.status(409).json({ ok: false, message: "Listing is submitted and locked." });
    }
    if (existing.listingStatus === "ARCHIVED") {
      return res.status(409).json({ ok: false, message: "Listing is archived." });
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
        marketStatus: payload.marketStatus ?? payload.status ?? existing.marketStatus,
        description: payload.description ?? existing.description,
        features: Array.isArray(payload.features) ? payload.features : existing.features,
        photos: Array.isArray(payload.photos) ? payload.photos : existing.photos,
      },
    });

    // ✅ EMAIL (customer): draft saved (fire-and-forget)
    void (async () => {
      const to =
        user?.email ||
        (user?.userId ? await getUserEmailById(user.userId) : null) ||
        (existing?.userId ? await getUserEmailById(existing.userId) : null);

      if (!to) return;

      await sendUserListingEmail({
        to,
        event: "DRAFT_SAVED",
        listingTitle: (updated as any).title || "Untitled listing",
        slug: (updated as any).slug,
        listingId: (updated as any).id,
        myListingsUrl: "https://havn.ie/my-listings.html",
      });
    })();

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("PATCH /properties/:id error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/properties/:id/submit
 * Owner/admin: move DRAFT -> SUBMITTED (locks listing)
 */
router.post("/:id/submit", requireAuth, async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const user = req.user;

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (!isOwnerOrAdmin(user, existing.userId)) return res.status(403).json({ ok: false, message: "Forbidden" });

    if (existing.listingStatus !== "DRAFT") {
      return res.status(409).json({
        ok: false,
        message: `Cannot submit from status ${existing.listingStatus}`,
      });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "SUBMITTED",
        submittedAt: new Date(),
      },
    });

    // ✅ EMAIL (customer): submitted for approval (fire-and-forget)
    void (async () => {
      const to =
        user?.email ||
        (user?.userId ? await getUserEmailById(user.userId) : null) ||
        (existing?.userId ? await getUserEmailById(existing.userId) : null);

      if (!to) return;

      await sendUserListingEmail({
        to,
        event: "SUBMITTED_FOR_APPROVAL",
        listingTitle: (updated as any).title || "Untitled listing",
        slug: (updated as any).slug,
        listingId: (updated as any).id,
        myListingsUrl: "https://havn.ie/my-listings.html",
      });
    })();

    // ✅ EMAIL: notify admin (fire-and-forget, never breaks flow)
    void sendAdminNewSubmissionEmail({
      listingTitle: (updated as any).title || "Untitled listing",
      slug: (updated as any).slug,
      listingId: String((updated as any).id),
      adminUrl: `https://havn.ie/property-admin.html?id=${(updated as any).id}`,
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /properties/:id/submit error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;
