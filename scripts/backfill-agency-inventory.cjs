require("dotenv").config();

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;

function cleanString(value) {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();

  return text || null;
}

function positiveIntOrNull(value) {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);

  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function finiteFloatOrNull(value) {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

function transactionTypeForProperty(property) {
  const mode = String(property.mode || "")
    .trim()
    .toUpperCase();

  return mode === "RENT" || mode === "SHARE"
    ? "RENTAL"
    : "SALE";
}

function inventoryStageForProperty(property) {
  const status = String(property.listingStatus || "")
    .trim()
    .toUpperCase();

  switch (status) {
    case "PUBLISHED":
      return "LIVE";

    case "SUBMITTED":
      return "READY_TO_LIST";

    case "DRAFT":
      return "PREPARING";

    case "REJECTED":
    case "CLOSED":
    case "ARCHIVED":
      return "WITHDRAWN";

    default:
      return "PREPARING";
  }
}

function liveAtForProperty(property) {
  if (
    String(property.listingStatus || "").toUpperCase() === "PUBLISHED"
  ) {
    return property.publishedAt || property.updatedAt || null;
  }

  return null;
}

function readyToListAtForProperty(property) {
  const status = String(property.listingStatus || "")
    .trim()
    .toUpperCase();

  if (status === "SUBMITTED" || status === "PUBLISHED") {
    return property.submittedAt || property.createdAt || null;
  }

  return null;
}

function inventorySnapshot(item) {
  return {
    id: item.id,
    agencyId: item.agencyId,
    address1: item.address1,
    address2: item.address2,
    city: item.city,
    county: item.county,
    eircode: item.eircode,
    propertyType: item.propertyType,
    bedrooms: item.bedrooms,
    bathrooms: item.bathrooms,
    size: item.size,
    sizeUnit: item.sizeUnit,
    transactionType: item.transactionType,
    stage: item.stage,
    askingPrice: item.askingPrice,
    valuationPrice: item.valuationPrice,
    assignedMemberId: item.assignedMemberId,
    primaryContactId: item.primaryContactId,
    notes: item.notes,
    appraisalDate: item.appraisalDate,
    instructionDate: item.instructionDate,
    readyToListAt: item.readyToListAt,
    liveAt: item.liveAt,
    saleAgreedDate: item.saleAgreedDate,
    letAgreedDate: item.letAgreedDate,
    completedAt: item.completedAt,
    withdrawnAt: item.withdrawnAt,
    lostAt: item.lostAt,
    createdByUserId: item.createdByUserId,
    updatedByUserId: item.updatedByUserId,
    archivedAt: item.archivedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function describeProperty(property) {
  const address = [
    property.address1,
    property.address2,
    property.city,
    property.county,
    property.eircode,
  ]
    .map((value) => cleanString(value))
    .filter(Boolean)
    .join(", ");

  return `${property.id} | ${property.title || "Untitled listing"} | ${
    address || "No address"
  }`;
}

async function resolveSingleActiveMembership(userId) {
  const memberships = await prisma.agencyMember.findMany({
    where: {
      userId,
      status: "ACTIVE",
      agency: {
        status: "ACTIVE",
      },
    },
    orderBy: [
      { isPrimary: "desc" },
      { joinedAt: "asc" },
      { id: "asc" },
    ],
    take: 2,
    select: {
      id: true,
      agencyId: true,
      userId: true,
      role: true,
      status: true,
      isPrimary: true,
      agency: {
        select: {
          id: true,
          name: true,
          status: true,
        },
      },
    },
  });

  if (memberships.length === 0) {
    return {
      ok: false,
      reason: "NO_ACTIVE_AGENCY_MEMBERSHIP",
      membership: null,
    };
  }

  if (memberships.length > 1) {
    return {
      ok: false,
      reason: "MULTIPLE_ACTIVE_AGENCY_MEMBERSHIPS",
      membership: null,
    };
  }

  return {
    ok: true,
    reason: null,
    membership: memberships[0],
  };
}

async function main() {
  console.log("");
  console.log("HAVN agency inventory backfill");
  console.log("==============================");
  console.log(
    DRY_RUN
      ? "MODE: DRY RUN - no database changes will be made"
      : "MODE: APPLY - database changes WILL be made"
  );
  console.log("");

  const properties = await prisma.property.findMany({
    where: {
      inventoryPropertyId: null,
    },
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
      eircode: true,

      propertyType: true,
      bedrooms: true,
      bathrooms: true,
      size: true,
      sizeUnit: true,

      mode: true,
      price: true,

      listingStatus: true,
      createdAt: true,
      updatedAt: true,
      submittedAt: true,
      publishedAt: true,

      userId: true,

      agencyId: true,
      inventoryPropertyId: true,
      createdByUserId: true,
      updatedByUserId: true,
    },
  });

  const summary = {
    inspected: properties.length,
    alreadyLinked: 0,
    eligible: 0,
    created: 0,
    skippedNoMembership: 0,
    skippedMultipleMemberships: 0,
    skippedAgencyConflict: 0,
    failed: 0,
  };

  console.log(`Unlinked properties found: ${properties.length}`);
  console.log("");

  for (const property of properties) {
    console.log("----------------------------------------");
    console.log(`Property: ${describeProperty(property)}`);

    if (property.inventoryPropertyId != null) {
      summary.alreadyLinked += 1;
      console.log(
        `SKIP: already linked to Inventory ${property.inventoryPropertyId}`
      );
      continue;
    }

    const membershipResult =
      await resolveSingleActiveMembership(property.userId);

    if (!membershipResult.ok) {
      if (
        membershipResult.reason ===
        "MULTIPLE_ACTIVE_AGENCY_MEMBERSHIPS"
      ) {
        summary.skippedMultipleMemberships += 1;
      } else {
        summary.skippedNoMembership += 1;
      }

      console.log(`SKIP: ${membershipResult.reason}`);
      continue;
    }

    const membership = membershipResult.membership;

    if (
      property.agencyId != null &&
      property.agencyId !== membership.agencyId
    ) {
      summary.skippedAgencyConflict += 1;

      console.log(
        `SKIP: property agencyId ${property.agencyId} conflicts with active membership agencyId ${membership.agencyId}`
      );

      continue;
    }

    summary.eligible += 1;

    const transactionType =
      transactionTypeForProperty(property);

    const stage =
      inventoryStageForProperty(property);

    const createData = {
      agencyId: membership.agencyId,

      address1:
        cleanString(property.address1) ||
        cleanString(property.title) ||
        `Legacy HAVN Property ${property.id}`,

      address2: cleanString(property.address2),

      city:
        cleanString(property.city) ||
        "Unknown",

      county:
        cleanString(property.county) ||
        "Unknown",

      eircode: cleanString(property.eircode),

      propertyType:
        cleanString(property.propertyType),

      bedrooms:
        positiveIntOrNull(property.bedrooms),

      bathrooms:
        positiveIntOrNull(property.bathrooms),

      size:
        finiteFloatOrNull(property.size),

      sizeUnit:
        cleanString(property.sizeUnit),

      transactionType,
      stage,

      askingPrice:
        positiveIntOrNull(property.price),

      valuationPrice: null,

      assignedMemberId:
        membership.id,

      primaryContactId: null,

      notes:
        `Automatically backfilled from legacy HAVN listing #${property.id}.`,

      appraisalDate: null,
      instructionDate: null,

      readyToListAt:
        readyToListAtForProperty(property),

      liveAt:
        liveAtForProperty(property),

      saleAgreedDate: null,
      letAgreedDate: null,
      completedAt: null,

      withdrawnAt:
        stage === "WITHDRAWN"
          ? property.updatedAt || new Date()
          : null,

      lostAt: null,

      createdByUserId:
        property.createdByUserId ||
        property.userId,

      updatedByUserId:
        property.updatedByUserId ||
        property.userId,
    };

    console.log(
      `Eligible: Agency ${membership.agencyId} (${membership.agency.name})`
    );
    console.log(
      `Assigned member: ${membership.id} | User ${membership.userId} | ${membership.role}`
    );
    console.log(
      `Inventory mapping: ${transactionType} / ${stage}`
    );

    if (DRY_RUN) {
      console.log(
        `DRY RUN: would create Inventory record and link Property ${property.id}`
      );
      continue;
    }

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          /*
           * Re-read inside the transaction.
           * This protects against the record becoming linked
           * between our initial scan and the write.
           */
          const freshProperty =
            await tx.property.findUnique({
              where: {
                id: property.id,
              },
              select: {
                id: true,
                userId: true,
                agencyId: true,
                inventoryPropertyId: true,
                createdByUserId: true,
                updatedByUserId: true,
              },
            });

          if (!freshProperty) {
            throw new Error(
              `Property ${property.id} disappeared before backfill`
            );
          }

          if (
            freshProperty.inventoryPropertyId != null
          ) {
            return {
              skipped: true,
              reason: "ALREADY_LINKED_DURING_RUN",
              inventoryId:
                freshProperty.inventoryPropertyId,
            };
          }

          if (
            freshProperty.agencyId != null &&
            freshProperty.agencyId !== membership.agencyId
          ) {
            throw new Error(
              `Property ${property.id} changed agency during backfill`
            );
          }

          const inventory =
            await tx.inventoryProperty.create({
              data: createData,
            });

          const updatedProperty =
            await tx.property.update({
              where: {
                id: property.id,
              },
              data: {
                agencyId:
                  membership.agencyId,

                inventoryPropertyId:
                  inventory.id,

                createdByUserId:
                  freshProperty.createdByUserId ||
                  freshProperty.userId,

                updatedByUserId:
                  freshProperty.updatedByUserId ||
                  freshProperty.userId,
              },
              select: {
                id: true,
                slug: true,
                title: true,
                listingStatus: true,
                agencyId: true,
                inventoryPropertyId: true,
                createdByUserId: true,
                updatedByUserId: true,
                updatedAt: true,
              },
            });

          await tx.agencyAuditLog.create({
            data: {
              agencyId:
                membership.agencyId,

              actorUserId:
                membership.userId,

              actorAgencyMemberId:
                membership.id,

              effectiveUserId:
                membership.userId,

              action:
                "INVENTORY_BACKFILLED_FROM_LISTING",

              entityType:
                "InventoryProperty",

              entityId:
                String(inventory.id),

              beforeState: null,

              afterState:
                inventorySnapshot(inventory),

              changedFields: [
                "InventoryProperty.created",
                "Property.agencyId",
                "Property.inventoryPropertyId",
              ],

              metadata: {
                source:
                  "backfill-agency-inventory",

                propertyId:
                  updatedProperty.id,

                propertySlug:
                  updatedProperty.slug,

                listingStatus:
                  updatedProperty.listingStatus,

                legacyPropertyOwnerUserId:
                  property.userId,
              },
            },
          });

          return {
            skipped: false,
            inventoryId:
              inventory.id,
            property:
              updatedProperty,
          };
        }
      );

      if (result.skipped) {
        console.log(
          `SKIP: ${result.reason} - Inventory ${result.inventoryId}`
        );
        continue;
      }

      summary.created += 1;

      console.log(
        `CREATED: Inventory ${result.inventoryId} linked to Property ${property.id}`
      );
    } catch (error) {
      summary.failed += 1;

      console.error(
        `FAILED: Property ${property.id}`,
        error?.message || error
      );
    }
  }

  console.log("");
  console.log("========================================");
  console.log("BACKFILL SUMMARY");
  console.log("========================================");
  console.log(
    `Properties inspected:                ${summary.inspected}`
  );
  console.log(
    `Eligible for backfill:               ${summary.eligible}`
  );
  console.log(
    `Inventory records created:           ${summary.created}`
  );
  console.log(
    `Skipped - no active membership:      ${summary.skippedNoMembership}`
  );
  console.log(
    `Skipped - multiple memberships:      ${summary.skippedMultipleMemberships}`
  );
  console.log(
    `Skipped - agency conflict:           ${summary.skippedAgencyConflict}`
  );
  console.log(
    `Failures:                            ${summary.failed}`
  );

  if (DRY_RUN) {
    console.log("");
    console.log(
      "DRY RUN COMPLETE - the database was not changed."
    );
    console.log(
      "Run again with --apply only after reviewing this output."
    );
  } else {
    console.log("");
    console.log("BACKFILL APPLY COMPLETE.");
  }
}

main()
  .catch((error) => {
    console.error("");
    console.error("HAVN agency inventory backfill FAILED.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });