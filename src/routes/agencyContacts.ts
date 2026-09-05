import { Router, Request } from "express";
import {
  Prisma,
  ProfessionalContactRole,
  CrmTaskPriority,
  CrmOpportunityType,
  CrmOpportunityStage,
  CrmInteractionType,
  CrmInteractionDirection,
  CrmInteractionProvider,
} from "@prisma/client";

import { prisma } from "../lib/prisma";
import requireActiveAgent from "../middleware/requireActiveAgent";
import {
  AgencyAccessError,
  AgencyWorkspace,
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

const PROFESSIONAL_CONTACT_ROLES = new Set<string>(
  Object.values(ProfessionalContactRole),
);

const CRM_TASK_PRIORITIES = new Set<string>(Object.values(CrmTaskPriority));
const CRM_OPPORTUNITY_TYPES = new Set<string>(Object.values(CrmOpportunityType));
const CRM_OPPORTUNITY_STAGES = new Set<string>(Object.values(CrmOpportunityStage));
const CRM_INTERACTION_TYPES = new Set<string>(Object.values(CrmInteractionType));
const CRM_INTERACTION_DIRECTIONS = new Set<string>(Object.values(CrmInteractionDirection));
const CRM_INTERACTION_PROVIDERS = new Set<string>(Object.values(CrmInteractionProvider));

function parseEnumValue<T extends string>(
  value: unknown,
  allowed: Set<string>,
  field: string,
): T | null {
  if (value == null || value === "") return null;
  const parsed = String(value).trim().toUpperCase();
  if (!allowed.has(parsed)) {
    throw new ApiError("VALIDATION_ERROR", `Invalid ${field}`, 400);
  }
  return parsed as T;
}

function nullableNonNegativeBigInt(value: unknown, field: string): bigint | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ApiError("VALIDATION_ERROR", `${field} must be a non-negative integer`, 400);
  }
  return BigInt(parsed);
}

function probabilityValue(value: unknown, fallback?: number): number {
  if (value == null || value === "") return fallback ?? 10;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new ApiError("VALIDATION_ERROR", "probability must be an integer from 0 to 100", 400);
  }
  return parsed;
}

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

function requiredString(value: unknown, field: string, maxLength = 500): string {
  const text = nullableString(value, maxLength);
  if (!text) throw new ApiError("VALIDATION_ERROR", `${field} is required`, 400);
  return text;
}

function nullableDate(value: unknown, field: string): Date | null {
  if (value == null || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new ApiError("VALIDATION_ERROR", `${field} must be a valid date`, 400);
  }
  return date;
}

function parseProfessionalContactRoles(value: unknown): ProfessionalContactRole[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new ApiError("VALIDATION_ERROR", "roles must be an array", 400);
  }
  const roles = [...new Set(value.map((role) => String(role || "").trim().toUpperCase()).filter(Boolean))];
  if (roles.some((role) => !PROFESSIONAL_CONTACT_ROLES.has(role))) {
    throw new ApiError("VALIDATION_ERROR", "One or more contact roles are invalid", 400);
  }
  return roles as ProfessionalContactRole[];
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

async function workspaceFor(req: AgentRequest): Promise<AgencyWorkspace> {
  const userId = asPositiveInt(req.agentAccess?.userId);
  if (!userId) {
    throw new ApiError(
      "AUTH_CONTEXT_INVALID",
      "Authenticated professional user could not be resolved",
      401,
    );
  }
  return requireAgencyWorkspace(userId);
}

function assertCanManageCrm(workspace: AgencyWorkspace) {
  if (String(workspace.membership.role).toUpperCase() === "VIEWER") {
    throw new AgencyAccessError(
      "AGENCY_PERMISSION_DENIED",
      "You do not have permission to change CRM records",
      403,
    );
  }
}

async function assertCompanyForAgency(companyId: number | null, agencyId: number) {
  if (companyId == null) return;
  const company = await prisma.crmCompany.findFirst({
    where: { id: companyId, agencyId, isArchived: false },
    select: { id: true },
  });
  if (!company) {
    throw new ApiError(
      "CRM_COMPANY_NOT_FOUND",
      "Company must belong to this agency and be active",
      404,
    );
  }
}

