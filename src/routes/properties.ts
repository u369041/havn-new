import { Router, Request, Response } from 'express';
import { PrismaClient, ListingType, ListingStatus } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

/* ---------- helpers ---------- */

function toListingType(v: any): ListingType {
  if (typeof v !== 'string') throw new Error('listingType must be a string (SALE or RENT)');
  const up = v.toUpperCase();
  if (up === 'SALE' || up === 'RENT') return up as ListingType;
  throw new Error('listingType must be SALE or RENT');
}

function toListingStatus(v: any | undefined): ListingStatus | undefined {
  if (v == null) return undefined;
  if (typeof v !== 'string') throw new Error('status must be a string (ACTIVE, DRAFT, ARCHIVED)');
  const up = v.toUpperCase();
  if (up === 'ACTIVE' || up === 'DRAFT' || up === 'ARCHIVED') return up as ListingStatus;
  throw new Error('status must be ACTIVE, DRAFT or ARCHIVED');
}

function toNum(n: any): number | null {
  if (n === null || n === undefined || n === '') return null;
  const parsed = Number(n);
  return Number.isFinite(parsed) ? parsed : null;
}

/* ---------- routes ---------- */

/** GET /api/health */
router.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

/** GET /api/properties */
router.get('/properties', async (_req: Request, res: Response) => {
  try {
    const properties = await prisma.property.findMany({
      orderBy: { createdAt: 'desc' },
      include: { images: true },
    });
    res.json({ ok: true, count: properties.length, properties });
  } catch (err) {
    console.error('GET /properties failed', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch properties' });
  }
});

/** GET /api/properties/:slug */
router.get('/properties/:slug', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const property = await prisma.property.findUnique({
      where: { slug },
      include: { images: true },
    });
    if (!property) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, property });
  } catch (err) {
    console.error('GET /properties/:slug failed', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch property' });
  }
});

/** POST /api/properties  (JSON body) */
router.post('/properties', async (req: Request, res: Response) => {
  try {
    const b = req.body || {};

    // required
    const title: string = b.title;
    const priceNum = toNum(b.price);
    const slug: string = b.slug;

    if (!title || !slug || priceNum == null) {
      return res.status(400).json({
        ok: false,
        error: 'title, price, and slug are required',
      });
    }

    const listingType = toListingType(b.listingType);
    const status = toListingStatus(b.status);

    // optional numbers
    const bedrooms = toNum(bedOr(b.bedrooms, b.beds));
    const bathrooms = toNum(bathOr(b.bathrooms, b.baths));
    const areaSqM = toNum(b.areaSqM);

    // optional strings
    const description = b.description ?? null;
    const addressLine1 = b.addressLine1 ?? null;
    const addressLine2 = b.addressLine2 ?? null;
    const city = b.city ?? null;
    const county = b.county ?? null;
    const eircode = b.eircode ?? null;

    // lat/lon optional
    const latitude = b.latitude !== undefined ? Number(b.latitude) : null;
    const longitude = b.longitude !== undefined ? Number(b.longitude) : null;

    // images (optional)
    let imagesCreate:
      | {
          create: {
            url: string;
            publicId: string | null;
            width: number | null;
            height: number | null;
            format: string | null;
            position: number | null;
          }[];
        }
      | undefined;

    if (Array.isArray(b.images) && b.images.length) {
      imagesCreate = {
        create: b.images.map((img: any, idx: number) => ({
          url: String(img?.url ?? ''),
          publicId: img?.publicId ?? null,
          width: toNum(img?.width),
          height: toNum(img?.height),
          format: img?.format ?? null,
          position: toNum(img?.position ?? idx),
        })),
      };
    }

    const result = await prisma.property.create({
      data: {
        title,
        description,
        price: priceNum!,
        slug,
        listingType,
        status, // may be undefined; Prisma will use default if your schema has one
        bedrooms,
        bathrooms,
        areaSqM,
        addressLine1,
        addressLine2,
        city,
        county,
        eircode,
        latitude,
        longitude,
        ...(imagesCreate ? { images: imagesCreate } : {}),
      },
      include: { images: true },
    });

    res.status(201).json({ ok: true, property: result });
  } catch (err: any) {
    console.error('POST /properties failed', err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Failed to create property',
    });
  }
});

/* ----- tiny helpers for legacy field names ----- */
function bedOr(a: any, b: any) {
  return a !== undefined ? a : b;
}
function bathOr(a: any, b: any) {
  return a !== undefined ? a : b;
}

/* named export expected by server.ts */
export { router as apiRouter };
