import { Router, Request } from "express";
import {
  InventoryStage,
  InventoryTransactionType,
  Prisma,
} from "@prisma/client";

import { prisma } from "../lib/prisma";
import requireActiveAgent from "../middleware/requireActiveAgent";
import {
  AgencyAccessError,
  AgencyWorkspace,
  assertAgencyPermission,
  canEditInventoryRecord,
  requireAgencyWorkspace,
} from "../services/agencyAccess";

const router = Router();

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

router.use(requireActiveAgent);

type AgentRequest = Request & {
  agentAccess?: {
    userId?: number;
    agentProfileId?: number;
    role?: string;
    companyName?: string;
    isSuperAdmin?: boolean;
  };
};

const INVENTORY_STAGES = new Set<string>(Object.values(InventoryStage));
const TRANSACTION_TYPES = new Set<string>(
  Object.values(InventoryTransactionType)
);

const inventoryInclude = {
  assignedMember: {
    select: {
      id: true,
      userId: true,
      role: true,
      status: true,
      jobTitle: true,
      isPrimary: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  },
  primaryContact: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyName: true,
      primaryEmail: true,
      phoneNumber: true,
      roles: true,
      isArchived: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  updatedBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  listings: {
    select: {
      id: true,
      slug: true,
      title: true,
      listingStatus: true,
      mode: true,
      price: true,
      isFeatured: true,
      publishedAt: true,
      updatedAt: true,
    },
    orderBy: {
      updatedAt: "desc" as const,
    },
  },
} satisfies Prisma.InventoryPropertyInclude;

function asPositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function nullableString(value: unknown, maxLength = 500): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function requiredString(
  value: unknown,
  field: string,
  maxLength = 500
): string {
  const text = nullableString(value, maxLength);
  if (!text) {
    throw new ApiError("VALIDATION_ERROR", `${field} is required`, 400);
  }
  return text;
}

function nullableInt(value: unknown, field: string): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new ApiError("VALIDATION_ERROR", `${field} must be an integer`, 400);
  }
  return n;
}

function nullableFloat(value: unknown, field: string): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new ApiError("VALIDATION_ERROR", `${field} must be a number`, 400);
  }
  return n;
}

function nullableDate(value: unknown, field: string): Date | null {
  if (value == null || value === "") return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    throw new ApiError("VALIDATION_ERROR", `${field} must be a valid date`, 400);
  }
  return d;
}

function requestMeta(req: Request) {
  return {
    ipAddress: req.ip || null,
    userAgent: nullableString(req.get("user-agent"), 1000),
    requestId:
      nullableString(req.get("x-request-id"), 200) ||
      nullableString(req.get("x-correlation-id"), 200),
  };
}

function inventorySnapshot(item: any) {
  if (!item) return null;
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

function changedFields(before: any, after: any): string[] {
  const a = inventorySnapshot(before) || {};
  const b = inventorySnapshot(after) || {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);

  return [...keys].filter((key) => {
    const left = (a as any)[key];
    const right = (b as any)[key];
    return JSON.stringify(left) !== JSON.stringify(right);
  });
}

async function workspaceFor(req: AgentRequest): Promise<AgencyWorkspace> {
  const userId = asPositiveInt(req.agentAccess?.userId);
  if (!userId) {
    throw new ApiError(
      "AUTH_CONTEXT_INVALID",
      "Authenticated professional user could not be resolved",
      401
    );
  }
  return requireAgencyWorkspace(userId);
}

async function inventoryForAgency(
  id: number,
  agencyId: number,
  include = inventoryInclude
) {
  return prisma.inventoryProperty.findFirst({
    where: {
      id,
      agencyId,
    },
    include,
  });
}

function assertCanEdit(
  workspace: AgencyWorkspace,
  assignedMemberId: number | null | undefined
) {
  if (!canEditInventoryRecord(workspace, assignedMemberId)) {
    throw new AgencyAccessError(
      "AGENCY_PERMISSION_DENIED",
      "You do not have permission to edit this inventory record",
      403
    );
  }
}

async function assertAssignableMember(
  agencyId: number,
  memberId: number | null
) {
  if (memberId == null) return;

  const member = await prisma.agencyMember.findFirst({
    where: {
      id: memberId,
      agencyId,
      status: "ACTIVE",
    },
    select: {
      id: true,
    },
  });

  if (!member) {
    throw new ApiError(
      "INVALID_ASSIGNEE",
      "Assigned member must be an active member of this agency",
      400
    );
  }
}

async function assertPrimaryContact(
  agencyId: number,
  contactId: number | null
) {
  if (contactId == null) return;

  const contact = await prisma.professionalContact.findFirst({
    where: {
      id: contactId,
      agencyId,
      isArchived: false,
    },
    select: {
      id: true,
    },
  });

  if (!contact) {
    throw new ApiError(
      "INVALID_PRIMARY_CONTACT",
      "Primary contact must belong to this agency and be active",
      400
    );
  }
}

function parseStage(value: unknown): InventoryStage | undefined {
  if (value == null || value === "") return undefined;
  const stage = String(value).trim().toUpperCase();
  if (!INVENTORY_STAGES.has(stage)) {
    throw new ApiError("VALIDATION_ERROR", "Invalid inventory stage", 400);
  }
  return stage as InventoryStage;
}

function parseTransactionType(
  value: unknown
): InventoryTransactionType | undefined {
  if (value == null || value === "") return undefined;
  const type = String(value).trim().toUpperCase();
  if (!TRANSACTION_TYPES.has(type)) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Invalid inventory transaction type",
      400
    );
  }
  return type as InventoryTransactionType;
}

