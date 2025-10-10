import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

/* ----------------------------- helpers ---------------------------------- */

const ALLOWED_TYPES = ['SALE', 'RENT']; // match your Prisma enum
const ALLOWED_STATUS = ['ACTIVE', 'DRAFT', 'ARCHIVED']; // match your Prisma enum

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function toPositiveInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  if (typeof v === 'string' && v.trim() !== '' && /^\d+$/.test(v)) return parseInt(v, 10);
  return null;
}

function bad(res: Response, msg: string, status = 400) {
  return res.status(status).json({ ok: false, error: msg });
}

const imageSelect = {
  id: true,
  url: true,
  publicId: true,
  width: true,
  height: true,
  format: true,
  position: true,
};

const propertySelectList = {
  id: true,
  slug: true,
  title: true,
  price: true,
  description: true,
  listingType: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  images: {
    select: imageSelect,
    orderBy: { position: 'asc' as const },
  },
};

const propertySelectDetail = propertySelectList;

/* ----------------------------- routes ----------------------------------- */

/**
 * GET /api/properties
 * Optional query params:
 *   search: string (in title/description/slug)
 *   type: SALE|RENT
 *   status: ACTIVE|DRAFT|ARCHIVED
 *   minPrice: number
 *   maxPrice: number
 */
router.get('/properties', async (req: Request, res: Response) => {
  try {
    const { search, type, status, minPrice, maxPrice } = req.query;

    const where: any = {};

    if (isNonEmptyString(search)) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (isNonEmptyString(type) && ALLOWED_TYPES.includes(type)) {
      where.listingType = type;
    }

    if (isNonEmptyString(status) && ALLOWED_STATUS.includes(status)) {
      where.status = status;
    }

    const min = toPositiveInt(minPrice as any);
    const max = toPositiveInt(maxPrice as any);
    if (min !== null || max !== null) {
      where.price = {};
      if (min !== null) where.price.gte = min;
      if (max !== null) where.price.lte = max;
    }

    const properties = await prisma.property.findMany({
      where,
      select: propertySelectList,
      orderBy: [{ createdAt: 'desc' }],
      // add pagination if you want: take, skip
    });

    return res.json({ ok: true, count: properties.length, properties });
  } catch (err) {
    console.error('GET /properties failed:', err);
    return bad(res, 'Failed to fetch properties', 500);
  }
});

/**
 * GET /api/properties/:slug
 */
router.get('/properties/:slug', async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug;
    if (!isNonEmptyString(slug)) return bad(res, 'Invalid slug');

    const property = await prisma.property.findUnique({
      where: { slug },
      select: propertySelectDetail,
    });

    if (!property) return bad(res, 'Not found', 404);

    return res.json({ ok: true, property });
  } catch (err) {
    console.error('GET /properties/:slug failed:', err);
    return bad(res, 'Failed to fetch property', 500);
  }
});

/**
 * POST /api/properties
 * Body:
 * {
 *   title: string
 *   price: number
 *   description?: string
 *   listingType: "SALE" | "RENT"
 *   status?: "ACTIVE" | "DRAFT" | "ARCHIVED"  (default: "ACTIVE")
 *   slug: string (unique)
 *   images?: Array<{
 *     url: string
 *     publicId?: string
 *     width?: number
 *     height?: number
 *     format?: string
 *     position?: number
 *   }>
 * }
 */
router.post('/properties', async (req: Request, res: Response) => {
  try {
    const {
      title,
      price,
      description,
      listingType,
      status,
      slug,
      images,
    } = req.body ?? {};

    // Basic validation
    if (!isNonEmptyString(title)) return bad(res, 'title is required');
    const priceInt = toPositiveInt(price);
    if (priceInt === null) return bad(res, 'price must be a positive integer');
    if (!isNonEmptyString(listingType) || !ALLOWED_TYPES.includes(listingType)) {
      return bad(res, `listingType must be one of: ${ALLOWED_TYPES.join(', ')}`);
    }
    if (status && (!isNonEmptyString(status) || !ALLOWED_STATUS.includes(status))) {
      return bad(res, `status must be one of: ${ALLOWED_STATUS.join(', ')}`);
    }
    if (!isNonEmptyString(slug)) return bad(res, 'slug is required');

    // Validate images array (optional)
    let imagesData:
      | Array<{
          url: string;
          publicId?: string;
          width?: number;
          height?: number;
          format?: string;
          position?: number;
        }>
      | undefined;

    if (Array.isArray(images)) {
      imagesData = images
        .filter((img) => img && typeof img === 'object' && isNonEmptyString(img.url))
        .map((img, idx) => ({
          url: String(img.url),
          publicId: isNonEmptyString(img.publicId) ? String(img.publicId) : undefined,
          width: toPositiveInt(img.width) ?? undefined,
          height: toPositiveInt(img.height) ?? undefined,
          format: isNonEmptyString(img.format) ? String(img.format) : undefined,
          position:
            img.position !== undefined && img.position !== null
              ? toPositiveInt(img.position) ?? idx
              : idx,
        }));
    }

    // Create
    const created = await prisma.property.create({
      data: {
        title: String(title),
        price: priceInt,
        description: isNonEmptyString(description) ? String(description) : null,
        listingType: listingType, // string matches enum values
        status: status && isNonEmptyString(status) ? status : 'ACTIVE',
        slug: String(slug),
        ...(imagesData && imagesData.length
          ? {
              images: {
                create: imagesData,
              },
            }
          : {}),
      },
      select: propertySelectDetail,
    });

    return res.status(201).json({ ok: true, property: created });
  } catch (err: any) {
    console.error('POST /properties failed:', err);

    // Unique slug friendly message
    if (err?.code === 'P2002' && Array.isArray(err?.meta?.target) && err.meta.target.includes('slug')) {
      return bad(res, 'Slug already exists', 409);
    }

    return bad(res, 'Failed to create property', 500);
  }
});

/* ------------------------------------------------------------------------ */

export default router;
