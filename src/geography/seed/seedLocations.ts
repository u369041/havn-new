import { LocationType, Prisma } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import {
  CoreLocationSeed,
  coreLocations,
} from "../data/coreLocations";

type SeedSummary = {
  processed: number;
  createdOrUpdated: number;
  countryCount: number;
  countyCount: number;
  cityCount: number;
};

function validateSeedData(records: CoreLocationSeed[]): void {
  const slugs = new Set<string>();

  for (const record of records) {
    if (!record.slug.trim()) {
      throw new Error("A geography seed record has an empty slug.");
    }

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.slug)) {
      throw new Error(
        `Invalid geography slug "${record.slug}". Slugs must be lowercase and hyphenated.`,
      );
    }

    if (slugs.has(record.slug)) {
      throw new Error(
        `Duplicate geography slug detected: "${record.slug}".`,
      );
    }

    slugs.add(record.slug);

    if (!record.name.trim()) {
      throw new Error(
        `Location "${record.slug}" has an empty name.`,
      );
    }

    if (!record.canonicalName.trim()) {
      throw new Error(
        `Location "${record.slug}" has an empty canonical name.`,
      );
    }

    if (!record.displayName.trim()) {
      throw new Error(
        `Location "${record.slug}" has an empty display name.`,
      );
    }
  }

  for (const record of records) {
    if (
      record.parentSlug !== null &&
      !slugs.has(record.parentSlug)
    ) {
      throw new Error(
        `Location "${record.slug}" references missing parent "${record.parentSlug}".`,
      );
    }

    if (
      record.type === LocationType.COUNTRY &&
      record.parentSlug !== null
    ) {
      throw new Error(
        `Country "${record.slug}" must not have a parent.`,
      );
    }

    if (
      record.type !== LocationType.COUNTRY &&
      record.parentSlug === null
    ) {
      throw new Error(
        `Location "${record.slug}" must have a parent.`,
      );
    }
  }
}

function getHierarchyDepth(
  record: CoreLocationSeed,
  recordsBySlug: Map<string, CoreLocationSeed>,
  visited = new Set<string>(),
): number {
  if (record.parentSlug === null) {
    return 0;
  }

  if (visited.has(record.slug)) {
    throw new Error(
      `Circular geography hierarchy detected at "${record.slug}".`,
    );
  }

  const nextVisited = new Set(visited);
  nextVisited.add(record.slug);

  const parent = recordsBySlug.get(record.parentSlug);

  if (!parent) {
    throw new Error(
      `Missing parent "${record.parentSlug}" for "${record.slug}".`,
    );
  }

  return (
    1 +
    getHierarchyDepth(
      parent,
      recordsBySlug,
      nextVisited,
    )
  );
}

function normalizeStringArray(values?: string[]): string[] {
  if (!values?.length) {
    return [];
  }

  const deduplicated = new Map<string, string>();

  for (const value of values) {
    const cleaned = value.trim();

    if (!cleaned) {
      continue;
    }

    const key = cleaned.toLocaleLowerCase("en-IE");

    if (!deduplicated.has(key)) {
      deduplicated.set(key, cleaned);
    }
  }

  return Array.from(deduplicated.values());
}

function buildLocationData(
  record: CoreLocationSeed,
  parentId: number | null,
): Prisma.LocationUncheckedCreateInput {
  return {
    slug: record.slug,
    name: record.name.trim(),
    canonicalName: record.canonicalName.trim(),
    displayName: record.displayName.trim(),

    type: record.type,

    county: record.county?.trim() || null,
    parentId,

    latitude: record.latitude ?? null,
    longitude: record.longitude ?? null,

    aliases: normalizeStringArray(record.aliases),
    searchTerms: normalizeStringArray(record.searchTerms),
    eircodeRoutingKeys: normalizeStringArray(
      record.eircodeRoutingKeys,
    ).map((value) => value.toUpperCase()),

    population: record.population ?? null,

    searchable: record.searchable ?? true,
    indexable: record.indexable ?? false,
    isPopular: record.isPopular ?? false,
    isActive: record.isActive ?? true,

    seoPriority: record.seoPriority ?? 0,
    displayOrder: record.displayOrder ?? 0,

    tailteId: record.tailteId ?? null,
    csoId: record.csoId ?? null,
    osmId: record.osmId ?? null,
    geonamesId: record.geonamesId ?? null,

    sourceData:
      record.sourceData === undefined
        ? Prisma.JsonNull
        : (record.sourceData as Prisma.InputJsonValue),

    boundingBox: Prisma.JsonNull,

    daftChecked: false,
    daftCheckedAt: null,
    daftNotes: null,
  };
}

