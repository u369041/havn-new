import { Router } from "express";
import { LocationType } from "@prisma/client";
import { LocationService } from "../services/locationService";

const router = Router();

function parseLocationTypes(value: unknown): LocationType[] | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const validTypes = new Set(Object.values(LocationType));

  const types = value
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item): item is LocationType =>
      validTypes.has(item as LocationType),
    );

  return types.length ? types : undefined;
}

function parsePositiveInteger(
  value: unknown,
  fallback?: number,
): number | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

router.get("/search", async (req, res) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (!query) {
      return res.status(400).json({
        error: "A search query is required.",
      });
    }

    const locations = await LocationService.search(query, {
      limit: parsePositiveInteger(req.query.limit, 20),
      county:
        typeof req.query.county === "string"
          ? req.query.county.trim()
          : undefined,
      types: parseLocationTypes(req.query.types),
    });

    return res.json({
      query,
      count: locations.length,
      locations,
    });
  } catch (error) {
    console.error("Location search failed:", error);

    return res.status(500).json({
      error: "Unable to search locations.",
    });
  }
});

router.get("/popular", async (req, res) => {
  try {
    const locations = await LocationService.getPopular(
      parsePositiveInteger(req.query.limit, 20),
      parseLocationTypes(req.query.types),
    );

    return res.json({
      count: locations.length,
      locations,
    });
  } catch (error) {
    console.error("Popular location lookup failed:", error);

    return res.status(500).json({
      error: "Unable to load popular locations.",
    });
  }
});

router.get("/resolve", async (req, res) => {
  try {
    const input =
      typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (!input) {
      return res.status(400).json({
        error: "A location value is required.",
      });
    }

    const locations = await LocationService.resolveAlias(input, {
      county:
        typeof req.query.county === "string"
          ? req.query.county.trim()
          : undefined,
      types: parseLocationTypes(req.query.types),
    });

    return res.json({
      query: input,
      count: locations.length,
      locations,
    });
  } catch (error) {
    console.error("Location alias resolution failed:", error);

    return res.status(500).json({
      error: "Unable to resolve location.",
    });
  }
});

router.get("/:slug/breadcrumb", async (req, res) => {
  try {
    const location = await LocationService.getBySlug(req.params.slug);

    if (!location || !location.isActive) {
      return res.status(404).json({
        error: "Location not found.",
      });
    }

    const breadcrumb = await LocationService.getBreadcrumb(location.id);

    return res.json({
      location: {
        id: location.id,
        slug: location.slug,
        displayName: location.displayName,
        type: location.type,
      },
      breadcrumb,
    });
  } catch (error) {
    console.error("Location breadcrumb lookup failed:", error);

    return res.status(500).json({
      error: "Unable to load location breadcrumb.",
    });
  }
});

router.get("/:slug/children", async (req, res) => {
  try {
    const location = await LocationService.getBySlug(req.params.slug);

    if (!location || !location.isActive) {
      return res.status(404).json({
        error: "Location not found.",
      });
    }

    const children = await LocationService.getChildren(location.id, {
      activeOnly: true,
      searchableOnly: req.query.searchable === "true",
      types: parseLocationTypes(req.query.types),
    });

    return res.json({
      parent: {
        id: location.id,
        slug: location.slug,
        displayName: location.displayName,
        type: location.type,
      },
      count: children.length,
      children,
    });
  } catch (error) {
    console.error("Location children lookup failed:", error);

    return res.status(500).json({
      error: "Unable to load child locations.",
    });
  }
});

router.get("/:slug", async (req, res) => {
  try {
    const location = await LocationService.getBySlug(req.params.slug);

    if (!location || !location.isActive) {
      return res.status(404).json({
        error: "Location not found.",
      });
    }

    return res.json({ location });
  } catch (error) {
    console.error("Location lookup failed:", error);

    return res.status(500).json({
      error: "Unable to load location.",
    });
  }
});

export default router;