import { LocationType } from "@prisma/client";

import { prisma } from "../../lib/prisma";

type MatchMethod =
  | "ALREADY_LINKED"
  | "EXACT_NAME"
  | "ALIAS_OR_SEARCH_TERM"
  | "DUBLIN_POSTAL_DISTRICT"
  | "FUZZY_NAME"
  | "COORDINATE_NEAREST"
  | "UNMATCHED";

type LocationCandidate = {
  id: number;
  slug: string;
  canonicalName: string;
  displayName: string;
  county: string | null;
  latitude: number | null;
  longitude: number | null;
  aliases: string[];
  searchTerms: string[];
};

type PropertyRecord = {
  id: number;
  slug: string;
  title: string;
  address1: string;
  address2: string | null;
  city: string;
  county: string;
  lat: number | null;
  lng: number | null;
  locationId: number | null;
};

type MatchResult = {
  property: PropertyRecord;
  method: MatchMethod;
  location: LocationCandidate | null;
  distanceKm: number | null;
  reason: string;
};

const writeMode = process.argv.includes("--write");

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-IE")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCounty(value: string | null | undefined): string {
  return normalize(value)
    .replace(/^co\s+/, "")
    .replace(/^county\s+/, "")
    .replace(/\s+county$/, "")
    .trim();
}

function normalizePlace(value: string | null | undefined): string {
  return normalize(value)
    .replace(/\s+city$/, "")
    .trim();
}

function sameCounty(
  propertyCounty: string,
  locationCounty: string | null,
): boolean {
  return normalizeCounty(propertyCounty) === normalizeCounty(locationCounty);
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number): number =>
    (degrees * Math.PI) / 180;

  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = Array.from(
    { length: a.length + 1 },
    () => Array<number>(b.length + 1).fill(0),
  );

  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function uniqueCandidate(
  candidates: LocationCandidate[],
): LocationCandidate | null {
  return candidates.length === 1 ? candidates[0] : null;
}

function findDublinCity(
  locations: LocationCandidate[],
): LocationCandidate | null {
  const matches = locations.filter(
    (location) =>
      normalizePlace(location.canonicalName) === "dublin" ||
      normalizePlace(location.displayName) === "dublin",
  );

  return uniqueCandidate(matches);
}

function isDublinPostalDistrict(city: string): boolean {
  const normalized = normalize(city);

  return /^dublin\s+\d{1,2}[a-z]?$/.test(normalized);
}