async function assertActiveAgencyMember(memberId: number | null, agencyId: number) {
  if (memberId == null) return;
  const member = await prisma.agencyMember.findFirst({
    where: { id: memberId, agencyId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!member) {
    throw new ApiError(
      "CRM_MEMBER_NOT_FOUND",
      "Assigned CRM owner must be an active member of this agency",
      404,
    );
  }
}

async function assertOpportunityRelations(agencyId: number, values: {
  contactId?: number | null;
  companyId?: number | null;
  inventoryPropertyId?: number | null;
  ownerMemberId?: number | null;
}) {
  if (values.contactId != null) {
    const contact = await prisma.professionalContact.findFirst({
      where: { id: values.contactId, agencyId, isArchived: false },
      select: { id: true },
    });
    if (!contact) throw new ApiError("CONTACT_NOT_FOUND", "Opportunity contact must be an active CRM contact in this agency", 404);
  }
  if (values.companyId != null) await assertCompanyForAgency(values.companyId, agencyId);
  if (values.inventoryPropertyId != null) {
    const property = await prisma.inventoryProperty.findFirst({
      where: { id: values.inventoryPropertyId, agencyId, archivedAt: null },
      select: { id: true },
    });
    if (!property) throw new ApiError("INVENTORY_NOT_FOUND", "Opportunity property must be an active Inventory record in this agency", 404);
  }
  if (values.ownerMemberId != null) await assertActiveAgencyMember(values.ownerMemberId, agencyId);
}


async function assertInteractionRelations(agencyId: number, values: {
  contactId?: number | null;
  companyId?: number | null;
  opportunityId?: number | null;
  inventoryPropertyId?: number | null;
  ownerMemberId?: number | null;
}) {
  if (values.contactId != null) {
    const contact = await prisma.professionalContact.findFirst({
      where: { id: values.contactId, agencyId, isArchived: false },
      select: { id: true },
    });
    if (!contact) {
      throw new ApiError(
        "CONTACT_NOT_FOUND",
        "Interaction contact must be an active CRM contact in this agency",
        404,
      );
    }
  }

  if (values.companyId != null) {
    await assertCompanyForAgency(values.companyId, agencyId);
  }

  if (values.opportunityId != null) {
    const opportunity = await prisma.crmOpportunity.findFirst({
      where: { id: values.opportunityId, agencyId, isArchived: false },
      select: { id: true },
    });
    if (!opportunity) {
      throw new ApiError(
        "CRM_OPPORTUNITY_NOT_FOUND",
        "Interaction opportunity must be an active CRM opportunity in this agency",
        404,
      );
    }
  }

  if (values.inventoryPropertyId != null) {
    const property = await prisma.inventoryProperty.findFirst({
      where: { id: values.inventoryPropertyId, agencyId, archivedAt: null },
      select: { id: true },
    });
    if (!property) {
      throw new ApiError(
        "INVENTORY_NOT_FOUND",
        "Interaction property must be an active Inventory record in this agency",
        404,
      );
    }
  }

  if (values.ownerMemberId != null) {
    await assertActiveAgencyMember(values.ownerMemberId, agencyId);
  }
}

function interactionSnapshot(item: any) {
  if (!item) return null;
  return {
    id: item.id,
    agencyId: item.agencyId,
    contactId: item.contactId,
    companyId: item.companyId,
    opportunityId: item.opportunityId,
    inventoryPropertyId: item.inventoryPropertyId,
    ownerMemberId: item.ownerMemberId,
    type: item.type,
    direction: item.direction,
    subject: item.subject,
    summary: item.summary,
    occurredAt: item.occurredAt,
    durationMinutes: item.durationMinutes,
    sourceProvider: item.sourceProvider,
    externalId: item.externalId,
    externalThreadId: item.externalThreadId,
    externalUrl: item.externalUrl,
    createdByUserId: item.createdByUserId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function opportunitySnapshot(item: any) {
  if (!item) return null;
  return {
    id: item.id,
    agencyId: item.agencyId,
    contactId: item.contactId,
    companyId: item.companyId,
    inventoryPropertyId: item.inventoryPropertyId,
    ownerMemberId: item.ownerMemberId,
    title: item.title,
    type: item.type,
    stage: item.stage,
    valueCents: item.valueCents == null ? null : Number(item.valueCents),
    probability: item.probability,
    expectedCloseAt: item.expectedCloseAt,
    lostReason: item.lostReason,
    notes: item.notes,
    isArchived: item.isArchived,
    archivedAt: item.archivedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function opportunityForResponse(item: any) {
  if (!item) return item;
  return {
    ...item,
    valueCents: item.valueCents == null ? null : Number(item.valueCents),
  };
}

function contactForResponse(contact: any) {
  if (!contact) return contact;
  return {
    ...contact,
    crmOpportunities: Array.isArray(contact.crmOpportunities)
      ? contact.crmOpportunities.map(opportunityForResponse)
      : contact.crmOpportunities,
  };
}

function contactSnapshot(contact: any) {
  if (!contact) return null;
  return {
    id: contact.id,
    agencyId: contact.agencyId,
    companyId: contact.companyId,
    firstName: contact.firstName,
    lastName: contact.lastName,
    companyName: contact.companyName,
    primaryEmail: contact.primaryEmail,
    phoneNumber: contact.phoneNumber,
    roles: contact.roles,
    notes: contact.notes,
    isArchived: contact.isArchived,
    archivedAt: contact.archivedAt,
    createdByUserId: contact.createdByUserId,
    updatedByUserId: contact.updatedByUserId,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
  };
}

function companySnapshot(company: any) {
  if (!company) return null;
  return {
    id: company.id,
    agencyId: company.agencyId,
    name: company.name,
    email: company.email,
    phoneNumber: company.phoneNumber,
    websiteUrl: company.websiteUrl,
    addressLine1: company.addressLine1,
    addressLine2: company.addressLine2,
    townCity: company.townCity,
    county: company.county,
    eircode: company.eircode,
    notes: company.notes,
    isArchived: company.isArchived,
    archivedAt: company.archivedAt,
    createdByUserId: company.createdByUserId,
    updatedByUserId: company.updatedByUserId,
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
  };
}

function snapshotChangedFields(before: any, after: any): string[] {
  const left = before || {};
  const right = after || {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]));
}

async function crmContactForAgency(id: number, agencyId: number) {
  return prisma.professionalContact.findFirst({
    where: { id, agencyId },
    include: {
      company: true,
      propertyLinks: {
        where: { archivedAt: null },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
        include: {
          inventoryProperty: {
            select: {
              id: true,
              address1: true,
              address2: true,
              city: true,
              county: true,
              eircode: true,
              transactionType: true,
              stage: true,
              askingPrice: true,
              archivedAt: true,
              updatedAt: true,
            },
          },
        },
      },
      crmNotes: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { createdBy: { select: { id: true, name: true, email: true } } },
      },
      crmFollowUps: {
        orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }, { id: "asc" }],
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          updatedBy: { select: { id: true, name: true, email: true } },
          assignedMember: {
            select: {
              id: true, role: true, jobTitle: true,
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      },
      crmOpportunities: {
        where: { isArchived: false },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        include: {
          company: { select: { id: true, name: true, isArchived: true } },
          ownerMember: { select: { id: true, role: true, jobTitle: true, user: { select: { id: true, name: true, email: true } } } },
          inventoryProperty: { select: { id: true, address1: true, address2: true, city: true, county: true, eircode: true, stage: true, transactionType: true, archivedAt: true } },
        },
      },
      crmInteractions: {
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 250,
        include: {
          company: { select: { id: true, name: true, isArchived: true } },
          opportunity: { select: { id: true, title: true, type: true, stage: true, isArchived: true } },
          inventoryProperty: { select: { id: true, address1: true, address2: true, city: true, county: true, eircode: true, stage: true, transactionType: true, archivedAt: true } },
          ownerMember: { select: { id: true, role: true, jobTitle: true, user: { select: { id: true, name: true, email: true } } } },
          createdBy: { select: { id: true, name: true, email: true } },
        },
      },
      createdBy: { select: { id: true, name: true, email: true } },
      updatedBy: { select: { id: true, name: true, email: true } },
    },
  });
}

async function assertNoDuplicateActiveEmail(
  agencyId: number,
  primaryEmail: string | null,
  excludeContactId?: number,
) {
  if (!primaryEmail) return;
  const duplicate = await prisma.professionalContact.findFirst({
    where: {
      agencyId,
      isArchived: false,
      primaryEmail: { equals: primaryEmail, mode: "insensitive" },
      ...(excludeContactId ? { NOT: { id: excludeContactId } } : {}),
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new ApiError(
      "CONTACT_ALREADY_EXISTS",
      `An active CRM contact with this email already exists (contact ${duplicate.id}).`,
      409,
    );
  }
}

/* Companies */
router.get("/companies", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const includeArchived = String(req.query.includeArchived || "").toLowerCase() === "true";
    const q = nullableString(req.query.q, 200);
    const items = await prisma.crmCompany.findMany({
      where: {
        agencyId: workspace.agency.id,
        ...(includeArchived ? {} : { isArchived: false }),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                { phoneNumber: { contains: q, mode: "insensitive" } },
                { townCity: { contains: q, mode: "insensitive" } },
                { county: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: { _count: { select: { contacts: true } } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 500,
    });
    return res.json({
      ok: true,
      agency: { id: workspace.agency.id, name: workspace.agency.name },
      items,
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/companies", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const body = req.body || {};
    const userId = workspace.membership.userId;
    const created = await prisma.$transaction(async (tx) => {
      const company = await tx.crmCompany.create({
        data: {
          agencyId: workspace.agency.id,
          name: requiredString(body.name, "name", 250),
          email: nullableString(body.email, 320)?.toLowerCase() || null,
          phoneNumber: nullableString(body.phoneNumber, 80),
          websiteUrl: nullableString(body.websiteUrl, 1000),
          addressLine1: nullableString(body.addressLine1, 300),
          addressLine2: nullableString(body.addressLine2, 300),
          townCity: nullableString(body.townCity, 200),
          county: nullableString(body.county, 200),
          eircode: nullableString(body.eircode, 20),
          notes: nullableString(body.notes, 10000),
          createdByUserId: userId,
          updatedByUserId: userId,
        },
      });
      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: userId,
          action: "CRM_COMPANY_CREATED",
          entityType: "CrmCompany",
          entityId: String(company.id),
          afterState: companySnapshot(company),
          changedFields: Object.keys(companySnapshot(company) || {}),
          metadata: { source: "agencyContacts" },
          ...requestMeta(req),
        },
      });
      return company;
    });
    return res.status(201).json({ ok: true, item: created });
  } catch (error) {
    return handleError(res, error);
  }
});

router.patch("/companies/:companyId", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const companyId = asPositiveInt(req.params.companyId);
    if (!companyId) throw new ApiError("VALIDATION_ERROR", "Invalid company id", 400);
    const before = await prisma.crmCompany.findFirst({
      where: { id: companyId, agencyId: workspace.agency.id },
    });
    if (!before) throw new ApiError("CRM_COMPANY_NOT_FOUND", "CRM company not found", 404);
    const body = req.body || {};
    const data: Prisma.CrmCompanyUncheckedUpdateInput = {
      updatedByUserId: workspace.membership.userId,
    };
    if ("name" in body) data.name = requiredString(body.name, "name", 250);
    if ("email" in body) data.email = nullableString(body.email, 320)?.toLowerCase() || null;
    if ("phoneNumber" in body) data.phoneNumber = nullableString(body.phoneNumber, 80);
    if ("websiteUrl" in body) data.websiteUrl = nullableString(body.websiteUrl, 1000);
    if ("addressLine1" in body) data.addressLine1 = nullableString(body.addressLine1, 300);
    if ("addressLine2" in body) data.addressLine2 = nullableString(body.addressLine2, 300);
    if ("townCity" in body) data.townCity = nullableString(body.townCity, 200);
    if ("county" in body) data.county = nullableString(body.county, 200);
    if ("eircode" in body) data.eircode = nullableString(body.eircode, 20);
    if ("notes" in body) data.notes = nullableString(body.notes, 10000);
    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.crmCompany.update({ where: { id: companyId }, data });
      const changed = snapshotChangedFields(companySnapshot(before), companySnapshot(updated));
      if (changed.length > 0) {
        await tx.agencyAuditLog.create({
          data: {
            agencyId: workspace.agency.id,
            actorUserId: workspace.membership.userId,
            actorAgencyMemberId: workspace.membership.id,
            effectiveUserId: workspace.membership.userId,
            action: "CRM_COMPANY_UPDATED",
            entityType: "CrmCompany",
            entityId: String(companyId),
            beforeState: companySnapshot(before),
            afterState: companySnapshot(updated),
            changedFields: changed,
            metadata: { source: "agencyContacts" },
            ...requestMeta(req),
          },
        });
      }
      return updated;
    });
    return res.json({ ok: true, item: after });
  } catch (error) {
    return handleError(res, error);
  }
});

/* Company archive / restore */
router.post("/companies/:companyId/archive", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const companyId = asPositiveInt(req.params.companyId);
    if (!companyId) throw new ApiError("VALIDATION_ERROR", "Invalid company id", 400);
    const before = await prisma.crmCompany.findFirst({
      where: { id: companyId, agencyId: workspace.agency.id },
      include: { contacts: { where: { isArchived: false }, select: { id: true } } },
    });
    if (!before) throw new ApiError("CRM_COMPANY_NOT_FOUND", "CRM company not found", 404);
    if (before.isArchived) return res.json({ ok: true, item: before, alreadyArchived: true });
    if (before.contacts.length > 0) {
      throw new ApiError(
        "CRM_COMPANY_HAS_ACTIVE_CONTACTS",
        "Unlink or archive active CRM contacts before archiving this company",
        409,
      );
    }
    const archivedAt = new Date();
    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.crmCompany.update({
        where: { id: companyId },
        data: { isArchived: true, archivedAt, updatedByUserId: workspace.membership.userId },
      });
      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: workspace.membership.userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: workspace.membership.userId,
          action: "CRM_COMPANY_ARCHIVED",
          entityType: "CrmCompany",
          entityId: String(companyId),
          beforeState: companySnapshot(before),
          afterState: companySnapshot(updated),
          changedFields: ["isArchived", "archivedAt"],
          metadata: { source: "agencyContacts" },
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

router.post("/companies/:companyId/restore", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const companyId = asPositiveInt(req.params.companyId);
    if (!companyId) throw new ApiError("VALIDATION_ERROR", "Invalid company id", 400);
    const before = await prisma.crmCompany.findFirst({
      where: { id: companyId, agencyId: workspace.agency.id },
    });
    if (!before) throw new ApiError("CRM_COMPANY_NOT_FOUND", "CRM company not found", 404);
    if (!before.isArchived) return res.json({ ok: true, item: before, alreadyActive: true });
    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.crmCompany.update({
        where: { id: companyId },
        data: { isArchived: false, archivedAt: null, updatedByUserId: workspace.membership.userId },
      });
      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: workspace.membership.userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: workspace.membership.userId,
          action: "CRM_COMPANY_RESTORED",
          entityType: "CrmCompany",
          entityId: String(companyId),
          beforeState: companySnapshot(before),
          afterState: companySnapshot(updated),
          changedFields: ["isArchived", "archivedAt"],
          metadata: { source: "agencyContacts" },
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

/* Agency-wide follow-up list */
router.get("/follow-ups", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const includeArchivedContacts =
      String(req.query.includeArchivedContacts || "").toLowerCase() === "true";

    const items = await prisma.crmFollowUp.findMany({
      where: {
        agencyId: workspace.agency.id,
        ...(includeArchivedContacts
          ? {}
          : { contact: { is: { isArchived: false } } }),
      },
      include: {
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            primaryEmail: true,
            phoneNumber: true,
            roles: true,
            isArchived: true,
            companyId: true,
            companyName: true,
            company: { select: { id: true, name: true, isArchived: true } },
          },
        },
        createdBy: { select: { id: true, name: true, email: true } },
        updatedBy: { select: { id: true, name: true, email: true } },
        assignedMember: {
          select: { id: true, role: true, jobTitle: true, user: { select: { id: true, name: true, email: true } } },
        },
      },
      orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }, { priority: "desc" }, { id: "asc" }],
      take: 1000,
    });

    return res.json({
      ok: true,
      agency: { id: workspace.agency.id, name: workspace.agency.name },
      items,
    });
  } catch (error) {
    return handleError(res, error);
  }
});

