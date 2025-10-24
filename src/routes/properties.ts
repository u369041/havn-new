// src/routes/properties.ts
import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";

const router = Router();

/**
 * Keep the selection aligned with your Prisma schema.
 * (No `address` or `description` — those fields don't exist in your model.)
 */
const propertySelect: Prisma.PropertySelect = {
  id: true,
  slug: true,
  title: true,
  price: true,
  beds: true,
  baths: true,
  ber: true,
  eircode: true,
  type: true,
  photos: true,
  overview: true,
  features: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * GET /api/properties
 * Returns all properties (optionally limited via ?limit=)
 */
router.get("/", async (req, res) => {
  try {
    const limitParam = req.query.limit as string | undefined;
    const take = limitParam ? Math.max(0, Math.min(100, Number(limitParam))) : undefined;

    const properties = await prisma.property.findMany({
      select: propertySelect,
      orderBy: { createdAt: "desc" },
      take,
    });

    res.json({
      ok: true,
      count: properties.length,
      properties,
    });
  } catch (err) {
    console.error("GET /api/properties failed:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/**
 * GET /api/properties/:slug
 * Returns a single property by slug
 */
router.get("/:slug", async (req, res) => {
  const { slug } = req.params;
  try {
    const property = await prisma.property.findUnique({
      where: { slug },
      select: propertySelect,
    });

    if (!property) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    res.json({ ok: true, property });
  } catch (err) {
    console.error(`GET /api/properties/${slug} failed:`, err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
