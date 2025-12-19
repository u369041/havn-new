import { Router } from "express";
import prisma from "../prisma"; // adjust if your prisma client export path differs

const router = Router();

/**
 * Helpers
 */
function parseLimit(raw: unknown, fallback = 12, max = 50) {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = s == null ? NaN : parseInt(String(s), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

/**
 * GET /api/properties
 * Optional: ?limit=4
 *
 * Returns: Property card data (safe selection that avoids missing DB columns)
 */
router.get("/", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 12, 50);

    // IMPORTANT:
    // We intentionally use `select` to avoid reading columns that might not exist
    // in production DB (like propertyType right now).
    const properties = await prisma.property.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        slug: true,
        title: true,
        address1: true,
        address2: true,
        city: true,
        county: true,
        eircode: true,
        price: true,
        status: true,
        ber: true,
        bedrooms: true,
        bathrooms: true,
        size: true,
        sizeUnits: true,
        features: true,
        description: true,
        photos: true,
        createdAt: true,

        // DO NOT include propertyType until the DB column exists
        // propertyType: true,
      },
    });

    return res.json(properties);
  } catch (err: any) {
    console.error("GET /api/properties failed:", err);
    // Return a helpful error response (still safe for prod)
    return res.status(500).json({
      ok: false,
      error: "Failed to fetch properties",
      // Uncomment these 2 lines temporarily if you want the browser response to show the real error:
      // debugCode: err?.code ?? null,
      // debugMessage: err?.message ?? String(err),
    });
  }
});

/**
 * GET /api/properties/:idOrSlug
 * Fetch a single property by numeric id or slug.
 */
router.get("/:idOrSlug", async (req, res) => {
  try {
    const { idOrSlug } = req.params;

    const id = Number.isFinite(Number(idOrSlug)) ? Number(idOrSlug) : null;

    const property = await prisma.property.findFirst({
      where: id != null ? { id } : { slug: idOrSlug },
      select: {
        id: true,
        slug: true,
        title: true,
        address1: true,
        address2: true,
        city: true,
        county: true,
        eircode: true,
        price: true,
        status: true,
        ber: true,
        bedrooms: true,
        bathrooms: true,
        size: true,
        sizeUnits: true,
        features: true,
        description: true,
        photos: true,
        createdAt: true,

        // propertyType: true, // keep disabled until DB column exists
      },
    });

    if (!property) {
      return res.status(404).json({ ok: false, error: "Property not found" });
    }

    return res.json(property);
  } catch (err: any) {
    console.error("GET /api/properties/:idOrSlug failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to fetch property" });
  }
});

export default router;
