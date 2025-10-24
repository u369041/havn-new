import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../prisma.js";

const debug = Router();

/** --- simple admin gate: x-admin-key header must match --- */
function adminOnly(req: Request, res: Response, next: NextFunction) {
  const headerKey = req.header("x-admin-key");
  const expected = process.env.ADMIN_KEY ?? "havn_8c1d6e0e5b9e4d7f";
  if (!headerKey || headerKey !== expected) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

/** health check that touches the DB driver */
debug.get("/ping-db", async (_req, res) => {
  try {
    const rows = (await prisma.$queryRaw`SELECT 1 AS ok`) as Array<{ ok: number }>;
    return res.json({ ok: true, result: rows });
  } catch (err: any) {
    return res
      .status(500)
      .json({ ok: false, error: err?.message ?? "db error" });
  }
});

/**
 * Seed one safe record.
 * Your Property schema requires: slug (unique), title, price, photos (NOT NULL).
 * We send photos: [] to satisfy the NOT NULL constraint.
 */
debug.post("/seed-one", adminOnly, async (_req, res) => {
  try {
    const payload = {
      slug: "seed-sample-1",
      title: "Seed Sample #1",
      price: 123000,
      photos: [] as string[],
    };

    const item = await prisma.property.upsert({
      where: { slug: payload.slug },
      update: payload,
      create: payload,
      select: { id: true, slug: true, title: true, price: true, photos: true },
    });

    return res.json({ ok: true, item });
  } catch (err: any) {
    return res
      .status(500)
      .json({ ok: false, error: err?.message ?? "seed-one failed" });
  }
});

/** Bulk seed a few sample rows (all include photos: [] to satisfy NOT NULL) */
debug.post("/seed", adminOnly, async (_req, res) => {
  try {
    const seeds = [
      { slug: "seed-001", title: "Seed #001", price: 250000, photos: [] as string[] },
      { slug: "seed-002", title: "Seed #002", price: 315000, photos: [] as string[] },
      { slug: "seed-003", title: "Seed #003", price: 429000, photos: [] as string[] },
    ];

    const results = [];
    for (const s of seeds) {
      const r = await prisma.property.upsert({
        where: { slug: s.slug },
        update: s,
        create: s,
        select: { id: true, slug: true, title: true, price: true, photos: true },
      });
      results.push(r);
    }

    return res.json({ ok: true, count: results.length, items: results });
  } catch (err: any) {
    return res
      .status(500)
      .json({ ok: false, error: err?.message ?? "seed failed" });
  }
});

/** Clear all seed rows (slugs that start with "seed-") */
debug.post("/seed-clear", adminOnly, async (_req, res) => {
  try {
    const del = await prisma.property.deleteMany({
      where: { slug: { startsWith: "seed-" } },
    });
    return res.json({ ok: true, deleted: del.count });
  } catch (err: any) {
    return res
      .status(500)
      .json({ ok: false, error: err?.message ?? "seed-clear failed" });
  }
});

export { debug };
