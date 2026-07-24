import { Location, LocationType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

export type LocationSearchOptions = {
  limit?: number;
  types?: LocationType[];
  county?: string;
  searchableOnly?: boolean;
  activeOnly?: boolean;
};

export type LocationBreadcrumbItem = {
  id: number;
  slug: string;
  name: string;
  displayName: string;
  type: LocationType;
};

export type LocationSearchResult = {
  id: number;
  slug: string;
  name: string;
  canonicalName: string;
  displayName: string;
  type: LocationType;
  county: string | null;
  parentId: number | null;
  latitude: number | null;
  longitude: number | null;
  isPopular: boolean;
};

export type PublicLocationDetail = LocationSearchResult & {
  isActive: boolean;
  searchable: boolean;
};

const DEFAULT_SEARCH_LIMIT = 15;
const MAX_SEARCH_LIMIT = 20;
const MIN_SEARCH_QUERY_LENGTH = 2;
const MAX_HIERARCHY_DEPTH = 20;
const SEARCH_DEDUPLICATION_MULTIPLIER = 4;

const publicLocationSelect = {
  id: true,
  slug: true,
  name: true,
  canonicalName: true,
  displayName: true,
  type: true,
  county: true,
  parentId: true,
  latitude: true,
  longitude: true,
  isPopular: true,
  isActive: true,
  searchable: true,
} satisfies Prisma.LocationSelect;

type SelectedPublicLocation = Prisma.LocationGetPayload<{
  select: typeof publicLocationSelect;
}>;

function normaliseSearchText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-IE")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function clampLimit(limit?: number): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_SEARCH_LIMIT;
  }

  return Math.min(
    Math.max(Math.trunc(limit as number), 1),
    MAX_SEARCH_LIMIT,
  );
}

function toSearchResult(
  location: SelectedPublicLocation,
): LocationSearchResult {
  return {
    id: location.id,
    slug: location.slug,
    name: location.name,
    canonicalName: location.canonicalName,
    displayName: location.displayName,
    type: location.type,
    county: location.county,
    parentId: location.parentId,
    latitude: location.latitude,
    longitude: location.longitude,
    isPopular: location.isPopular,
  };
}

function toPublicLocationDetail(
  location: SelectedPublicLocation,
): PublicLocationDetail {
  return {
    ...toSearchResult(location),
    isActive: location.isActive,
    searchable: location.searchable,
  };
}

function locationDeduplicationKey(
  location: SelectedPublicLocation,
): string {
  const canonicalName = normaliseSearchText(
    location.canonicalName || location.name,
  );
  const county = normaliseSearchText(location.county || "");
  const parentId = location.parentId ?? "root";

  return `${canonicalName}|${county}|${parentId}`;
}

function deduplicateLocations(
  locations: SelectedPublicLocation[],
  limit: number,
): LocationSearchResult[] {
  const seen = new Set<string>();
  const results: LocationSearchResult[] = [];

  for (const location of locations) {
    const key = locationDeduplicationKey(location);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(toSearchResult(location));

    if (results.length >= limit) {
      break;
    }
  }

  return results;
}

export class LocationService {
  static async search(
    query: string,
    options: LocationSearchOptions = {},
  ): Promise<LocationSearchResult[]> {
    const cleanedQuery = normaliseSearchText(query);

    if (cleanedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
      return [];
    }

    const limit = clampLimit(options.limit);
    const escapedQuery = escapeLikePattern(cleanedQuery);

    const databaseTake = Math.min(
      limit * SEARCH_DEDUPLICATION_MULTIPLIER,
      MAX_SEARCH_LIMIT * SEARCH_DEDUPLICATION_MULTIPLIER,
    );

    const conditions: Prisma.LocationWhereInput[] = [
      {
        OR: [
          {
            name: {
              contains: escapedQuery,
              mode: "insensitive",
            },
          },
          {
            canonicalName: {
              contains: escapedQuery,
              mode: "insensitive",
            },
          },
          {
            displayName: {
              contains: escapedQuery,
              mode: "insensitive",
            },
          },
          {
            slug: {
              contains: escapedQuery.replace(/\s+/g, "-"),
              mode: "insensitive",
            },
          },
          {
            aliases: {
              has: cleanedQuery,
            },
          },
          {
            searchTerms: {
              has: cleanedQuery,
            },
          },
          {
            eircodeRoutingKeys: {
              has: cleanedQuery.toUpperCase(),
            },
          },
        ],
      },
    ];

    if (options.activeOnly !== false) {
      conditions.push({ isActive: true });
    }

    if (options.searchableOnly !== false) {
      conditions.push({ searchable: true });
    }

    if (options.types?.length) {
      conditions.push({
        type: {
          in: options.types,
        },
      });
    }

    if (options.county?.trim()) {
      conditions.push({
        county: {
          equals: options.county.trim(),
          mode: "insensitive",
        },
      });
    }

    const locations = await prisma.location.findMany({
      where: {
        AND: conditions,
      },
      select: publicLocationSelect,
      orderBy: [
        { isPopular: "desc" },
        { seoPriority: "desc" },
        { displayOrder: "asc" },
        { displayName: "asc" },
      ],
      take: databaseTake,
    });

    return deduplicateLocations(locations, limit);
  }