/* CRM owners / assignees */
router.get("/workspace-members", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const items = await prisma.agencyMember.findMany({
      where: { agencyId: workspace.agency.id, status: "ACTIVE" },
      select: {
        id: true,
        role: true,
        jobTitle: true,
        isPrimary: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
    });
    return res.json({ ok: true, items });
  } catch (error) {
    return handleError(res, error);
  }
});

/* Opportunity pipeline */
const opportunityInclude = {
  contact: { select: { id: true, firstName: true, lastName: true, primaryEmail: true, roles: true, isArchived: true } },
  company: { select: { id: true, name: true, isArchived: true } },
  inventoryProperty: { select: { id: true, address1: true, address2: true, city: true, county: true, eircode: true, stage: true, transactionType: true, archivedAt: true } },
  ownerMember: { select: { id: true, role: true, jobTitle: true, user: { select: { id: true, name: true, email: true } } } },
} satisfies Prisma.CrmOpportunityInclude;

router.get("/opportunities", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const includeArchived = String(req.query.includeArchived || "").toLowerCase() === "true";
    const stage = parseEnumValue<CrmOpportunityStage>(req.query.stage, CRM_OPPORTUNITY_STAGES, "stage");
    const ownerMemberId = req.query.ownerMemberId == null || req.query.ownerMemberId === "" ? null : asPositiveInt(req.query.ownerMemberId);
    const contactId = req.query.contactId == null || req.query.contactId === "" ? null : asPositiveInt(req.query.contactId);
    if (req.query.ownerMemberId != null && req.query.ownerMemberId !== "" && !ownerMemberId) throw new ApiError("VALIDATION_ERROR", "ownerMemberId must be a positive integer", 400);
    if (req.query.contactId != null && req.query.contactId !== "" && !contactId) throw new ApiError("VALIDATION_ERROR", "contactId must be a positive integer", 400);
    const items = await prisma.crmOpportunity.findMany({
      where: {
        agencyId: workspace.agency.id,
        ...(includeArchived ? {} : { isArchived: false }),
        ...(stage ? { stage } : {}),
        ...(ownerMemberId ? { ownerMemberId } : {}),
        ...(contactId ? { contactId } : {}),
      },
      include: opportunityInclude,
      orderBy: [{ isArchived: "asc" }, { updatedAt: "desc" }, { id: "desc" }],
      take: 1000,
    });
    return res.json({ ok: true, items: items.map(opportunityForResponse) });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/opportunities", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const body = req.body || {};
    const type = parseEnumValue<CrmOpportunityType>(body.type, CRM_OPPORTUNITY_TYPES, "opportunity type");
    if (!type) throw new ApiError("VALIDATION_ERROR", "type is required", 400);
    const stage = parseEnumValue<CrmOpportunityStage>(body.stage, CRM_OPPORTUNITY_STAGES, "opportunity stage") || CrmOpportunityStage.LEAD;
    const contactId = body.contactId == null || body.contactId === "" ? null : asPositiveInt(body.contactId);
    const companyId = body.companyId == null || body.companyId === "" ? null : asPositiveInt(body.companyId);
    const inventoryPropertyId = body.inventoryPropertyId == null || body.inventoryPropertyId === "" ? null : asPositiveInt(body.inventoryPropertyId);
    const ownerMemberId = body.ownerMemberId == null || body.ownerMemberId === "" ? workspace.membership.id : asPositiveInt(body.ownerMemberId);
    for (const [field, raw, parsed] of [["contactId", body.contactId, contactId], ["companyId", body.companyId, companyId], ["inventoryPropertyId", body.inventoryPropertyId, inventoryPropertyId], ["ownerMemberId", body.ownerMemberId, ownerMemberId]] as const) {
      if (raw != null && raw !== "" && !parsed) throw new ApiError("VALIDATION_ERROR", `${field} must be a positive integer or null`, 400);
    }
    await assertOpportunityRelations(workspace.agency.id, { contactId, companyId, inventoryPropertyId, ownerMemberId });
    const created = await prisma.$transaction(async (tx) => {
      const item = await tx.crmOpportunity.create({
        data: {
          agencyId: workspace.agency.id,
          contactId,
          companyId,
          inventoryPropertyId,
          ownerMemberId,
          title: requiredString(body.title, "title", 300),
          type,
          stage,
          valueCents: nullableNonNegativeBigInt(body.valueCents, "valueCents"),
          probability: probabilityValue(body.probability, stage === CrmOpportunityStage.WON ? 100 : stage === CrmOpportunityStage.LOST ? 0 : 10),
          expectedCloseAt: nullableDate(body.expectedCloseAt, "expectedCloseAt"),
          lostReason: stage === CrmOpportunityStage.LOST ? nullableString(body.lostReason, 2000) : null,
          notes: nullableString(body.notes, 10000),
        },
        include: opportunityInclude,
      });
      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: workspace.membership.userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: workspace.membership.userId,
          action: "CRM_OPPORTUNITY_CREATED",
          entityType: "CrmOpportunity",
          entityId: String(item.id),
          afterState: opportunitySnapshot(item),
          changedFields: ["created"],
          metadata: { source: "agencyContacts", contactId: item.contactId, companyId: item.companyId, inventoryPropertyId: item.inventoryPropertyId },
          ...requestMeta(req),
        },
      });
      return item;
    });
    return res.status(201).json({ ok: true, item: opportunityForResponse(created) });
  } catch (error) {
    return handleError(res, error);
  }
});

