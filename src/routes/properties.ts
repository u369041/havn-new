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

function toNum(n: any): number | undefined {
  if (n === null || n === undefined || n === '') return undefined;
  const parsed = Number(n);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/* ---------- routes ---------- */

router.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

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

router.post('/properties', async (req: Request, res: Response) => {
  try {
    const b = req.body || {};

    // required
    const title: string = b.title;
    const price = toNum(b.price);
    const slug: string = b.slug;

    if (!title || !slug || price === undefined) {
      return res.status(400).json({
        ok: false,
        error: 'title, price, and slug are required',
      });
    }

    const listingType = toListingType(b.listingType);
    const status = toListingStatus(b.status);

    // optional
    const bedrooms = toNum(b.bedrooms);
    const bathrooms = toNum(b.bathrooms);

    const description = b.description ?? undefined;
    const addressLine1 = b.addressLine1 ?? undefined;
    const addressLine2 = b.addressLine2 ?? undefined;
    const city = b.city ?? undefined;
    const county = b.county ?? undefined;
    const eircode = b.eircode ?? undefined;
    const latitude = toNum(b.latitude);
    const longitude = toNum(b.longitude);

    // images
    let imagesCreate:
      | {
          create: {
            url: string;
            publicId: string;
            width?: number;
            height?: number;
            format?: string;
            position?: number;
          }[];
        }
      | undefined;

    if (Array.isArray(b.images) && b.images.length) {
      imagesCreate = {
        create: b.images.map((img: any, idx: number) => ({
          url: String(img?.url ?? ''),
          publicId: String(img?.publicId ?? ''), // always string
          width: toNum(img?.width),
          height: toNum(img?.height),
          format: img?.format ? String(img.format) : undefined,
          position: img?.position !== undefined ? Number(img.position) : idx,
        })),
      };
    }

    const result = await prisma.property.create({
      data: {
        title,
        description,
        price,
        slug,
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

export { router as apiRouter };