function matchProperty(
  property: PropertyRecord,
  locations: LocationCandidate[],
): MatchResult {
  if (property.locationId !== null) {
    const linked =
      locations.find(
        (location) => location.id === property.locationId,
      ) ?? null;

    return {
      property,
      method: "ALREADY_LINKED",
      location: linked,
      distanceKm: null,
      reason: linked
        ? "Property already has a valid locationId."
        : "Property has a locationId that was not found in the candidate set.",
    };
  }

  const countyLocations = locations.filter((location) =>
    sameCounty(property.county, location.county),
  );

  const normalizedCity = normalizePlace(property.city);

  if (
    normalizeCounty(property.county) === "dublin" &&
    isDublinPostalDistrict(property.city)
  ) {
    const dublin = findDublinCity(countyLocations);

    if (dublin) {
      return {
        property,
        method: "DUBLIN_POSTAL_DISTRICT",
        location: dublin,
        distanceKm: null,
        reason: `Recognised "${property.city}" as a Dublin postal district.`,
      };
    }
  }

  if (normalizedCity) {
    const exactMatches = countyLocations.filter((location) => {
      return (
        normalizePlace(location.canonicalName) === normalizedCity ||
        normalizePlace(location.displayName) === normalizedCity
      );
    });

    const exact = uniqueCandidate(exactMatches);

    if (exact) {
      return {
        property,
        method: "EXACT_NAME",
        location: exact,
        distanceKm: null,
        reason: `Exact place-name match within county "${property.county}".`,
      };
    }

    const aliasMatches = countyLocations.filter((location) => {
      const searchableValues = [
        ...location.aliases,
        ...location.searchTerms,
      ].map(normalizePlace);

      return searchableValues.includes(normalizedCity);
    });

    const alias = uniqueCandidate(aliasMatches);

    if (alias) {
      return {
        property,
        method: "ALIAS_OR_SEARCH_TERM",
        location: alias,
        distanceKm: null,
        reason: `Alias/search-term match within county "${property.county}".`,
      };
    }

    const fuzzyMatches = countyLocations.filter((location) => {
      const candidateNames = [
        location.canonicalName,
        location.displayName,
        ...location.aliases,
      ].map(normalizePlace);

      return candidateNames.some((candidateName) => {
        if (!candidateName) return false;

        const maxDistance =
          Math.max(candidateName.length, normalizedCity.length) <= 8
            ? 1
            : 2;

        return levenshtein(candidateName, normalizedCity) <= maxDistance;
      });
    });

    const fuzzy = uniqueCandidate(fuzzyMatches);

    if (fuzzy) {
      return {
        property,
        method: "FUZZY_NAME",
        location: fuzzy,
        distanceKm: null,
        reason: `Unique close spelling match for "${property.city}" within county "${property.county}".`,
      };
    }
  }

  if (
    property.lat !== null &&
    property.lng !== null &&
    countyLocations.length > 0
  ) {
    const coordinateCandidates = countyLocations
      .filter(
        (location) =>
          location.latitude !== null &&
          location.longitude !== null,
      )
      .map((location) => ({
        location,
        distanceKm: haversineKm(
          property.lat as number,
          property.lng as number,
          location.latitude as number,
          location.longitude as number,
        ),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm);

    const nearest = coordinateCandidates[0];
    const secondNearest = coordinateCandidates[1];

    if (
      nearest &&
      nearest.distanceKm <= 12 &&
      (!secondNearest ||
        secondNearest.distanceKm - nearest.distanceKm >= 1)
    ) {
      return {
        property,
        method: "COORDINATE_NEAREST",
        location: nearest.location,
        distanceKm: nearest.distanceKm,
        reason:
          "Nearest canonical location in the same county is within 12 km and clearly closer than the next candidate.",
      };
    }
  }

  return {
    property,
    method: "UNMATCHED",
    location: null,
    distanceKm: null,
    reason:
      "No unique high-confidence match was found. Manual review required.",
  };
}

async function main(): Promise<void> {
  console.log("HAVN Property Location Matcher");
  console.log("==============================");
  console.log(`Mode: ${writeMode ? "WRITE" : "DRY_RUN"}`);
  console.log("");

  const [properties, locations] = await Promise.all([
    prisma.property.findMany({
      orderBy: {
        id: "asc",
      },
      select: {
        id: true,
        slug: true,
        title: true,
        address1: true,
        address2: true,
        city: true,
        county: true,
        lat: true,
        lng: true,
        locationId: true,
      },
    }),
    prisma.location.findMany({
      where: {
        type: {
          in: [
            LocationType.CITY,
            LocationType.TOWN,
            LocationType.VILLAGE,
            LocationType.SUBURB,
            LocationType.NEIGHBOURHOOD,
            LocationType.LOCALITY,
          ],
        },
        isActive: true,
        searchable: true,
      },
      select: {
        id: true,
        slug: true,
        canonicalName: true,
        displayName: true,
        county: true,
        latitude: true,
        longitude: true,
        aliases: true,
        searchTerms: true,
      },
    }),
  ]);

  const results = properties.map((property) =>
    matchProperty(property, locations),
  );

  const counts = {
    total: results.length,
    alreadyLinked: results.filter(
      (result) => result.method === "ALREADY_LINKED",
    ).length,
    exact: results.filter(
      (result) => result.method === "EXACT_NAME",
    ).length,
    alias: results.filter(
      (result) =>
        result.method === "ALIAS_OR_SEARCH_TERM",
    ).length,
    dublinPostal: results.filter(
      (result) =>
        result.method === "DUBLIN_POSTAL_DISTRICT",
    ).length,
    fuzzy: results.filter(
      (result) => result.method === "FUZZY_NAME",
    ).length,
    coordinate: results.filter(
      (result) =>
        result.method === "COORDINATE_NEAREST",
    ).length,
    unmatched: results.filter(
      (result) => result.method === "UNMATCHED",
    ).length,
  };

  console.log(`Properties found: ${counts.total}`);
  console.log(`Already linked: ${counts.alreadyLinked}`);
  console.log(`Exact matches: ${counts.exact}`);
  console.log(`Alias/search-term matches: ${counts.alias}`);
  console.log(`Dublin postal-district matches: ${counts.dublinPostal}`);
  console.log(`Fuzzy-name matches: ${counts.fuzzy}`);
  console.log(`Coordinate matches: ${counts.coordinate}`);
  console.log(`Manual review required: ${counts.unmatched}`);
  console.log("");

  for (const result of results) {
    const target = result.location
      ? `${result.location.displayName} (${result.location.slug}, id ${result.location.id})`
      : "NO MATCH";

    const distance =
      result.distanceKm === null
        ? ""
        : `, ${result.distanceKm.toFixed(2)} km`;

    console.log(
      `[${result.method}] Property ${result.property.id} "${result.property.title}"`,
    );
    console.log(
      `  Current: ${result.property.city}, ${result.property.county}`,
    );
    console.log(`  Target: ${target}${distance}`);
    console.log(`  Reason: ${result.reason}`);
  }

  if (!writeMode) {
    console.log("");
    console.log("DRY RUN ONLY - no properties were updated.");
    return;
  }

  const writeableResults = results.filter(
    (result) =>
      result.location !== null &&
      result.method !== "ALREADY_LINKED" &&
      result.method !== "UNMATCHED",
  );

  console.log("");
  console.log(
    `Writing ${writeableResults.length} property-location links...`,
  );

  let updated = 0;
  let failed = 0;

  for (const result of writeableResults) {
    try {
      await prisma.property.update({
        where: {
          id: result.property.id,
        },
        data: {
          locationId: result.location!.id,
        },
      });

      updated += 1;
    } catch (error: unknown) {
      failed += 1;
      console.error(
        `Failed to update property ${result.property.id}:`,
        error,
      );
    }
  }

  console.log("");
  console.log("HAVN property location matching completed.");
  console.log(`Updated: ${updated}`);
  console.log(`Unmatched: ${counts.unmatched}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error("HAVN property location matcher failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