router.patch("/opportunities/:opportunityId", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const opportunityId = asPositiveInt(req.params.opportunityId);
    if (!opportunityId) throw new ApiError("VALIDATION_ERROR", "Invalid opportunity id", 400);
    const before = await prisma.crmOpportunity.findFirst({ where: { id: opportunityId, agencyId: workspace.agency.id } });
    if (!before) throw new ApiError("CRM_OPPORTUNITY_NOT_FOUND", "CRM opportunity not found", 404);
    const body = req.body || {};
    const data: Prisma.CrmOpportunityUncheckedUpdateInput = {};
    if ("title" in body) data.title = requiredString(body.title, "title", 300);
    if ("type" in body) { const v = parseEnumValue<CrmOpportunityType>(body.type, CRM_OPPORTUNITY_TYPES, "opportunity type"); if (!v) throw new ApiError("VALIDATION_ERROR", "type is required", 400); data.type = v; }
    if ("stage" in body) { const v = parseEnumValue<CrmOpportunityStage>(body.stage, CRM_OPPORTUNITY_STAGES, "opportunity stage"); if (!v) throw new ApiError("VALIDATION_ERROR", "stage is required", 400); data.stage = v; if (v === CrmOpportunityStage.WON && !("probability" in body)) data.probability = 100; if (v === CrmOpportunityStage.LOST && !("probability" in body)) data.probability = 0; if (v !== CrmOpportunityStage.LOST && !("lostReason" in body)) data.lostReason = null; }
    if ("valueCents" in body) data.valueCents = nullableNonNegativeBigInt(body.valueCents, "valueCents");
    if ("probability" in body) data.probability = probabilityValue(body.probability);
    if ("expectedCloseAt" in body) data.expectedCloseAt = nullableDate(body.expectedCloseAt, "expectedCloseAt");
    if ("lostReason" in body) data.lostReason = nullableString(body.lostReason, 2000);
    if ("notes" in body) data.notes = nullableString(body.notes, 10000);
    const relationFields = ["contactId", "companyId", "inventoryPropertyId", "ownerMemberId"] as const;
    const relationValues: any = {};
    for (const field of relationFields) {
      if (field in body) {
        const parsed = body[field] == null || body[field] === "" ? null : asPositiveInt(body[field]);
        if (body[field] != null && body[field] !== "" && !parsed) throw new ApiError("VALIDATION_ERROR", `${field} must be a positive integer or null`, 400);
        relationValues[field] = parsed;
        (data as any)[field] = parsed;
      }
    }
    await assertOpportunityRelations(workspace.agency.id, relationValues);
    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.crmOpportunity.update({ where: { id: opportunityId }, data, include: opportunityInclude });
      const changed = snapshotChangedFields(opportunitySnapshot(before), opportunitySnapshot(updated));
      if (changed.length) await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: workspace.membership.userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: workspace.membership.userId,
          action: "CRM_OPPORTUNITY_UPDATED",
          entityType: "CrmOpportunity",
          entityId: String(opportunityId),
          beforeState: opportunitySnapshot(before),
          afterState: opportunitySnapshot(updated),
          changedFields: changed,
          metadata: { source: "agencyContacts", contactId: updated.contactId, companyId: updated.companyId, inventoryPropertyId: updated.inventoryPropertyId },
          ...requestMeta(req),
        },
      });
      return updated;
    });
    return res.json({ ok: true, item: opportunityForResponse(after) });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/opportunities/:opportunityId/archive", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const opportunityId = asPositiveInt(req.params.opportunityId);
    if (!opportunityId) throw new ApiError("VALIDATION_ERROR", "Invalid opportunity id", 400);
    const before = await prisma.crmOpportunity.findFirst({ where: { id: opportunityId, agencyId: workspace.agency.id } });
    if (!before) throw new ApiError("CRM_OPPORTUNITY_NOT_FOUND", "CRM opportunity not found", 404);
    if (before.isArchived) return res.json({ ok: true, item: opportunityForResponse(before), alreadyArchived: true });
    const archivedAt = new Date();
    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.crmOpportunity.update({ where: { id: opportunityId }, data: { isArchived: true, archivedAt }, include: opportunityInclude });
      await tx.agencyAuditLog.create({ data: { agencyId: workspace.agency.id, actorUserId: workspace.membership.userId, actorAgencyMemberId: workspace.membership.id, effectiveUserId: workspace.membership.userId, action: "CRM_OPPORTUNITY_ARCHIVED", entityType: "CrmOpportunity", entityId: String(opportunityId), beforeState: opportunitySnapshot(before), afterState: opportunitySnapshot(updated), changedFields: ["isArchived", "archivedAt"], metadata: { source: "agencyContacts", contactId: updated.contactId }, ...requestMeta(req) } });
      return updated;
    });
    return res.json({ ok: true, item: opportunityForResponse(after) });
  } catch (error) { return handleError(res, error); }
});

router.post("/opportunities/:opportunityId/restore", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const opportunityId = asPositiveInt(req.params.opportunityId);
    if (!opportunityId) throw new ApiError("VALIDATION_ERROR", "Invalid opportunity id", 400);
    const before = await prisma.crmOpportunity.findFirst({ where: { id: opportunityId, agencyId: workspace.agency.id } });
    if (!before) throw new ApiError("CRM_OPPORTUNITY_NOT_FOUND", "CRM opportunity not found", 404);
    if (!before.isArchived) return res.json({ ok: true, item: opportunityForResponse(before), alreadyActive: true });
    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.crmOpportunity.update({ where: { id: opportunityId }, data: { isArchived: false, archivedAt: null }, include: opportunityInclude });
      await tx.agencyAuditLog.create({ data: { agencyId: workspace.agency.id, actorUserId: workspace.membership.userId, actorAgencyMemberId: workspace.membership.id, effectiveUserId: workspace.membership.userId, action: "CRM_OPPORTUNITY_RESTORED", entityType: "CrmOpportunity", entityId: String(opportunityId), beforeState: opportunitySnapshot(before), afterState: opportunitySnapshot(updated), changedFields: ["isArchived", "archivedAt"], metadata: { source: "agencyContacts", contactId: updated.contactId }, ...requestMeta(req) } });
      return updated;
    });
    return res.json({ ok: true, item: opportunityForResponse(after) });
  } catch (error) { return handleError(res, error); }
});

/* Contact list */
router.get("/", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const includeArchived = String(req.query.includeArchived || "").toLowerCase() === "true";
    const q = nullableString(req.query.q, 200);
    const companyId = req.query.companyId == null ? undefined : asPositiveInt(req.query.companyId);
    const role = nullableString(req.query.role, 100)?.toUpperCase() || null;
    if (req.query.companyId != null && companyId == null) {
      throw new ApiError("VALIDATION_ERROR", "companyId must be a positive integer", 400);
    }
    if (role && !PROFESSIONAL_CONTACT_ROLES.has(role)) {
      throw new ApiError("VALIDATION_ERROR", "Invalid contact role", 400);
    }
    const searchTokens = q
      ? q.split(/\s+/).map((token) => token.trim()).filter(Boolean).slice(0, 8)
      : [];
    const searchFields = (term: string) => [
      { firstName: { contains: term, mode: "insensitive" as const } },
      { lastName: { contains: term, mode: "insensitive" as const } },
      { companyName: { contains: term, mode: "insensitive" as const } },
      { primaryEmail: { contains: term, mode: "insensitive" as const } },
      { phoneNumber: { contains: term, mode: "insensitive" as const } },
      { company: { is: { name: { contains: term, mode: "insensitive" as const } } } },
    ];
    const items = await prisma.professionalContact.findMany({
      where: {
        agencyId: workspace.agency.id,
        ...(includeArchived ? {} : { isArchived: false }),
        ...(companyId ? { companyId } : {}),
        ...(role ? { roles: { has: role as ProfessionalContactRole } } : {}),
        ...(q ? { AND: searchTokens.map((token) => ({ OR: searchFields(token) })) } : {}),
      },
      include: {
        company: true,
        _count: {
          select: {
            propertyLinks: { where: { archivedAt: null } },
            crmNotes: true,
            crmFollowUps: true,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 500,
    });
    return res.json({
      ok: true,
      agency: { id: workspace.agency.id, name: workspace.agency.name },
      membership: { id: workspace.membership.id, role: workspace.membership.role },
      items,
    });
  } catch (error) {
    return handleError(res, error);
  }
});


/* CRM interactions */
const interactionInclude = {
  contact: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      primaryEmail: true,
      phoneNumber: true,
      roles: true,
      isArchived: true,
    },
  },
  company: { select: { id: true, name: true, isArchived: true } },
  opportunity: {
    select: { id: true, title: true, type: true, stage: true, isArchived: true },
  },
  inventoryProperty: {
    select: {
      id: true,
      address1: true,
      address2: true,
      city: true,
      county: true,
      eircode: true,
      stage: true,
      transactionType: true,
      archivedAt: true,
    },
  },
  ownerMember: {
    select: {
      id: true,
      role: true,
      jobTitle: true,
      user: { select: { id: true, name: true, email: true } },
    },
  },
  createdBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.CrmInteractionInclude;