async function seedLocations(): Promise<SeedSummary> {
  validateSeedData(coreLocations);

  const recordsBySlug = new Map(
    coreLocations.map((record) => [
      record.slug,
      record,
    ]),
  );

  const orderedRecords = [...coreLocations].sort((a, b) => {
    const depthDifference =
      getHierarchyDepth(a, recordsBySlug) -
      getHierarchyDepth(b, recordsBySlug);

    if (depthDifference !== 0) {
      return depthDifference;
    }

    return (
      (a.displayOrder ?? 0) -
        (b.displayOrder ?? 0) ||
      a.displayName.localeCompare(
        b.displayName,
        "en-IE",
      )
    );
  });

  const databaseIdsBySlug = new Map<string, number>();

  const summary: SeedSummary = {
    processed: 0,
    createdOrUpdated: 0,
    countryCount: 0,
    countyCount: 0,
    cityCount: 0,
  };

  for (const record of orderedRecords) {
    let parentId: number | null = null;

    if (record.parentSlug !== null) {
      const seededParentId = databaseIdsBySlug.get(
        record.parentSlug,
      );

      if (seededParentId) {
        parentId = seededParentId;
      } else {
        const existingParent =
          await prisma.location.findUnique({
            where: {
              slug: record.parentSlug,
            },
            select: {
              id: true,
            },
          });

        if (!existingParent) {
          throw new Error(
            `Cannot seed "${record.slug}" because parent "${record.parentSlug}" does not exist.`,
          );
        }

        parentId = existingParent.id;
      }
    }

    const data = buildLocationData(record, parentId);

    const location = await prisma.location.upsert({
      where: {
        slug: record.slug,
      },
      create: data,
      update: {
        name: data.name,
        canonicalName: data.canonicalName,
        displayName: data.displayName,
        type: data.type,
        county: data.county,
        parentId: data.parentId,
        latitude: data.latitude,
        longitude: data.longitude,
        aliases: data.aliases,
        searchTerms: data.searchTerms,
        eircodeRoutingKeys:
          data.eircodeRoutingKeys,
        population: data.population,
        searchable: data.searchable,
        indexable: data.indexable,
        isPopular: data.isPopular,
        isActive: data.isActive,
        seoPriority: data.seoPriority,
        displayOrder: data.displayOrder,
        tailteId: data.tailteId,
        csoId: data.csoId,
        osmId: data.osmId,
        geonamesId: data.geonamesId,
        sourceData: data.sourceData,
      },
      select: {
        id: true,
        slug: true,
        type: true,
      },
    });

    databaseIdsBySlug.set(
      location.slug,
      location.id,
    );

    summary.processed += 1;
    summary.createdOrUpdated += 1;

    if (location.type === LocationType.COUNTRY) {
      summary.countryCount += 1;
    }

    if (location.type === LocationType.COUNTY) {
      summary.countyCount += 1;
    }

    if (location.type === LocationType.CITY) {
      summary.cityCount += 1;
    }

    console.log(
      `Seeded ${location.type}: ${location.slug}`,
    );
  }

  return summary;
}

async function main(): Promise<void> {
  console.log("Starting HAVN geography seed...");

  const summary = await seedLocations();

  console.log("");
  console.log("HAVN geography seed completed.");
  console.log(`Processed: ${summary.processed}`);
  console.log(
    `Created or updated: ${summary.createdOrUpdated}`,
  );
  console.log(
    `Countries: ${summary.countryCount}`,
  );
  console.log(`Counties: ${summary.countyCount}`);
  console.log(`Cities: ${summary.cityCount}`);
}

main()
  .catch((error: unknown) => {
    console.error(
      "HAVN geography seed failed:",
      error,
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });