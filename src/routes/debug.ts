import { Router } from "express";
import { prisma } from "../prisma.js";

// Keep the admin check simple and explicit here for debugging.
// Matches the key you've been using: havn_8c1d6e0e5b9e4d7f
function requireAdmin(req: any, res: any, next: any) {
  const ADMIN_KEY = process.env.ADMIN_KEY ?? "havn_8c1d6e0e5b9e4d7f";
  const key = req.header("x-admin-key") ?? "";
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized (bad x-admin-key)" });
  }
  next();
}

export const debug = Router();

/** DB connectivity check */
debug.get("/ping-db", async (_req, res) => {
  try {
    const rows = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
    res.json({ ok: true, result: rows });
  } catch (err: any) {
    console.error("PING-DB ERROR:", err);
    res.status(500).json({ ok: false, error: err?.message ?? "ping failed" });
  }
});

function errPayload(err: any) {
  // Prisma and general error formatter we can safely JSON.stringify
  const out: any = {
    message: err?.message ?? String(err),
    name: err?.name,
    code: (err && (err.code || err?.meta?.code)) ?? undefined,
  };
  if (err?.meta) out.meta = err.meta;
  if (err?.stack) out.stack = String(err.stack).split("\n").slice(0, 5);
  return out;
}

/** Seed just ONE known-safe record to surface any constraint/required-field errors clearly */
debug.post("/seed-one", requireAdmin, async (_req, res) => {
  const r = { slug: "seed-test-one", title: "Seed Test One", price: 123456 };
  try {
    const up = await prisma.property.upsert({
      where: { slug: r.slug },
      create: { slug: r.slug, title: r.title, price: r.price },
      update: { title: r.title, price: r.price },
      select: { id: true, slug: true, title: true, price: true },
    });
    res.json({ ok: true, result: up });
  } catch (err: any) {
    console.error("SEED-ONE ERROR:", err);
    res.status(500).json({ ok: false, error: errPayload(err) });
  }
});

/** Seed a few demo rows — ONLY fields we know exist: slug, title, price */
debug.post("/seed", requireAdmin, async (_req, res) => {
  const seeds: Array<{ slug: string; title: string; price: number }> = [
    { slug: "oak-avenue-12", title: "12 Oak Avenue", price: 350000 },
    { slug: "maple-grove-4", title: "4 Maple Grove", price: 465000 },
    { slug: "seaview-apt-21", title: "Seaview Apt 21", price: 289000 },
  ];

  try {
    const results = [];
    for (const r of seeds) {
      const up = await prisma.property.upsert({
        where: { slug: r.slug },
        create: { slug: r.slug, title: r.title, price: r.price },
        update: { title: r.title, price: r.price },
        select: { id: true, slug: true, title: true, price: true },
      });
      results.push(up);
    }
    res.json({ ok: true, insertedOrUpdated: results.length, results });
  } catch (err: any) {
    console.error("SEED ERROR:", err);
    res.status(500).json({ ok: false, error: errPayload(err) });
  }
});

/** Clear only our seeded slugs */
debug.post("/seed-clear", requireAdmin, async (_req, res) => {
  const slugs = ["oak-avenue-12", "maple-grove-4", "seaview-apt-21", "seed-test-one"];
  try {
    const del = await prisma.property.deleteMany({ where: { slug: { in: slugs } } });
    res.json({ ok: true, deleted: del.count });
  } catch (err: any) {
    console.error("SEED-CLEAR ERROR:", err);
    res.status(500).json({ ok: false, error: errPayload(err) });
  }
});
