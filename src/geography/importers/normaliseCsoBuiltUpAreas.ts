import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { LocationType } from "@prisma/client";

type GeoJsonPoint = {
  type: "Point";
  coordinates: [number, number];
};

type BuiltUpAreaProperties = {
  OBJECTID?: number;
  URBAN_AREA_GUID?: string | null;
  URBAN_AREA_CODE?: string | null;
  URBAN_AREA_NAME?: string | null;
  COUNTY?: string | null;
  GEOGID?: string | null;
  GEOGDESC?: string | null;
  Population?: number | null;
};

type BuiltUpAreaFeature = {
  type: "Feature";
  id?: number | string;
  geometry: GeoJsonPoint | null;
  properties: BuiltUpAreaProperties;
};

type BuiltUpAreaFeatureCollection = {
  type: "FeatureCollection";
  features: BuiltUpAreaFeature[];
};

type NormalisedLocation = {
  slug: string;
  name: string;
  canonicalName: string;
  displayName: string;
  type: LocationType;
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
  tailteId: null;
  csoId: string | null;
  osmId: null;
  geonamesId: null;
  sourceData: Record<string, unknown>;
};

const inputFile = path.resolve(
  process.cwd(),
  "src",
  "geography",
  "data",
  "raw",
  "cso-built-up-areas-2022.geojson",
);

const outputDirectory = path.resolve(
  process.cwd(),
  "src",
  "geography",
  "data",
  "normalised",
);

const outputFile = path.join(
  outputDirectory,
  "cso-built-up-areas-2022.normalised.json",
);

const CITY_DEFINITIONS = [
  { canonicalName: "Dublin", pattern: /^Dublin(?: City)?(?: and Suburbs)?$/i },
  { canonicalName: "Cork", pattern: /^Cork(?: City)?(?: and Suburbs)?$/i },
  { canonicalName: "Limerick", pattern: /^Limerick(?: City)?(?: and Suburbs)?$/i },
  { canonicalName: "Galway", pattern: /^Galway(?: City)?(?: and Suburbs)?$/i },
  { canonicalName: "Waterford", pattern: /^Waterford(?: City)?(?: and Suburbs)?$/i },
] as const;

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned || null;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const cleaned = cleanText(value);
    if (!cleaned) continue;

    const key = cleaned.toLocaleLowerCase("en-IE");
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(cleaned);
  }

  return result;
}

function getCityCanonicalName(name: string): string | null {
  const match = CITY_DEFINITIONS.find((city) =>
    city.pattern.test(name),
  );

  return match?.canonicalName ?? null;
}

function getLocationType(name: string): LocationType {
  return getCityCanonicalName(name)
    ? LocationType.CITY
    : LocationType.TOWN;
}

function getDisplayName(
  canonicalName: string,
  type: LocationType,
): string {
  return type === LocationType.CITY
    ? `${canonicalName} City`
    : canonicalName;
}

function getSeoPriority(
  population: number | null,
  type: LocationType,
): number {
  if (type === LocationType.CITY) return 90;
  if (population === null) return 35;
  if (population >= 20_000) return 75;
  if (population >= 10_000) return 65;
  if (population >= 5_000) return 55;
  if (population >= 1_500) return 45;
  return 35;
}

function getIndexable(
  population: number | null,
  type: LocationType,
): boolean {
  if (type === LocationType.CITY) return true;
  return population !== null && population >= 1_500;
}

function validateCollection(
  value: unknown,
): asserts value is BuiltUpAreaFeatureCollection {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    value.type !== "FeatureCollection" ||
    !("features" in value) ||
    !Array.isArray(value.features)
  ) {
    throw new Error(
      "The raw CSO file is not a valid GeoJSON FeatureCollection.",
    );
  }
}

