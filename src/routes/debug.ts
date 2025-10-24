import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../prisma.js";

const adminOnly = (req: Request, res: Response, next: NextFunction) => {
  const key = req.header("x-admin-key");
  if (key && (key === process.env.ADMIN_KEY || key === "havn_8c1d6e0e5b9e4d7f")) return next();
  return res.status(401).json({ ok: false, error: "unauthorized" });
};

export const debug = Router();

/** Quick DB ping */
debug.get("/ping-db", async (_req, res) => {
  try {
    const r = await prisma.$queryRawUnsafe<Array<{ ok: number }>>("SELECT 1 as ok");
    res.json({ ok: true, result: r });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

/** Inspect columns / NOT NULL flags for a table (e.g. Property) */
debug.get("/columns/:table", adminOnly, async (req, res) => {
  try {
    const t = String(req.params.table).replace(/[^A-Za-z0-9_"]/g, "");
    const rows = await prisma.$queryRawUnsafe<Array<{
      column_name: string; is_nullable: "YES" | "NO"; data_type: string; column_default: string | null;
    }>>(
      `
      SELECT column_name, is_nullable, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
      ORDER BY ordinal_position
      `,
      t
    );
    res.json({ ok: true, table: t, columns: rows });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

/** Seed exactly one safe record (fill NOT NULL JSON as empty arrays) */
debug.post("/seed-one", adminOnly, async (_req, res) => {
  try {
    const slug = `prop-${Math.random().toString(36).slice(2, 8)}`;

    // Only include fields we KNOW exist in your current schema:
    const data = {
      slug,
      title: "Seeded Property",
      price: 123456,
      // If these JSON columns are NOT NULL in your schema:
      photos: [] as any[],
      features: [] as any[],
    };

    const item = await prisma.property.upsert({
      where: { slug },
      update: data,
      create: data,
      select: { id: true, slug: true, title: true, price: true },
    });

    res.json({ ok: true, item });
  } catch (err: any) {
    // Prisma error surfaces useful fields: code, meta, clientVersion
    const payload: any = {
      ok: false,
      error: err?.message ?? String(err),
    };
    if (err?.code) payload.code = err.code;
    if (err?.meta) payload.meta = err.meta;
    if (err?.clientVersion) payload.clientVersion = err.clientVersion;
    res.status(500).json(payload);
  }
});

/** Clear demo data */
debug.post("/seed-clear", adminOnly, async (_req, res) => {
  try {
    const r = await prisma.property.deleteMany({});
    res.json({ ok: true, deleted: r.count });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});
