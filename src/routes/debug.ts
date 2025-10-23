import express from "express";
import { prisma } from "../prisma.js";
import { requireAdmin } from "../middleware/admin.js";

export const debug = express.Router();

debug.get("/ping", (_req, res) => res.json({ ok: true }));

debug.get("/ping-db", async (_req, res) => {
  try {
    const result = await prisma.$queryRaw`SELECT 1 AS ok`;
    return res.json({ ok: true, result });
  } catch (err) {
    console.error("ping-db error:", err);
    return res.status(500).json({ ok: false, error: "db-error" });
  }
});

// Create N samples
debug.get("/seed-sample", requireAdmin, async (req, res) => {
  const n = Math.max(1, Math.min(50, Number(req.query.count ?? 3)));
  try {
    const created: Array<{ id: number; slug: string }> = [];
    for (let i = 0; i < n; i++) {
      const slug = `sample-${Date.now()}-${i}`;
      const title = `Sample Property ${i + 1}`;
      const row = await prisma.property.create({
        data: { slug, title } as any,
        select: { id: true, slug: true },
      });
      created.push(row);
    }
    res.json({ ok: true, createdCount: created.length, created });
  } catch (err: any) {
    console.error("seed-sample error:", err);
    res.status(500).json({ ok: false, error: "seed-failed", message: String(err?.message ?? err) });
  }
});

// Delete all “sample-*” rows created by the seeder
debug.post("/seed-clear", requireAdmin, async (_req, res) => {
  try {
    const result = await prisma.property.deleteMany({
      where: { slug: { startsWith: "sample-" } },
    });
    res.json({ ok: true, deleted: result.count });
  } catch (err) {
    console.error("seed-clear error:", err);
    res.status(500).json({ ok: false, error: "clear-failed" });
  }
});