function mutableInventoryData(body: any) {
  const data: Prisma.InventoryPropertyUncheckedUpdateInput = {};

  if ("address1" in body) {
    data.address1 = requiredString(body.address1, "address1", 300);
  }
  if ("address2" in body) {
    data.address2 = nullableString(body.address2, 300);
  }
  if ("city" in body) {
    data.city = requiredString(body.city, "city", 200);
  }
  if ("county" in body) {
    data.county = requiredString(body.county, "county", 200);
  }
  if ("eircode" in body) {
    data.eircode = nullableString(body.eircode, 20);
  }
  if ("propertyType" in body) {
    data.propertyType = nullableString(body.propertyType, 100);
  }
  if ("bedrooms" in body) {
    data.bedrooms = nullableInt(body.bedrooms, "bedrooms");
  }
  if ("bathrooms" in body) {
    data.bathrooms = nullableInt(body.bathrooms, "bathrooms");
  }
  if ("size" in body) {
    data.size = nullableFloat(body.size, "size");
  }
  if ("sizeUnit" in body) {
    data.sizeUnit = nullableString(body.sizeUnit, 30);
  }

  const transactionType = parseTransactionType(body.transactionType);
  if (transactionType) data.transactionType = transactionType;

  const stage = parseStage(body.stage);
  if (stage) data.stage = stage;

  if ("askingPrice" in body) {
    data.askingPrice = nullableInt(body.askingPrice, "askingPrice");
  }
  if ("valuationPrice" in body) {
    data.valuationPrice = nullableInt(body.valuationPrice, "valuationPrice");
  }
  if ("primaryContactId" in body) {
    data.primaryContactId = asPositiveInt(body.primaryContactId);
  }
  if ("notes" in body) {
    data.notes = nullableString(body.notes, 10000);
  }

  const dateFields = [
    "appraisalDate",
    "instructionDate",
    "readyToListAt",
    "liveAt",
    "saleAgreedDate",
    "letAgreedDate",
    "completedAt",
    "withdrawnAt",
    "lostAt",
  ] as const;

  for (const field of dateFields) {
    if (field in body) {
      (data as any)[field] = nullableDate(body[field], field);
    }
  }

  return data;
}

