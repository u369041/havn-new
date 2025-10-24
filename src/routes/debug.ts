// src/routes/debug.ts
import { Router } from "express";
import { adminOnly } from "../middleware/admin.js";
import { prisma } from "../prisma.js";

export const debug = Router();

// Simple DB sanity check
debug.get("/ping-db", async (_req, res) => {
  try {
    const r = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`;
    res.json({ ok: true, result: r });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

// Create ONE safe record (only fields that exist: slug, title, price)
debug.post("/seed-one", adminOnly, async (_req, res) => {
  try {
    const ts = Date.now();
    const r = {
      slug: `seed-${ts}`,
      title: `Seed ${new Date(ts).toISOString()}`,
      price: 123456, // required by your schema
    };
    const item = await prisma.property.upsert({
      where: { slug: r.slug },
      create: r,
      update: { title: r.title, price: r.price },
      select: { id: true, slug: true, title: true, price: true },
    });
    res.json({ ok: true, item });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

// Seed a few records
debug.post("/seed", adminOnly, async (_req, res) => {
  try {
    const created: any[] = [];
    for (let i = 0; i < 5; i++) {
      const ts = Date.now() + i;
      const r = {
        slug: `seed-${ts}`,
        title: `Seed ${new Date(ts).toISOString()}`,
        price: 100000 + i * 1000,
      };
      const item = await prisma.property.upsert({
        where: { slug: r.slug },
        create: r,
        update: { title: r.title, price: r.price },
        select: { id: true, slug: true, title: true, price: true },
      });
      created.push(item);
    }
    res.json({ ok: true, count: created.length, items: created });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

// Clear seed data
debug.post("/seed-clear", adminOnly, async (_req, res) => {
  try {
    const r = await prisma.property.deleteMany({
      where: { slug: { startsWith: "seed-" } },
    });
    res.json({ ok: true, deleted: r.count });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});
