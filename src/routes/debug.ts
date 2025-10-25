// src/routes/debug.ts
import { Router } from "express";
import { prisma } from "../prisma.js";

const router = Router();

// ---- simple admin gate ------------------------------------------------------
const ADMIN_KEY = process.env.ADMIN_KEY || "havn_8c1d6e0e5b9e4d7f";
function adminOnly(req: any, res: any, next: any) {
  const key = req.header("x-admin-key");
  if (!key || key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  return next();
}

// ---- helpers ----------------------------------------------------------------
function slugify(i: number) {
  return `demo-property-${i.toString().padStart(3, "0")}`;
}

function makeDemoRecord(i: number) {
  const price = 250000 + i * 1000;
  return {
    slug: slugify(i),
    title: `Demo Property ${i}`,
    price,
    beds: (i % 5) + 1,
    baths: (i % 3) + 1,
    ber: ["A1", "A2", "B1", "C1", "D1"][i % 5],
    eircode: `D0${(i % 9) + 1} ABC`,
    type: ["house", "apartment", "duplex"][i % 3],
    overview: `Auto-seeded demo listing #${i}`,
    // IMPORTANT: schema requires these arrays to be non-null
    photos: [
      "https://picsum.photos/seed/havn1/800/600",
      "https://picsum.photos/seed/havn2/800/600",
    ],
    features: ["parking", "balcony", "near transport"].slice(0, (i % 3) + 1),
  };
}

// ---- routes -----------------------------------------------------------------

// seed a bunch of records (safe: sequential upsert + try/catch)
router.post("/seed-demo", adminOnly, async (req, res) => {
  const count = Number(req.body?.count ?? 30);
  const clearFirst = Boolean(req.body?.clearFirst ?? true);

  try {
    if (clearFirst) {
      const del = await prisma.property.deleteMany({});
      console.log("seed-demo: cleared", del.count);
    }

    let inserted = 0;
    for (let i = 1; i <= count; i++) {
      const data = makeDemoRecord(i);
      // upsert by slug to avoid duplicates on re-seed
      await prisma.property.upsert({
        where: { slug: data.slug },
        update: { ...data }, // update all simple fields
        create: { ...data },
      });
      inserted++;
    }

    return res.json({ ok: true, inserted });
  } catch (err: any) {
    console.error("seed-demo error:", err);
    // Prisma sometimes throws long messages; surface them to help debugging
    const message =
      typeof err?.message === "string" ? err.message : JSON.stringify(err);
    return res.status(500).json({ ok: false, error: message });
  }
});

// remove everything
router.post("/seed-clear", adminOnly, async (_req, res) => {
  try {
    const del = await prisma.property.deleteMany({});
    return res.json({ ok: true, deleted: del.count });
  } catch (err: any) {
    const message =
      typeof err?.message === "string" ? err.message : JSON.stringify(err);
    return res.status(500).json({ ok: false, error: message });
  }
});

// quick DB ping
router.get("/ping-db", adminOnly, async (_req, res) => {
  try {
    const r = await prisma.$queryRaw`SELECT 1 as ok`;
    return res.json({ ok: true, result: r });
  } catch (err: any) {
    const message =
      typeof err?.message === "string" ? err.message : JSON.stringify(err);
    return res.status(500).json({ ok: false, error: message });
  }
});

// inspect a table's columns (useful for Render debugging)
router.get("/columns/:table", adminOnly, async (req, res) => {
  const table = String(req.params.table || "").trim();
  if (!table) return res.status(400).json({ ok: false, error: "bad_table" });
  try {
    // Works on Postgres (adjust if you’re on another driver)
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position
    `,
      table
    );
    return res.json({ ok: true, table, columns: rows });
  } catch (err: any) {
    const message =
      typeof err?.message === "string" ? err.message : JSON.stringify(err);
    return res.status(500).json({ ok: false, error: message });
  }
});

export default router;
