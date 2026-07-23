import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
  Centroid_x?: number | null;
  Centroid_y?: number | null;
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

const SOURCE_URL =
  "https://services.arcgis.com/NzlPQPKn5QF9v2US/ArcGIS/rest/services/" +
  "BUA_population_Census2022_points/FeatureServer/0/query" +
  "?where=1%3D1" +
  "&outFields=*" +
  "&returnGeometry=true" +
  "&outSR=4326" +
  "&f=geojson";

const outputDirectory = path.resolve(
  process.cwd(),
  "src",
  "geography",
  "data",
  "raw",
);

const outputFile = path.join(
  outputDirectory,
  "cso-built-up-areas-2022.geojson",
);

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned || null;
}

function validateFeatureCollection(
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
      "The CSO endpoint did not return a valid GeoJSON FeatureCollection.",
    );
  }
}

function validateFeatures(
  collection: BuiltUpAreaFeatureCollection,
): void {
  if (collection.features.length === 0) {
    throw new Error("The CSO dataset returned zero built-up areas.");
  }

  const missingNames: number[] = [];
  const missingCounties: number[] = [];
  const missingCoordinates: number[] = [];

  collection.features.forEach((feature, index) => {
    const name = cleanText(feature.properties?.URBAN_AREA_NAME);
    const county = cleanText(feature.properties?.COUNTY);
    const coordinates =
      feature.geometry?.type === "Point"
        ? feature.geometry.coordinates
        : null;

    if (!name) missingNames.push(index);
    if (!county) missingCounties.push(index);

    if (
      !coordinates ||
      coordinates.length !== 2 ||
      !Number.isFinite(coordinates[0]) ||
      !Number.isFinite(coordinates[1])
    ) {
      missingCoordinates.push(index);
    }
  });

  if (missingNames.length > 0) {
    throw new Error(
      `${missingNames.length} records are missing URBAN_AREA_NAME.`,
    );
  }

  if (missingCounties.length > 0) {
    console.warn(
      `Warning: ${missingCounties.length} records are missing COUNTY.`,
    );
  }

  if (missingCoordinates.length > 0) {
    throw new Error(
      `${missingCoordinates.length} records have invalid coordinates.`,
    );
  }
}

function printSummary(
  collection: BuiltUpAreaFeatureCollection,
): void {
  const counties = new Set<string>();
  let totalPopulation = 0;
  let recordsWithPopulation = 0;

  for (const feature of collection.features) {
    const county = cleanText(feature.properties.COUNTY);
    if (county) counties.add(county);

    const population = Number(feature.properties.Population);
    if (Number.isFinite(population) && population >= 0) {
      totalPopulation += population;
      recordsWithPopulation += 1;
    }
  }

  const alphabeticalSample = [...collection.features]
    .sort((a, b) => {
      const aName = cleanText(a.properties.URBAN_AREA_NAME) ?? "";
      const bName = cleanText(b.properties.URBAN_AREA_NAME) ?? "";
      return aName.localeCompare(bName, "en-IE");
    })
    .slice(0, 10)
    .map((feature) => ({
      code:
        cleanText(feature.properties.URBAN_AREA_CODE) ?? null,
      name:
        cleanText(feature.properties.URBAN_AREA_NAME) ?? null,
      county:
        cleanText(feature.properties.COUNTY) ?? null,
      population:
        feature.properties.Population ?? null,
      longitude:
        feature.geometry?.coordinates[0] ?? null,
      latitude:
        feature.geometry?.coordinates[1] ?? null,
    }));

  console.log("");
  console.log("CSO Built-Up Areas download summary");
  console.log("-----------------------------------");
  console.log(`Settlement records: ${collection.features.length}`);
  console.log(`Distinct county values: ${counties.size}`);
  console.log(`Records with population: ${recordsWithPopulation}`);
  console.log(`Combined reported population: ${totalPopulation}`);

  console.log("");
  console.log("County values:");
  console.log(
    [...counties]
      .sort((a, b) => a.localeCompare(b, "en-IE"))
      .join(", "),
  );

  console.log("");
  console.log("First 10 settlements alphabetically:");
  console.table(alphabeticalSample);
}

async function main(): Promise<void> {
  console.log(
    "Downloading official CSO Census 2022 Built-Up Areas...",
  );

  const response = await fetch(SOURCE_URL, {
    headers: {
      Accept: "application/geo+json, application/json",
      "User-Agent": "HAVN.ie Geography Importer/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `CSO download failed with HTTP ${response.status} ${response.statusText}.`,
    );
  }

  const json: unknown = await response.json();

  validateFeatureCollection(json);
  validateFeatures(json);

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    outputFile,
    JSON.stringify(json, null, 2),
    "utf8",
  );

  printSummary(json);

  console.log("");
  console.log(`Saved dataset to: ${outputFile}`);
  console.log("");
  console.log("No database records were created or updated.");
}

main().catch((error: unknown) => {
  console.error("CSO Built-Up Areas download failed:", error);
  process.exitCode = 1;
});
