// src/routes/debug.ts
import { Router } from "express";
import { adminOnly } from "../middleware/admin.js";
import { prisma } from "../prisma.js";

export const debug = Router();

// quick sanity ping
debug.get("/ping-db", async (_req, res) => {
  try {
    const r = await prisma.$queryRawUnsafe<Array<{ ok: number }>>(`SELECT 1 AS ok`);
    res.json({ ok: true, result: r });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? "unknown" });
  }
});

/**
 * Create or update a single safe record.
 * Only uses fields that are definitely present in your schema:
 *  - slug (unique)
 *  - title (string)
 *  - price (number)
 */
debug.post("/seed-one", adminOnly, async (_req, res) => {
  try {
    const r = await prisma.property.upsert({
      where: { slug: "seed-sample-1" },
      update: { title: "Seed Sample #1", price: 123000 },
      create: { slug: "seed-sample-1", title: "Seed Sample #1", price: 123000 },
      select: { id: true, slug: true, title: true, price: true },
    });
    res.json({ ok: true, item: r });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? "unknown" });
  }
});

/** Clear only the seed records we created */
debug.post("/seed-clear", adminOnly, async (_req, res) => {
  try {
    const del = await prisma.property.deleteMany({
      where: { slug: { startsWith: "seed-sample-" } },
    });
    res.json({ ok: true, deleted: del.count });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? "unknown" });
  }
});
