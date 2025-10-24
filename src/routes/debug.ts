// src/routes/debug.ts
import type { Router } from "express";
import { prisma } from "../prisma.js";
import { adminOnly } from "../middleware/admin.js";
import { buildDemoProperties } from "../lib/demoData.js";

export function debug(router: Router) {
  // ping DB
  router.get("/api/debug/ping-db", adminOnly, async (_req, res) => {
    try {
      const r = await prisma.$queryRawUnsafe<{ ok: number }[]>("SELECT 1 as ok");
      res.json({ ok: true, result: r });
    } catch (err: any) {
      console.error("ping-db error:", err);
      res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // clear properties
  router.post("/api/debug/seed-clear", adminOnly, async (_req, res) => {
    try {
      const r = await prisma.property.deleteMany({});
      res.json({ ok: true, deleted: r.count });
    } catch (err: any) {
      console.error("seed-clear error:", err);
      res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // list properties (simple)
  router.get("/api/properties", async (_req, res) => {
    try {
      const items = await prisma.property.findMany({
        select: { slug: true, title: true, price: true, photos: true, features: true },
        orderBy: { slug: "asc" }
      });
      res.json({ ok: true, count: items.length, properties: items });
    } catch (err: any) {
      console.error("list properties error:", err);
      res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // BULK SEED — robust: transaction + explicit defaults + error capture
  router.post("/api/debug/seed-demo", adminOnly, async (req, res) => {
    const count = Number(req.body?.count ?? 25);
    const clearFirst = req.body?.clearFirst !== false; // default true

    try {
      if (clearFirst) await prisma.property.deleteMany({});

      const demo = buildDemoProperties(
        Number.isFinite(count) && count > 0 && count <= 200 ? count : 25
      );

      const ops = demo.map((p) =>
        prisma.property.upsert({
          where: { slug: p.slug },
          update: {
            title: p.title,
            price: p.price,
            photos: p.photos ?? [""],
            features: p.features ?? [""],
          },
          create: {
            slug: p.slug,
            title: p.title,
            price: p.price,
            photos: p.photos ?? [""],
            features: p.features ?? [""],
          },
        })
      );

      // run in batches to avoid overwhelming the DB
      const BATCH = 20;
      const created: string[] = [];
      for (let i = 0; i < ops.length; i += BATCH) {
        const chunk = ops.slice(i, i + BATCH);
        const results = await prisma.$transaction(chunk, { timeout: 20000 });
        for (const r of results) created.push((r as any).slug);
      }

      const total = await prisma.property.count();
      res.json({ ok: true, seeded: created.length, total, slugs: created });
    } catch (err: any) {
      console.error("seed-demo error:", err);
      // surface Prisma error message if present
      const message =
        err?.meta?.cause ||
        err?.message ||
        String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });
}

export default debug;
