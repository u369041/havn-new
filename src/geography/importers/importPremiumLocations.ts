import { LocationType } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import {
  havnPremiumLocations,
  type HavnPremiumLocationSeed
} from "../data/havnPremiumLocations";

const writeMode = process.argv.includes("--write");

function mergeUnique(existing: string[], incoming: string[]): string[] {
  return Array.from(
    new Set(
      [...existing, ...incoming]
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

async function findCountyParentId(county: string): Promise<number> {
  const parent = await prisma.location.findFirst({
    where: {
      type: LocationType.COUNTY,
      OR: [
        { canonicalName: county },
        { name: county },
        { county }
      ]
    },
    select: {
      id: true
    }
  });

  if (!parent) {
    throw new Error(`County parent not found for "${county}".`);
  }

  return parent.id;
}

async function inspectSeed(seed: HavnPremiumLocationSeed) {
  const existing = await prisma.location.findUnique({
    where: {
      slug: seed.updateExistingSlug ?? seed.slug
    },
    select: {
      id: true,
      slug: true,
      aliases: true,
      searchTerms: true
    }
  });

  return {
    seed,
    existing,
    action: existing ? "UPDATE" : "CREATE"
  } as const;
}

async function main(): Promise<void> {
  console.log("HAVN Premium Geography Importer");
  console.log("===============================");
  console.log(`Mode: ${writeMode ? "WRITE" : "DRY_RUN"}`);
  console.log("");

  const inspected = [];

  for (const seed of havnPremiumLocations) {
    inspected.push(await inspectSeed(seed));
  }

  const creates = inspected.filter((item) => item.action === "CREATE");
  const updates = inspected.filter((item) => item.action === "UPDATE");

  console.log(`Records in dataset: ${inspected.length}`);
  console.log(`Would create: ${creates.length}`);
  console.log(`Would update: ${updates.length}`);
  console.log("");

  for (const item of inspected) {
    console.log(
      `[${item.action}] ${item.seed.displayName} -> ${item.seed.slug}`
    );
  }

  if (!writeMode) {
    console.log("");
    console.log("DRY RUN ONLY - no locations were changed.");
    return;
  }

  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const item of inspected) {
    const { seed, existing } = item;

    try {
      const parentId = await findCountyParentId(seed.county);

      if (existing) {
        await prisma.location.update({
          where: {
            id: existing.id
          },
          data: {
            aliases: mergeUnique(existing.aliases, seed.aliases),
            searchTerms: mergeUnique(
              existing.searchTerms,
              seed.searchTerms
            ),
            searchable: true,
            isActive: true,
            indexable: seed.indexable,
            isPopular: seed.isPopular,
            seoPriority: seed.seoPriority,
            displayOrder: seed.displayOrder,
            parentId
          }
        });

        updated += 1;
        continue;
      }

      await prisma.location.create({
        data: {
          slug: seed.slug,
          name: seed.name,
          canonicalName: seed.canonicalName,
          displayName: seed.displayName,
          type: seed.type as LocationType,
          county: seed.county,
          parentId,
          aliases: seed.aliases,
          searchTerms: seed.searchTerms,
          searchable: true,
          indexable: seed.indexable,
          isPopular: seed.isPopular,
          isActive: true,
          seoPriority: seed.seoPriority,
          displayOrder: seed.displayOrder,
          sourceData: {
            source: "HAVN_PREMIUM_GEOGRAPHY",
            version: "wave-1a",
            curated: true
          }
        }
      });

      created += 1;
    } catch (error: unknown) {
      failed += 1;
      console.error(
        `Failed for ${seed.displayName}:`,
        error
      );
    }
  }

  console.log("");
  console.log("HAVN premium geography import completed.");
  console.log(`Created: ${created}`);
  console.log(`Updated: ${updated}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error("Premium geography importer failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