router.get("/interactions", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const contactId = req.query.contactId == null || req.query.contactId === "" ? null : asPositiveInt(req.query.contactId);
    const companyId = req.query.companyId == null || req.query.companyId === "" ? null : asPositiveInt(req.query.companyId);
    const opportunityId = req.query.opportunityId == null || req.query.opportunityId === "" ? null : asPositiveInt(req.query.opportunityId);
    const inventoryPropertyId = req.query.inventoryPropertyId == null || req.query.inventoryPropertyId === "" ? null : asPositiveInt(req.query.inventoryPropertyId);
    const ownerMemberId = req.query.ownerMemberId == null || req.query.ownerMemberId === "" ? null : asPositiveInt(req.query.ownerMemberId);
    const type = parseEnumValue<CrmInteractionType>(req.query.type, CRM_INTERACTION_TYPES, "type");
    const direction = parseEnumValue<CrmInteractionDirection>(req.query.direction, CRM_INTERACTION_DIRECTIONS, "direction");
    const sourceProvider = parseEnumValue<CrmInteractionProvider>(req.query.sourceProvider, CRM_INTERACTION_PROVIDERS, "sourceProvider");

    if (req.query.contactId != null && req.query.contactId !== "" && !contactId) throw new ApiError("VALIDATION_ERROR", "contactId must be a positive integer", 400);
    if (req.query.companyId != null && req.query.companyId !== "" && !companyId) throw new ApiError("VALIDATION_ERROR", "companyId must be a positive integer", 400);
    if (req.query.opportunityId != null && req.query.opportunityId !== "" && !opportunityId) throw new ApiError("VALIDATION_ERROR", "opportunityId must be a positive integer", 400);
    if (req.query.inventoryPropertyId != null && req.query.inventoryPropertyId !== "" && !inventoryPropertyId) throw new ApiError("VALIDATION_ERROR", "inventoryPropertyId must be a positive integer", 400);
    if (req.query.ownerMemberId != null && req.query.ownerMemberId !== "" && !ownerMemberId) throw new ApiError("VALIDATION_ERROR", "ownerMemberId must be a positive integer", 400);

    const limitRaw = req.query.limit == null || req.query.limit === "" ? 250 : Number(req.query.limit);
    if (!Number.isSafeInteger(limitRaw) || limitRaw < 1 || limitRaw > 1000) {
      throw new ApiError("VALIDATION_ERROR", "limit must be an integer from 1 to 1000", 400);
    }

    const items = await prisma.crmInteraction.findMany({
      where: {
        agencyId: workspace.agency.id,
        ...(contactId ? { contactId } : {}),
        ...(companyId ? { companyId } : {}),
        ...(opportunityId ? { opportunityId } : {}),
        ...(inventoryPropertyId ? { inventoryPropertyId } : {}),
        ...(ownerMemberId ? { ownerMemberId } : {}),
        ...(type ? { type } : {}),
        ...(direction ? { direction } : {}),
        ...(sourceProvider ? { sourceProvider } : {}),
      },
      include: interactionInclude,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: limitRaw,
    });

    return res.json({
      ok: true,
      agency: { id: workspace.agency.id, name: workspace.agency.name },
      items,
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.get("/interactions/:interactionId", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const interactionId = asPositiveInt(req.params.interactionId);
    if (!interactionId) throw new ApiError("VALIDATION_ERROR", "Invalid CRM interaction id", 400);

    const item = await prisma.crmInteraction.findFirst({
      where: { id: interactionId, agencyId: workspace.agency.id },
      include: interactionInclude,
    });
    if (!item) throw new ApiError("CRM_INTERACTION_NOT_FOUND", "CRM interaction not found", 404);
    return res.json({ ok: true, item });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/interactions", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const body = req.body || {};

    const contactId = body.contactId == null || body.contactId === "" ? null : asPositiveInt(body.contactId);
    const companyId = body.companyId == null || body.companyId === "" ? null : asPositiveInt(body.companyId);
    const opportunityId = body.opportunityId == null || body.opportunityId === "" ? null : asPositiveInt(body.opportunityId);
    const inventoryPropertyId = body.inventoryPropertyId == null || body.inventoryPropertyId === "" ? null : asPositiveInt(body.inventoryPropertyId);
    const ownerMemberId = body.ownerMemberId == null || body.ownerMemberId === "" ? workspace.membership.id : asPositiveInt(body.ownerMemberId);

    if (body.contactId != null && body.contactId !== "" && !contactId) throw new ApiError("VALIDATION_ERROR", "contactId must be a positive integer or null", 400);
    if (body.companyId != null && body.companyId !== "" && !companyId) throw new ApiError("VALIDATION_ERROR", "companyId must be a positive integer or null", 400);
    if (body.opportunityId != null && body.opportunityId !== "" && !opportunityId) throw new ApiError("VALIDATION_ERROR", "opportunityId must be a positive integer or null", 400);
    if (body.inventoryPropertyId != null && body.inventoryPropertyId !== "" && !inventoryPropertyId) throw new ApiError("VALIDATION_ERROR", "inventoryPropertyId must be a positive integer or null", 400);
    if (!ownerMemberId) throw new ApiError("VALIDATION_ERROR", "ownerMemberId must be a positive integer", 400);

    const type = parseEnumValue<CrmInteractionType>(body.type, CRM_INTERACTION_TYPES, "type");
    if (!type) throw new ApiError("VALIDATION_ERROR", "type is required", 400);
    const direction = parseEnumValue<CrmInteractionDirection>(body.direction, CRM_INTERACTION_DIRECTIONS, "direction") || CrmInteractionDirection.INTERNAL;
    const sourceProvider = parseEnumValue<CrmInteractionProvider>(body.sourceProvider, CRM_INTERACTION_PROVIDERS, "sourceProvider") || CrmInteractionProvider.MANUAL;
    const occurredAt = nullableDate(body.occurredAt, "occurredAt") || new Date();
    const durationMinutes = body.durationMinutes == null || body.durationMinutes === "" ? null : Number(body.durationMinutes);
    if (durationMinutes != null && (!Number.isSafeInteger(durationMinutes) || durationMinutes < 0 || durationMinutes > 14400)) {
      throw new ApiError("VALIDATION_ERROR", "durationMinutes must be an integer from 0 to 14400", 400);
    }

    await assertInteractionRelations(workspace.agency.id, {
      contactId,
      companyId,
      opportunityId,
      inventoryPropertyId,
      ownerMemberId,
    });

    const externalId = nullableString(body.externalId, 1000);
    if (sourceProvider !== CrmInteractionProvider.MANUAL && !externalId) {
      throw new ApiError("VALIDATION_ERROR", "externalId is required for synced interactions", 400);
    }

    const created = await prisma.$transaction(async (tx) => {
      const interaction = await tx.crmInteraction.create({
        data: {
          agencyId: workspace.agency.id,
          contactId,
          companyId,
          opportunityId,
          inventoryPropertyId,
          ownerMemberId,
          type,
          direction,
          subject: nullableString(body.subject, 500),
          summary: requiredString(body.summary, "summary", 20000),
          occurredAt,
          durationMinutes,
          sourceProvider,
          externalId,
          externalThreadId: nullableString(body.externalThreadId, 1000),
          externalUrl: nullableString(body.externalUrl, 2000),
          createdByUserId: workspace.membership.userId,
        },
        include: interactionInclude,
      });

      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: workspace.membership.userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: workspace.membership.userId,
          action: "CRM_INTERACTION_CREATED",
          entityType: "CrmInteraction",
          entityId: String(interaction.id),
          afterState: interactionSnapshot(interaction),
          changedFields: ["crmInteractions"],
          metadata: {
            source: "agencyContacts",
            interactionId: interaction.id,
            contactId,
            companyId,
            opportunityId,
            inventoryPropertyId,
          },
          ...requestMeta(req),
        },
      });

      return interaction;
    });

    return res.status(201).json({ ok: true, item: created });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({
        ok: false,
        error: "CRM_INTERACTION_DUPLICATE",
        message: "This synced interaction has already been recorded",
      });
    }
    return handleError(res, error);
  }
});

