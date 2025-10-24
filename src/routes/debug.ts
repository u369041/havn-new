import express from "express";
import { prisma } from "../prisma.js";
import { requireAdmin } from "../middleware/admin.js";

export const debug = express.Router();

/** Healthy ping (no DB) */
debug.get("/ping", (_req, res) => {
  res.json({ ok: true, pong: true });
});

/** DB ping */
debug.get("/ping-db", async (_req, res) => {
  try {
    const r = await prisma.$queryRawUnsafe("SELECT 1 as ok");
    res.json({ ok: true, result: r });
  } catch (err) {
    console.error("DEBUG /ping-db error:", err);
    res.status(500).json({ ok: false, error: "db-failed" });
  }
});

/** Seed a couple of sample properties (PROTECTED) */
debug.post("/seed", requireAdmin, async (_req, res) => {
  try {
    const rows = [
      {
        slug: "seacliff-cottage-howth",
        title: "Seacliff Cottage, Howth",
        description:
          "Sunny 3-bed with panoramic sea views above the harbour. Freshly renovated.",
      },
      {
        slug: "georgian-apt-dublin-2",
        title: "Georgian Apartment, Dublin 2",
        description:
          "Elegant 2-bed on a quiet square, high ceilings and sash windows.",
      },
    ];

    // Upsert by slug so it's idempotent
    const results = [];
    for (const r of rows) {
      const saved = await prisma.property.upsert({
        where: { slug: r.slug },
        update: { title: r.title, description: r.description },
        create: { slug: r.slug, title: r.title, description: r.description },
      });
      results.push(saved);
    }

    res.json({ ok: true, count: results.length, properties: results });
  } catch (err) {
    console.error("DEBUG /seed error:", err);
    res.status(500).json({ ok: false, error: "seed-failed" });
  }
});

/** Clear ONLY the sample rows we add (PROTECTED) */
debug.post("/seed-clear", requireAdmin, async (_req, res) => {
  try {
    const slugs = ["seacliff-cottage-howth", "georgian-apt-dublin-2"];
    const del = await prisma.property.deleteMany({ where: { slug: { in: slugs } } });
    res.json({ ok: true, deleted: del.count });
  } catch (err) {
    console.error("DEBUG /seed-clear error:", err);
    res.status(500).json({ ok: false, error: "clear-failed" });
  }
});
