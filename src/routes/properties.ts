import { Router } from "express";
import { PrismaClient, ListingType, ListingStatus } from "@prisma/client";
import slugify from "slugify";

export const apiRouter = Router();
const prisma = new PrismaClient();

/* ---- router health ---- */
apiRouter.get("/health", (_req, res) => res.json({ ok: true }));

/* ---- list ---- */
apiRouter.get("/properties", async (_req, res) => {
  try {
    const properties = await prisma.property.findMany({
      include: { images: true },
      orderBy: { createdAt: "desc" },
    });
    if (!properties.length) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }
    res.json({ ok: true, count: properties.length, properties });
  } catch (e: any) {
    console.error("GET /properties failed:", e);
    res.status(500).json({ ok: false, error: e?.message ?? "Unknown error" });
  }
});

/* ---- detail by slug ---- */
apiRouter.get("/properties/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const property = await prisma.property.findUnique({
      where: { slug },
      include: { images: true },
    });
    if (!property) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }
    res.json({ ok: true, property });
  } catch (e: any) {
    console.error("GET /properties/:slug failed:", e);
    res.status(500).json({ ok: false, error: e?.message ?? "Unknown error" });
  }
});

/* ---- create ---- */
apiRouter.post("/properties", async (req, res) => {
  try {
    const b = req.body ?? {};

    if (!b.title) {
      return res.status(400).json({ ok: false, error: "title is required" });
    }
    if (!b.listingType) {
      return res
        .status(400)
        .json({ ok: false, error: "listingType is required (SALE or RENT)" });
    }

    const listingType =
      typeof b.listingType === "string"
        ? (b.listingType.toUpperCase() as ListingType)
        : b.listingType;

    if (!["SALE", "RENT"].includes(listingType)) {
      return res
        .status(400)
        .json({ ok: false, error: "listingType must be SALE or RENT" });
    }

    const status: ListingStatus =
      (typeof b.status === "string"
        ? (b.status.toUpperCase() as ListingStatus)
        : undefined) || "ACTIVE";

    const slug: string =
      (typeof b.slug === "string" && b.slug.trim()) ||
      slugify(`${b.title}-${Date.now()}`, { lower: true, strict: true });

    const imagesInput =
      Array.isArray(b.images) && b.images.length
        ? {
            create: b.images.map((img: any) => ({
              url: String(img.url),
              publicId: img.publicId ? String(img.publicId) : "manual",
              width:
                img.width !== undefined && img.width !== null
                  ? Number(img.width)
                  : null,
              height:
                img.height !== undefined && img.height !== null
                  ? Number(img.height)
                  : null,
              format:
                img.format !== undefined && img.format !== null
                  ? String(img.format)
                  : null,
              position:
                img.position !== undefined && img.position !== null
                  ? Number(img.position)
                  : 0,
            })),
          }
        : undefined;

    const created = await prisma.property.create({
      data: {
        title: String(b.title),
        description: b.description ? String(b.description) : null,
        price: b.price ? Number(b.price) : null,
        listingType,
        status,
        slug,
        images: imagesInput,
      },
      include: { images: true },
    });

    res.json({ ok: true, property: created });
  } catch (e: any) {
    console.error("POST /properties failed:", e);
    const msg =
      e?.meta?.cause || e?.meta?.target || e?.message || "Failed to create";
    res.status(500).json({ ok: false, error: msg });
  }
});