router.patch("/interactions/:interactionId", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const interactionId = asPositiveInt(req.params.interactionId);
    if (!interactionId) throw new ApiError("VALIDATION_ERROR", "Invalid CRM interaction id", 400);

    const before = await prisma.crmInteraction.findFirst({
      where: { id: interactionId, agencyId: workspace.agency.id },
    });
    if (!before) throw new ApiError("CRM_INTERACTION_NOT_FOUND", "CRM interaction not found", 404);

    const body = req.body || {};
    const data: Prisma.CrmInteractionUncheckedUpdateInput = {};

    if ("contactId" in body) {
      const value = body.contactId == null || body.contactId === "" ? null : asPositiveInt(body.contactId);
      if (body.contactId != null && body.contactId !== "" && !value) throw new ApiError("VALIDATION_ERROR", "contactId must be a positive integer or null", 400);
      data.contactId = value;
    }
    if ("companyId" in body) {
      const value = body.companyId == null || body.companyId === "" ? null : asPositiveInt(body.companyId);
      if (body.companyId != null && body.companyId !== "" && !value) throw new ApiError("VALIDATION_ERROR", "companyId must be a positive integer or null", 400);
      data.companyId = value;
    }
    if ("opportunityId" in body) {
      const value = body.opportunityId == null || body.opportunityId === "" ? null : asPositiveInt(body.opportunityId);
      if (body.opportunityId != null && body.opportunityId !== "" && !value) throw new ApiError("VALIDATION_ERROR", "opportunityId must be a positive integer or null", 400);
      data.opportunityId = value;
    }
    if ("inventoryPropertyId" in body) {
      const value = body.inventoryPropertyId == null || body.inventoryPropertyId === "" ? null : asPositiveInt(body.inventoryPropertyId);
      if (body.inventoryPropertyId != null && body.inventoryPropertyId !== "" && !value) throw new ApiError("VALIDATION_ERROR", "inventoryPropertyId must be a positive integer or null", 400);
      data.inventoryPropertyId = value;
    }
    if ("ownerMemberId" in body) {
      const value = body.ownerMemberId == null || body.ownerMemberId === "" ? null : asPositiveInt(body.ownerMemberId);
      if (body.ownerMemberId != null && body.ownerMemberId !== "" && !value) throw new ApiError("VALIDATION_ERROR", "ownerMemberId must be a positive integer or null", 400);
      data.ownerMemberId = value;
    }
    if ("type" in body) {
      const value = parseEnumValue<CrmInteractionType>(body.type, CRM_INTERACTION_TYPES, "type");
      if (!value) throw new ApiError("VALIDATION_ERROR", "type is required", 400);
      data.type = value;
    }
    if ("direction" in body) {
      const value = parseEnumValue<CrmInteractionDirection>(body.direction, CRM_INTERACTION_DIRECTIONS, "direction");
      if (!value) throw new ApiError("VALIDATION_ERROR", "direction is required", 400);
      data.direction = value;
    }
    if ("subject" in body) data.subject = nullableString(body.subject, 500);
    if ("summary" in body) data.summary = requiredString(body.summary, "summary", 20000);
    if ("occurredAt" in body) {
      const value = nullableDate(body.occurredAt, "occurredAt");
      if (!value) throw new ApiError("VALIDATION_ERROR", "occurredAt is required", 400);
      data.occurredAt = value;
    }
    if ("durationMinutes" in body) {
      const value = body.durationMinutes == null || body.durationMinutes === "" ? null : Number(body.durationMinutes);
      if (value != null && (!Number.isSafeInteger(value) || value < 0 || value > 14400)) {
        throw new ApiError("VALIDATION_ERROR", "durationMinutes must be an integer from 0 to 14400", 400);
      }
      data.durationMinutes = value;
    }
    if ("sourceProvider" in body) {
      const value = parseEnumValue<CrmInteractionProvider>(body.sourceProvider, CRM_INTERACTION_PROVIDERS, "sourceProvider");
      if (!value) throw new ApiError("VALIDATION_ERROR", "sourceProvider is required", 400);
      data.sourceProvider = value;
    }
    if ("externalId" in body) data.externalId = nullableString(body.externalId, 1000);
    if ("externalThreadId" in body) data.externalThreadId = nullableString(body.externalThreadId, 1000);
    if ("externalUrl" in body) data.externalUrl = nullableString(body.externalUrl, 2000);

    const effective = {
      contactId: "contactId" in body ? (data.contactId as number | null) : before.contactId,
      companyId: "companyId" in body ? (data.companyId as number | null) : before.companyId,
      opportunityId: "opportunityId" in body ? (data.opportunityId as number | null) : before.opportunityId,
      inventoryPropertyId: "inventoryPropertyId" in body ? (data.inventoryPropertyId as number | null) : before.inventoryPropertyId,
      ownerMemberId: "ownerMemberId" in body ? (data.ownerMemberId as number | null) : before.ownerMemberId,
    };
    await assertInteractionRelations(workspace.agency.id, effective);

    const effectiveProvider = ("sourceProvider" in body ? data.sourceProvider : before.sourceProvider) as CrmInteractionProvider;
    const effectiveExternalId = "externalId" in body ? (data.externalId as string | null) : before.externalId;
    if (effectiveProvider !== CrmInteractionProvider.MANUAL && !effectiveExternalId) {
      throw new ApiError("VALIDATION_ERROR", "externalId is required for synced interactions", 400);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.crmInteraction.update({
        where: { id: interactionId },
        data,
        include: interactionInclude,
      });
      const beforeSnapshot = interactionSnapshot(before);
      const afterSnapshot = interactionSnapshot(item);
      const changed = snapshotChangedFields(beforeSnapshot, afterSnapshot);
      if (changed.length > 0) {
        await tx.agencyAuditLog.create({
          data: {
            agencyId: workspace.agency.id,
            actorUserId: workspace.membership.userId,
            actorAgencyMemberId: workspace.membership.id,
            effectiveUserId: workspace.membership.userId,
            action: "CRM_INTERACTION_UPDATED",
            entityType: "CrmInteraction",
            entityId: String(interactionId),
            beforeState: beforeSnapshot,
            afterState: afterSnapshot,
            changedFields: changed.map((field) => `crmInteractions.${field}`),
            metadata: {
              source: "agencyContacts",
              interactionId,
              contactId: item.contactId,
              companyId: item.companyId,
              opportunityId: item.opportunityId,
              inventoryPropertyId: item.inventoryPropertyId,
            },
            ...requestMeta(req),
          },
        });
      }
      return item;
    });

    return res.json({ ok: true, item: updated });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({
        ok: false,
        error: "CRM_INTERACTION_DUPLICATE",
        message: "This synced interaction has already been recorded",
      });
    }
    return handleError(res, error);
  }
});

router.delete("/interactions/:interactionId", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const interactionId = asPositiveInt(req.params.interactionId);
    if (!interactionId) throw new ApiError("VALIDATION_ERROR", "Invalid CRM interaction id", 400);

    const before = await prisma.crmInteraction.findFirst({
      where: { id: interactionId, agencyId: workspace.agency.id },
    });
    if (!before) throw new ApiError("CRM_INTERACTION_NOT_FOUND", "CRM interaction not found", 404);

    await prisma.$transaction(async (tx) => {
      await tx.crmInteraction.delete({ where: { id: interactionId } });
      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: workspace.membership.userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: workspace.membership.userId,
          action: "CRM_INTERACTION_DELETED",
          entityType: "CrmInteraction",
          entityId: String(interactionId),
          beforeState: interactionSnapshot(before),
          changedFields: ["crmInteractions"],
          metadata: {
            source: "agencyContacts",
            interactionId,
            contactId: before.contactId,
            companyId: before.companyId,
            opportunityId: before.opportunityId,
            inventoryPropertyId: before.inventoryPropertyId,
          },
          ...requestMeta(req),
        },
      });
    });

    return res.json({ ok: true, deletedInteractionId: interactionId });
  } catch (error) {
    return handleError(res, error);
  }
});

/* Notes */
router.post("/:id/notes", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const id = asPositiveInt(req.params.id);
    if (!id) throw new ApiError("VALIDATION_ERROR", "Invalid CRM contact id", 400);
    const contact = await prisma.professionalContact.findFirst({
      where: { id, agencyId: workspace.agency.id },
      select: { id: true, isArchived: true },
    });
    if (!contact) throw new ApiError("CONTACT_NOT_FOUND", "CRM contact not found", 404);
    if (contact.isArchived) {
      throw new ApiError("CONTACT_ARCHIVED", "Restore this CRM contact before adding notes", 409);
    }
    const userId = workspace.membership.userId;
    const body = requiredString(req.body?.body, "body", 10000);
    const created = await prisma.$transaction(async (tx) => {
      const note = await tx.crmNote.create({
        data: { agencyId: workspace.agency.id, contactId: id, body, createdByUserId: userId },
        include: { createdBy: { select: { id: true, name: true, email: true } } },
      });
      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: userId,
          action: "CRM_NOTE_CREATED",
          entityType: "ProfessionalContact",
          entityId: String(id),
          afterState: { noteId: note.id, contactId: id, body: note.body, createdAt: note.createdAt },
          changedFields: ["crmNotes"],
          metadata: { source: "agencyContacts", noteId: note.id },
          ...requestMeta(req),
        },
      });
      return note;
    });
    return res.status(201).json({ ok: true, item: created });
  } catch (error) {
    return handleError(res, error);
  }
});

router.patch("/:id/notes/:noteId", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const id = asPositiveInt(req.params.id);
    const noteId = asPositiveInt(req.params.noteId);
    if (!id || !noteId) {
      throw new ApiError("VALIDATION_ERROR", "Invalid CRM contact or note id", 400);
    }
    const before = await prisma.crmNote.findFirst({
      where: { id: noteId, contactId: id, agencyId: workspace.agency.id },
    });
    if (!before) throw new ApiError("CRM_NOTE_NOT_FOUND", "CRM note not found", 404);
    const body = requiredString(req.body?.body, "body", 10000);
    const updated = await prisma.$transaction(async (tx) => {
      const note = await tx.crmNote.update({
        where: { id: noteId },
        data: { body },
        include: { createdBy: { select: { id: true, name: true, email: true } } },
      });
      if (before.body !== note.body) {
        await tx.agencyAuditLog.create({
          data: {
            agencyId: workspace.agency.id,
            actorUserId: workspace.membership.userId,
            actorAgencyMemberId: workspace.membership.id,
            effectiveUserId: workspace.membership.userId,
            action: "CRM_NOTE_UPDATED",
            entityType: "ProfessionalContact",
            entityId: String(id),
            beforeState: { noteId: before.id, contactId: id, body: before.body },
            afterState: { noteId: note.id, contactId: id, body: note.body },
            changedFields: ["crmNotes.body"],
            metadata: { source: "agencyContacts", noteId },
            ...requestMeta(req),
          },
        });
      }
      return note;
    });
    return res.json({ ok: true, item: updated });
  } catch (error) {
    return handleError(res, error);
  }
});

