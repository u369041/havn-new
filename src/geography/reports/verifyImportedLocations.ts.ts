import { LocationType } from "@prisma/client";

import { prisma } from "../../lib/prisma";

type Check = {
  label: string;
  actual: number;
  expected: number;
};

function status(actual: number, expected: number): string {
  return actual === expected ? "PASS" : "FAIL";
}

async function main(): Promise<void> {
  console.log("HAVN Geography Database Verification");
  console.log("====================================");

  const [
    countryCount,
    countyCount,
    cityCount,
    townCount,
    settlementCount,
    totalLocationCount,
    indexableSettlementCount,
    popularSettlementCount,
    missingParentCount,
    missingCoordinateCount,
    populationAggregate,
    duplicateSlugGroups,
  ] = await Promise.all([
    prisma.location.count({
      where: { type: LocationType.COUNTRY },
    }),
    prisma.location.count({
      where: { type: LocationType.COUNTY },
    }),
    prisma.location.count({
      where: { type: LocationType.CITY },
    }),
    prisma.location.count({
      where: { type: LocationType.TOWN },
    }),
    prisma.location.count({
      where: {
        type: {
          in: [LocationType.CITY, LocationType.TOWN],
        },
      },
    }),
    prisma.location.count(),
    prisma.location.count({
      where: {
        type: {
          in: [LocationType.CITY, LocationType.TOWN],
        },
        indexable: true,
      },
    }),
    prisma.location.count({
      where: {
        type: {
          in: [LocationType.CITY, LocationType.TOWN],
        },
        isPopular: true,
      },
    }),
    prisma.location.count({
      where: {
        type: {
          in: [LocationType.CITY, LocationType.TOWN],
        },
        OR: [
          { parentId: null },
          {
            parent: {
              is: {
                type: {
                  not: LocationType.COUNTY,
                },
              },
            },
          },
        ],
      },
    }),
    prisma.location.count({
      where: {
        type: {
          in: [LocationType.CITY, LocationType.TOWN],
        },
        OR: [{ latitude: null }, { longitude: null }],
      },
    }),
    prisma.location.aggregate({
      where: {
        type: {
          in: [LocationType.CITY, LocationType.TOWN],
        },
      },
      _sum: {
        population: true,
      },
    }),
    prisma.location.groupBy({
      by: ["slug"],
      _count: {
        slug: true,
      },
      having: {
        slug: {
          _count: {
            gt: 1,
          },
        },
      },
    }),
  ]);

  const populationTotal = populationAggregate._sum.population ?? 0;
  const duplicateSlugCount = duplicateSlugGroups.length;

  const checks: Check[] = [
    { label: "Countries", actual: countryCount, expected: 1 },
    { label: "Counties", actual: countyCount, expected: 26 },
    { label: "Cities", actual: cityCount, expected: 5 },
    { label: "Towns / settlements", actual: townCount, expected: 862 },
    { label: "CSO settlements total", actual: settlementCount, expected: 867 },
    { label: "All Location records", actual: totalLocationCount, expected: 894 },
    {
      label: "Indexable settlements",
      actual: indexableSettlementCount,
      expected: 218,
    },
    {
      label: "Popular settlements",
      actual: popularSettlementCount,
      expected: 25,
    },
    {
      label: "Missing/invalid county parents",
      actual: missingParentCount,
      expected: 0,
    },
    {
      label: "Missing coordinates",
      actual: missingCoordinateCount,
      expected: 0,
    },
    {
      label: "Duplicate slug groups",
      actual: duplicateSlugCount,
      expected: 0,
    },
    {
      label: "Combined settlement population",
      actual: populationTotal,
      expected: 3_630_501,
    },
  ];

  console.log("");

  for (const check of checks) {
    console.log(
      `${check.label.padEnd(31)} ${String(check.actual).padStart(10)} / ${String(
        check.expected,
      ).padStart(10)}  ${status(check.actual, check.expected)}`,
    );
  }

  const failedChecks = checks.filter(
    (check) => check.actual !== check.expected,
  );

  console.log("");

  if (failedChecks.length === 0) {
    console.log("DATABASE VERIFICATION PASSED");
    return;
  }

  console.error("DATABASE VERIFICATION FAILED");
  console.error("");

  for (const check of failedChecks) {
    console.error(
      `- ${check.label}: expected ${check.expected}, received ${check.actual}`,
    );
  }

  process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error("HAVN geography database verification failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });