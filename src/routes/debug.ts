// src/routes/debug.ts
import type { Router } from "express";
import { prisma } from "../prisma.js";
import { adminOnly } from "../middleware/admin.js";
import { buildDemoProperties } from "../lib/demoData.js";

export function debug(router: Router) {
  // Health (simple)
  router.get("/api/health", async (_req, res) => {
    const build =
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.RENDER_GIT_COMMIT ||
      process.env.GIT_COMMIT ||
      "dev";
    res.json({ ok: true, service: "havn-new", build });
  });

  // DB ping
  router.get("/api/debug/ping-db", adminOnly, async (_req, res) => {
    try {
      const r = await prisma.$queryRawUnsafe<{ ok: number }[]>("SELECT 1 as ok");
      res.json({ ok: true, result: r });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // Clear all properties
  router.post("/api/debug/seed-clear", adminOnly, async (_req, res) => {
    try {
      const r = await prisma.property.deleteMany({});
      res.json({ ok: true, deleted: r.count });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // Bulk seed demo data (safe, non-null arrays)
  router.post("/api/debug/seed-demo", adminOnly, async (req, res) => {
    const count = Number(req.body?.count ?? 25);
    const clearFirst = Boolean(req.body?.clearFirst ?? true);

    try {
      if (clearFirst) {
        await prisma.property.deleteMany({});
      }

      const demo = buildDemoProperties(count);
      const results: { slug: string; id?: string | number }[] = [];

      for (const p of demo) {
        const r = await prisma.property.upsert({
          where: { slug: p.slug },
          update: {
            title: p.title,
            price: p.price,
            photos: p.photos,
            features: p.features,
          },
          create: {
            slug: p.slug,
            title: p.title,
            price: p.price,
            photos: p.photos,
            features: p.features,
          },
        });
        results.push({ slug: r.slug as any, id: (r as any).id });
      }

      const total = await prisma.property.count();
      res.json({ ok: true, seeded: results.length, total, items: results });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });
}

export default debug;
