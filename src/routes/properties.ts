// src/routes/properties.ts
import { Router, Request, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import slugify from 'slugify';

const router = Router();
const prisma = new PrismaClient();

/* --------------------------------- helpers -------------------------------- */

function toSlug(input: string): string {
  return slugify(input, { lower: true, strict: true, trim: true });
}

function safeEnum<T extends string>(val: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof val === 'string') {
    const key = val.toUpperCase() as T;
    if ((allowed as readonly string[]).includes(key)) return key;
  }
  return fallback;
}

function numOrUndefined(val: unknown): number | undefined {
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

function normaliseImageForCreate(img: any, index: number) {
  // Prisma optional fields should be undefined (not null) when omitted
  return {
    url: String(img?.url ?? ''),
    publicId: img?.publicId || undefined,
    width: img?.width ?? undefined,
    height: img?.height ?? undefined,
    format: img?.format || undefined,
    position: Number.isFinite(img?.position) ? Number(img.position) : index,
  };
}

/** Ensure slug is unique; append -001, -002 ... if needed */
async function ensureUniqueSlug(base: string): Promise<string> {
  let slug = base;
  let i = 1;
  while (true) {
    const exists = await prisma.property.findUnique({ where: { slug } });
    if (!exists) return slug;
    slug = `${base}-${String(i).padStart(3, '0')}`;
    i += 1;
  }
}

/* ---------------------------------- GET / --------------------------------- */
/** List properties with filters */
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      q,
      type,
      status,
      minPrice,
      maxPrice,
      page = '1',
      pageSize = '20',
      sort = 'createdAt:desc',
    } = req.query as Record<string, string>;

    const where: Prisma.PropertyWhereInput = {};

    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
        { county: { contains: q, mode: 'insensitive' } },
        { eircode: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (type) {
      const allowed = ['SALE', 'RENT', 'SHARE', 'OTHER'] as const;
      const v = safeEnum(type, allowed, allowed[0]);
      where.listingType = v as any;
    }

    if (status) {
      const allowed = ['ACTIVE', 'DRAFT'] as const;
      const v = safeEnum(status, allowed, allowed[0]);
      where.status = v as any;
    }

    const priceFilter: Prisma.IntFilter = {};
    const min = numOrUndefined(minPrice);
    const max = numOrUndefined(maxPrice);
    if (typeof min === 'number') priceFilter.gte = min;
    if (typeof max === 'number') priceFilter.lte = max;
    if (Object.keys(priceFilter).length) where.price = priceFilter;

    // pagination
    const pageNum = Math.max(1, Number(page) || 1);
    const take = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const skip = (pageNum - 1) * take;

    // sorting
    let orderBy: Prisma.PropertyOrderByWithRelationInput = { createdAt: 'desc' };
    if (typeof sort === 'string' && sort.includes(':')) {
      const [field, dir] = sort.split(':');
      if (field && (dir === 'asc' || dir === 'desc')) {
        orderBy = { [field]: dir } as any;
      }
    }

    const [count, properties] = await Promise.all([
      prisma.property.count({ where }),
      prisma.property.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          images: { orderBy: { position: 'asc' } },
        },
      }),
    ]);

    res.json({ ok: true, count, properties });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ ok: false, error: err?.message ?? 'Unknown error' });
  }
});

/* ------------------------------ GET /:slug -------------------------------- */
/** Single property by slug */
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const property = await prisma.property.findUnique({
      where: { slug },
      include: { images: { orderBy: { position: 'asc' } } },
    });
    if (!property) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    res.json({ ok: true, property });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ ok: false, error: err?.message ?? 'Unknown error' });
  }
});

/* --------------------------------- POST / --------------------------------- */
/** Create property */
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};

    // required
    const title: string = String(body.title ?? '').trim();
    const price: number = Number(body.price ?? 0);
    if (!title) return res.status(400).json({ ok: false, error: 'title is required' });
    if (!Number.isFinite(price)) return res.status(400).json({ ok: false, error: 'price is invalid' });

    // enums
    const typeAllowed = ['SALE', 'RENT', 'SHARE', 'OTHER'] as const;
    const statusAllowed = ['ACTIVE', 'DRAFT'] as const;

    const listingType = safeEnum(body.listingType, typeAllowed, 'SALE') as any;
    const status = safeEnum(body.status, statusAllowed, 'ACTIVE') as any;

    // slug
    const baseSlug = body.slug ? toSlug(String(body.slug)) : toSlug(title);
    const slug = await ensureUniqueSlug(baseSlug);

    // optional numeric fields
    const bedrooms = numOrUndefined(body.bedrooms);
    const bathrooms = numOrUndefined(body.bathrooms);

    // optional strings
    const description = body.description?.trim() || undefined;
    const addressLine1 = body.addressLine1?.trim() || undefined;
    const addressLine2 = body.addressLine2?.trim() || undefined;
    const city = body.city?.trim() || undefined;
    const county = body.county?.trim() || undefined;
    const eircode = body.eircode?.trim() || undefined;

    // lat/lng
    const latitude = typeof body.latitude === 'number' ? body.latitude : numOrUndefined(body.latitude);
    const longitude = typeof body.longitude === 'number' ? body.longitude : numOrUndefined(body.longitude);

    // images
    const imagesInput = Array.isArray(body.images) ? body.images : [];
    const imageCreates = imagesInput.map(normaliseImageForCreate);

    const created = await prisma.property.create({
      data: {
        title,
        description,
        price,
        listingType,
        status,
        bedrooms,
        bathrooms,
        addressLine1,
        addressLine2,
        city,
        county,
        eircode,
        latitude,
        longitude,
        slug,
        images: imageCreates.length ? { create: imageCreates } : undefined,
      },
      include: {
        images: { orderBy: { position: 'asc' } },
      },
    });

    res.status(201).json({ ok: true, property: created });
  } catch (err: any) {
    console.error(err);
    if (err?.code === 'P2002' && Array.isArray(err?.meta?.target) && err.meta.target.includes('slug')) {
      return res.status(409).json({ ok: false, error: 'Unique constraint failed on: slug' });
    }
    res.status(500).json({ ok: false, error: err?.message ?? 'Unknown error' });
  }
});

export default router;
