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
  aliases: string[];
  eircodeRoutingKeys: string[];
  isPopular: boolean;
  seoPriority: number;
  displayOrder: number;
};

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;
const MAX_HIERARCHY_DEPTH = 20;

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

function toSearchResult(location: Location): LocationSearchResult {
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
    aliases: location.aliases,
    eircodeRoutingKeys: location.eircodeRoutingKeys,
    isPopular: location.isPopular,
    seoPriority: location.seoPriority,
    displayOrder: location.displayOrder,
  };
}

export class LocationService {
  static async search(
    query: string,
    options: LocationSearchOptions = {},
  ): Promise<LocationSearchResult[]> {
    const cleanedQuery = normaliseSearchText(query);

    if (cleanedQuery.length < 1) {
      return [];
    }

    const limit = clampLimit(options.limit);
    const escapedQuery = escapeLikePattern(cleanedQuery);

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
      orderBy: [
        { isPopular: "desc" },
        { seoPriority: "desc" },
        { displayOrder: "asc" },
        { displayName: "asc" },
      ],
      take: limit,
    });

    return locations.map(toSearchResult);
  }

  static async getById(id: number): Promise<Location | null> {
    if (!Number.isInteger(id) || id <= 0) {
      return null;
    }

    return prisma.location.findUnique({
      where: { id },
    });
  }

  static async getBySlug(slug: string): Promise<Location | null> {
    const cleanedSlug = slug.trim().toLocaleLowerCase("en-IE");

    if (!cleanedSlug) {
      return null;
    }

    return prisma.location.findUnique({
      where: {
        slug: cleanedSlug,
      },
    });
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
      orderBy: [
        { displayOrder: "asc" },
        { isPopular: "desc" },
        { displayName: "asc" },
      ],
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

    if (!cleanedInput) {
      return [];
    }

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
      orderBy: [
        { isPopular: "desc" },
        { seoPriority: "desc" },
        { displayOrder: "asc" },
        { displayName: "asc" },
      ],
      take: 20,
    });

    return locations.map(toSearchResult);
  }

  static async getPopular(
    limit = 20,
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