import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../prisma.js";

/** Simple admin gate via header */
const adminOnly = (req: Request, res: Response, next: NextFunction) => {
  const key = req.header("x-admin-key");
  // Allow either env key or your known static key
  if (key && (key === process.env.ADMIN_KEY || key === "havn_8c1d6e0e5b9e4d7f")) {
    return next();
  }
  return res.status(401).json({ ok: false, error: "unauthorized" });
};

export const debug = Router();

/** DB ping */
debug.get("/ping-db", async (_req, res) => {
  try {
    const r = await prisma.$queryRawUnsafe<Array<{ ok: number }>>("SELECT 1 as ok");
    res.json({ ok: true, result: r });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

/** Make exactly one safe demo record */
debug.post("/seed-one", adminOnly, async (_req, res) => {
  try {
    const slug = `prop-${Math.random().toString(36).slice(2, 8)}`;

    const item = await prisma.property.upsert({
      where: { slug },
      update: {
        title: "Seeded Property",
        price: 123456,
        photos: [],        // ✅ NOT NULL JSON defaults
        features: [],      // ✅ NOT NULL JSON defaults
      },
      create: {
        slug,
        title: "Seeded Property",
        price: 123456,
        photos: [],        // ✅
        features: [],      // ✅
      },
      select: { id: true, slug: true, title: true, price: true },
    });

    res.json({ ok: true, item });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
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