router.delete("/:id/notes/:noteId", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const id = asPositiveInt(req.params.id);
    const noteId = asPositiveInt(req.params.noteId);
    if (!id || !noteId) {
      throw new ApiError("VALIDATION_ERROR", "Invalid CRM contact or note id", 400);
    }
    const before = await prisma.crmNote.findFirst({
      where: { id: noteId, contactId: id, agencyId: workspace.agency.id },
    });
    if (!before) throw new ApiError("CRM_NOTE_NOT_FOUND", "CRM note not found", 404);
    await prisma.$transaction(async (tx) => {
      await tx.crmNote.delete({ where: { id: noteId } });
      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: workspace.membership.userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: workspace.membership.userId,
          action: "CRM_NOTE_DELETED",
          entityType: "ProfessionalContact",
          entityId: String(id),
          beforeState: { noteId: before.id, contactId: id, body: before.body, createdAt: before.createdAt },
          changedFields: ["crmNotes"],
          metadata: { source: "agencyContacts", noteId },
          ...requestMeta(req),
        },
      });
    });
    return res.json({ ok: true, deletedNoteId: noteId });
  } catch (error) {
    return handleError(res, error);
  }
});

/* Follow-ups */
router.post("/:id/follow-ups", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const id = asPositiveInt(req.params.id);
    if (!id) throw new ApiError("VALIDATION_ERROR", "Invalid CRM contact id", 400);
    const contact = await prisma.professionalContact.findFirst({
      where: { id, agencyId: workspace.agency.id },
      select: { id: true, isArchived: true },
    });
    if (!contact) throw new ApiError("CONTACT_NOT_FOUND", "CRM contact not found", 404);
    if (contact.isArchived) {
      throw new ApiError("CONTACT_ARCHIVED", "Restore this CRM contact before adding follow-ups", 409);
    }
    const dueAt = nullableDate(req.body?.dueAt, "dueAt");
    if (!dueAt) throw new ApiError("VALIDATION_ERROR", "dueAt is required", 400);
    const userId = workspace.membership.userId;
    const assignedMemberId = req.body?.assignedMemberId == null || req.body?.assignedMemberId === ""
      ? workspace.membership.id
      : asPositiveInt(req.body?.assignedMemberId);
    if (!assignedMemberId) throw new ApiError("VALIDATION_ERROR", "assignedMemberId must be a positive integer", 400);
    await assertActiveAgencyMember(assignedMemberId, workspace.agency.id);
    const priority = parseEnumValue<CrmTaskPriority>(req.body?.priority, CRM_TASK_PRIORITIES, "priority") || CrmTaskPriority.NORMAL;
    const created = await prisma.$transaction(async (tx) => {
      const followUp = await tx.crmFollowUp.create({
        data: {
          agencyId: workspace.agency.id,
          contactId: id,
          assignedMemberId,
          title: requiredString(req.body?.title, "title", 300),
          description: nullableString(req.body?.description, 5000),
          dueAt,
          priority,
          createdByUserId: userId,
          updatedByUserId: userId,
        },
      });
      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: userId,
          action: "CRM_FOLLOW_UP_CREATED",
          entityType: "ProfessionalContact",
          entityId: String(id),
          afterState: {
            id: followUp.id,
            contactId: followUp.contactId,
            title: followUp.title,
            description: followUp.description,
            dueAt: followUp.dueAt,
            completedAt: followUp.completedAt,
            assignedMemberId: followUp.assignedMemberId,
            priority: followUp.priority,
          },
          changedFields: ["crmFollowUps"],
          metadata: { source: "agencyContacts", followUpId: followUp.id },
          ...requestMeta(req),
        },
      });
      return followUp;
    });
    return res.status(201).json({ ok: true, item: created });
  } catch (error) {
    return handleError(res, error);
  }
});

router.patch("/:id/follow-ups/:followUpId", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const id = asPositiveInt(req.params.id);
    const followUpId = asPositiveInt(req.params.followUpId);
    if (!id || !followUpId) {
      throw new ApiError("VALIDATION_ERROR", "Invalid CRM contact or follow-up id", 400);
    }
    const before = await prisma.crmFollowUp.findFirst({
      where: { id: followUpId, contactId: id, agencyId: workspace.agency.id },
    });
    if (!before) throw new ApiError("CRM_FOLLOW_UP_NOT_FOUND", "CRM follow-up not found", 404);
    const body = req.body || {};
    const data: Prisma.CrmFollowUpUncheckedUpdateInput = {
      updatedByUserId: workspace.membership.userId,
    };
    if ("title" in body) data.title = requiredString(body.title, "title", 300);
    if ("description" in body) data.description = nullableString(body.description, 5000);
    if ("dueAt" in body) {
      const dueAt = nullableDate(body.dueAt, "dueAt");
      if (!dueAt) throw new ApiError("VALIDATION_ERROR", "dueAt is required", 400);
      data.dueAt = dueAt;
    }
    if ("completedAt" in body) data.completedAt = nullableDate(body.completedAt, "completedAt");
    if ("completed" in body) {
      const completed = body.completed === true || String(body.completed || "").toLowerCase() === "true";
      data.completedAt = completed ? new Date() : null;
    }
    if ("assignedMemberId" in body) {
      const assignedMemberId = body.assignedMemberId == null || body.assignedMemberId === "" ? null : asPositiveInt(body.assignedMemberId);
      if (body.assignedMemberId != null && body.assignedMemberId !== "" && !assignedMemberId) {
        throw new ApiError("VALIDATION_ERROR", "assignedMemberId must be a positive integer or null", 400);
      }
      await assertActiveAgencyMember(assignedMemberId, workspace.agency.id);
      data.assignedMemberId = assignedMemberId;
    }
    if ("priority" in body) {
      const priority = parseEnumValue<CrmTaskPriority>(body.priority, CRM_TASK_PRIORITIES, "priority");
      if (!priority) throw new ApiError("VALIDATION_ERROR", "priority is required", 400);
      data.priority = priority;
    }
    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.crmFollowUp.update({ where: { id: followUpId }, data });
      const changed = snapshotChangedFields(before, updated);
      if (changed.length > 0) {
        await tx.agencyAuditLog.create({
          data: {
            agencyId: workspace.agency.id,
            actorUserId: workspace.membership.userId,
            actorAgencyMemberId: workspace.membership.id,
            effectiveUserId: workspace.membership.userId,
            action:
              !before.completedAt && updated.completedAt
                ? "CRM_FOLLOW_UP_COMPLETED"
                : before.completedAt && !updated.completedAt
                  ? "CRM_FOLLOW_UP_REOPENED"
                  : "CRM_FOLLOW_UP_UPDATED",
            entityType: "ProfessionalContact",
            entityId: String(id),
            beforeState: {
              id: before.id,
              title: before.title,
              description: before.description,
              dueAt: before.dueAt,
              completedAt: before.completedAt,
              assignedMemberId: before.assignedMemberId,
              priority: before.priority,
            },
            afterState: {
              id: updated.id,
              title: updated.title,
              description: updated.description,
              dueAt: updated.dueAt,
              completedAt: updated.completedAt,
              assignedMemberId: updated.assignedMemberId,
              priority: updated.priority,
            },
            changedFields: changed,
            metadata: { source: "agencyContacts", followUpId },
            ...requestMeta(req),
          },
        });
      }
      return updated;
    });
    return res.json({ ok: true, item: after });
  } catch (error) {
    return handleError(res, error);
  }
});

router.delete("/:id/follow-ups/:followUpId", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const id = asPositiveInt(req.params.id);
    const followUpId = asPositiveInt(req.params.followUpId);
    if (!id || !followUpId) {
      throw new ApiError("VALIDATION_ERROR", "Invalid CRM contact or follow-up id", 400);
    }
    const before = await prisma.crmFollowUp.findFirst({
      where: { id: followUpId, contactId: id, agencyId: workspace.agency.id },
    });
    if (!before) throw new ApiError("CRM_FOLLOW_UP_NOT_FOUND", "CRM follow-up not found", 404);
    await prisma.$transaction(async (tx) => {
      await tx.crmFollowUp.delete({ where: { id: followUpId } });
      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: workspace.membership.userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: workspace.membership.userId,
          action: "CRM_FOLLOW_UP_DELETED",
          entityType: "ProfessionalContact",
          entityId: String(id),
          beforeState: {
            id: before.id,
            title: before.title,
            description: before.description,
            dueAt: before.dueAt,
            completedAt: before.completedAt,
            assignedMemberId: before.assignedMemberId,
            priority: before.priority,
          },
          changedFields: ["crmFollowUps"],
          metadata: { source: "agencyContacts", followUpId },
          ...requestMeta(req),
        },
      });
    });
    return res.json({ ok: true, deletedFollowUpId: followUpId });
  } catch (error) {
    return handleError(res, error);
  }
});

