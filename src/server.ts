// src/server.ts

import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

const ALLOWED_ORIGINS: string[] = [
  'https://havn.ie',
  'https://www.havn.ie',
  'https://havn-new.onrender.com',
];

// Cloudinary env vars (SET THESE IN RENDER)
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || '';
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || '';

const app = express();

// --- middleware ---
app.use(helmet());

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
  }),
);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl, health checks
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
  }),
);

app.use(express.json());

app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// --- health ---
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

// ================================
//  CLOUDINARY SIGNATURE ENDPOINT
// ================================
app.all(
  '/api/uploads/cloudinary-signature',
  (req: Request, res: Response) => {
    try {
      const folder =
        (req.body &&
          typeof req.body.folder === 'string' &&
          req.body.folder.trim()) ||
        'properties';

      if (!CLOUDINARY_API_SECRET || !CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY) {
        console.error('Missing Cloudinary env vars');
        return res.status(500).json({
          ok: false,
          error: 'Cloudinary is not configured on the server',
        });
      }

      const timestamp = Math.round(Date.now() / 1000);
      const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;

      const signature = createHash('sha1')
        .update(paramsToSign + CLOUDINARY_API_SECRET)
        .digest('hex');

      return res.json({
        ok: true,
        signature,
        timestamp,
        cloudName: CLOUDINARY_CLOUD_NAME,
        apiKey: CLOUDINARY_API_KEY,
      });
    } catch (err) {
      console.error('Error generating Cloudinary signature', err);
      return res.status(500).json({
        ok: false,
        error: 'Failed to generate Cloudinary signature',
      });
    }
  },
);

// ================================
//  PROPERTIES ROUTES
// ================================

app.get('/api/properties', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;
    const status = (req.query.status as string | undefined) || undefined;

    const where: any = {};
    if (status) where.status = status;

    const [count, properties] = await Promise.all([
      prisma.property.count({ where }),
      prisma.property.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
    ]);

    res.json({ ok: true, count, properties });
  } catch (err) {
    console.error('GET /api/properties error', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch properties' });
  }
});

app.get('/api/properties/:slug', async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug;
    const property = await prisma.property.findUnique({ where: { slug } });

    if (!property) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    res.json({ ok: true, property });
  } catch (err) {
    console.error('GET /api/properties/:slug error', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch property' });
  }
});

app.post('/api/properties', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};

    const requiredFields = [
      'slug',
      'title',
      'address1',
      'city',
      'county',
      'eircode',
      'price',
      'status',
      'propertyType',
      'photos',
    ] as const;

    for (const f of requiredFields) {
      const v = body[f];
      if (
        v === undefined ||
        v === null ||
        (typeof v === 'string' && !v.trim())
      ) {
        return res.status(400).json({
          ok: false,
          error: `Missing required field: ${f}`,
        });
      }
    }

    if (!Array.isArray(body.photos) || body.photos.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'At least one photo is required',
      });
    }

    const features: string[] = Array.isArray(body.features)
      ? body.features
      : typeof body.features === 'string'
      ? body.features
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : [];

    const property = await prisma.property.create({
      data: {
        slug: body.slug,
        title: body.title,
        address1: body.address1,
        address2: body.address2 || '',
        city: body.city,
        county: body.county,
        eircode: body.eircode,
        price: Number(body.price),
        status: body.status,
        propertyType: body.propertyType,
        ber: body.ber || null,
        bedrooms:
          body.bedrooms !== undefined ? Number(body.bedrooms) : null,
        bathrooms:
          body.bathrooms !== undefined ? Number(body.bathrooms) : null,
        size: body.size !== undefined ? Number(body.size) : null,
        sizeUnits: body.sizeUnits || 'sqm',
        features,
        description: body.description || '',
        photos: body.photos,
      },
    });

    res.status(201).json({ ok: true, property });
  } catch (err: any) {
    console.error('POST /api/properties error', err);

    if (err.code === 'P2002') {
      return res
        .status(409)
        .json({ ok: false, error: 'Slug already exists' });
    }

    res.status(500).json({ ok: false, error: 'Failed to create property' });
  }
});

// 404 fallback as JSON (so we never get that HTML 404 again)
app.use((req: Request, res: Response) => {
  res.status(404).json({
    ok: false,
    error: 'Not found',
    path: req.path,
  });
});

app.listen(PORT, () => {
  console.log(`HAVN API listening on port ${PORT}`);
});
