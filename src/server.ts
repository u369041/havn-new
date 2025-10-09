import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import bodyParser from 'body-parser';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();

// ----- CORS -----
const allowedOrigins = [
  'https://www.havn.ie',
  'https://havn.ie',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

app.use(cors({
  origin(origin, cb) {
    // allow same-origin / server-to-server (no Origin header)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));
app.options('*', cors());

// ----- Common middleware -----
app.use(morgan('tiny'));
app.use(bodyParser.json());

// ----- Health check -----
app.get('/health', (_req, res) => res.json({ ok: true }));

// ----- API routes -----
// GET /api/properties
app.get('/api/properties', async (_req, res) => {
  try {
    const properties = await prisma.property.findMany({
      orderBy: { createdAt: 'desc' },
      include: { images: { orderBy: { position: 'asc' } } },
    });
    res.json({ ok: true, count: properties.length, properties });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ ok: false, error: err?.message || 'Server error' });
  }
});

// GET /api/properties/:slug
app.get('/api/properties/:slug', async (req, res) => {
  try {
    const property = await prisma.property.findUnique({
      where: { slug: req.params.slug },
      include: { images: { orderBy: { position: 'asc' } } },
    });
    if (!property) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, property });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ ok: false, error: err?.message || 'Server error' });
  }
});

// POST /api/properties  (kept here if you need it)
app.post('/api/properties', async (req, res) => {
  try {
    const {
      title, description, price, listingType, status, slug, city, county,
      bedrooms, bathrooms, areaSqFt, images = [],
    } = req.body;

    const created = await prisma.property.create({
      data: {
        title, description, price, listingType, status, slug, city, county,
        bedrooms, bathrooms, areaSqFt,
        images: {
          create: images.map((img: any, i: number) => ({
            url: img.url,
            publicId: img.publicId || null,
            width: img.width || null,
            height: img.height || null,
            format: img.format || null,
            position: typeof img.position === 'number' ? img.position : i,
          })),
        },
      },
      include: { images: { orderBy: { position: 'asc' } } },
    });

    res.status(201).json({ ok: true, property: created });
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ ok: false, error: err?.message || 'Bad request' });
  }
});

// ----- Start server -----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
});