router.get("/", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertAgencyPermission(workspace, "canViewAllInventory");

    const stage = parseStage(req.query.stage);
    const transactionType = parseTransactionType(req.query.transactionType);
    const assignedMemberId =
      req.query.assignedMemberId == null
        ? undefined
        : asPositiveInt(req.query.assignedMemberId);

    if (
      req.query.assignedMemberId != null &&
      assignedMemberId == null
    ) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "assignedMemberId must be a positive integer",
        400
      );
    }

    const includeArchived =
      String(req.query.includeArchived || "").toLowerCase() === "true";

    const q = nullableString(req.query.q, 200);

    const items = await prisma.inventoryProperty.findMany({
      where: {
        agencyId: workspace.agency.id,
        ...(includeArchived ? {} : { archivedAt: null }),
        ...(stage ? { stage } : {}),
        ...(transactionType ? { transactionType } : {}),
        ...(assignedMemberId ? { assignedMemberId } : {}),
        ...(q
          ? {
              OR: [
                { address1: { contains: q, mode: "insensitive" } },
                { address2: { contains: q, mode: "insensitive" } },
                { city: { contains: q, mode: "insensitive" } },
                { county: { contains: q, mode: "insensitive" } },
                { eircode: { contains: q, mode: "insensitive" } },
                { propertyType: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: inventoryInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 500,
    });

    return res.json({
      ok: true,
      agency: {
        id: workspace.agency.id,
        name: workspace.agency.name,
      },
      membership: {
        id: workspace.membership.id,
        role: workspace.membership.role,
      },
      permissions: workspace.permissions,
      items,
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.get("/:id/audit", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertAgencyPermission(workspace, "canViewAuditLog");

    const id = asPositiveInt(req.params.id);
    if (!id) {
      throw new ApiError("VALIDATION_ERROR", "Invalid inventory id", 400);
    }

    const item = await inventoryForAgency(id, workspace.agency.id);
    if (!item) {
      throw new ApiError("INVENTORY_NOT_FOUND", "Inventory record not found", 404);
    }

    const logs = await prisma.agencyAuditLog.findMany({
      where: {
        agencyId: workspace.agency.id,
        entityType: "InventoryProperty",
        entityId: String(id),
      },
      select: {
        id: true,
        actorUserId: true,
        actorAgencyMemberId: true,
        effectiveUserId: true,
        action: true,
        entityType: true,
        entityId: true,
        beforeState: true,
        afterState: true,
        changedFields: true,
        metadata: true,
        ipAddress: true,
        userAgent: true,
        requestId: true,
        createdAt: true,
        actorUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        actorAgencyMember: {
          select: {
            id: true,
            role: true,
            jobTitle: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 500,
    });

    return res.json({
      ok: true,
      itemId: id,
      items: logs.map((log) => ({
        ...log,
        id: log.id.toString(),
      })),
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.get("/:id", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertAgencyPermission(workspace, "canViewAllInventory");

    const id = asPositiveInt(req.params.id);
    if (!id) {
      throw new ApiError("VALIDATION_ERROR", "Invalid inventory id", 400);
    }

    const item = await inventoryForAgency(id, workspace.agency.id);
    if (!item) {
      throw new ApiError("INVENTORY_NOT_FOUND", "Inventory record not found", 404);
    }

    return res.json({
      ok: true,
      item,
      permissions: {
        ...workspace.permissions,
        canEditThisInventory: canEditInventoryRecord(
          workspace,
          item.assignedMemberId
        ),
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertAgencyPermission(workspace, "canCreateInventory");

    const userId = workspace.membership.userId;
    const body = req.body || {};

    const requestedAssignedMemberId =
      "assignedMemberId" in body
        ? asPositiveInt(body.assignedMemberId)
        : workspace.membership.id;

    if (
      "assignedMemberId" in body &&
      body.assignedMemberId != null &&
      body.assignedMemberId !== "" &&
      requestedAssignedMemberId == null
    ) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "assignedMemberId must be a positive integer or null",
        400
      );
    }

    if (
      requestedAssignedMemberId !== workspace.membership.id &&
      !workspace.permissions.canAssignInventory
    ) {
      throw new AgencyAccessError(
        "AGENCY_PERMISSION_DENIED",
        "You do not have permission to assign inventory to another member",
        403
      );
    }

    await assertAssignableMember(
      workspace.agency.id,
      requestedAssignedMemberId
    );

    const primaryContactId =
      "primaryContactId" in body
        ? asPositiveInt(body.primaryContactId)
        : null;

    if (
      "primaryContactId" in body &&
      body.primaryContactId != null &&
      body.primaryContactId !== "" &&
      primaryContactId == null
    ) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "primaryContactId must be a positive integer or null",
        400
      );
    }

    await assertPrimaryContact(workspace.agency.id, primaryContactId);

    const transactionType =
      parseTransactionType(body.transactionType) || "SALE";
    const stage = parseStage(body.stage) || "PROSPECT";

    const createData: Prisma.InventoryPropertyUncheckedCreateInput = {
      agencyId: workspace.agency.id,
      address1: requiredString(body.address1, "address1", 300),
      address2: nullableString(body.address2, 300),
      city: requiredString(body.city, "city", 200),
      county: requiredString(body.county, "county", 200),
      eircode: nullableString(body.eircode, 20),
      propertyType: nullableString(body.propertyType, 100),
      bedrooms: nullableInt(body.bedrooms, "bedrooms"),
      bathrooms: nullableInt(body.bathrooms, "bathrooms"),
      size: nullableFloat(body.size, "size"),
      sizeUnit: nullableString(body.sizeUnit, 30),
      transactionType,
      stage,
      askingPrice: nullableInt(body.askingPrice, "askingPrice"),
      valuationPrice: nullableInt(body.valuationPrice, "valuationPrice"),
      assignedMemberId: requestedAssignedMemberId,
      primaryContactId,
      notes: nullableString(body.notes, 10000),
      appraisalDate: nullableDate(body.appraisalDate, "appraisalDate"),
      instructionDate: nullableDate(body.instructionDate, "instructionDate"),
      readyToListAt: nullableDate(body.readyToListAt, "readyToListAt"),
      liveAt: nullableDate(body.liveAt, "liveAt"),
      saleAgreedDate: nullableDate(body.saleAgreedDate, "saleAgreedDate"),
      letAgreedDate: nullableDate(body.letAgreedDate, "letAgreedDate"),
      completedAt: nullableDate(body.completedAt, "completedAt"),
      withdrawnAt: nullableDate(body.withdrawnAt, "withdrawnAt"),
      lostAt: nullableDate(body.lostAt, "lostAt"),
      createdByUserId: userId,
      updatedByUserId: userId,
    };

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.inventoryProperty.create({
        data: createData,
        include: inventoryInclude,
      });

      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: userId,
          action: "INVENTORY_CREATED",
          entityType: "InventoryProperty",
          entityId: String(item.id),
          afterState: inventorySnapshot(item),
          changedFields: Object.keys(inventorySnapshot(item) || {}),
          metadata: {
            source: "agencyInventory",
          },
          ...requestMeta(req),
        },
      });

      return item;
    });

    return res.status(201).json({
      ok: true,
      item: result,
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.patch("/:id/assign", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertAgencyPermission(workspace, "canAssignInventory");

    const id = asPositiveInt(req.params.id);
    if (!id) {
      throw new ApiError("VALIDATION_ERROR", "Invalid inventory id", 400);
    }

    const before = await inventoryForAgency(id, workspace.agency.id);
    if (!before) {
      throw new ApiError("INVENTORY_NOT_FOUND", "Inventory record not found", 404);
    }

    const assignedMemberId =
      req.body?.assignedMemberId == null ||
      req.body?.assignedMemberId === ""
        ? null
        : asPositiveInt(req.body.assignedMemberId);

    if (
      req.body?.assignedMemberId != null &&
      req.body?.assignedMemberId !== "" &&
      assignedMemberId == null
    ) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "assignedMemberId must be a positive integer or null",
        400
      );
    }

    await assertAssignableMember(workspace.agency.id, assignedMemberId);

    const userId = workspace.membership.userId;

    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.inventoryProperty.update({
        where: { id },
        data: {
          assignedMemberId,
          updatedByUserId: userId,
        },
        include: inventoryInclude,
      });

      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: userId,
          action: "INVENTORY_ASSIGNED",
          entityType: "InventoryProperty",
          entityId: String(id),
          beforeState: inventorySnapshot(before),
          afterState: inventorySnapshot(updated),
          changedFields: changedFields(before, updated),
          metadata: {
            previousAssignedMemberId: before.assignedMemberId,
            assignedMemberId,
            source: "agencyInventory",
          },
          ...requestMeta(req),
        },
      });

      return updated;
    });

    return res.json({ ok: true, item: after });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/:id/link-listing", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);

    const id = asPositiveInt(req.params.id);
    const propertyId = asPositiveInt(req.body?.propertyId);

    if (!id || !propertyId) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "A valid inventory id and propertyId are required",
        400
      );
    }

    const inventory = await inventoryForAgency(id, workspace.agency.id);
    if (!inventory) {
      throw new ApiError("INVENTORY_NOT_FOUND", "Inventory record not found", 404);
    }

    assertCanEdit(workspace, inventory.assignedMemberId);

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        id: true,
        userId: true,
        agencyId: true,
        inventoryPropertyId: true,
        slug: true,
        title: true,
        listingStatus: true,
      },
    });

    if (!property) {
      throw new ApiError("PROPERTY_NOT_FOUND", "Property listing not found", 404);
    }

    const mayLinkLegacyOwnedProperty =
      property.userId === workspace.membership.userId;

    const alreadyAgencyProperty =
      property.agencyId === workspace.agency.id;

    if (!mayLinkLegacyOwnedProperty && !alreadyAgencyProperty) {
      throw new AgencyAccessError(
        "AGENCY_PERMISSION_DENIED",
        "This listing does not belong to the current agency or authenticated owner",
        403
      );
    }

    if (
      property.agencyId != null &&
      property.agencyId !== workspace.agency.id
    ) {
      throw new AgencyAccessError(
        "AGENCY_PERMISSION_DENIED",
        "This listing belongs to another agency",
        403
      );
    }

    if (
      property.inventoryPropertyId != null &&
      property.inventoryPropertyId !== id
    ) {
      throw new ApiError(
        "PROPERTY_ALREADY_LINKED",
        "This listing is already linked to another inventory record",
        409
      );
    }

    const userId = workspace.membership.userId;

    const updatedProperty = await prisma.$transaction(async (tx) => {
      const updated = await tx.property.update({
        where: { id: propertyId },
        data: {
          agencyId: workspace.agency.id,
          inventoryPropertyId: id,
          updatedByUserId: userId,
          createdByUserId: property.userId,
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
          agencyId: workspace.agency.id,
          actorUserId: userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: userId,
          action: "INVENTORY_LISTING_LINKED",
          entityType: "InventoryProperty",
          entityId: String(id),
          beforeState: {
            propertyId: property.id,
            agencyId: property.agencyId,
            inventoryPropertyId: property.inventoryPropertyId,
          },
          afterState: {
            propertyId: updated.id,
            agencyId: updated.agencyId,
            inventoryPropertyId: updated.inventoryPropertyId,
          },
          changedFields: [
            "Property.agencyId",
            "Property.inventoryPropertyId",
          ],
          metadata: {
            propertyId,
            propertySlug: property.slug,
            source: "agencyInventory",
          },
          ...requestMeta(req),
        },
      });

      return updated;
    });

    return res.json({
      ok: true,
      property: updatedProperty,
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.patch("/:id", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);

    const id = asPositiveInt(req.params.id);
    if (!id) {
      throw new ApiError("VALIDATION_ERROR", "Invalid inventory id", 400);
    }

    const before = await inventoryForAgency(id, workspace.agency.id);
    if (!before) {
      throw new ApiError("INVENTORY_NOT_FOUND", "Inventory record not found", 404);
    }

    assertCanEdit(workspace, before.assignedMemberId);

    const body = req.body || {};

    if ("assignedMemberId" in body) {
      throw new ApiError(
        "USE_ASSIGN_ENDPOINT",
        "Use PATCH /:id/assign to change inventory assignment",
        400
      );
    }

    const data = mutableInventoryData(body);

    if ("primaryContactId" in body) {
      const primaryContactId =
        body.primaryContactId == null || body.primaryContactId === ""
          ? null
          : asPositiveInt(body.primaryContactId);

      if (
        body.primaryContactId != null &&
        body.primaryContactId !== "" &&
        primaryContactId == null
      ) {
        throw new ApiError(
          "VALIDATION_ERROR",
          "primaryContactId must be a positive integer or null",
          400
        );
      }

      await assertPrimaryContact(workspace.agency.id, primaryContactId);
      data.primaryContactId = primaryContactId;
    }

    data.updatedByUserId = workspace.membership.userId;

    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.inventoryProperty.update({
        where: { id },
        data,
        include: inventoryInclude,
      });

      const fields = changedFields(before, updated);

      if (fields.length > 0) {
        await tx.agencyAuditLog.create({
          data: {
            agencyId: workspace.agency.id,
            actorUserId: workspace.membership.userId,
            actorAgencyMemberId: workspace.membership.id,
            effectiveUserId: workspace.membership.userId,
            action: "INVENTORY_UPDATED",
            entityType: "InventoryProperty",
            entityId: String(id),
            beforeState: inventorySnapshot(before),
            afterState: inventorySnapshot(updated),
            changedFields: fields,
            metadata: {
              source: "agencyInventory",
            },
            ...requestMeta(req),
          },
        });
      }

      return updated;
    });

    return res.json({
      ok: true,
      item: after,
    });
  } catch (error) {
    return handleError(res, error);
  }
});

class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

function handleError(res: any, error: unknown) {
  if (error instanceof ApiError || error instanceof AgencyAccessError) {
    return res.status(error.status).json({
      ok: false,
      error: error.code,
      message: error.message,
    });
  }

  console.error("AGENCY_INVENTORY_ERROR:", error);

  return res.status(500).json({
    ok: false,
    error: "AGENCY_INVENTORY_FAILED",
    message: "Could not complete the agency inventory request",
  });
}

export default router;
