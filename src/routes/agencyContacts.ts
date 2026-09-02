import { Router, Request } from "express";
import { Prisma, ProfessionalContactRole } from "@prisma/client";

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
    const created = await prisma.$transaction(async (tx) => {
      const followUp = await tx.crmFollowUp.create({
        data: {
          agencyId: workspace.agency.id,
          contactId: id,
          title: requiredString(req.body?.title, "title", 300),
          description: nullableString(req.body?.description, 5000),
          dueAt,
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
            action: "CRM_FOLLOW_UP_UPDATED",
            entityType: "ProfessionalContact",
            entityId: String(id),
            beforeState: {
              id: before.id,
              title: before.title,
              description: before.description,
              dueAt: before.dueAt,
              completedAt: before.completedAt,
            },
            afterState: {
              id: updated.id,
              title: updated.title,
              description: updated.description,
              dueAt: updated.dueAt,
              completedAt: updated.completedAt,
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
        entityType: "ProfessionalContact",
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
        createdAt: true,
        actorUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 250,
    });
    return res.json({
      ok: true,
      item,
      activity: activity.map((entry) => ({ ...entry, id: entry.id.toString() })),
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