/* Archive / restore */
router.post("/:id/archive", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const id = asPositiveInt(req.params.id);
    if (!id) throw new ApiError("VALIDATION_ERROR", "Invalid CRM contact id", 400);
    const before = await prisma.professionalContact.findFirst({
      where: { id, agencyId: workspace.agency.id },
      include: { propertyLinks: { where: { archivedAt: null }, select: { id: true } } },
    });
    if (!before) throw new ApiError("CONTACT_NOT_FOUND", "CRM contact not found", 404);
    if (before.isArchived) return res.json({ ok: true, item: before, alreadyArchived: true });
    if (before.propertyLinks.length > 0) {
      throw new ApiError(
        "CONTACT_HAS_ACTIVE_PROPERTY_LINKS",
        "Unlink this contact from active Inventory properties before archiving it",
        409,
      );
    }
    const archivedAt = new Date();
    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.professionalContact.update({
        where: { id },
        data: { isArchived: true, archivedAt, updatedByUserId: workspace.membership.userId },
      });
      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: workspace.membership.userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: workspace.membership.userId,
          action: "CRM_CONTACT_ARCHIVED",
          entityType: "ProfessionalContact",
          entityId: String(id),
          beforeState: contactSnapshot(before),
          afterState: contactSnapshot(updated),
          changedFields: ["isArchived", "archivedAt"],
          metadata: { source: "agencyContacts" },
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

router.post("/:id/restore", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const id = asPositiveInt(req.params.id);
    if (!id) throw new ApiError("VALIDATION_ERROR", "Invalid CRM contact id", 400);
    const before = await prisma.professionalContact.findFirst({
      where: { id, agencyId: workspace.agency.id },
    });
    if (!before) throw new ApiError("CONTACT_NOT_FOUND", "CRM contact not found", 404);
    if (!before.isArchived) return res.json({ ok: true, item: before, alreadyActive: true });
    await assertNoDuplicateActiveEmail(workspace.agency.id, before.primaryEmail, id);
    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.professionalContact.update({
        where: { id },
        data: { isArchived: false, archivedAt: null, updatedByUserId: workspace.membership.userId },
      });
      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: workspace.membership.userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: workspace.membership.userId,
          action: "CRM_CONTACT_RESTORED",
          entityType: "ProfessionalContact",
          entityId: String(id),
          beforeState: contactSnapshot(before),
          afterState: contactSnapshot(updated),
          changedFields: ["isArchived", "archivedAt"],
          metadata: { source: "agencyContacts" },
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

/* Create / update / detail */
router.post("/", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const body = req.body || {};
    const firstName = nullableString(body.firstName, 120);
    const lastName = nullableString(body.lastName, 120);
    const companyName = nullableString(body.companyName, 200);
    const primaryEmail = nullableString(body.primaryEmail, 320)?.toLowerCase() || null;
    const phoneNumber = nullableString(body.phoneNumber, 80);
    const roles = parseProfessionalContactRoles(body.roles);
    const notes = nullableString(body.notes, 5000);
    const companyId = body.companyId == null || body.companyId === "" ? null : asPositiveInt(body.companyId);
    if (body.companyId != null && body.companyId !== "" && companyId == null) {
      throw new ApiError("VALIDATION_ERROR", "companyId must be a positive integer or null", 400);
    }
    if (!firstName && !lastName && !companyName && !primaryEmail && !phoneNumber) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Provide a name, company, email or phone number for the contact",
        400,
      );
    }
    await assertCompanyForAgency(companyId, workspace.agency.id);
    await assertNoDuplicateActiveEmail(workspace.agency.id, primaryEmail);
    const userId = workspace.membership.userId;
    const created = await prisma.$transaction(async (tx) => {
      const contact = await tx.professionalContact.create({
        data: {
          agencyId: workspace.agency.id,
          companyId,
          firstName,
          lastName,
          companyName,
          primaryEmail,
          phoneNumber,
          roles,
          notes,
          createdByUserId: userId,
          updatedByUserId: userId,
        },
        include: { company: true },
      });
      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: userId,
          action: "CRM_CONTACT_CREATED",
          entityType: "ProfessionalContact",
          entityId: String(contact.id),
          afterState: contactSnapshot(contact),
          changedFields: Object.keys(contactSnapshot(contact) || {}),
          metadata: { source: "agencyContacts" },
          ...requestMeta(req),
        },
      });
      return contact;
    });
    return res.status(201).json({ ok: true, item: created });
  } catch (error) {
    return handleError(res, error);
  }
});

router.patch("/:id", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const id = asPositiveInt(req.params.id);
    if (!id) throw new ApiError("VALIDATION_ERROR", "Invalid CRM contact id", 400);
    const before = await prisma.professionalContact.findFirst({
      where: { id, agencyId: workspace.agency.id },
    });
    if (!before) throw new ApiError("CONTACT_NOT_FOUND", "CRM contact not found", 404);
    if (before.isArchived) {
      throw new ApiError("CONTACT_ARCHIVED", "Restore this CRM contact before editing it", 409);
    }
    const body = req.body || {};
    const data: Prisma.ProfessionalContactUncheckedUpdateInput = {
      updatedByUserId: workspace.membership.userId,
    };
    if ("firstName" in body) data.firstName = nullableString(body.firstName, 120);
    if ("lastName" in body) data.lastName = nullableString(body.lastName, 120);
    if ("companyName" in body) data.companyName = nullableString(body.companyName, 200);
    if ("primaryEmail" in body) {
      const primaryEmail = nullableString(body.primaryEmail, 320)?.toLowerCase() || null;
      await assertNoDuplicateActiveEmail(workspace.agency.id, primaryEmail, id);
      data.primaryEmail = primaryEmail;
    }
    if ("phoneNumber" in body) data.phoneNumber = nullableString(body.phoneNumber, 80);
    if ("roles" in body) data.roles = parseProfessionalContactRoles(body.roles);
    if ("notes" in body) data.notes = nullableString(body.notes, 5000);
    if ("companyId" in body) {
      const companyId = body.companyId == null || body.companyId === "" ? null : asPositiveInt(body.companyId);
      if (body.companyId != null && body.companyId !== "" && companyId == null) {
        throw new ApiError("VALIDATION_ERROR", "companyId must be a positive integer or null", 400);
      }
      await assertCompanyForAgency(companyId, workspace.agency.id);
      data.companyId = companyId;
    }
    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.professionalContact.update({
        where: { id },
        data,
        include: { company: true },
      });
      const changed = snapshotChangedFields(contactSnapshot(before), contactSnapshot(updated));
      if (changed.length > 0) {
        await tx.agencyAuditLog.create({
          data: {
            agencyId: workspace.agency.id,
            actorUserId: workspace.membership.userId,
            actorAgencyMemberId: workspace.membership.id,
            effectiveUserId: workspace.membership.userId,
            action: "CRM_CONTACT_UPDATED",
            entityType: "ProfessionalContact",
            entityId: String(id),
            beforeState: contactSnapshot(before),
            afterState: contactSnapshot(updated),
            changedFields: changed,
            metadata: { source: "agencyContacts" },
            ...requestMeta(req),
          },
        });
      }
      return updated;
    });
    return res.json({ ok: true, item: after });
  } catch (error) {
    return handleError(res, error);
  }
});

router.get("/:id", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const id = asPositiveInt(req.params.id);
    if (!id) throw new ApiError("VALIDATION_ERROR", "Invalid CRM contact id", 400);
    const item = await crmContactForAgency(id, workspace.agency.id);
    if (!item) throw new ApiError("CONTACT_NOT_FOUND", "CRM contact not found", 404);
    const activity = await prisma.agencyAuditLog.findMany({
      where: {
        agencyId: workspace.agency.id,
        OR: [
          {
            entityType: "ProfessionalContact",
            entityId: String(id),
          },
          {
            entityType: "InventoryProperty",
            action: {
              in: [
                "INVENTORY_CONTACT_LINKED",
                "INVENTORY_CONTACT_UPDATED",
                "INVENTORY_CONTACT_UNLINKED",
              ],
            },
            metadata: {
              path: ["contactId"],
              equals: id,
            },
          },
        ],
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
        createdAt: true,
        actorUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 250,
    });

    const inventoryIds = Array.from(
      new Set(
        activity
          .filter((entry) => entry.entityType === "InventoryProperty")
          .map((entry) => Number(entry.entityId))
          .filter((value) => Number.isSafeInteger(value) && value > 0)
      )
    );
    const inventoryItems = inventoryIds.length
      ? await prisma.inventoryProperty.findMany({
          where: { agencyId: workspace.agency.id, id: { in: inventoryIds } },
          select: {
            id: true,
            address1: true,
            address2: true,
            city: true,
            county: true,
            eircode: true,
            stage: true,
            transactionType: true,
            archivedAt: true,
          },
        })
      : [];
    const inventoryById = new Map(inventoryItems.map((property) => [property.id, property]));

    return res.json({
      ok: true,
      item: contactForResponse(item),
      activity: activity.map((entry) => ({
        ...entry,
        id: entry.id.toString(),
        inventoryProperty:
          entry.entityType === "InventoryProperty"
            ? inventoryById.get(Number(entry.entityId)) || null
            : null,
      })),
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

  console.error("AGENCY_CONTACTS_ERROR:", error);
  return res.status(500).json({
    ok: false,
    error: "AGENCY_CONTACTS_FAILED",
    message: "Could not complete the CRM request",
  });
}

export default router;
