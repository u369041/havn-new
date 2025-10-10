import { Router, Request, Response } from "express";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

/**
 * We select only columns that we know exist in the current DB.
 * If you later add columns in Prisma, add them here too.
 */
const PROPERTY_SELECT = {
  id: true,
  title: true,
  description: true,
  price: true,
  listingType: true, // enum in DB
  status: true,      // enum in DB
  slug: true,
  createdAt: true,
  updatedAt: true,
  // NO sizeSqM / areaSqFt here (removed)
  images: {
    select: {
      id: true,
      propertyId: true,
      publicId: true,
      url: true,
      width: true,
      height: true,
      format: true,
      position: true,
      createdAt: true,
    },
    orderBy: { position: "asc" as const },
  },
} satisfies Prisma.PropertySelect;

/**
 * GET /api/properties
 * Optional filters:
 *   q: string (search title/description/slug)
 *   type: string (e.g. SALE | RENT) – we pass through, DB will validate enum
 *   status: string (e.g. ACTIVE | DRAFT)
 *   minPrice, maxPrice: numbers
 *   page, pageSize: numbers
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const {
      q,
      type,
      status,
      minPrice,
      maxPrice,
      page = "1",
      pageSize = "24",
    } = req.query as Record<string, string | undefined>;

    const pageNum = Math.max(1, parseInt(page ?? "1", 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(pageSize ?? "24", 10) || 24));
    const skip = (pageNum - 1) * perPage;

    const where: Prisma.PropertyWhereInput = {};

    if (q && q.trim()) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
      ];
    }

    if (type && type.trim()) {
      // Let Prisma/DB validate the enum value; if invalid, it will throw
      where.listingType = type as any;
    }

    if (status && status.trim()) {
      where.status = status as any;
    }

    const priceFilter: Prisma.IntFilter = {};
    const min = Number(minPrice);
    const max = Number(maxPrice);

    if (!Number.isNaN(min)) priceFilter.gte = min;
    if (!Number.isNaN(max)) priceFilter.lte = max;

    if (priceFilter.gte !== undefined || priceFilter.lte !== undefined) {
      where.price = priceFilter;
    }

    const [count, properties] = await Promise.all([
      prisma.property.count({ where }),
      prisma.property.findMany({
        where,
        select: PROPERTY_SELECT,
        orderBy: { createdAt: "desc" },
        skip,
        take: perPage,
      }),
    ]);

    res.json({ ok: true, count, properties });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: err?.message ?? "Unexpected error",
    });
  }
});

/**
 * GET /api/properties/:slug
 */
router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    const property = await prisma.property.findUnique({
      where: { slug },
      select: PROPERTY_SELECT,
    });

    if (!property) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    res.json({ ok: true, property });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: err?.message ?? "Unexpected error",
    });
  }
});

/**
 * POST /api/properties
 * Minimal, safe create payload.
 * (We keep it permissive to avoid enum/type friction during testing.)
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      title,
      description,
      price,
      status,      // e.g. "ACTIVE"
      type,        // e.g. "SALE" | "RENT"
      slug,        // optional: if not provided, server will generate if you have a hook; otherwise we’ll derive
      images = [],
    } = req.body ?? {};

    if (!title || typeof title !== "string") {
      return res.status(400).json({ ok: false, error: "title is required" });
    }

    const priceNum = Number(price);
    if (Number.isNaN(priceNum)) {
      return res.status(400).json({ ok: false, error: "price must be a number" });
    }

    // Very light slug handling: if none provided, derive a simple one
    const derivedSlug =
      typeof slug === "string" && slug.trim()
        ? slug.trim()
        : title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)+/g, "") + "-" + Date.now().toString().slice(-6);

    // Prepare images -> only allowed fields
    const imageCreates =
      Array.isArray(images)
        ? images.map((img: any, idx: number) => ({
            url: String(img?.url ?? ""),
            publicId: String(img?.publicId ?? ""),
            width: img?.width != null ? Number(img.width) : null,
            height: img?.height != null ? Number(img.height) : null,
            format: img?.format != null ? String(img.format) : null,
            position: img?.position != null ? Number(img.position) : idx,
          }))
        : [];

    const created = await prisma.property.create({
      data: {
        title,
        description: description ?? null,
        price: priceNum,
        listingType: (type ?? "SALE") as any,
        status: (status ?? "ACTIVE") as any,
        slug: derivedSlug,
        images: imageCreates.length
          ? { create: imageCreates }
          : undefined,
      },
      select: PROPERTY_SELECT,
    });

    res.status(201).json({ ok: true, property: created });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: err?.message ?? "Unexpected error",
    });
  }
});

export default router;
