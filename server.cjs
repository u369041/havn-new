// server.cjs — HAVN API (Render-ready, Prisma + Express, with debug + schema introspection)

require("dotenv/config");

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const app = express();

const BUILD =
  process.env.RENDER_GIT_COMMIT ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  new Date().toISOString();

// ---------- Middleware ----------
app.use(helmet());
app.use(morgan("tiny"));
app.use(express.json({ limit: "5mb" }));

const allowedOrigins = new Set([
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com",
]);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.has(origin)) return cb(null, true);
      return cb(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ---------- Debug Routes ----------

// Health
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "havn-new", build: BUILD });
});

// Route list
app.get("/api/debug/routes", (_req, res) => {
  res.json({
    ok: true,
    build: BUILD,
    routes: [
      "/api/health",
      "/api/debug/routes",
      "/api/debug/db",
      "/api/debug/schema",
      "/api/debug/seed",
      "/api/properties",
    ],
  });
});

// DB ping
app.get("/api/debug/db", async (_req, res) => {
  try {
    await prisma.$queryRawUnsafe("SELECT 1;");
    res.json({ ok: true, database: "connected" });
  } catch (e) {
    res.status(500).json({ ok: false, error: "db-failed", detail: e?.message || String(e) });
  }
});

// ---------- NEW: Schema introspection ----------
app.get("/api/debug/schema", async (_req, res) => {
  try {
    const columns = await prisma.$queryRawUnsafe(`
      SELECT
        c.table_schema,
        c.table_name,
        c.column_name,
        c.data_type,
        c.udt_name,
        c.is_nullable,
        c.ordinal_position
      FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name='Property'
      ORDER BY c.ordinal_position;
    `);

    const statusEnum = await prisma.$queryRawUnsafe(`
      SELECT t.typname AS enum_name, e.enumlabel AS enum_value
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typname = 'PropertyStatus'
      ORDER BY e.enumsortorder;
    `);

    const tableExists = await prisma.$queryRawUnsafe(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='Property'
      ) AS exists;
    `);

    res.json({ ok: true, build: BUILD, tableExists, columns, statusEnum });
  } catch (e) {
    console.error("SCHEMA INTROSPECTION FAILED:", e);
    res.status(500).json({
      ok: false,
      error: "schema-introspection-failed",
      message: e?.message || String(e),
      code: e?.code,
      meta: e?.meta,
      stack: e?.stack,
    });
  }
});

// ---------- Seed Route ----------
app.get("/api/debug/seed", async (req, res) => {
  try {
    const token = String(req.query.token || "");
    if (!process.env.SEED_TOKEN || token !== process.env.SEED_TOKEN) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const demos = [
      {
        title: "Alder, Dunloe Upper, Beaufort, Killarney, Co. Kerry (V93 NN84)",
        slug: "alder-dunloe-upper-beaufort-killarney-co-kerry-v93nn84",
        address: "Alder, Dunloe Upper, Beaufort, Killarney, Co. Kerry",
        eircode: "V93NN84",
        status: "FOR_SALE",
        price: 495000,
        beds: 4,
        baths: 3,
        ber: "B2",
        latitude: 52.0567,
        longitude: -9.6031,
        photos: [
          "https://res.cloudinary.com/havn/image/upload/v1720000001/properties/demo1-1.jpg",
          "https://res.cloudinary.com/havn/image/upload/v1720000001/properties/demo1-2.jpg",
        ],
        floorplans: [],
        features: ["South-facing garden", "Underfloor heating", "EV charger", "Fibre broadband"],
        overview: "Bright 4-bed near the Gap of Dunloe with mountain views.",
        description: "Spacious home in Beaufort, minutes to Killarney.",
      },
      {
        title: "13 The Grange, Raheen, Co. Limerick",
        slug: "13-the-grange-raheen-limerick",
        address: "13 The Grange, Raheen, Limerick",
        eircode: "V94XXXX",
        status: "FOR_SALE",
        price: 375000,
        beds: 3,
        baths: 3,
        ber: "B3",
        latitude: 52.6202,
        longitude: -8.659,
        photos: [
          "https://res.cloudinary.com/havn/image/upload/v1720000001/properties/demo2-1.jpg",
          "https://res.cloudinary.com/havn/image/upload/v1720000001/properties/demo2-2.jpg",
        ],
        floorplans: [],
        features: ["Cul-de-sac", "Attic storage", "West garden"],
        overview: "Turn-key 3-bed semi-D in Raheen.",
        description: "Well-kept family home close to UHL and Crescent SC.",
      },
      {
        title: "City Quay Apartment, Dublin 2",
        slug: "city-quay-apartment-dublin-2",
        address: "City Quay, Dublin 2",
        eircode: "D02XXXX",
        status: "FOR_SALE",
        price: 495000,
        beds: 2,
        baths: 2,
        ber: "B1",
        latitude: 53.3462,
        longitude: -6.2529,
        photos: [
          "https://res.cloudinary.com/havn/image/upload/v1720000001/properties/demo3-1.jpg",
          "https://res.cloudinary.com/havn/image/upload/v1720000001/properties/demo3-2.jpg",
        ],
        floorplans: [],
        features: ["Balcony", "Concierge", "Lift access"],
        overview: "River-view 2-bed with parking.",
        description: "Light-filled corner unit overlooking the Liffey.",
      },
    ];

    let inserted = 0;
    for (const d of demos) {
      await prisma.property.upsert({ where: { slug: d.slug }, update: d, create: d });
      inserted++;
    }

    res.json({ ok: true, inserted });
  } catch (e) {
    console.error("SEED FAILED:", e);
    res.status(500).json({
      ok: false,
      error: "seed-failed",
      message: e?.message || String(e),
      code: e?.code,
      meta: e?.meta,
      stack: e?.stack,
    });
  }
});

// ---------- Properties Route ----------
app.get("/api/properties", async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 100);
    const properties = await prisma.property.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
    });
    res.json({ ok: true, count: properties.length, properties });
  } catch (e) {
    console.error("PROPERTIES FAILED:", e);
    res.status(500).json({
      ok: false,
      error: "list-failed",
      message: e?.message || String(e),
      code: e?.code,
      meta: e?.meta,
      stack: e?.stack,
    });
  }
});

// Root
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "havn-new", base: "/api", build: BUILD });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "server-error" });
});

// Start
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ HAVN API listening on :${PORT} (build: ${BUILD})`);
});
