import { LocationType, Prisma } from "@prisma/client";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "../../lib/prisma";

type NormalisedLocation = {
  slug: string;
  name: string;
  canonicalName: string;
  displayName: string;
  type: "CITY" | "TOWN";
  parentSlug: string;
  county: string;
  latitude: number;
  longitude: number;
  aliases: string[];
  searchTerms: string[];
  eircodeRoutingKeys: string[];
  population: number | null;
  searchable: boolean;
  indexable: boolean;
  isPopular: boolean;
  isActive: boolean;
  seoPriority: number;
  displayOrder: number;
  tailteId: string | null;
  csoId: string | null;
  osmId: string | null;
  geonamesId: string | null;
  sourceData: Record<string, unknown>;
};

type ImportSummary = {
  mode: "DRY_RUN" | "WRITE";
  inputRecords: number;
  validRecords: number;
  existingRecords: number;
  newRecords: number;
  created: number;
  updated: number;
  failed: number;
};

const inputFile = path.resolve(
  process.cwd(),
  "src",
  "geography",
  "data",
  "normalised",
  "cso-built-up-areas-2022.normalised.json",
);

const writeMode = process.argv.includes("--write");

function normalizeStringArray(values: string[] | undefined): string[] {
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

  return [...deduplicated.values()];
}

function validateRecord(record: NormalisedLocation): void {
  if (!record.slug?.trim()) {
    throw new Error("A record has an empty slug.");
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.slug)) {
    throw new Error(`Invalid slug: "${record.slug}".`);
  }

  if (!record.name?.trim()) {
    throw new Error(`"${record.slug}" has an empty name.`);
  }

  if (!record.canonicalName?.trim()) {
    throw new Error(`"${record.slug}" has an empty canonicalName.`);
  }

  if (!record.displayName?.trim()) {
    throw new Error(`"${record.slug}" has an empty displayName.`);
  }

  if (!record.parentSlug?.trim()) {
    throw new Error(`"${record.slug}" has no parentSlug.`);
  }

  if (record.type !== "CITY" && record.type !== "TOWN") {
    throw new Error(
      `"${record.slug}" has unsupported type "${record.type}".`,
    );
  }

  if (!Number.isFinite(record.latitude)) {
    throw new Error(`"${record.slug}" has an invalid latitude.`);
  }

  if (!Number.isFinite(record.longitude)) {
    throw new Error(`"${record.slug}" has an invalid longitude.`);
  }
}

function buildCreateData(
  record: NormalisedLocation,
  parentId: number,
): Prisma.LocationUncheckedCreateInput {
  return {
    slug: record.slug,
    name: record.name.trim(),
    canonicalName: record.canonicalName.trim(),
    displayName: record.displayName.trim(),
    type:
      record.type === "CITY"
        ? LocationType.CITY
        : LocationType.TOWN,
    county: record.county.trim(),
    parentId,
    latitude: record.latitude,
    longitude: record.longitude,
    aliases: normalizeStringArray(record.aliases),
    searchTerms: normalizeStringArray(record.searchTerms),
    eircodeRoutingKeys: normalizeStringArray(
      record.eircodeRoutingKeys,
    ).map((value) => value.toUpperCase()),
    population: record.population,
    searchable: record.searchable,
    indexable: record.indexable,
    isPopular: record.isPopular,
    isActive: record.isActive,
    seoPriority: record.seoPriority,
    displayOrder: record.displayOrder,
    tailteId: record.tailteId,
    csoId: record.csoId,
    osmId: record.osmId,
    geonamesId: record.geonamesId,
    sourceData: record.sourceData as Prisma.InputJsonValue,
    boundingBox: Prisma.JsonNull,
    daftChecked: false,
    daftCheckedAt: null,
    daftNotes: null,
  };
}

async function main(): Promise<void> {
  console.log("Reading verified CSO geography dataset...");

  const raw = await readFile(inputFile, "utf8");
  const parsed: unknown = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("The normalised geography file must contain a JSON array.");
  }

  const records = parsed as NormalisedLocation[];

  for (const record of records) {
    validateRecord(record);
  }

  const duplicateSlugs = records
    .map((record) => record.slug)
    .filter((slug, index, all) => all.indexOf(slug) !== index);

  if (duplicateSlugs.length > 0) {
    throw new Error(
      `Duplicate slugs detected: ${[...new Set(duplicateSlugs)].join(", ")}`,
    );
  }

  const parentSlugs = [...new Set(records.map((record) => record.parentSlug))];

  const parents = await prisma.location.findMany({
    where: {
      slug: {
        in: parentSlugs,
      },
      type: LocationType.COUNTY,
    },
    select: {
      id: true,
      slug: true,
    },
  });

  const parentIdsBySlug = new Map(
    parents.map((parent) => [parent.slug, parent.id]),
  );

  const missingParents = parentSlugs.filter(
    (slug) => !parentIdsBySlug.has(slug),
  );

  if (missingParents.length > 0) {
    throw new Error(
      [
        "The following county parent records are missing from the database:",
        ...missingParents.map((slug) => `- ${slug}`),
        "",
        "Run npm run geography:seed before importing the CSO locations.",
      ].join("\n"),
    );
  }

  const existingLocations = await prisma.location.findMany({
    where: {
      slug: {
        in: records.map((record) => record.slug),
      },
    },
    select: {
      slug: true,
    },
  });

  const existingSlugs = new Set(
    existingLocations.map((location) => location.slug),
  );

  const summary: ImportSummary = {
    mode: writeMode ? "WRITE" : "DRY_RUN",
    inputRecords: records.length,
    validRecords: records.length,
    existingRecords: existingSlugs.size,
    newRecords: records.length - existingSlugs.size,
    created: 0,
    updated: 0,
    failed: 0,
  };

  console.log("");
  console.log("HAVN CSO Geography Import Plan");
  console.log("==============================");
  console.log(`Mode: ${summary.mode}`);
  console.log(`Input records: ${summary.inputRecords}`);
  console.log(`Valid records: ${summary.validRecords}`);
  console.log(`Existing records to update: ${summary.existingRecords}`);
  console.log(`New records to create: ${summary.newRecords}`);
  console.log(`County parents resolved: ${parents.length}`);

  if (!writeMode) {
    console.log("");
    console.log("DRY RUN ONLY — no database records were created or updated.");
    console.log(
      "After reviewing these totals, run the same command with --write to import.",
    );
    return;
  }

  console.log("");
  console.log("Writing locations to the database...");

  for (const record of records) {
    const parentId = parentIdsBySlug.get(record.parentSlug);

    if (!parentId) {
      summary.failed += 1;
      console.error(
        `Skipped ${record.slug}: parent ${record.parentSlug} was not resolved.`,
      );
      continue;
    }

    const data = buildCreateData(record, parentId);
    const existedBefore = existingSlugs.has(record.slug);

    try {
      await prisma.location.upsert({
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
          eircodeRoutingKeys: data.eircodeRoutingKeys,
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
      });

      if (existedBefore) {
        summary.updated += 1;
      } else {
        summary.created += 1;
      }
    } catch (error: unknown) {
      summary.failed += 1;
      console.error(`Failed to import ${record.slug}:`, error);
    }
  }

  console.log("");
  console.log("HAVN CSO geography import completed.");
  console.log(`Created: ${summary.created}`);
  console.log(`Updated: ${summary.updated}`);
  console.log(`Failed: ${summary.failed}`);

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error("HAVN CSO geography import failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
