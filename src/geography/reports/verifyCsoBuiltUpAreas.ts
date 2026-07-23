import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type NormalisedLocation = {
  slug: string;
  name: string;
  canonicalName: string;
  displayName: string;
  type: string;
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

type Anomaly = {
  severity: "ERROR" | "WARNING";
  category: string;
  slug: string;
  name: string;
  county: string;
  details: string;
};

const inputFile = path.resolve(
  process.cwd(),
  "src",
  "geography",
  "data",
  "normalised",
  "cso-built-up-areas-2022.normalised.json",
);

const outputDirectory = path.resolve(
  process.cwd(),
  "src",
  "geography",
  "reports",
  "output",
);

const summaryFile = path.join(
  outputDirectory,
  "verification-summary.json",
);

const anomaliesFile = path.join(
  outputDirectory,
  "verification-anomalies.csv",
);

const expectedCounties = new Set([
  "Carlow",
  "Cavan",
  "Clare",
  "Cork",
  "Donegal",
  "Dublin",
  "Galway",
  "Kerry",
  "Kildare",
  "Kilkenny",
  "Laois",
  "Leitrim",
  "Limerick",
  "Longford",
  "Louth",
  "Mayo",
  "Meath",
  "Monaghan",
  "Offaly",
  "Roscommon",
  "Sligo",
  "Tipperary",
  "Waterford",
  "Westmeath",
  "Wexford",
  "Wicklow",
]);

function csvEscape(value: unknown): string {
  const text = String(value ?? "");

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function addAnomaly(
  anomalies: Anomaly[],
  location: Partial<NormalisedLocation>,
  severity: Anomaly["severity"],
  category: string,
  details: string,
): void {
  anomalies.push({
    severity,
    category,
    slug: location.slug ?? "",
    name: location.displayName ?? location.name ?? "",
    county: location.county ?? "",
    details,
  });
}

async function main(): Promise<void> {
  console.log("Reading normalised HAVN geography dataset...");

  const raw = await readFile(inputFile, "utf8");
  const parsed: unknown = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(
      "The normalised geography file must contain a JSON array.",
    );
  }

  const locations = parsed as NormalisedLocation[];
  const anomalies: Anomaly[] = [];

  const slugCounts = new Map<string, number>();
  const csoIdCounts = new Map<string, number>();
  const countyCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();

  for (const location of locations) {
    slugCounts.set(
      location.slug,
      (slugCounts.get(location.slug) ?? 0) + 1,
    );

    if (location.csoId) {
      csoIdCounts.set(
        location.csoId,
        (csoIdCounts.get(location.csoId) ?? 0) + 1,
      );
    }

    countyCounts.set(
      location.county,
      (countyCounts.get(location.county) ?? 0) + 1,
    );

    typeCounts.set(
      location.type,
      (typeCounts.get(location.type) ?? 0) + 1,
    );

    if (!location.slug?.trim()) {
      addAnomaly(
        anomalies,
        location,
        "ERROR",
        "MISSING_SLUG",
        "Location has no slug.",
      );
    }

    if (!location.name?.trim()) {
      addAnomaly(
        anomalies,
        location,
        "ERROR",
        "MISSING_NAME",
        "Location has no name.",
      );
    }

    if (!location.displayName?.trim()) {
      addAnomaly(
        anomalies,
        location,
        "ERROR",
        "MISSING_DISPLAY_NAME",
        "Location has no displayName.",
      );
    }

    if (!expectedCounties.has(location.county)) {
      addAnomaly(
        anomalies,
        location,
        "ERROR",
        "UNKNOWN_COUNTY",
        `Unexpected county value: ${location.county}`,
      );
    }

    const expectedParentSlug =
      `county-${location.county
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")}`;

    if (location.parentSlug !== expectedParentSlug) {
      addAnomaly(
        anomalies,
        location,
        "ERROR",
        "INVALID_PARENT_SLUG",
        `Expected ${expectedParentSlug}, received ${location.parentSlug}.`,
      );
    }

    if (
      !isFiniteNumber(location.latitude) ||
      location.latitude < 51 ||
      location.latitude > 56
    ) {
      addAnomaly(
        anomalies,
        location,
        "ERROR",
        "INVALID_LATITUDE",
        `Latitude is outside the expected Ireland range: ${location.latitude}`,
      );
    }

    if (
      !isFiniteNumber(location.longitude) ||
      location.longitude < -11 ||
      location.longitude > -5
    ) {
      addAnomaly(
        anomalies,
        location,
        "ERROR",
        "INVALID_LONGITUDE",
        `Longitude is outside the expected Ireland range: ${location.longitude}`,
      );
    }

    if (
      !Array.isArray(location.aliases) ||
      location.aliases.length === 0
    ) {
      addAnomaly(
        anomalies,
        location,
        "ERROR",
        "MISSING_ALIASES",
        "Location has no aliases.",
      );
    }

    if (
      !Array.isArray(location.searchTerms) ||
      location.searchTerms.length === 0
    ) {
      addAnomaly(
        anomalies,
        location,
        "ERROR",
        "MISSING_SEARCH_TERMS",
        "Location has no search terms.",
      );
    }

    if (!location.csoId) {
      addAnomaly(
        anomalies,
        location,
        "WARNING",
        "MISSING_CSO_ID",
        "Location has no CSO identifier.",
      );
    }

    if (
      location.population !== null &&
      (!Number.isInteger(location.population) ||
        location.population < 0)
    ) {
      addAnomaly(
        anomalies,
        location,
        "ERROR",
        "INVALID_POPULATION",
        `Invalid population value: ${location.population}`,
      );
    }

    if (
      location.type !== "CITY" &&
      location.type !== "TOWN"
    ) {
      addAnomaly(
        anomalies,
        location,
        "ERROR",
        "UNKNOWN_LOCATION_TYPE",
        `Unexpected location type: ${location.type}`,
      );
    }
  }

  for (const [slug, count] of slugCounts) {
    if (count > 1) {
      const location = locations.find(
        (item) => item.slug === slug,
      );

      addAnomaly(
        anomalies,
        location ?? { slug },
        "ERROR",
        "DUPLICATE_SLUG",
        `Slug appears ${count} times.`,
      );
    }
  }

  for (const [csoId, count] of csoIdCounts) {
    if (count > 1) {
      const location = locations.find(
        (item) => item.csoId === csoId,
      );

      addAnomaly(
        anomalies,
        location ?? {},
        "ERROR",
        "DUPLICATE_CSO_ID",
        `CSO ID ${csoId} appears ${count} times.`,
      );
    }
  }

  for (const county of expectedCounties) {
    if (!countyCounts.has(county)) {
      addAnomaly(
        anomalies,
        { county },
        "ERROR",
        "MISSING_COUNTY",
        `No settlements were found for ${county}.`,
      );
    }
  }

  const populations = locations
    .map((location) => location.population)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  const totalPopulation = populations.reduce(
    (sum, value) => sum + value,
    0,
  );

  const medianPopulation =
    populations.length === 0
      ? null
      : populations.length % 2 === 1
        ? populations[Math.floor(populations.length / 2)]
        : Math.round(
            (populations[populations.length / 2 - 1] +
              populations[populations.length / 2]) /
              2,
          );

  const largestSettlements = [...locations]
    .sort(
      (a, b) =>
        (b.population ?? -1) - (a.population ?? -1),
    )
    .slice(0, 20)
    .map((location) => ({
      name: location.displayName,
      county: location.county,
      type: location.type,
      population: location.population,
      slug: location.slug,
    }));

  const errors = anomalies.filter(
    (item) => item.severity === "ERROR",
  );
  const warnings = anomalies.filter(
    (item) => item.severity === "WARNING",
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    sourceFile: inputFile,
    status: errors.length === 0 ? "PASS" : "FAIL",
    totals: {
      locations: locations.length,
      counties: countyCounts.size,
      cities: typeCounts.get("CITY") ?? 0,
      towns: typeCounts.get("TOWN") ?? 0,
      indexable: locations.filter(
        (location) => location.indexable,
      ).length,
      popular: locations.filter(
        (location) => location.isPopular,
      ).length,
      errors: errors.length,
      warnings: warnings.length,
    },
    population: {
      recordsWithPopulation: populations.length,
      total: totalPopulation,
      minimum: populations[0] ?? null,
      median: medianPopulation,
      maximum:
        populations[populations.length - 1] ?? null,
    },
    counties: Object.fromEntries(
      [...countyCounts.entries()].sort(([a], [b]) =>
        a.localeCompare(b, "en-IE"),
      ),
    ),
    largestSettlements,
    anomaliesByCategory: Object.fromEntries(
      [...new Set(anomalies.map((item) => item.category))]
        .sort()
        .map((category) => [
          category,
          anomalies.filter(
            (item) => item.category === category,
          ).length,
        ]),
    ),
  };

  await mkdir(outputDirectory, { recursive: true });

  await writeFile(
    summaryFile,
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  const csvHeader =
    "severity,category,slug,name,county,details";

  const csvRows =
    anomalies.length === 0
      ? [
          [
            "INFO",
            "NO_ANOMALIES",
            "",
            "",
            "",
            "No anomalies found",
          ]
            .map(csvEscape)
            .join(","),
        ]
      : anomalies.map((item) =>
          [
            item.severity,
            item.category,
            item.slug,
            item.name,
            item.county,
            item.details,
          ]
            .map(csvEscape)
            .join(","),
        );

  await writeFile(
    anomaliesFile,
    [csvHeader, ...csvRows].join("\n"),
    "utf8",
  );

  console.log("");
  console.log("HAVN Geography Verification Report");
  console.log("==================================");
  console.log(`Status: ${summary.status}`);
  console.log(`Locations: ${summary.totals.locations}`);
  console.log(`Counties: ${summary.totals.counties}`);
  console.log(`Cities: ${summary.totals.cities}`);
  console.log(`Towns/settlements: ${summary.totals.towns}`);
  console.log(`Indexable: ${summary.totals.indexable}`);
  console.log(`Popular: ${summary.totals.popular}`);
  console.log(`Errors: ${summary.totals.errors}`);
  console.log(`Warnings: ${summary.totals.warnings}`);

  console.log("");
  console.log("Population");
  console.log("----------");
  console.log(
    `Records with population: ${summary.population.recordsWithPopulation}`,
  );
  console.log(
    `Combined population: ${summary.population.total}`,
  );
  console.log(
    `Median settlement population: ${summary.population.median}`,
  );
  console.log(
    `Largest settlement population: ${summary.population.maximum}`,
  );

  console.log("");
  console.log("Largest 20 settlements");
  console.log("----------------------");
  console.table(largestSettlements);

  console.log("");
  console.log(`Summary saved to: ${summaryFile}`);
  console.log(`Anomalies saved to: ${anomaliesFile}`);

  if (errors.length > 0) {
    console.log("");
    console.log(
      "Verification failed. Do not import this dataset into the database yet.",
    );
    process.exitCode = 1;
  } else {
    console.log("");
    console.log(
      "Verification passed. The dataset is ready for database-import planning.",
    );
  }
}

main().catch((error: unknown) => {
  console.error("HAVN geography verification failed:", error);
  process.exitCode = 1;
});