function normaliseFeature(
  feature: BuiltUpAreaFeature,
  index: number,
): NormalisedLocation {
  const name = cleanText(feature.properties?.URBAN_AREA_NAME);
  const county = cleanText(feature.properties?.COUNTY);

  if (!name) {
    throw new Error(`Record ${index} has no URBAN_AREA_NAME.`);
  }

  if (!county) {
    throw new Error(`Record ${index} has no COUNTY.`);
  }

  if (
    feature.geometry?.type !== "Point" ||
    feature.geometry.coordinates.length !== 2
  ) {
    throw new Error(`Record ${index} has invalid point geometry.`);
  }

  const [longitude, latitude] = feature.geometry.coordinates;

  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude)
  ) {
    throw new Error(`Record ${index} has invalid coordinates.`);
  }

  const rawPopulation = Number(feature.properties.Population);
  const population =
    Number.isFinite(rawPopulation) && rawPopulation >= 0
      ? Math.round(rawPopulation)
      : null;

  const type = getLocationType(name);
  const cityCanonicalName = getCityCanonicalName(name);
  const canonicalName = cityCanonicalName ?? name;
  const displayName = getDisplayName(canonicalName, type);
  const countySlug = `county-${slugify(county)}`;
  const baseSlug =
    type === LocationType.CITY
      ? `${slugify(canonicalName)}-city`
      : slugify(canonicalName);

  const aliases = uniqueStrings([
    name,
    canonicalName,
    displayName,
    type === LocationType.CITY
      ? `City of ${canonicalName}`
      : null,
    type === LocationType.CITY
      ? `${canonicalName} City and Suburbs`
      : null,
  ]);

  const searchTerms = uniqueStrings([
    name,
    canonicalName,
    displayName,
    county,
    `${canonicalName} ${county}`,
    `${canonicalName}, ${county}`,
    `County ${county}`,
  ]);

  const csoId =
    cleanText(feature.properties.URBAN_AREA_CODE) ??
    cleanText(feature.properties.GEOGID) ??
    (feature.properties.OBJECTID !== undefined
      ? String(feature.properties.OBJECTID)
      : null);

  return {
    slug: baseSlug,
    name: canonicalName,
    canonicalName,
    displayName,
    type,
    parentSlug: countySlug,
    county,
    latitude,
    longitude,
    aliases,
    searchTerms,
    eircodeRoutingKeys: [],
    population,
    searchable: true,
    indexable: getIndexable(population, type),
    isPopular:
      type === LocationType.CITY ||
      (population !== null && population >= 20_000),
    isActive: true,
    seoPriority: getSeoPriority(population, type),
    displayOrder: population === null ? 999_999 : -population,
    tailteId: null,
    csoId,
    osmId: null,
    geonamesId: null,
    sourceData: {
      source: "CSO_CENSUS_2022_BUILT_UP_AREAS",
      sourceVersion: 2022,
      objectId: feature.properties.OBJECTID ?? null,
      urbanAreaGuid:
        cleanText(feature.properties.URBAN_AREA_GUID) ?? null,
      urbanAreaCode:
        cleanText(feature.properties.URBAN_AREA_CODE) ?? null,
      geogId: cleanText(feature.properties.GEOGID) ?? null,
      geogDesc: cleanText(feature.properties.GEOGDESC) ?? null,
    },
  };
}

function resolveDuplicateSlugs(
  locations: NormalisedLocation[],
): {
  locations: NormalisedLocation[];
  duplicateGroups: number;
  changedSlugs: number;
} {
  const groups = new Map<string, NormalisedLocation[]>();

  for (const location of locations) {
    const group = groups.get(location.slug) ?? [];
    group.push(location);
    groups.set(location.slug, group);
  }

  let duplicateGroups = 0;
  let changedSlugs = 0;

  for (const [slug, group] of groups) {
    if (group.length <= 1) continue;

    duplicateGroups += 1;

    for (const location of group) {
      location.slug = `${slug}-${slugify(location.county)}`;
      changedSlugs += 1;
    }
  }

  const finalSlugs = new Set<string>();

  for (const location of locations) {
    if (finalSlugs.has(location.slug)) {
      const suffix = location.csoId
        ? slugify(location.csoId)
        : String(finalSlugs.size + 1);

      location.slug = `${location.slug}-${suffix}`;
      changedSlugs += 1;
    }

    finalSlugs.add(location.slug);
  }

  return {
    locations,
    duplicateGroups,
    changedSlugs,
  };
}

async function main(): Promise<void> {
  console.log("Reading downloaded CSO Built-Up Areas dataset...");

  const raw = await readFile(inputFile, "utf8");
  const parsed: unknown = JSON.parse(raw);

  validateCollection(parsed);

  const normalised = parsed.features.map(normaliseFeature);
  const duplicateResult = resolveDuplicateSlugs(normalised);

  const ordered = duplicateResult.locations.sort((a, b) => {
    const countyCompare = a.county.localeCompare(b.county, "en-IE");
    if (countyCompare !== 0) return countyCompare;

    return a.name.localeCompare(b.name, "en-IE");
  });

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    outputFile,
    JSON.stringify(ordered, null, 2),
    "utf8",
  );

  const typeCounts = ordered.reduce<Record<string, number>>(
    (counts, location) => {
      counts[location.type] =
        (counts[location.type] ?? 0) + 1;
      return counts;
    },
    {},
  );

  const indexableCount = ordered.filter(
    (location) => location.indexable,
  ).length;

  const popularCount = ordered.filter(
    (location) => location.isPopular,
  ).length;

  console.log("");
  console.log("HAVN geography normalisation summary");
  console.log("------------------------------------");
  console.log(`Input records: ${parsed.features.length}`);
  console.log(`Output locations: ${ordered.length}`);
  console.log(`Cities: ${typeCounts[LocationType.CITY] ?? 0}`);
  console.log(`Towns/settlements: ${typeCounts[LocationType.TOWN] ?? 0}`);
  console.log(`Indexable locations: ${indexableCount}`);
  console.log(`Popular locations: ${popularCount}`);
  console.log(
    `Duplicate base-slug groups: ${duplicateResult.duplicateGroups}`,
  );
  console.log(
    `Slugs changed for uniqueness: ${duplicateResult.changedSlugs}`,
  );
  console.log("");
  console.log(`Saved normalised dataset to: ${outputFile}`);
  console.log("");
  console.log("No database records were created or updated.");
}

main().catch((error: unknown) => {
  console.error("CSO Built-Up Areas normalisation failed:", error);
  process.exitCode = 1;
});