  static async getById(id: number): Promise<Location | null> {
    if (!Number.isInteger(id) || id <= 0) {
      return null;
    }

    return prisma.location.findUnique({
      where: { id },
    });
  }

  static async getBySlug(
    slug: string,
  ): Promise<PublicLocationDetail | null> {
    const cleanedSlug = slug.trim().toLocaleLowerCase("en-IE");

    if (!cleanedSlug) {
      return null;
    }

    const location = await prisma.location.findUnique({
      where: {
        slug: cleanedSlug,
      },
      select: publicLocationSelect,
    });

    return location ? toPublicLocationDetail(location) : null;
  }

  static async getChildren(
    parentId: number,
    options: {
      activeOnly?: boolean;
      searchableOnly?: boolean;
      types?: LocationType[];
    } = {},
  ): Promise<LocationSearchResult[]> {
    if (!Number.isInteger(parentId) || parentId <= 0) {
      return [];
    }

    const children = await prisma.location.findMany({
      where: {
        parentId,
        ...(options.activeOnly !== false ? { isActive: true } : {}),
        ...(options.searchableOnly === true ? { searchable: true } : {}),
        ...(options.types?.length
          ? {
              type: {
                in: options.types,
              },
            }
          : {}),
      },
      select: publicLocationSelect,
      orderBy: [
        { displayOrder: "asc" },
        { isPopular: "desc" },
        { displayName: "asc" },
      ],
      take: MAX_SEARCH_LIMIT,
    });

    return children.map(toSearchResult);
  }

  static async getParent(id: number): Promise<Location | null> {
    const location = await prisma.location.findUnique({
      where: { id },
      select: {
        parent: true,
      },
    });

    return location?.parent ?? null;
  }

  static async getBreadcrumb(
    locationId: number,
  ): Promise<LocationBreadcrumbItem[]> {
    const breadcrumb: LocationBreadcrumbItem[] = [];
    const visitedIds = new Set<number>();

    let currentId: number | null = locationId;
    let depth = 0;

    while (currentId !== null && depth < MAX_HIERARCHY_DEPTH) {
      if (visitedIds.has(currentId)) {
        throw new Error(
          `Circular location hierarchy detected at location ${currentId}.`,
        );
      }

      visitedIds.add(currentId);

      const location: {
        id: number;
        slug: string;
        name: string;
        displayName: string;
        type: LocationType;
        parentId: number | null;
      } | null = await prisma.location.findUnique({
        where: { id: currentId },
        select: {
          id: true,
          slug: true,
          name: true,
          displayName: true,
          type: true,
          parentId: true,
        },
      });

      if (!location) {
        break;
      }

      breadcrumb.unshift({
        id: location.id,
        slug: location.slug,
        name: location.name,
        displayName: location.displayName,
        type: location.type,
      });

      currentId = location.parentId;
      depth += 1;
    }

    return breadcrumb;
  }

  static async resolveAlias(
    input: string,
    options: {
      county?: string;
      types?: LocationType[];
    } = {},
  ): Promise<LocationSearchResult[]> {
    const cleanedInput = normaliseSearchText(input);

    if (cleanedInput.length < MIN_SEARCH_QUERY_LENGTH) {
      return [];
    }

    const limit = 10;

    const locations = await prisma.location.findMany({
      where: {
        isActive: true,
        searchable: true,
        AND: [
          {
            OR: [
              {
                name: {
                  equals: cleanedInput,
                  mode: "insensitive",
                },
              },
              {
                canonicalName: {
                  equals: cleanedInput,
                  mode: "insensitive",
                },
              },
              {
                displayName: {
                  equals: cleanedInput,
                  mode: "insensitive",
                },
              },
              {
                aliases: {
                  has: cleanedInput,
                },
              },
              {
                searchTerms: {
                  has: cleanedInput,
                },
              },
              {
                eircodeRoutingKeys: {
                  has: cleanedInput.toUpperCase(),
                },
              },
            ],
          },
          ...(options.county?.trim()
            ? [
                {
                  county: {
                    equals: options.county.trim(),
                    mode: "insensitive" as const,
                  },
                },
              ]
            : []),
          ...(options.types?.length
            ? [
                {
                  type: {
                    in: options.types,
                  },
                },
              ]
            : []),
        ],
      },
      select: publicLocationSelect,
      orderBy: [
        { isPopular: "desc" },
        { seoPriority: "desc" },
        { displayOrder: "asc" },
        { displayName: "asc" },
      ],
      take: limit * SEARCH_DEDUPLICATION_MULTIPLIER,
    });

    return deduplicateLocations(locations, limit);
  }

  static async getPopular(
    limit = DEFAULT_SEARCH_LIMIT,
    types?: LocationType[],
  ): Promise<LocationSearchResult[]> {
    const locations = await prisma.location.findMany({
      where: {
        isActive: true,
        searchable: true,
        isPopular: true,
        ...(types?.length
          ? {
              type: {
                in: types,
              },
            }
          : {}),
      },
      select: publicLocationSelect,
      orderBy: [
        { displayOrder: "asc" },
        { seoPriority: "desc" },
        { displayName: "asc" },
      ],
      take: clampLimit(limit),
    });

    return locations.map(toSearchResult);
  }
}