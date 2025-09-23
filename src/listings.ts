import { Router } from "express";
import type { Request, Response } from "express";
import { prisma } from "./db.js";

export const listings = Router();

// GET /api/listings?limit=&offset=
listings.get("/api/listings", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 20), 50);
    const offset = Number(req.query.offset ?? 0);

    const items = await prisma.listing.findMany({
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
      select: {
        id: true, slug: true, title: true, price: true, currency: true,
        type: true, city: true, county: true, beds: true, baths: true, createdAt: true,
        images: { orderBy: { sort: "asc" }, take: 1, select: { url: true, alt: true } }
      }
    });

    res.json({ ok: true, count: items.length, items });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/listings/:slug
listings.get("/api/listings/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const item = await prisma.listing.findUnique({
      where: { slug },
      include: { images: { orderBy: { sort: "asc" } } }
    });
    if (!item) return res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true, item });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/dev/seed  (one-time seed; optional header x-seed-token=<SEED_TOKEN>)
listings.post("/api/dev/seed", async (req: Request, res: Response) => {
  try {
    const token = String(req.header("x-seed-token") ?? "");
    if (process.env.SEED_TOKEN && token !== process.env.SEED_TOKEN) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const already = await prisma.listing.count();
    if (already > 0) return res.json({ ok: true, seeded: false, message: "Listings already exist" });

    const user = await prisma.user.upsert({
      where: { email: "owner@havn.ie" },
      update: {},
      create: { email: "owner@havn.ie", role: "admin" }
    });

    await prisma.listing.create({
      data: {
        title: "Sample 2-bed apartment",
        slug: "sample-2-bed-apartment",
        price: 1500,
        type: "rent",
        address: "123 High Street",
        city: "Dublin",
        county: "Dublin",
        beds: 2,
        baths: 1,
        description: "Demo listing for havn.ie - remove once real data is added.",
        features: ["balcony", "parking"],
        status: "published",
        ownerId: user.id,
        images: {
          create: [
            { url: "https://picsum.photos/seed/havn1/1200/800", alt: "Living room" },
            { url: "https://picsum.photos/seed/havn2/1200/800", alt: "Bedroom" }
          ]
        }
      }
    });

    res.json({ ok: true, seeded: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
