// src/routes/diag.ts
import { Router } from "express";
import { prisma } from "../db.js";

const r = Router();

/** Check that the tables exist (cast regclass -> text so Prisma can read it). */
r.get("/db", async (_req, res) => {
  try {
    const prop = await prisma.$queryRawUnsafe<Array<{ t: string | null }>>(
      `SELECT CAST(to_regclass('public."Property"') AS text) AS t`
    );
    const img = await prisma.$queryRawUnsafe<Array<{ t: string | null }>>(
      `SELECT CAST(to_regclass('public."PropertyImage"') AS text) AS t`
    );
    res.json({
      ok: true,
      tables: {
        Property: prop?.[0]?.t ?? null,
        PropertyImage: img?.[0]?.t ?? null,
      },
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

/** List actual columns in Property & PropertyImage. */
r.get("/columns", async (_req, res) => {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string; data_type: string }>>(
      `
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN ('Property','PropertyImage')
      ORDER BY table_name, ordinal_position
      `
    );
    res.json({ ok: true, columns: rows });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

/** Quick sample to verify Prisma can query the model. */
r.get("/props-sample", async (_req, res) => {
  try {
    const count = await prisma.property.count();
    res.json({ ok: true, count });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e), code: e?.code });
  }
});

export default r;
