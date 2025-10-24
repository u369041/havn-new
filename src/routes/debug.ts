import { Router } from "express";
import { prisma } from "../prisma.js";
import { requireAdmin } from "../middleware/admin.js";

export const debug = Router();

// simple DB ping
debug.get("/ping-db", async (_req, res) => {
  try {
    const result = await prisma.$queryRawUnsafe<Array<{ ok: number }>>("SELECT 1 as ok");
    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

// seed some demo properties (admin-only)
debug.post("/seed", requireAdmin, async (_req, res) => {
  try {
    const rows = [
      { slug: "demo-apt-1", title: "Demo Apartment 1", price: 250000 },
      { slug: "demo-house-2", title: "Demo House 2", price: 495000 },
      { slug: "demo-cottage-3", title: "Demo Cottage 3", price: 325000 },
    ];

    const results: any[] = [];
    for (const r of rows) {
      const up = await prisma.property.upsert({
        where: { slug: r.slug },
        update: { title: r.title, price: r.price },
        create: { slug: r.slug, title: r.title, price: r.price },
        select: { id: true, slug: true, title: true, price: true },
      });
      results.push(up);
    }

    res.json({ ok: true, insertedOrUpdated: results.length, items: results });
  } catch (err: any) {
    // bubble detailed info to help us debug quickly
    res.status(500).json({
      ok: false,
      error: String(err?.message ?? err),
      meta: {
        code: (err as any)?.code,
        stack: (err as any)?.stack,
      },
    });
  }
});

// wipe all properties (admin-only)
debug.post("/seed-clear", requireAdmin, async (_req, res) => {
  try {
    const out = await prisma.property.deleteMany({});
    res.json({ ok: true, deleted: out.count });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});
