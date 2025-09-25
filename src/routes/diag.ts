// src/routes/diag.ts
import { Router } from "express";
import { prisma } from "../db.js";

const r = Router();

r.get("/db", async (_req, res) => {
  try {
    const prop = await prisma.$queryRawUnsafe<any>(`SELECT to_regclass('public."Property"') AS t`);
    const img  = await prisma.$queryRawUnsafe<any>(`SELECT to_regclass('public."PropertyImage"') AS t`);
    res.json({
      ok: true,
      tables: {
        Property: prop?.[0]?.t ?? null,
        PropertyImage: img?.[0]?.t ?? null
      }
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

r.get("/props-sample", async (_req, res) => {
  try {
    const count = await prisma.property.count();
    res.json({ ok: true, count });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e), code: e?.code });
  }
});

export default r;
