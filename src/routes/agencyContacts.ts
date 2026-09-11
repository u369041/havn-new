import { Router, Request } from "express";
import crypto from "crypto";
import { ImapFlow } from "imapflow";
import { createDAVClient } from "tsdav";
import { promises as dns } from "dns";
import {
  Prisma,
  ProfessionalContactRole,
  CrmTaskPriority,
  CrmOpportunityType,
  CrmOpportunityStage,
  CrmInteractionType,
  CrmInteractionDirection,
  CrmInteractionProvider,
  CrmIntegrationProvider,
  CrmIntegrationStatus,
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


// Microsoft OAuth callback is intentionally public: Microsoft redirects the browser
// here without HAVN's Bearer token. The signed, short-lived state binds the callback
// to the agency member/user that initiated the connection.
router.get("/integrations/microsoft/callback", async (req, res) => {
  const successUrl = "https://havn.ie/app/index.html?microsoft_oauth=connected#/crm";
  const errorUrl = (message: string) =>
    `https://havn.ie/app/index.html?microsoft_oauth=error&microsoft_message=${encodeURIComponent(message)}#/crm`;

  try {
    const code = requiredString(req.query?.code, "code", 10000);
    const state = requiredString(req.query?.state, "state", 10000);
    const payload = decodeMicrosoftState(state);
    const userId = asPositiveInt(payload?.userId);
    if (!userId) {
      throw new ApiError(
        "CRM_MICROSOFT_OAUTH_STATE_INVALID",
        "Microsoft connection state does not contain a valid user",
        400,
      );
    }

    const workspace = await requireAgencyWorkspace(userId);
    assertCanManageCrm(workspace);
    if (
      Number(payload.agencyId) !== workspace.agency.id ||
      Number(payload.memberId) !== workspace.membership.id ||
      Number(payload.userId) !== workspace.membership.userId
    ) {
      throw new ApiError(
        "CRM_MICROSOFT_OAUTH_STATE_INVALID",
        "Microsoft connection state does not match this user",
        403,
      );
    }

    const existing = await microsoftConnectionForWorkspace(workspace);
    const tokens = await microsoftTokenExchange(new URLSearchParams({
      client_id: requiredMicrosoftEnv("MICROSOFT_CLIENT_ID"),
      client_secret: requiredMicrosoftEnv("MICROSOFT_CLIENT_SECRET"),
      code,
      grant_type: "authorization_code",
      redirect_uri: microsoftRedirectUri(),
      scope: MICROSOFT_OAUTH_SCOPES.join(" "),
    }));
    if (!tokens.access_token) {
      throw new ApiError(
        "CRM_MICROSOFT_OAUTH_FAILED",
        "Microsoft did not return an access token",
        400,
      );
    }

    const profile = await microsoftJson<any>(
      "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    const accountEmail = String(
      profile?.mail || profile?.userPrincipalName || "",
    ).trim().toLowerCase();
    if (!accountEmail) {
      throw new ApiError(
        "CRM_MICROSOFT_ACCOUNT_EMAIL_MISSING",
        "Microsoft account email could not be resolved",
        400,
      );
    }

    const grantedScopes = String(
      tokens.scope || MICROSOFT_OAUTH_SCOPES.join(" "),
    )
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter(Boolean);

    const connection = await prisma.crmIntegrationConnection.upsert({
      where: {
        agencyId_memberId_provider_connectionKey: {
          agencyId: workspace.agency.id,
          memberId: workspace.membership.id,
          provider: MICROSOFT_PROVIDER,
          connectionKey: MICROSOFT_CONNECTION_KEY,
        },
      },
      create: {
        agencyId: workspace.agency.id,
        memberId: workspace.membership.id,
        userId: workspace.membership.userId,
        provider: MICROSOFT_PROVIDER,
        connectionKey: MICROSOFT_CONNECTION_KEY,
        status: CrmIntegrationStatus.CONNECTED,
        accountEmail,
        externalAccountId: nullableString(profile?.id, 500),
        scopes: grantedScopes,
        accessTokenEncrypted: encryptMicrosoftSecret(tokens.access_token),
        refreshTokenEncrypted: tokens.refresh_token
          ? encryptMicrosoftSecret(tokens.refresh_token)
          : null,
        tokenExpiresAt: new Date(
          Date.now() + Math.max(60, Number(tokens.expires_in || 3600)) * 1000,
        ),
      },
      update: {
        userId: workspace.membership.userId,
        status: CrmIntegrationStatus.CONNECTED,
        accountEmail,
        externalAccountId: nullableString(profile?.id, 500),
        scopes: grantedScopes,
        accessTokenEncrypted: encryptMicrosoftSecret(tokens.access_token),
        refreshTokenEncrypted: tokens.refresh_token
          ? encryptMicrosoftSecret(tokens.refresh_token)
          : existing?.refreshTokenEncrypted || null,
        tokenExpiresAt: new Date(
          Date.now() + Math.max(60, Number(tokens.expires_in || 3600)) * 1000,
        ),
        gmailHistoryId:
          existing?.accountEmail && existing.accountEmail !== accountEmail
            ? null
            : existing?.gmailHistoryId,
        calendarSyncToken:
          existing?.accountEmail && existing.accountEmail !== accountEmail
            ? null
            : existing?.calendarSyncToken,
        lastErrorAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        disconnectedAt: null,
      },
    });

    await prisma.agencyAuditLog.create({
      data: {
        agencyId: workspace.agency.id,
        actorUserId: workspace.membership.userId,
        actorAgencyMemberId: workspace.membership.id,
        effectiveUserId: workspace.membership.userId,
        action: "CRM_MICROSOFT_CONNECTED",
        entityType: "CrmIntegrationConnection",
        entityId: String(connection.id),
        afterState: {
          provider: connection.provider,
          status: connection.status,
          accountEmail,
        },
        changedFields: ["crmIntegrationConnections"],
        metadata: {
          source: "agencyContacts",
          provider: "MICROSOFT",
          accountEmail,
          oauthCallback: "backend",
        },
        ...requestMeta(req),
      },
    });

    console.info("Microsoft CRM OAuth callback completed", {
      agencyId: workspace.agency.id,
      memberId: workspace.membership.id,
      accountEmail,
    });
    return res.redirect(302, successUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Microsoft connection failed";
    console.error("Microsoft CRM OAuth callback failed", error);
    return res.redirect(302, errorUrl(message));
  }
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


async function assertFollowUpRelations(agencyId: number, values: {
  contactId?: number | null;
  opportunityId?: number | null;
}) {
  const contactId = values.contactId ?? null;
  const opportunityId = values.opportunityId ?? null;

  if (contactId == null && opportunityId == null) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "A follow-up must be linked to a CRM contact, an opportunity, or both",
      400,
    );
  }

  if (contactId != null) {
    const contact = await prisma.professionalContact.findFirst({
      where: { id: contactId, agencyId, isArchived: false },
      select: { id: true },
    });
    if (!contact) {
      throw new ApiError(
        "CONTACT_NOT_FOUND",
        "Follow-up contact must be an active CRM contact in this agency",
        404,
      );
    }
  }

  if (opportunityId != null) {
    const opportunity = await prisma.crmOpportunity.findFirst({
      where: { id: opportunityId, agencyId, isArchived: false },
      select: { id: true, contactId: true },
    });
    if (!opportunity) {
      throw new ApiError(
        "CRM_OPPORTUNITY_NOT_FOUND",
        "Follow-up opportunity must be an active CRM opportunity in this agency",
        404,
      );
    }
    if (contactId != null && opportunity.contactId != null && opportunity.contactId !== contactId) {
      throw new ApiError(
        "CRM_FOLLOW_UP_RELATION_MISMATCH",
        "Follow-up contact must match the contact linked to this opportunity",
        409,
      );
    }
  }
}

const followUpInclude = {
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
  opportunity: {
    select: {
      id: true,
      title: true,
      type: true,
      stage: true,
      contactId: true,
      companyId: true,
      inventoryPropertyId: true,
      ownerMemberId: true,
      isArchived: true,
    },
  },
  createdBy: { select: { id: true, name: true, email: true } },
  updatedBy: { select: { id: true, name: true, email: true } },
  assignedMember: {
    select: {
      id: true,
      role: true,
      jobTitle: true,
      user: { select: { id: true, name: true, email: true } },
    },
  },
} satisfies Prisma.CrmFollowUpInclude;

function followUpSnapshot(item: any) {
  if (!item) return null;
  return {
    id: item.id,
    agencyId: item.agencyId,
    contactId: item.contactId,
    opportunityId: item.opportunityId,
    assignedMemberId: item.assignedMemberId,
    title: item.title,
    description: item.description,
    dueAt: item.dueAt,
    completedAt: item.completedAt,
    priority: item.priority,
    createdByUserId: item.createdByUserId,
    updatedByUserId: item.updatedByUserId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
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
    sourceConnectionId: item.sourceConnectionId,
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
          opportunity: {
            select: {
              id: true, title: true, type: true, stage: true, contactId: true,
              companyId: true, inventoryPropertyId: true, ownerMemberId: true, isArchived: true,
            },
          },
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
          sourceConnection: {
            select: {
              id: true,
              provider: true,
              connectionKey: true,
              accountEmail: true,
              configuration: true,
            },
          },
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


/* CRM Import Centre */
type CrmImportMapping = Record<string, string | null | undefined>;
type CrmImportRow = Record<string, unknown>;
type CrmImportStatus = "ready" | "matched" | "possible_duplicate" | "needs_attention" | "ignored";

type CrmImportPreviewRow = {
  rowNumber: number;
  status: CrmImportStatus;
  messages: string[];
  company?: any;
  contact?: any;
  opportunity?: any;
  matches?: {
    companyId?: number | null;
    contactId?: number | null;
    opportunityId?: number | null;
  };
};

const CRM_IMPORT_MAX_ROWS = 5000;
const CRM_IMPORT_MAPPING_KEYS = new Set([
  "company.name", "company.email", "company.phoneNumber", "company.websiteUrl",
  "company.addressLine1", "company.addressLine2", "company.townCity", "company.county",
  "company.eircode", "company.notes",
  "contact.fullName", "contact.firstName", "contact.lastName", "contact.companyName", "contact.primaryEmail",
  "contact.phoneNumber", "contact.roles", "contact.notes",
  "opportunity.title", "opportunity.type", "opportunity.stage", "opportunity.value",
  "opportunity.probability", "opportunity.expectedCloseAt", "opportunity.owner", "opportunity.notes",
]);

function importText(value: unknown, maxLength = 10000): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function importCell(row: CrmImportRow, mapping: CrmImportMapping, key: string): string | null {
  const column = importText(mapping[key], 500);
  if (!column) return null;
  return importText(row[column]);
}

function normalizeImportText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ");
}

function normalizeImportPhone(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const plus = raw.startsWith("+") ? "+" : "";
  const digits = raw.replace(/\D/g, "");
  return plus + digits;
}

function parseImportedRoles(value: string | null): ProfessionalContactRole[] {
  if (!value) return [];
  const aliases: Record<string, string> = {
    SELLER: "VENDOR", OWNER: "VENDOR", VENDOR: "VENDOR",
    BUYER: "BUYER", PURCHASER: "BUYER",
    LANDLORD: "LANDLORD",
    TENANT: "TENANT", RENTER: "TENANT",
    SOLICITOR: "SOLICITOR", LAWYER: "SOLICITOR",
    BROKER: "BROKER", MORTGAGE_BROKER: "BROKER", "MORTGAGE BROKER": "BROKER",
    OTHER: "OTHER",
  };
  const raw = value.split(/[;,|/]+/).map((part) => part.trim()).filter(Boolean);
  const roles = raw.map((role) => aliases[role.toUpperCase()] || role.toUpperCase());
  const unique = [...new Set(roles)];
  if (unique.some((role) => !PROFESSIONAL_CONTACT_ROLES.has(role))) {
    throw new ApiError("CRM_IMPORT_ROLE_INVALID", `Unknown contact role: ${unique.find((role) => !PROFESSIONAL_CONTACT_ROLES.has(role))}`, 400);
  }
  return unique as ProfessionalContactRole[];
}

function parseImportedOpportunityType(value: string | null): CrmOpportunityType | null {
  if (!value) return null;
  const key = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, string> = {
    VENDOR: "VENDOR_INSTRUCTION", SELLER: "VENDOR_INSTRUCTION", SALE: "VENDOR_INSTRUCTION",
    BUYER: "BUYER_SEARCH", PURCHASER: "BUYER_SEARCH",
    LANDLORD: "LANDLORD_INSTRUCTION", LETTING: "LANDLORD_INSTRUCTION",
    TENANT: "TENANT_SEARCH", RENTER: "TENANT_SEARCH",
  };
  const parsed = aliases[key] || key;
  if (!CRM_OPPORTUNITY_TYPES.has(parsed)) throw new ApiError("CRM_IMPORT_TYPE_INVALID", `Unknown opportunity type: ${value}`, 400);
  return parsed as CrmOpportunityType;
}

function parseImportedOpportunityStage(value: string | null): CrmOpportunityStage {
  if (!value) return CrmOpportunityStage.LEAD;
  const key = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, string> = {
    NEW: "LEAD", PROSPECT: "LEAD", VALUATION: "APPOINTMENT", APPRAISAL: "APPOINTMENT",
    INSTRUCTED: "INSTRUCTION", LISTED: "ACTIVE", SALE_AGREED: "AGREED", SOLD: "WON",
    CLOSED_WON: "WON", CLOSED_LOST: "LOST",
  };
  const parsed = aliases[key] || key;
  if (!CRM_OPPORTUNITY_STAGES.has(parsed)) throw new ApiError("CRM_IMPORT_STAGE_INVALID", `Unknown opportunity stage: ${value}`, 400);
  return parsed as CrmOpportunityStage;
}

function parseImportedMoneyToCents(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9.,-]/g, "").replace(/,/g, "");
  if (!cleaned) return null;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount < 0) throw new ApiError("CRM_IMPORT_VALUE_INVALID", `Invalid opportunity value: ${value}`, 400);
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents)) throw new ApiError("CRM_IMPORT_VALUE_INVALID", `Opportunity value is too large: ${value}`, 400);
  return cents;
}

function parseImportedProbability(value: string | null, stage: CrmOpportunityStage): number {
  if (!value) return stage === CrmOpportunityStage.WON ? 100 : stage === CrmOpportunityStage.LOST ? 0 : 10;
  const parsed = Number(value.replace(/%/g, "").trim());
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) throw new ApiError("CRM_IMPORT_PROBABILITY_INVALID", `Invalid probability: ${value}`, 400);
  return parsed;
}

function parseImportedDate(value: string | null): Date | null {
  if (!value) return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;
  const m = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (m) {
    const date = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (!Number.isNaN(date.getTime())) return date;
  }
  throw new ApiError("CRM_IMPORT_DATE_INVALID", `Invalid date: ${value}`, 400);
}

function validateImportMapping(mapping: unknown): CrmImportMapping {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) throw new ApiError("VALIDATION_ERROR", "mapping must be an object", 400);
  const result: CrmImportMapping = {};
  for (const [key, value] of Object.entries(mapping as Record<string, unknown>)) {
    if (!CRM_IMPORT_MAPPING_KEYS.has(key)) continue;
    result[key] = importText(value, 500);
  }
  if (!Object.values(result).some(Boolean)) throw new ApiError("CRM_IMPORT_MAPPING_EMPTY", "Map at least one spreadsheet column before previewing the import", 400);
  return result;
}

function validateImportRows(rows: unknown): CrmImportRow[] {
  if (!Array.isArray(rows)) throw new ApiError("VALIDATION_ERROR", "rows must be an array", 400);
  if (rows.length < 1) throw new ApiError("CRM_IMPORT_EMPTY", "The import file does not contain any data rows", 400);
  if (rows.length > CRM_IMPORT_MAX_ROWS) throw new ApiError("CRM_IMPORT_TOO_LARGE", `A single CRM import is limited to ${CRM_IMPORT_MAX_ROWS} rows`, 413);
  return rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new ApiError("CRM_IMPORT_ROW_INVALID", `Row ${index + 2} is invalid`, 400);
    return row as CrmImportRow;
  });
}

async function crmImportPreview(workspace: AgencyWorkspace, rows: CrmImportRow[], mapping: CrmImportMapping) {
  const [companies, contacts, opportunities, members] = await Promise.all([
    prisma.crmCompany.findMany({ where: { agencyId: workspace.agency.id, isArchived: false } }),
    prisma.professionalContact.findMany({ where: { agencyId: workspace.agency.id, isArchived: false }, include: { company: { select: { id: true, name: true } } } }),
    prisma.crmOpportunity.findMany({ where: { agencyId: workspace.agency.id, isArchived: false }, select: { id: true, title: true, contactId: true, companyId: true } }),
    prisma.agencyMember.findMany({ where: { agencyId: workspace.agency.id, status: "ACTIVE" }, select: { id: true, user: { select: { name: true, email: true } } } }),
  ]);

  const existingCompanyByName = new Map(companies.map((company) => [normalizeImportText(company.name), company]));
  const existingContactByEmail = new Map(contacts.filter((contact) => contact.primaryEmail).map((contact) => [normalizeImportText(contact.primaryEmail), contact]));
  const existingContactsByPhone = new Map<string, typeof contacts>();
  for (const contact of contacts) {
    const phone = normalizeImportPhone(contact.phoneNumber);
    if (!phone) continue;
    existingContactsByPhone.set(phone, [...(existingContactsByPhone.get(phone) || []), contact]);
  }
  const memberByIdentity = new Map<string, number>();
  for (const member of members) {
    const values = [member.user?.email, member.user?.name].filter(Boolean) as string[];
    for (const value of values) memberByIdentity.set(normalizeImportText(value), member.id);
  }

  const seenCompanies = new Map<string, { rowNumber: number; id?: number | null }>();
  const seenContactsByEmail = new Map<string, { rowNumber: number }>();
  const seenContactsByPhone = new Map<string, { rowNumber: number }>();
  const seenOpportunities = new Map<string, { rowNumber: number }>();
  const previewRows: CrmImportPreviewRow[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 2;
    const messages: string[] = [];
    let status: CrmImportStatus = "ready";
    let company: any = null;
    let contact: any = null;
    let opportunity: any = null;
    const matches: CrmImportPreviewRow["matches"] = {};

    try {
      const companyName = importCell(row, mapping, "company.name");
      const companySignal = companyName || ["company.email", "company.phoneNumber", "company.websiteUrl", "company.addressLine1", "company.townCity", "company.county", "company.eircode", "company.notes"].some((key) => importCell(row, mapping, key));
      if (companySignal) {
        if (!companyName) throw new ApiError("CRM_IMPORT_COMPANY_NAME_REQUIRED", "Company name is required when importing company data", 400);
        company = {
          name: companyName,
          email: importCell(row, mapping, "company.email")?.toLowerCase() || null,
          phoneNumber: importCell(row, mapping, "company.phoneNumber"),
          websiteUrl: importCell(row, mapping, "company.websiteUrl"),
          addressLine1: importCell(row, mapping, "company.addressLine1"),
          addressLine2: importCell(row, mapping, "company.addressLine2"),
          townCity: importCell(row, mapping, "company.townCity"),
          county: importCell(row, mapping, "company.county"),
          eircode: importCell(row, mapping, "company.eircode"),
          notes: importCell(row, mapping, "company.notes"),
        };
        const companyKey = normalizeImportText(companyName);
        const existing = existingCompanyByName.get(companyKey);
        if (existing) {
          matches.companyId = existing.id;
          messages.push(`Company matched existing record #${existing.id}`);
        } else if (!seenCompanies.has(companyKey)) {
          seenCompanies.set(companyKey, { rowNumber });
        } else {
          messages.push(`Company repeats row ${seenCompanies.get(companyKey)?.rowNumber}`);
        }
      }

      const fullName = importCell(row, mapping, "contact.fullName");
      let mappedFirstName = importCell(row, mapping, "contact.firstName");
      let mappedLastName = importCell(row, mapping, "contact.lastName");
      if (fullName && !mappedFirstName && !mappedLastName) {
        const parts = fullName.split(/\s+/).filter(Boolean);
        mappedFirstName = parts.shift() || null;
        mappedLastName = parts.length ? parts.join(" ") : null;
      }
      const contactValues = {
        firstName: mappedFirstName,
        lastName: mappedLastName,
        companyName: importCell(row, mapping, "contact.companyName"),
        primaryEmail: importCell(row, mapping, "contact.primaryEmail")?.toLowerCase() || null,
        phoneNumber: importCell(row, mapping, "contact.phoneNumber"),
        roles: parseImportedRoles(importCell(row, mapping, "contact.roles")),
        notes: importCell(row, mapping, "contact.notes"),
      };
      const contactSignal = Boolean(contactValues.firstName || contactValues.lastName || contactValues.companyName || contactValues.primaryEmail || contactValues.phoneNumber || contactValues.roles.length || contactValues.notes);
      if (contactSignal) {
        if (!contactValues.firstName && !contactValues.lastName && !contactValues.companyName && !contactValues.primaryEmail && !contactValues.phoneNumber) {
          throw new ApiError("CRM_IMPORT_CONTACT_IDENTITY_REQUIRED", "Contact needs a name, company, email or phone number", 400);
        }
        contact = contactValues;
        const emailKey = normalizeImportText(contactValues.primaryEmail);
        const phoneKey = normalizeImportPhone(contactValues.phoneNumber);
        if (emailKey && existingContactByEmail.has(emailKey)) {
          const existing = existingContactByEmail.get(emailKey)!;
          matches.contactId = existing.id;
          messages.push(`Contact matched existing email record #${existing.id}`);
        } else if (emailKey && seenContactsByEmail.has(emailKey)) {
          messages.push(`Contact repeats row ${seenContactsByEmail.get(emailKey)?.rowNumber} and will be reused`);
        } else if (phoneKey && (existingContactsByPhone.get(phoneKey)?.length || 0) > 0) {
          status = "possible_duplicate";
          messages.push("Possible contact duplicate: phone number already exists");
        } else if (phoneKey && seenContactsByPhone.has(phoneKey)) {
          messages.push(`Contact repeats row ${seenContactsByPhone.get(phoneKey)?.rowNumber} and will be reused`);
        } else if (!emailKey && !phoneKey && (contactValues.firstName || contactValues.lastName)) {
          const nameKey = normalizeImportText(`${contactValues.firstName || ""} ${contactValues.lastName || ""}`);
          const companyKey = normalizeImportText(companyName || contactValues.companyName);
          const nameMatches = contacts.filter((existing) => {
            const existingName = normalizeImportText(`${existing.firstName || ""} ${existing.lastName || ""}`);
            const existingCompany = normalizeImportText(existing.company?.name || existing.companyName);
            return existingName === nameKey && (!companyKey || existingCompany === companyKey);
          });
          if (nameMatches.length) {
            status = "possible_duplicate";
            messages.push("Possible contact duplicate: name already exists in this CRM");
          }
        }
        if (emailKey && !seenContactsByEmail.has(emailKey)) seenContactsByEmail.set(emailKey, { rowNumber });
        if (phoneKey && !seenContactsByPhone.has(phoneKey)) seenContactsByPhone.set(phoneKey, { rowNumber });
      }

      const opportunityTitle = importCell(row, mapping, "opportunity.title");
      const opportunitySignal = opportunityTitle || ["opportunity.type", "opportunity.stage", "opportunity.value", "opportunity.probability", "opportunity.expectedCloseAt", "opportunity.owner", "opportunity.notes"].some((key) => importCell(row, mapping, key));
      if (opportunitySignal) {
        if (!opportunityTitle) throw new ApiError("CRM_IMPORT_OPPORTUNITY_TITLE_REQUIRED", "Opportunity title is required when importing opportunity data", 400);
        const type = parseImportedOpportunityType(importCell(row, mapping, "opportunity.type"));
        if (!type) throw new ApiError("CRM_IMPORT_OPPORTUNITY_TYPE_REQUIRED", "Opportunity type is required", 400);
        const stage = parseImportedOpportunityStage(importCell(row, mapping, "opportunity.stage"));
        const ownerText = importCell(row, mapping, "opportunity.owner");
        let ownerMemberId: number | null = workspace.membership.id;
        if (ownerText) {
          ownerMemberId = memberByIdentity.get(normalizeImportText(ownerText)) || null;
          if (!ownerMemberId) throw new ApiError("CRM_IMPORT_OWNER_NOT_FOUND", `Opportunity owner was not found in this agency: ${ownerText}`, 400);
        }
        opportunity = {
          title: opportunityTitle,
          type,
          stage,
          valueCents: parseImportedMoneyToCents(importCell(row, mapping, "opportunity.value")),
          probability: parseImportedProbability(importCell(row, mapping, "opportunity.probability"), stage),
          expectedCloseAt: parseImportedDate(importCell(row, mapping, "opportunity.expectedCloseAt")),
          ownerMemberId,
          notes: importCell(row, mapping, "opportunity.notes"),
        };
        const relationKey = `${normalizeImportText(opportunityTitle)}|${matches.contactId || normalizeImportText(contactValues.primaryEmail || `${contactValues.firstName || ""} ${contactValues.lastName || ""}`)}|${matches.companyId || normalizeImportText(companyName)}`;
        const canMatchExistingOpportunity = Boolean(matches.contactId || matches.companyId);
        const existingOpportunity = canMatchExistingOpportunity
          ? opportunities.find((item) =>
              normalizeImportText(item.title) === normalizeImportText(opportunityTitle) &&
              (!matches.contactId || item.contactId === matches.contactId) &&
              (!matches.companyId || item.companyId === matches.companyId),
            )
          : undefined;
        if (existingOpportunity) {
          matches.opportunityId = existingOpportunity.id;
          messages.push(`Opportunity matched existing record #${existingOpportunity.id}`);
        } else if (seenOpportunities.has(relationKey)) {
          status = "possible_duplicate";
          messages.push(`Opportunity repeats row ${seenOpportunities.get(relationKey)?.rowNumber}`);
        } else {
          seenOpportunities.set(relationKey, { rowNumber });
        }
      }

      if (!company && !contact && !opportunity) {
        status = "ignored";
        messages.push("No mapped CRM data found in this row");
      } else if (status === "ready") {
        const createsSomething =
          Boolean(company && !matches.companyId) ||
          Boolean(contact && !matches.contactId) ||
          Boolean(opportunity && !matches.opportunityId);
        status = createsSomething ? "ready" : "matched";
      }
    } catch (error) {
      status = "needs_attention";
      messages.push(error instanceof Error ? error.message : "Row could not be validated");
    }

    previewRows.push({ rowNumber, status, messages, company, contact, opportunity, matches });
  }

  const summary = previewRows.reduce((acc, row) => {
    acc.total += 1;
    acc[row.status] += 1;
    return acc;
  }, { total: 0, ready: 0, matched: 0, possible_duplicate: 0, needs_attention: 0, ignored: 0 } as Record<string, number>);

  return { rows: previewRows, summary };
}

router.post("/imports/preview", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const rows = validateImportRows(req.body?.rows);
    const mapping = validateImportMapping(req.body?.mapping);
    const preview = await crmImportPreview(workspace, rows, mapping);
    return res.json({ ok: true, ...preview });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/imports/commit", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const rows = validateImportRows(req.body?.rows);
    const mapping = validateImportMapping(req.body?.mapping);
    const sourceFileName = importText(req.body?.sourceFileName, 500) || "CRM import";
    const skipRowNumbers = new Set(
      Array.isArray(req.body?.skipRowNumbers)
        ? req.body.skipRowNumbers.map((value: unknown) => asPositiveInt(value)).filter(Boolean) as number[]
        : [],
    );
    const preview = await crmImportPreview(workspace, rows, mapping);
    const unresolved = preview.rows.filter(
      (row) => (row.status === "needs_attention" || row.status === "possible_duplicate") && !skipRowNumbers.has(row.rowNumber),
    );
    if (unresolved.length > 0) {
      throw new ApiError(
        "CRM_IMPORT_REVIEW_REQUIRED",
        "Skip or resolve rows marked Needs attention or Possible duplicate before importing",
        409,
      );
    }

    const importId = crypto.randomUUID();
    const userId = workspace.membership.userId;
    const companyIdsByName = new Map<string, number>();
    const contactIdsByIdentity = new Map<string, number>();
    let companiesCreated = 0;
    let companiesMatched = 0;
    let contactsCreated = 0;
    let contactsMatched = 0;
    let opportunitiesCreated = 0;
    let opportunitiesMatched = 0;

    await prisma.$transaction(async (tx) => {
      for (const row of preview.rows) {
        if (row.status === "ignored" || skipRowNumbers.has(row.rowNumber)) continue;
        let companyId = row.matches?.companyId || null;
        if (row.company) {
          const companyKey = normalizeImportText(row.company.name);
          companyId = companyId || companyIdsByName.get(companyKey) || null;
          if (!companyId) {
            const created = await tx.crmCompany.create({
              data: {
                agencyId: workspace.agency.id,
                ...row.company,
                createdByUserId: userId,
                updatedByUserId: userId,
              },
            });
            companyId = created.id;
            companyIdsByName.set(companyKey, created.id);
            companiesCreated += 1;
            await tx.agencyAuditLog.create({
              data: {
                agencyId: workspace.agency.id,
                actorUserId: userId,
                actorAgencyMemberId: workspace.membership.id,
                effectiveUserId: userId,
                action: "CRM_COMPANY_CREATED",
                entityType: "CrmCompany",
                entityId: String(created.id),
                afterState: companySnapshot(created),
                changedFields: Object.keys(companySnapshot(created) || {}),
                metadata: { source: "crmImport", importId, sourceFileName, rowNumber: row.rowNumber },
              },
            });
          } else {
            companiesMatched += 1;
          }
        }

        let contactId = row.matches?.contactId || null;
        if (row.contact) {
          const emailKey = normalizeImportText(row.contact.primaryEmail);
          const phoneKey = normalizeImportPhone(row.contact.phoneNumber);
          const identityKey = emailKey ? `email:${emailKey}` : phoneKey ? `phone:${phoneKey}` : `name:${normalizeImportText(`${row.contact.firstName || ""} ${row.contact.lastName || ""}`)}|${companyId || normalizeImportText(row.contact.companyName)}`;
          contactId = contactId || contactIdsByIdentity.get(identityKey) || null;
          if (!contactId) {
            const created = await tx.professionalContact.create({
              data: {
                agencyId: workspace.agency.id,
                companyId,
                ...row.contact,
                companyName: row.contact.companyName || row.company?.name || null,
                createdByUserId: userId,
                updatedByUserId: userId,
              },
            });
            contactId = created.id;
            contactIdsByIdentity.set(identityKey, created.id);
            contactsCreated += 1;
            await tx.agencyAuditLog.create({
              data: {
                agencyId: workspace.agency.id,
                actorUserId: userId,
                actorAgencyMemberId: workspace.membership.id,
                effectiveUserId: userId,
                action: "CRM_CONTACT_CREATED",
                entityType: "ProfessionalContact",
                entityId: String(created.id),
                afterState: contactSnapshot(created),
                changedFields: Object.keys(contactSnapshot(created) || {}),
                metadata: { source: "crmImport", importId, sourceFileName, rowNumber: row.rowNumber },
              },
            });
          } else {
            contactsMatched += 1;
          }
        }

        if (row.opportunity) {
          if (row.matches?.opportunityId) {
            opportunitiesMatched += 1;
          } else {
            const created = await tx.crmOpportunity.create({
              data: {
                agencyId: workspace.agency.id,
                contactId,
                companyId,
                ownerMemberId: row.opportunity.ownerMemberId,
                title: row.opportunity.title,
                type: row.opportunity.type,
                stage: row.opportunity.stage,
                valueCents: row.opportunity.valueCents == null ? null : BigInt(row.opportunity.valueCents),
                probability: row.opportunity.probability,
                expectedCloseAt: row.opportunity.expectedCloseAt,
                notes: row.opportunity.notes,
              },
            });
            opportunitiesCreated += 1;
            await tx.agencyAuditLog.create({
              data: {
                agencyId: workspace.agency.id,
                actorUserId: userId,
                actorAgencyMemberId: workspace.membership.id,
                effectiveUserId: userId,
                action: "CRM_OPPORTUNITY_CREATED",
                entityType: "CrmOpportunity",
                entityId: String(created.id),
                afterState: opportunitySnapshot(created),
                changedFields: ["created"],
                metadata: { source: "crmImport", importId, sourceFileName, rowNumber: row.rowNumber, contactId, companyId },
              },
            });
          }
        }
      }

      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: userId,
          action: "CRM_IMPORT_COMPLETED",
          entityType: "CrmImport",
          entityId: importId,
          afterState: {
            importId,
            sourceFileName,
            rows: preview.summary.total,
            companiesCreated,
            companiesMatched,
            contactsCreated,
            contactsMatched,
            opportunitiesCreated,
            opportunitiesMatched,
            rowsSkipped: skipRowNumbers.size,
          },
          changedFields: ["crmCompanies", "professionalContacts", "crmOpportunities"],
          metadata: { source: "crmImport", importId, sourceFileName },
        },
      });
    }, { timeout: 120000 });

    return res.status(201).json({
      ok: true,
      importId,
      sourceFileName,
      summary: {
        rows: preview.summary.total,
        companiesCreated,
        companiesMatched,
        contactsCreated,
        contactsMatched,
        opportunitiesCreated,
        opportunitiesMatched,
        rowsSkipped: skipRowNumbers.size,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
});

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
    const opportunityId =
      req.query.opportunityId == null || req.query.opportunityId === ""
        ? null
        : asPositiveInt(req.query.opportunityId);
    if (req.query.opportunityId != null && req.query.opportunityId !== "" && !opportunityId) {
      throw new ApiError("VALIDATION_ERROR", "opportunityId must be a positive integer", 400);
    }

    const items = await prisma.crmFollowUp.findMany({
      where: {
        agencyId: workspace.agency.id,
        ...(opportunityId ? { opportunityId } : {}),
        ...(includeArchivedContacts
          ? {}
          : {
              OR: [
                { contactId: null },
                { contact: { is: { isArchived: false } } },
              ],
            }),
      },
      include: followUpInclude,
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
  followUps: {
    where: { completedAt: null },
    orderBy: [{ dueAt: "asc" }, { priority: "desc" }, { id: "asc" }],
    take: 20,
    include: {
      contact: { select: { id: true, firstName: true, lastName: true, primaryEmail: true, isArchived: true } },
      assignedMember: { select: { id: true, role: true, jobTitle: true, user: { select: { id: true, name: true, email: true } } } },
    },
  },
} satisfies Prisma.CrmOpportunityInclude;

router.get("/opportunities", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const includeArchived = String(req.query.includeArchived || "").toLowerCase() === "true";
    const stage = parseEnumValue<CrmOpportunityStage>(req.query.stage, CRM_OPPORTUNITY_STAGES, "stage");
    const ownerMemberId = req.query.ownerMemberId == null || req.query.ownerMemberId === "" ? null : asPositiveInt(req.query.ownerMemberId);
    const contactId = req.query.contactId == null || req.query.contactId === "" ? null : asPositiveInt(req.query.contactId);
    const q = nullableString(req.query.q, 200);
    if (req.query.ownerMemberId != null && req.query.ownerMemberId !== "" && !ownerMemberId) throw new ApiError("VALIDATION_ERROR", "ownerMemberId must be a positive integer", 400);
    if (req.query.contactId != null && req.query.contactId !== "" && !contactId) throw new ApiError("VALIDATION_ERROR", "contactId must be a positive integer", 400);
    const searchTokens = q
      ? q.split(/\s+/).map((token) => token.trim()).filter(Boolean).slice(0, 8)
      : [];
    const opportunitySearchFields = (term: string) => [
      { title: { contains: term, mode: "insensitive" as const } },
      { notes: { contains: term, mode: "insensitive" as const } },
      { contact: { is: { OR: [
        { firstName: { contains: term, mode: "insensitive" as const } },
        { lastName: { contains: term, mode: "insensitive" as const } },
        { primaryEmail: { contains: term, mode: "insensitive" as const } },
        { companyName: { contains: term, mode: "insensitive" as const } },
      ] } } },
      { company: { is: { name: { contains: term, mode: "insensitive" as const } } } },
      { inventoryProperty: { is: { OR: [
        { address1: { contains: term, mode: "insensitive" as const } },
        { address2: { contains: term, mode: "insensitive" as const } },
        { city: { contains: term, mode: "insensitive" as const } },
        { county: { contains: term, mode: "insensitive" as const } },
        { eircode: { contains: term, mode: "insensitive" as const } },
      ] } } },
    ];
    const items = await prisma.crmOpportunity.findMany({
      where: {
        agencyId: workspace.agency.id,
        ...(includeArchived ? {} : { isArchived: false }),
        ...(stage ? { stage } : {}),
        ...(ownerMemberId ? { ownerMemberId } : {}),
        ...(contactId ? { contactId } : {}),
        ...(q ? { AND: searchTokens.map((token) => ({ OR: opportunitySearchFields(token) })) } : {}),
      },
      include: opportunityInclude,
      orderBy: [{ isArchived: "asc" }, { updatedAt: "desc" }, { id: "desc" }],
      take: q ? 50 : 1000,
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
  sourceConnection: {
    select: {
      id: true,
      provider: true,
      connectionKey: true,
      accountEmail: true,
      configuration: true,
    },
  },
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
function followUpAuditEntity(item: { id: number; contactId: number | null; opportunityId: number | null }) {
  return item.opportunityId
    ? { entityType: "CrmOpportunity", entityId: String(item.opportunityId) }
    : { entityType: "ProfessionalContact", entityId: String(item.contactId) };
}

async function createFollowUpForWorkspace(args: {
  workspace: AgencyWorkspace;
  req: AgentRequest;
  contactId: number | null;
  opportunityId: number | null;
  body: any;
}) {
  const { workspace, req, contactId, opportunityId, body } = args;
  await assertFollowUpRelations(workspace.agency.id, { contactId, opportunityId });
  const dueAt = nullableDate(body?.dueAt, "dueAt");
  if (!dueAt) throw new ApiError("VALIDATION_ERROR", "dueAt is required", 400);
  const assignedMemberId = body?.assignedMemberId == null || body?.assignedMemberId === ""
    ? workspace.membership.id
    : asPositiveInt(body?.assignedMemberId);
  if (!assignedMemberId) throw new ApiError("VALIDATION_ERROR", "assignedMemberId must be a positive integer", 400);
  await assertActiveAgencyMember(assignedMemberId, workspace.agency.id);
  const priority = parseEnumValue<CrmTaskPriority>(body?.priority, CRM_TASK_PRIORITIES, "priority") || CrmTaskPriority.NORMAL;
  const userId = workspace.membership.userId;

  return prisma.$transaction(async (tx) => {
    const followUp = await tx.crmFollowUp.create({
      data: {
        agencyId: workspace.agency.id,
        contactId,
        opportunityId,
        assignedMemberId,
        title: requiredString(body?.title, "title", 300),
        description: nullableString(body?.description, 5000),
        dueAt,
        priority,
        createdByUserId: userId,
        updatedByUserId: userId,
      },
      include: followUpInclude,
    });
    const auditEntity = followUpAuditEntity(followUp);
    await tx.agencyAuditLog.create({
      data: {
        agencyId: workspace.agency.id,
        actorUserId: userId,
        actorAgencyMemberId: workspace.membership.id,
        effectiveUserId: userId,
        action: "CRM_FOLLOW_UP_CREATED",
        entityType: auditEntity.entityType,
        entityId: auditEntity.entityId,
        afterState: followUpSnapshot(followUp),
        changedFields: ["crmFollowUps"],
        metadata: {
          source: "agencyContacts",
          followUpId: followUp.id,
          contactId: followUp.contactId,
          opportunityId: followUp.opportunityId,
        },
        ...requestMeta(req),
      },
    });
    return followUp;
  });
}

router.post("/follow-ups", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const body = req.body || {};
    const contactId = body.contactId == null || body.contactId === "" ? null : asPositiveInt(body.contactId);
    const opportunityId = body.opportunityId == null || body.opportunityId === "" ? null : asPositiveInt(body.opportunityId);
    if (body.contactId != null && body.contactId !== "" && !contactId) {
      throw new ApiError("VALIDATION_ERROR", "contactId must be a positive integer or null", 400);
    }
    if (body.opportunityId != null && body.opportunityId !== "" && !opportunityId) {
      throw new ApiError("VALIDATION_ERROR", "opportunityId must be a positive integer or null", 400);
    }
    const item = await createFollowUpForWorkspace({ workspace, req, contactId, opportunityId, body });
    return res.status(201).json({ ok: true, item });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/opportunities/:opportunityId/follow-ups", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const opportunityId = asPositiveInt(req.params.opportunityId);
    if (!opportunityId) throw new ApiError("VALIDATION_ERROR", "Invalid CRM opportunity id", 400);
    const opportunity = await prisma.crmOpportunity.findFirst({
      where: { id: opportunityId, agencyId: workspace.agency.id, isArchived: false },
      select: { id: true, contactId: true },
    });
    if (!opportunity) throw new ApiError("CRM_OPPORTUNITY_NOT_FOUND", "CRM opportunity not found", 404);
    const body = req.body || {};
    const explicitContactId = body.contactId == null || body.contactId === "" ? null : asPositiveInt(body.contactId);
    if (body.contactId != null && body.contactId !== "" && !explicitContactId) {
      throw new ApiError("VALIDATION_ERROR", "contactId must be a positive integer or null", 400);
    }
    const contactId = explicitContactId ?? opportunity.contactId ?? null;
    const item = await createFollowUpForWorkspace({ workspace, req, contactId, opportunityId, body });
    return res.status(201).json({ ok: true, item });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/:id/follow-ups", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const contactId = asPositiveInt(req.params.id);
    if (!contactId) throw new ApiError("VALIDATION_ERROR", "Invalid CRM contact id", 400);
    const contact = await prisma.professionalContact.findFirst({
      where: { id: contactId, agencyId: workspace.agency.id },
      select: { id: true, isArchived: true },
    });
    if (!contact) throw new ApiError("CONTACT_NOT_FOUND", "CRM contact not found", 404);
    if (contact.isArchived) {
      throw new ApiError("CONTACT_ARCHIVED", "Restore this CRM contact before adding follow-ups", 409);
    }
    const body = req.body || {};
    const opportunityId = body.opportunityId == null || body.opportunityId === "" ? null : asPositiveInt(body.opportunityId);
    if (body.opportunityId != null && body.opportunityId !== "" && !opportunityId) {
      throw new ApiError("VALIDATION_ERROR", "opportunityId must be a positive integer or null", 400);
    }
    const item = await createFollowUpForWorkspace({ workspace, req, contactId, opportunityId, body });
    return res.status(201).json({ ok: true, item });
  } catch (error) {
    return handleError(res, error);
  }
});

async function updateFollowUpForWorkspace(args: {
  workspace: AgencyWorkspace;
  req: AgentRequest;
  followUpId: number;
  body: any;
  expectedContactId?: number | null;
}) {
  const { workspace, req, followUpId, body, expectedContactId } = args;
  const before = await prisma.crmFollowUp.findFirst({
    where: {
      id: followUpId,
      agencyId: workspace.agency.id,
      ...(expectedContactId != null ? { contactId: expectedContactId } : {}),
    },
  });
  if (!before) throw new ApiError("CRM_FOLLOW_UP_NOT_FOUND", "CRM follow-up not found", 404);

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
  if ("contactId" in body) {
    const contactId = body.contactId == null || body.contactId === "" ? null : asPositiveInt(body.contactId);
    if (body.contactId != null && body.contactId !== "" && !contactId) {
      throw new ApiError("VALIDATION_ERROR", "contactId must be a positive integer or null", 400);
    }
    data.contactId = contactId;
  }
  if ("opportunityId" in body) {
    const opportunityId = body.opportunityId == null || body.opportunityId === "" ? null : asPositiveInt(body.opportunityId);
    if (body.opportunityId != null && body.opportunityId !== "" && !opportunityId) {
      throw new ApiError("VALIDATION_ERROR", "opportunityId must be a positive integer or null", 400);
    }
    data.opportunityId = opportunityId;
  }

  const effectiveContactId = "contactId" in body ? (data.contactId as number | null) : before.contactId;
  const effectiveOpportunityId = "opportunityId" in body ? (data.opportunityId as number | null) : before.opportunityId;
  await assertFollowUpRelations(workspace.agency.id, {
    contactId: effectiveContactId,
    opportunityId: effectiveOpportunityId,
  });

  return prisma.$transaction(async (tx) => {
    const updated = await tx.crmFollowUp.update({
      where: { id: followUpId },
      data,
      include: followUpInclude,
    });
    const changed = snapshotChangedFields(followUpSnapshot(before), followUpSnapshot(updated));
    if (changed.length > 0) {
      const auditEntity = followUpAuditEntity(updated);
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
          entityType: auditEntity.entityType,
          entityId: auditEntity.entityId,
          beforeState: followUpSnapshot(before),
          afterState: followUpSnapshot(updated),
          changedFields: changed,
          metadata: {
            source: "agencyContacts",
            followUpId,
            contactId: updated.contactId,
            opportunityId: updated.opportunityId,
          },
          ...requestMeta(req),
        },
      });
    }
    return updated;
  });
}

router.patch("/follow-ups/:followUpId", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const followUpId = asPositiveInt(req.params.followUpId);
    if (!followUpId) throw new ApiError("VALIDATION_ERROR", "Invalid CRM follow-up id", 400);
    const item = await updateFollowUpForWorkspace({ workspace, req, followUpId, body: req.body || {} });
    return res.json({ ok: true, item });
  } catch (error) {
    return handleError(res, error);
  }
});

router.patch("/:id/follow-ups/:followUpId", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const contactId = asPositiveInt(req.params.id);
    const followUpId = asPositiveInt(req.params.followUpId);
    if (!contactId || !followUpId) {
      throw new ApiError("VALIDATION_ERROR", "Invalid CRM contact or follow-up id", 400);
    }
    const item = await updateFollowUpForWorkspace({
      workspace,
      req,
      followUpId,
      body: req.body || {},
      expectedContactId: contactId,
    });
    return res.json({ ok: true, item });
  } catch (error) {
    return handleError(res, error);
  }
});

async function deleteFollowUpForWorkspace(args: {
  workspace: AgencyWorkspace;
  req: AgentRequest;
  followUpId: number;
  expectedContactId?: number | null;
}) {
  const { workspace, req, followUpId, expectedContactId } = args;
  const before = await prisma.crmFollowUp.findFirst({
    where: {
      id: followUpId,
      agencyId: workspace.agency.id,
      ...(expectedContactId != null ? { contactId: expectedContactId } : {}),
    },
  });
  if (!before) throw new ApiError("CRM_FOLLOW_UP_NOT_FOUND", "CRM follow-up not found", 404);
  await prisma.$transaction(async (tx) => {
    await tx.crmFollowUp.delete({ where: { id: followUpId } });
    const auditEntity = followUpAuditEntity(before);
    await tx.agencyAuditLog.create({
      data: {
        agencyId: workspace.agency.id,
        actorUserId: workspace.membership.userId,
        actorAgencyMemberId: workspace.membership.id,
        effectiveUserId: workspace.membership.userId,
        action: "CRM_FOLLOW_UP_DELETED",
        entityType: auditEntity.entityType,
        entityId: auditEntity.entityId,
        beforeState: followUpSnapshot(before),
        changedFields: ["crmFollowUps"],
        metadata: {
          source: "agencyContacts",
          followUpId,
          contactId: before.contactId,
          opportunityId: before.opportunityId,
        },
        ...requestMeta(req),
      },
    });
  });
}

router.delete("/follow-ups/:followUpId", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const followUpId = asPositiveInt(req.params.followUpId);
    if (!followUpId) throw new ApiError("VALIDATION_ERROR", "Invalid CRM follow-up id", 400);
    await deleteFollowUpForWorkspace({ workspace, req, followUpId });
    return res.json({ ok: true, deletedFollowUpId: followUpId });
  } catch (error) {
    return handleError(res, error);
  }
});

router.delete("/:id/follow-ups/:followUpId", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const contactId = asPositiveInt(req.params.id);
    const followUpId = asPositiveInt(req.params.followUpId);
    if (!contactId || !followUpId) {
      throw new ApiError("VALIDATION_ERROR", "Invalid CRM contact or follow-up id", 400);
    }
    await deleteFollowUpForWorkspace({ workspace, req, followUpId, expectedContactId: contactId });
    return res.json({ ok: true, deletedFollowUpId: followUpId });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/follow-ups/:followUpId/complete-and-create-next", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const followUpId = asPositiveInt(req.params.followUpId);
    if (!followUpId) throw new ApiError("VALIDATION_ERROR", "Invalid CRM follow-up id", 400);
    const before = await prisma.crmFollowUp.findFirst({
      where: { id: followUpId, agencyId: workspace.agency.id },
    });
    if (!before) throw new ApiError("CRM_FOLLOW_UP_NOT_FOUND", "CRM follow-up not found", 404);
    if (before.completedAt) throw new ApiError("CRM_FOLLOW_UP_ALREADY_COMPLETED", "This follow-up is already completed", 409);

    const body = req.body || {};
    const nextDueAt = nullableDate(body.dueAt, "dueAt");
    if (!nextDueAt) throw new ApiError("VALIDATION_ERROR", "dueAt is required for the next action", 400);
    const nextAssignedMemberId = body.assignedMemberId == null || body.assignedMemberId === ""
      ? before.assignedMemberId || workspace.membership.id
      : asPositiveInt(body.assignedMemberId);
    if (!nextAssignedMemberId) throw new ApiError("VALIDATION_ERROR", "assignedMemberId must be a positive integer", 400);
    await assertActiveAgencyMember(nextAssignedMemberId, workspace.agency.id);
    const nextPriority = parseEnumValue<CrmTaskPriority>(body.priority, CRM_TASK_PRIORITIES, "priority") || before.priority;
    await assertFollowUpRelations(workspace.agency.id, {
      contactId: before.contactId,
      opportunityId: before.opportunityId,
    });

    const userId = workspace.membership.userId;
    const result = await prisma.$transaction(async (tx) => {
      const completed = await tx.crmFollowUp.update({
        where: { id: followUpId },
        data: { completedAt: new Date(), updatedByUserId: userId },
        include: followUpInclude,
      });
      const next = await tx.crmFollowUp.create({
        data: {
          agencyId: workspace.agency.id,
          contactId: before.contactId,
          opportunityId: before.opportunityId,
          assignedMemberId: nextAssignedMemberId,
          title: requiredString(body.title, "title", 300),
          description: nullableString(body.description, 5000),
          dueAt: nextDueAt,
          priority: nextPriority,
          createdByUserId: userId,
          updatedByUserId: userId,
        },
        include: followUpInclude,
      });
      const auditEntity = followUpAuditEntity(completed);
      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: userId,
          action: "CRM_FOLLOW_UP_COMPLETED_NEXT_CREATED",
          entityType: auditEntity.entityType,
          entityId: auditEntity.entityId,
          beforeState: followUpSnapshot(before),
          afterState: { completed: followUpSnapshot(completed), next: followUpSnapshot(next) },
          changedFields: ["crmFollowUps.completedAt", "crmFollowUps.nextAction"],
          metadata: {
            source: "agencyContacts",
            completedFollowUpId: completed.id,
            nextFollowUpId: next.id,
            contactId: completed.contactId,
            opportunityId: completed.opportunityId,
          },
          ...requestMeta(req),
        },
      });
      return { completed, next };
    });

    return res.status(201).json({ ok: true, ...result });
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



/* CRM Google integration */
const GOOGLE_PROVIDER = CrmIntegrationProvider.GOOGLE;
const GOOGLE_CONNECTION_KEY = "primary";
const GOOGLE_BASE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
] as const;
const GOOGLE_GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

function googleGmailSendEnabled(): boolean {
  return String(process.env.CRM_GOOGLE_GMAIL_SEND_ENABLED || "").trim().toLowerCase() === "true";
}

function googleOAuthScopes(): string[] {
  return googleGmailSendEnabled()
    ? [...GOOGLE_BASE_OAUTH_SCOPES, GOOGLE_GMAIL_SEND_SCOPE]
    : [...GOOGLE_BASE_OAUTH_SCOPES];
}
const GOOGLE_INITIAL_GMAIL_QUERY = "newer_than:30d";
const GOOGLE_INITIAL_CALENDAR_LOOKBACK_DAYS = 90;
const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleConnectionRecord = Awaited<ReturnType<typeof googleConnectionForWorkspace>>;

function requiredEnv(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new ApiError(
      "CRM_GOOGLE_CONFIGURATION_ERROR",
      `${name} is not configured`,
      503,
    );
  }
  return value;
}

function googleEncryptionKey(): Buffer {
  const raw = requiredEnv("CRM_GOOGLE_TOKEN_ENCRYPTION_KEY");
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    key = Buffer.alloc(0);
  }
  if (key.length !== 32) {
    throw new ApiError(
      "CRM_GOOGLE_CONFIGURATION_ERROR",
      "CRM_GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
      503,
    );
  }
  return key;
}

function encryptGoogleSecret(value: string): string {
  const key = googleEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

function decryptGoogleSecret(value: string): string {
  const [version, ivRaw, tagRaw, encryptedRaw] = String(value || "").split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || encryptedRaw == null) {
    throw new ApiError("CRM_GOOGLE_TOKEN_INVALID", "Stored Google token could not be read", 500);
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      googleEncryptionKey(),
      Buffer.from(ivRaw, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new ApiError("CRM_GOOGLE_TOKEN_INVALID", "Stored Google token could not be decrypted", 500);
  }
}

function googleRedirectUri(): string {
  return requiredEnv("GOOGLE_OAUTH_REDIRECT_URI");
}

function encodeGoogleState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", googleEncryptionKey())
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

function decodeGoogleState(state: string): any {
  const [body, signature] = String(state || "").split(".");
  if (!body || !signature) {
    throw new ApiError("CRM_GOOGLE_OAUTH_STATE_INVALID", "Google connection state is invalid", 400);
  }
  const expected = crypto
    .createHmac("sha256", googleEncryptionKey())
    .update(body)
    .digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    received = Buffer.alloc(0);
  }
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    throw new ApiError("CRM_GOOGLE_OAUTH_STATE_INVALID", "Google connection state is invalid", 400);
  }
  let payload: any;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new ApiError("CRM_GOOGLE_OAUTH_STATE_INVALID", "Google connection state is invalid", 400);
  }
  if (!payload?.exp || Number(payload.exp) < Date.now()) {
    throw new ApiError("CRM_GOOGLE_OAUTH_STATE_EXPIRED", "Google connection request has expired", 400);
  }
  return payload;
}

async function googleJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: any = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
  }
  if (!response.ok) {
    const message = body?.error_description || body?.error?.message || body?.error || `Google request failed (${response.status})`;
    const error = new ApiError("CRM_GOOGLE_API_ERROR", String(message), response.status >= 500 ? 502 : 400) as ApiError & { googleStatus?: number; googleBody?: any };
    error.googleStatus = response.status;
    error.googleBody = body;
    throw error;
  }
  return body as T;
}

async function googleTokenExchange(params: URLSearchParams): Promise<GoogleTokenResponse> {
  return googleJson<GoogleTokenResponse>("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
}

async function googleConnectionForWorkspace(workspace: AgencyWorkspace) {
  return prisma.crmIntegrationConnection.findUnique({
    where: {
      agencyId_memberId_provider_connectionKey: {
        agencyId: workspace.agency.id,
        memberId: workspace.membership.id,
        provider: GOOGLE_PROVIDER,
        connectionKey: GOOGLE_CONNECTION_KEY,
      },
    },
  });
}

function publicGoogleConnection(connection: any) {
  const sendEnabled = googleGmailSendEnabled();
  const sendGranted = Boolean(connection?.scopes?.includes?.(GOOGLE_GMAIL_SEND_SCOPE));
  if (!connection) {
    return {
      provider: GOOGLE_PROVIDER,
      connected: false,
      status: CrmIntegrationStatus.DISCONNECTED,
      accountEmail: null,
      scopes: [],
      lastEmailSyncAt: null,
      lastCalendarSyncAt: null,
      lastSyncAt: null,
      lastErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      gmailSendEnabled: sendEnabled,
      gmailSendGranted: false,
      gmailSendAvailable: false,
    };
  }
  return {
    id: connection.id,
    provider: connection.provider,
    connected: connection.status === CrmIntegrationStatus.CONNECTED,
    status: connection.status,
    accountEmail: connection.accountEmail,
    scopes: connection.scopes,
    tokenExpiresAt: connection.tokenExpiresAt,
    lastEmailSyncAt: connection.lastEmailSyncAt,
    lastCalendarSyncAt: connection.lastCalendarSyncAt,
    lastSyncAt: connection.lastSyncAt,
    lastErrorAt: connection.lastErrorAt,
    lastErrorCode: connection.lastErrorCode,
    lastErrorMessage: connection.lastErrorMessage,
    disconnectedAt: connection.disconnectedAt,
    gmailSendEnabled: sendEnabled,
    gmailSendGranted: sendGranted,
    gmailSendAvailable: sendEnabled && sendGranted && connection.status === CrmIntegrationStatus.CONNECTED,
  };
}

async function usableGoogleAccessToken(connection: NonNullable<GoogleConnectionRecord>): Promise<{ token: string; connection: any }> {
  const expiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt).getTime() : 0;
  const currentToken = decryptGoogleSecret(connection.accessTokenEncrypted);
  if (currentToken && expiresAt > Date.now() + 60_000) {
    return { token: currentToken, connection };
  }
  if (!connection.refreshTokenEncrypted) {
    throw new ApiError(
      "CRM_GOOGLE_RECONNECT_REQUIRED",
      "Google access has expired. Reconnect the account.",
      401,
    );
  }
  const refreshToken = decryptGoogleSecret(connection.refreshTokenEncrypted);
  const tokens = await googleTokenExchange(new URLSearchParams({
    client_id: requiredEnv("GOOGLE_CLIENT_ID"),
    client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }));
  if (!tokens.access_token) {
    throw new ApiError("CRM_GOOGLE_RECONNECT_REQUIRED", "Google did not return a refreshed access token", 401);
  }
  const updated = await prisma.crmIntegrationConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenEncrypted: encryptGoogleSecret(tokens.access_token),
      tokenExpiresAt: new Date(Date.now() + Math.max(60, Number(tokens.expires_in || 3600)) * 1000),
      status: CrmIntegrationStatus.CONNECTED,
      lastErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      disconnectedAt: null,
    },
  });
  return { token: tokens.access_token, connection: updated };
}

async function markGoogleConnectionError(connectionId: number, error: unknown) {
  const err: any = error;
  try {
    await prisma.crmIntegrationConnection.update({
      where: { id: connectionId },
      data: {
        status: CrmIntegrationStatus.ERROR,
        lastErrorAt: new Date(),
        lastErrorCode: nullableString(err?.code || err?.googleBody?.error || "GOOGLE_SYNC_ERROR", 200),
        lastErrorMessage: nullableString(err?.message || "Google synchronization failed", 2000),
      },
    });
  } catch (markError) {
    console.error("Failed to record Google CRM integration error", markError);
  }
}

function headerValue(headers: any[], name: string): string {
  const target = name.toLowerCase();
  const item = Array.isArray(headers)
    ? headers.find((header) => String(header?.name || "").toLowerCase() === target)
    : null;
  return String(item?.value || "").trim();
}

function extractEmails(value: string): string[] {
  const matches = String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(matches.map((email) => email.trim().toLowerCase()))];
}

async function matchedContactForEmails(agencyId: number, emails: string[]) {
  for (const email of [...new Set(emails.map((value) => value.toLowerCase()).filter(Boolean))]) {
    const contact = await prisma.professionalContact.findFirst({
      where: {
        agencyId,
        isArchived: false,
        primaryEmail: { equals: email, mode: "insensitive" },
      },
      select: { id: true, companyId: true },
    });
    if (contact) return contact;
  }
  return null;
}

function gmailDirection(accountEmail: string, from: string): CrmInteractionDirection {
  const account = accountEmail.toLowerCase();
  const fromEmails = extractEmails(from);
  return fromEmails.includes(account)
    ? CrmInteractionDirection.OUTBOUND
    : CrmInteractionDirection.INBOUND;
}

async function upsertGoogleEmailInteraction(args: {
  workspace: AgencyWorkspace;
  connection: any;
  accountEmail: string;
  token: string;
  messageId: string;
}) {
  const message = await googleJson<any>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(args.messageId)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`,
    { headers: { Authorization: `Bearer ${args.token}` } },
  );
  const headers = message?.payload?.headers || [];
  const from = headerValue(headers, "From");
  const to = headerValue(headers, "To");
  const cc = headerValue(headers, "Cc");
  const subject = headerValue(headers, "Subject") || "Email";
  const accountEmail = args.accountEmail.toLowerCase();
  const participantEmails = [...extractEmails(from), ...extractEmails(to), ...extractEmails(cc)]
    .filter((email) => email !== accountEmail);
  const contact = await matchedContactForEmails(args.workspace.agency.id, participantEmails);
  // Data minimisation: Gmail is a CRM source, not a mailbox mirror. Ignore messages
  // that do not match an active CRM contact in this agency.
  if (!contact) return false;
  const occurredAt = message?.internalDate && Number.isFinite(Number(message.internalDate))
    ? new Date(Number(message.internalDate))
    : new Date();
  const externalId = `${accountEmail}:gmail:${String(message.id)}`;
  const summary = String(message?.snippet || subject || "Email").trim().slice(0, 20000) || "Email";

  await prisma.crmInteraction.upsert({
    where: {
      agencyId_sourceProvider_externalId: {
        agencyId: args.workspace.agency.id,
        sourceProvider: CrmInteractionProvider.GOOGLE,
        externalId,
      },
    },
    create: {
      agencyId: args.workspace.agency.id,
      contactId: contact?.id || null,
      companyId: contact?.companyId || null,
      ownerMemberId: args.connection.memberId,
      type: CrmInteractionType.EMAIL,
      direction: gmailDirection(accountEmail, from),
      subject: subject.slice(0, 500),
      summary,
      occurredAt,
      sourceProvider: CrmInteractionProvider.GOOGLE,
      externalId,
      externalThreadId: message?.threadId ? `${accountEmail}:gmail:${String(message.threadId)}` : null,
      externalUrl: message?.threadId ? `https://mail.google.com/mail/#all/${encodeURIComponent(String(message.threadId))}` : null,
      createdByUserId: args.connection.userId,
    },
    update: {
      contactId: contact?.id || null,
      companyId: contact?.companyId || null,
      ownerMemberId: args.connection.memberId,
      direction: gmailDirection(accountEmail, from),
      subject: subject.slice(0, 500),
      summary,
      occurredAt,
      externalThreadId: message?.threadId ? `${accountEmail}:gmail:${String(message.threadId)}` : null,
      externalUrl: message?.threadId ? `https://mail.google.com/mail/#all/${encodeURIComponent(String(message.threadId))}` : null,
    },
  });
  return true;
}

async function fullGmailSync(workspace: AgencyWorkspace, connection: any, token: string) {
  let pageToken: string | null = null;
  const messageIds = new Set<string>();
  let pages = 0;
  do {
    const params = new URLSearchParams({ maxResults: "100", q: GOOGLE_INITIAL_GMAIL_QUERY });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await googleJson<any>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    for (const message of Array.isArray(page?.messages) ? page.messages : []) {
      if (message?.id) messageIds.add(String(message.id));
    }
    pageToken = page?.nextPageToken ? String(page.nextPageToken) : null;
    pages += 1;
  } while (pageToken && pages < 10);

  let imported = 0;
  let skipped = 0;
  for (const messageId of messageIds) {
    const matched = await upsertGoogleEmailInteraction({
      workspace,
      connection,
      accountEmail: connection.accountEmail,
      token,
      messageId,
    });
    if (matched) imported += 1;
    else skipped += 1;
  }
  const profile = await googleJson<any>(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return { imported, skipped, historyId: profile?.historyId ? String(profile.historyId) : null, mode: "full" };
}

async function incrementalGmailSync(workspace: AgencyWorkspace, connection: any, token: string) {
  if (!connection.gmailHistoryId) return fullGmailSync(workspace, connection, token);
  try {
    let pageToken: string | null = null;
    let latestHistoryId = connection.gmailHistoryId;
    const messageIds = new Set<string>();
    let pages = 0;
    do {
      const params = new URLSearchParams({
        startHistoryId: String(connection.gmailHistoryId),
        maxResults: "100",
        historyTypes: "messageAdded",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await googleJson<any>(
        `https://gmail.googleapis.com/gmail/v1/users/me/history?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      for (const history of Array.isArray(page?.history) ? page.history : []) {
        for (const added of Array.isArray(history?.messagesAdded) ? history.messagesAdded : []) {
          if (added?.message?.id) messageIds.add(String(added.message.id));
        }
      }
      if (page?.historyId) latestHistoryId = String(page.historyId);
      pageToken = page?.nextPageToken ? String(page.nextPageToken) : null;
      pages += 1;
    } while (pageToken && pages < 20);

    let imported = 0;
    let skipped = 0;
    for (const messageId of messageIds) {
      const matched = await upsertGoogleEmailInteraction({
        workspace,
        connection,
        accountEmail: connection.accountEmail,
        token,
        messageId,
      });
      if (matched) imported += 1;
      else skipped += 1;
    }
    return { imported, skipped, historyId: latestHistoryId, mode: "incremental" };
  } catch (error) {
    const err: any = error;
    if (err?.googleStatus === 404) {
      return fullGmailSync(workspace, connection, token);
    }
    throw error;
  }
}

function calendarEventDirection(accountEmail: string, event: any): CrmInteractionDirection {
  const organizer = String(event?.organizer?.email || "").toLowerCase();
  return organizer && organizer === accountEmail.toLowerCase()
    ? CrmInteractionDirection.OUTBOUND
    : CrmInteractionDirection.INBOUND;
}

async function upsertGoogleCalendarInteraction(args: {
  workspace: AgencyWorkspace;
  connection: any;
  accountEmail: string;
  event: any;
}) {
  const event = args.event;
  if (!event?.id || event?.status === "cancelled") return false;
  const startRaw = event?.start?.dateTime || event?.start?.date;
  if (!startRaw) return false;
  const occurredAt = new Date(startRaw);
  if (Number.isNaN(occurredAt.getTime())) return false;
  const endRaw = event?.end?.dateTime || event?.end?.date;
  const endAt = endRaw ? new Date(endRaw) : null;
  const durationMinutes = endAt && !Number.isNaN(endAt.getTime())
    ? Math.max(0, Math.round((endAt.getTime() - occurredAt.getTime()) / 60000))
    : null;
  const attendeeEmails = (Array.isArray(event?.attendees) ? event.attendees : [])
    .map((attendee: any) => String(attendee?.email || "").toLowerCase())
    .filter((email: string) => email && email !== args.accountEmail.toLowerCase());
  const contact = await matchedContactForEmails(args.workspace.agency.id, attendeeEmails);
  // Data minimisation: only retain calendar events involving an active CRM contact.
  if (!contact) return false;
  const subject = String(event?.summary || "Meeting").trim().slice(0, 500) || "Meeting";
  const description = String(event?.description || "").trim();
  const location = String(event?.location || "").trim();
  const summaryParts = [description, location ? `Location: ${location}` : ""].filter(Boolean);
  const summary = (summaryParts.join("\n\n") || subject).slice(0, 20000);
  const externalId = `${args.accountEmail.toLowerCase()}:calendar:${String(event.id)}`;

  await prisma.crmInteraction.upsert({
    where: {
      agencyId_sourceProvider_externalId: {
        agencyId: args.workspace.agency.id,
        sourceProvider: CrmInteractionProvider.GOOGLE,
        externalId,
      },
    },
    create: {
      agencyId: args.workspace.agency.id,
      contactId: contact?.id || null,
      companyId: contact?.companyId || null,
      ownerMemberId: args.connection.memberId,
      type: CrmInteractionType.MEETING,
      direction: calendarEventDirection(args.accountEmail, event),
      subject,
      summary,
      occurredAt,
      durationMinutes,
      sourceProvider: CrmInteractionProvider.GOOGLE,
      externalId,
      externalThreadId: event?.recurringEventId ? `${args.accountEmail.toLowerCase()}:calendar-series:${String(event.recurringEventId)}` : null,
      externalUrl: nullableString(event?.htmlLink, 2000),
      createdByUserId: args.connection.userId,
    },
    update: {
      contactId: contact?.id || null,
      companyId: contact?.companyId || null,
      ownerMemberId: args.connection.memberId,
      direction: calendarEventDirection(args.accountEmail, event),
      subject,
      summary,
      occurredAt,
      durationMinutes,
      externalThreadId: event?.recurringEventId ? `${args.accountEmail.toLowerCase()}:calendar-series:${String(event.recurringEventId)}` : null,
      externalUrl: nullableString(event?.htmlLink, 2000),
    },
  });
  return true;
}

async function googleCalendarSync(workspace: AgencyWorkspace, connection: any, token: string) {
  let syncToken = connection.calendarSyncToken ? String(connection.calendarSyncToken) : null;
  let pageToken: string | null = null;
  let nextSyncToken: string | null = null;
  let imported = 0;
  let pages = 0;
  const run = async (useSyncToken: boolean) => {
    pageToken = null;
    nextSyncToken = null;
    pages = 0;
    do {
      const params = new URLSearchParams({
        maxResults: "2500",
        singleEvents: "true",
        showDeleted: "true",
      });
      if (useSyncToken && syncToken) {
        params.set("syncToken", syncToken);
      } else {
        params.set("timeMin", new Date(Date.now() - GOOGLE_INITIAL_CALENDAR_LOOKBACK_DAYS * 86400000).toISOString());
      }
      if (pageToken) params.set("pageToken", pageToken);
      const page = await googleJson<any>(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      for (const event of Array.isArray(page?.items) ? page.items : []) {
        if (await upsertGoogleCalendarInteraction({ workspace, connection, accountEmail: connection.accountEmail, event })) {
          imported += 1;
        }
      }
      pageToken = page?.nextPageToken ? String(page.nextPageToken) : null;
      if (page?.nextSyncToken) nextSyncToken = String(page.nextSyncToken);
      pages += 1;
    } while (pageToken && pages < 20);
  };

  try {
    await run(Boolean(syncToken));
  } catch (error) {
    const err: any = error;
    if (syncToken && err?.googleStatus === 410) {
      syncToken = null;
      imported = 0;
      await run(false);
    } else {
      throw error;
    }
  }
  return { imported, syncToken: nextSyncToken || syncToken, mode: connection.calendarSyncToken ? "incremental" : "full" };
}

router.get("/integrations/google/status", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const connection = await googleConnectionForWorkspace(workspace);
    return res.json({
      ok: true,
      configured: Boolean(
        process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.GOOGLE_OAUTH_REDIRECT_URI &&
        process.env.CRM_GOOGLE_TOKEN_ENCRYPTION_KEY
      ),
      connection: publicGoogleConnection(connection),
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/integrations/google/connect", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const state = encodeGoogleState({
      agencyId: workspace.agency.id,
      memberId: workspace.membership.id,
      userId: workspace.membership.userId,
      nonce: crypto.randomBytes(18).toString("base64url"),
      exp: Date.now() + GOOGLE_OAUTH_STATE_TTL_MS,
    });
    const params = new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      redirect_uri: googleRedirectUri(),
      response_type: "code",
      scope: googleOAuthScopes().join(" "),
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
      state,
    });
    return res.json({
      ok: true,
      authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      redirectUri: googleRedirectUri(),
      scopes: googleOAuthScopes(),
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/integrations/google/exchange", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const code = requiredString(req.body?.code, "code", 5000);
    const state = requiredString(req.body?.state, "state", 10000);
    const payload = decodeGoogleState(state);
    if (
      Number(payload.agencyId) !== workspace.agency.id ||
      Number(payload.memberId) !== workspace.membership.id ||
      Number(payload.userId) !== workspace.membership.userId
    ) {
      throw new ApiError("CRM_GOOGLE_OAUTH_STATE_INVALID", "Google connection state does not match this user", 403);
    }

    const existing = await googleConnectionForWorkspace(workspace);
    const tokens = await googleTokenExchange(new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      code,
      grant_type: "authorization_code",
      redirect_uri: googleRedirectUri(),
    }));
    if (!tokens.access_token) {
      throw new ApiError("CRM_GOOGLE_OAUTH_FAILED", "Google did not return an access token", 400);
    }

    const profile = await googleJson<any>("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const accountEmail = String(profile?.email || "").trim().toLowerCase();
    if (!accountEmail) {
      throw new ApiError("CRM_GOOGLE_ACCOUNT_EMAIL_MISSING", "Google account email could not be resolved", 400);
    }
    const grantedScopes = String(tokens.scope || googleOAuthScopes().join(" "))
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter(Boolean);

    const connection = await prisma.crmIntegrationConnection.upsert({
      where: {
        agencyId_memberId_provider_connectionKey: {
          agencyId: workspace.agency.id,
          memberId: workspace.membership.id,
          provider: GOOGLE_PROVIDER,
          connectionKey: GOOGLE_CONNECTION_KEY,
        },
      },
      create: {
        agencyId: workspace.agency.id,
        memberId: workspace.membership.id,
        userId: workspace.membership.userId,
        provider: GOOGLE_PROVIDER,
        connectionKey: GOOGLE_CONNECTION_KEY,
        status: CrmIntegrationStatus.CONNECTED,
        accountEmail,
        externalAccountId: nullableString(profile?.sub, 500),
        scopes: grantedScopes,
        accessTokenEncrypted: encryptGoogleSecret(tokens.access_token),
        refreshTokenEncrypted: tokens.refresh_token ? encryptGoogleSecret(tokens.refresh_token) : null,
        tokenExpiresAt: new Date(Date.now() + Math.max(60, Number(tokens.expires_in || 3600)) * 1000),
      },
      update: {
        userId: workspace.membership.userId,
        status: CrmIntegrationStatus.CONNECTED,
        accountEmail,
        externalAccountId: nullableString(profile?.sub, 500),
        scopes: grantedScopes,
        accessTokenEncrypted: encryptGoogleSecret(tokens.access_token),
        refreshTokenEncrypted: tokens.refresh_token
          ? encryptGoogleSecret(tokens.refresh_token)
          : existing?.refreshTokenEncrypted || null,
        tokenExpiresAt: new Date(Date.now() + Math.max(60, Number(tokens.expires_in || 3600)) * 1000),
        gmailHistoryId: existing?.accountEmail && existing.accountEmail !== accountEmail ? null : existing?.gmailHistoryId,
        calendarSyncToken: existing?.accountEmail && existing.accountEmail !== accountEmail ? null : existing?.calendarSyncToken,
        lastErrorAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        disconnectedAt: null,
      },
    });

    await prisma.agencyAuditLog.create({
      data: {
        agencyId: workspace.agency.id,
        actorUserId: workspace.membership.userId,
        actorAgencyMemberId: workspace.membership.id,
        effectiveUserId: workspace.membership.userId,
        action: "CRM_GOOGLE_CONNECTED",
        entityType: "CrmIntegrationConnection",
        entityId: String(connection.id),
        afterState: { provider: connection.provider, status: connection.status, accountEmail },
        changedFields: ["crmIntegrationConnections"],
        metadata: { source: "agencyContacts", provider: "GOOGLE", accountEmail },
        ...requestMeta(req),
      },
    });

    return res.json({ ok: true, connection: publicGoogleConnection(connection) });
  } catch (error) {
    return handleError(res, error);
  }
});


function gmailAddressList(value: unknown, field: string, max = 50): string[] {
  if (value == null || value === "") return [];
  const raw = Array.isArray(value) ? value.map(String).join(",") : String(value);
  const emails = extractEmails(raw);
  if (emails.length === 0 && raw.trim()) {
    throw new ApiError("VALIDATION_ERROR", `${field} must contain a valid email address`, 400);
  }
  if (emails.length > max) {
    throw new ApiError("VALIDATION_ERROR", `${field} cannot contain more than ${max} email addresses`, 400);
  }
  return emails;
}

function mimeHeaderValue(value: string): string {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function base64UrlEncodeUtf8(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

type GmailAttachmentInput = {
  name: string;
  mimeType: string;
  bytes: Buffer;
};

function gmailAttachmentList(value: unknown): GmailAttachmentInput[] {
  if (value == null || value === "") return [];
  if (!Array.isArray(value)) throw new ApiError("VALIDATION_ERROR", "attachments must be an array", 400);
  if (value.length > 10) throw new ApiError("VALIDATION_ERROR", "A maximum of 10 attachments is allowed", 400);
  let totalBytes = 0;
  const attachments = value.map((item: any, index: number) => {
    const name = requiredString(item?.name, `attachments[${index}].name`, 255).replace(/[\r\n"]/g, "_");
    const mimeType = nullableString(item?.mimeType, 200) || "application/octet-stream";
    const data = requiredString(item?.data, `attachments[${index}].data`, 30_000_000);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 === 1) {
      throw new ApiError("VALIDATION_ERROR", `attachments[${index}].data must be base64 encoded`, 400);
    }
    const bytes = Buffer.from(data, "base64");
    if (bytes.length === 0) throw new ApiError("VALIDATION_ERROR", `attachments[${index}] is empty`, 400);
    if (bytes.length > 8 * 1024 * 1024) throw new ApiError("VALIDATION_ERROR", `${name} is larger than the 8 MB attachment limit`, 400);
    totalBytes += bytes.length;
    return { name, mimeType, bytes };
  });
  if (totalBytes > 15 * 1024 * 1024) {
    throw new ApiError("VALIDATION_ERROR", "Attachments cannot exceed 15 MB in total", 400);
  }
  return attachments;
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") || "";
}

function buildGmailMessage(args: {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachments: GmailAttachmentInput[];
  inReplyTo?: string | null;
  references?: string | null;
}) {
  const commonHeaders = [
    `From: ${mimeHeaderValue(args.from)}`,
    `To: ${args.to.map(mimeHeaderValue).join(", ")}`,
    args.cc.length ? `Cc: ${args.cc.map(mimeHeaderValue).join(", ")}` : "",
    args.bcc.length ? `Bcc: ${args.bcc.map(mimeHeaderValue).join(", ")}` : "",
    `Subject: ${mimeHeaderValue(args.subject)}`,
    args.inReplyTo ? `In-Reply-To: ${mimeHeaderValue(args.inReplyTo)}` : "",
    args.references ? `References: ${mimeHeaderValue(args.references)}` : "",
    "MIME-Version: 1.0",
  ].filter(Boolean);

  if (args.attachments.length === 0) {
    return `${commonHeaders.concat(['Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: 8bit"]).join("\r\n")}\r\n\r\n${args.body}`;
  }

  const boundary = `havn_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const parts = [
    `${commonHeaders.join("\r\n")}\r\nContent-Type: multipart/mixed; boundary="${boundary}"`,
    `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${args.body}`,
    ...args.attachments.map((attachment) =>
      `--${boundary}\r\nContent-Type: ${mimeHeaderValue(attachment.mimeType)}; name="${attachment.name}"\r\nContent-Disposition: attachment; filename="${attachment.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrapBase64(attachment.bytes.toString("base64"))}`
    ),
    `--${boundary}--`,
  ];
  return parts.join("\r\n");
}

router.post("/integrations/google/send", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    if (!googleGmailSendEnabled()) {
      throw new ApiError("CRM_GOOGLE_SEND_DISABLED", "Gmail sending is not enabled for this HAVN environment", 503);
    }

    const connection = await googleConnectionForWorkspace(workspace);
    if (!connection || connection.status !== CrmIntegrationStatus.CONNECTED) {
      throw new ApiError("CRM_GOOGLE_NOT_CONNECTED", "Connect Google before sending email from HAVN", 409);
    }
    if (!connection.scopes.includes(GOOGLE_GMAIL_SEND_SCOPE)) {
      throw new ApiError("CRM_GOOGLE_SEND_PERMISSION_REQUIRED", "Reconnect Google and approve Gmail send access before sending from HAVN", 409);
    }

    const to = gmailAddressList(req.body?.to, "to");
    const cc = gmailAddressList(req.body?.cc, "cc");
    const bcc = gmailAddressList(req.body?.bcc, "bcc");
    if (to.length === 0) throw new ApiError("VALIDATION_ERROR", "At least one recipient is required", 400);
    const subject = requiredString(req.body?.subject, "subject", 500);
    const body = requiredString(req.body?.body, "body", 50000);
    const attachments = gmailAttachmentList(req.body?.attachments);

    const contactId = req.body?.contactId == null || req.body?.contactId === "" ? null : asPositiveInt(req.body.contactId);
    const companyId = req.body?.companyId == null || req.body?.companyId === "" ? null : asPositiveInt(req.body.companyId);
    const opportunityId = req.body?.opportunityId == null || req.body?.opportunityId === "" ? null : asPositiveInt(req.body.opportunityId);
    const inventoryPropertyId = req.body?.inventoryPropertyId == null || req.body?.inventoryPropertyId === "" ? null : asPositiveInt(req.body.inventoryPropertyId);
    for (const [field, raw, parsed] of [
      ["contactId", req.body?.contactId, contactId],
      ["companyId", req.body?.companyId, companyId],
      ["opportunityId", req.body?.opportunityId, opportunityId],
      ["inventoryPropertyId", req.body?.inventoryPropertyId, inventoryPropertyId],
    ] as const) {
      if (raw != null && raw !== "" && !parsed) throw new ApiError("VALIDATION_ERROR", `${field} must be a positive integer or null`, 400);
    }
    await assertInteractionRelations(workspace.agency.id, {
      contactId,
      companyId,
      opportunityId,
      inventoryPropertyId,
      ownerMemberId: workspace.membership.id,
    });

    const access = await usableGoogleAccessToken(connection);
    const rawMime = buildGmailMessage({
      from: access.connection.accountEmail,
      to,
      cc,
      bcc,
      subject,
      body,
      attachments,
      inReplyTo: nullableString(req.body?.inReplyTo, 2000),
      references: nullableString(req.body?.references, 5000),
    });
    const sent = await googleJson<any>("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw: base64UrlEncodeUtf8(rawMime),
        ...(req.body?.threadId ? { threadId: String(req.body.threadId) } : {}),
      }),
    });
    if (!sent?.id) throw new ApiError("CRM_GOOGLE_SEND_FAILED", "Google did not return a sent message id", 502);

    const accountEmail = String(access.connection.accountEmail || "").toLowerCase();
    const externalId = `${accountEmail}:gmail:${String(sent.id)}`;
    const externalThreadId = sent?.threadId ? `${accountEmail}:gmail:${String(sent.threadId)}` : null;
    const externalUrl = sent?.threadId ? `https://mail.google.com/mail/#sent/${encodeURIComponent(String(sent.threadId))}` : null;
    const occurredAt = new Date();

    const interaction = await prisma.$transaction(async (tx) => {
      const created = await tx.crmInteraction.upsert({
        where: {
          agencyId_sourceProvider_externalId: {
            agencyId: workspace.agency.id,
            sourceProvider: CrmInteractionProvider.GOOGLE,
            externalId,
          },
        },
        create: {
          agencyId: workspace.agency.id,
          contactId,
          companyId,
          opportunityId,
          inventoryPropertyId,
          ownerMemberId: workspace.membership.id,
          type: CrmInteractionType.EMAIL,
          direction: CrmInteractionDirection.OUTBOUND,
          subject,
          summary: body.slice(0, 20000),
          occurredAt,
          sourceProvider: CrmInteractionProvider.GOOGLE,
          externalId,
          externalThreadId,
          externalUrl,
          createdByUserId: workspace.membership.userId,
        },
        update: {
          contactId,
          companyId,
          opportunityId,
          inventoryPropertyId,
          ownerMemberId: workspace.membership.id,
          direction: CrmInteractionDirection.OUTBOUND,
          subject,
          summary: body.slice(0, 20000),
          occurredAt,
          externalThreadId,
          externalUrl,
        },
        include: interactionInclude,
      });
      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: workspace.membership.userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: workspace.membership.userId,
          action: "CRM_GOOGLE_EMAIL_SENT",
          entityType: "CrmInteraction",
          entityId: String(created.id),
          afterState: {
            interactionId: created.id,
            contactId,
            companyId,
            opportunityId,
            inventoryPropertyId,
            subject,
            to,
            cc,
            bccCount: bcc.length,
            attachmentCount: attachments.length,
            attachmentNames: attachments.map((attachment) => attachment.name),
            attachmentBytes: attachments.reduce((sum, attachment) => sum + attachment.bytes.length, 0),
            provider: "GOOGLE",
          },
          changedFields: ["crmInteractions"],
          metadata: { source: "agencyContacts", provider: "GOOGLE", googleMessageId: String(sent.id), googleThreadId: sent?.threadId ? String(sent.threadId) : null },
          ...requestMeta(req),
        },
      });
      return created;
    });

    return res.status(201).json({ ok: true, item: interaction, sent: { id: String(sent.id), threadId: sent?.threadId ? String(sent.threadId) : null } });
  } catch (error) {
    return handleError(res, error);
  }
});

type CrmSyncAuditMode = "always" | "changes" | "never";

function shouldWriteCrmSyncAudit(mode: CrmSyncAuditMode, result: any): boolean {
  if (mode === "always") return true;
  if (mode === "never") return false;
  return [
    result?.gmail?.imported,
    result?.mail?.imported,
    result?.calendar?.imported,
  ].some((value) => Number(value || 0) > 0);
}

async function syncGoogleConnection(
  workspace: AgencyWorkspace,
  connection: any,
  options: {
    gmail?: boolean;
    calendar?: boolean;
    auditMode?: CrmSyncAuditMode;
    auditSource?: string;
    requestMetadata?: Record<string, unknown>;
  } = {},
) {
  const requestedGmail = options.gmail !== false;
  const requestedCalendar = options.calendar !== false;
  const auditMode = options.auditMode || "always";
  const auditSource = options.auditSource || "agencyContacts";
  const requestMetadata = options.requestMetadata || {};
  const connectionId = Number(connection?.id || 0) || null;

  try {
    if (!connection || connection.status === CrmIntegrationStatus.DISCONNECTED) {
      throw new ApiError(
        "CRM_GOOGLE_NOT_CONNECTED",
        "Connect a Google account before synchronizing",
        409,
      );
    }
    if (!requestedGmail && !requestedCalendar) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Select Gmail, Calendar, or both to synchronize",
        400,
      );
    }

    const access = await usableGoogleAccessToken(connection);
    let liveConnection: any = access.connection;
    const result: any = { gmail: null, calendar: null };
    const now = new Date();

    if (requestedGmail) {
      result.gmail = await incrementalGmailSync(workspace, liveConnection, access.token);
      liveConnection = await prisma.crmIntegrationConnection.update({
        where: { id: connection.id },
        data: {
          gmailHistoryId: result.gmail.historyId,
          lastEmailSyncAt: now,
          lastSyncAt: now,
          status: CrmIntegrationStatus.CONNECTED,
          lastErrorAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
    }

    if (requestedCalendar) {
      result.calendar = await googleCalendarSync(workspace, liveConnection, access.token);
      liveConnection = await prisma.crmIntegrationConnection.update({
        where: { id: connection.id },
        data: {
          calendarSyncToken: result.calendar.syncToken,
          lastCalendarSyncAt: now,
          lastSyncAt: now,
          status: CrmIntegrationStatus.CONNECTED,
          lastErrorAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
    }

    if (shouldWriteCrmSyncAudit(auditMode, result)) {
      await prisma.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: workspace.membership.userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: workspace.membership.userId,
          action: "CRM_GOOGLE_SYNCED",
          entityType: "CrmIntegrationConnection",
          entityId: String(connection.id),
          changedFields: ["crmInteractions"],
          metadata: {
            source: auditSource,
            provider: "GOOGLE",
            gmailImported: result.gmail?.imported ?? null,
            calendarImported: result.calendar?.imported ?? null,
          },
          ...requestMetadata,
        },
      });
    }

    return { result, liveConnection };
  } catch (error) {
    if (connectionId) await markGoogleConnectionError(connectionId, error);
    throw error;
  }
}

router.post("/integrations/google/sync", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const connection = await googleConnectionForWorkspace(workspace);
    const { result, liveConnection } = await syncGoogleConnection(workspace, connection, {
      gmail: req.body?.gmail !== false,
      calendar: req.body?.calendar !== false,
      requestMetadata: requestMeta(req),
    });

    return res.json({
      ok: true,
      result,
      connection: publicGoogleConnection(liveConnection),
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/integrations/google/disconnect", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const connection = await googleConnectionForWorkspace(workspace);
    if (!connection) {
      return res.json({ ok: true, connection: publicGoogleConnection(null) });
    }

    let revokeToken = "";
    try {
      revokeToken = connection.refreshTokenEncrypted
        ? decryptGoogleSecret(connection.refreshTokenEncrypted)
        : decryptGoogleSecret(connection.accessTokenEncrypted);
    } catch {
      revokeToken = "";
    }
    if (revokeToken) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(revokeToken)}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
      } catch (error) {
        console.warn("Google token revocation request failed", error);
      }
    }

    const updated = await prisma.crmIntegrationConnection.update({
      where: { id: connection.id },
      data: {
        status: CrmIntegrationStatus.DISCONNECTED,
        accessTokenEncrypted: encryptGoogleSecret(""),
        refreshTokenEncrypted: null,
        tokenExpiresAt: null,
        gmailHistoryId: null,
        calendarSyncToken: null,
        disconnectedAt: new Date(),
      },
    });

    await prisma.agencyAuditLog.create({
      data: {
        agencyId: workspace.agency.id,
        actorUserId: workspace.membership.userId,
        actorAgencyMemberId: workspace.membership.id,
        effectiveUserId: workspace.membership.userId,
        action: "CRM_GOOGLE_DISCONNECTED",
        entityType: "CrmIntegrationConnection",
        entityId: String(connection.id),
        changedFields: ["crmIntegrationConnections"],
        metadata: { source: "agencyContacts", provider: "GOOGLE", accountEmail: connection.accountEmail },
        ...requestMeta(req),
      },
    });

    return res.json({ ok: true, connection: publicGoogleConnection(updated) });
  } catch (error) {
    return handleError(res, error);
  }
});


/* CRM Microsoft 365 integration */
const MICROSOFT_PROVIDER = CrmIntegrationProvider.MICROSOFT;
const MICROSOFT_CONNECTION_KEY = "primary";
const MICROSOFT_OAUTH_SCOPES = [
  "openid",
  "email",
  "offline_access",
  "User.Read",
  "Mail.Read",
  "Calendars.Read",
] as const;
const MICROSOFT_INITIAL_MAIL_LOOKBACK_DAYS = 30;
const MICROSOFT_INITIAL_CALENDAR_LOOKBACK_DAYS = 90;
const MICROSOFT_INITIAL_CALENDAR_FORWARD_DAYS = 365;
const MICROSOFT_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

type MicrosoftTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

type MicrosoftConnectionRecord = Awaited<ReturnType<typeof microsoftConnectionForWorkspace>>;

function requiredMicrosoftEnv(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new ApiError(
      "CRM_MICROSOFT_CONFIGURATION_ERROR",
      `${name} is not configured`,
      503,
    );
  }
  return value;
}

function microsoftTenant(): string {
  return String(process.env.MICROSOFT_TENANT_ID || "common").trim() || "common";
}

function microsoftEncryptionKey(): Buffer {
  const raw = requiredMicrosoftEnv("CRM_MICROSOFT_TOKEN_ENCRYPTION_KEY");
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    key = Buffer.alloc(0);
  }
  if (key.length !== 32) {
    throw new ApiError(
      "CRM_MICROSOFT_CONFIGURATION_ERROR",
      "CRM_MICROSOFT_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
      503,
    );
  }
  return key;
}

function encryptMicrosoftSecret(value: string): string {
  const key = microsoftEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

function decryptMicrosoftSecret(value: string): string {
  const [version, ivRaw, tagRaw, encryptedRaw] = String(value || "").split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || encryptedRaw == null) {
    throw new ApiError("CRM_MICROSOFT_TOKEN_INVALID", "Stored Microsoft token could not be read", 500);
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      microsoftEncryptionKey(),
      Buffer.from(ivRaw, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new ApiError("CRM_MICROSOFT_TOKEN_INVALID", "Stored Microsoft token could not be decrypted", 500);
  }
}

function microsoftRedirectUri(): string {
  return requiredMicrosoftEnv("MICROSOFT_OAUTH_REDIRECT_URI");
}

function encodeMicrosoftState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", microsoftEncryptionKey())
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

function decodeMicrosoftState(state: string): any {
  const [body, signature] = String(state || "").split(".");
  if (!body || !signature) {
    throw new ApiError("CRM_MICROSOFT_OAUTH_STATE_INVALID", "Microsoft connection state is invalid", 400);
  }
  const expected = crypto
    .createHmac("sha256", microsoftEncryptionKey())
    .update(body)
    .digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    received = Buffer.alloc(0);
  }
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    throw new ApiError("CRM_MICROSOFT_OAUTH_STATE_INVALID", "Microsoft connection state is invalid", 400);
  }
  let payload: any;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new ApiError("CRM_MICROSOFT_OAUTH_STATE_INVALID", "Microsoft connection state is invalid", 400);
  }
  if (!payload?.exp || Number(payload.exp) < Date.now()) {
    throw new ApiError("CRM_MICROSOFT_OAUTH_STATE_EXPIRED", "Microsoft connection request has expired", 400);
  }
  return payload;
}

async function microsoftJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: any = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
  }
  if (!response.ok) {
    const message = body?.error_description || body?.error?.message || body?.error_description || body?.error || `Microsoft request failed (${response.status})`;
    const error = new ApiError(
      "CRM_MICROSOFT_API_ERROR",
      String(message),
      response.status >= 500 ? 502 : 400,
    ) as ApiError & { microsoftStatus?: number; microsoftBody?: any };
    error.microsoftStatus = response.status;
    error.microsoftBody = body;
    throw error;
  }
  return body as T;
}

async function microsoftTokenExchange(params: URLSearchParams): Promise<MicrosoftTokenResponse> {
  return microsoftJson<MicrosoftTokenResponse>(
    `https://login.microsoftonline.com/${encodeURIComponent(microsoftTenant())}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
  );
}

async function microsoftConnectionForWorkspace(workspace: AgencyWorkspace) {
  return prisma.crmIntegrationConnection.findUnique({
    where: {
      agencyId_memberId_provider_connectionKey: {
        agencyId: workspace.agency.id,
        memberId: workspace.membership.id,
        provider: MICROSOFT_PROVIDER,
        connectionKey: MICROSOFT_CONNECTION_KEY,
      },
    },
  });
}

function publicMicrosoftConnection(connection: any) {
  if (!connection) {
    return {
      provider: MICROSOFT_PROVIDER,
      connected: false,
      status: CrmIntegrationStatus.DISCONNECTED,
      accountEmail: null,
      scopes: [],
      lastEmailSyncAt: null,
      lastCalendarSyncAt: null,
      lastSyncAt: null,
      lastErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      disconnectedAt: null,
      emailSendEnabled: false,
      emailSendAvailable: false,
    };
  }
  return {
    id: connection.id,
    provider: connection.provider,
    connected: connection.status === CrmIntegrationStatus.CONNECTED,
    status: connection.status,
    accountEmail: connection.accountEmail,
    scopes: connection.scopes,
    tokenExpiresAt: connection.tokenExpiresAt,
    lastEmailSyncAt: connection.lastEmailSyncAt,
    lastCalendarSyncAt: connection.lastCalendarSyncAt,
    lastSyncAt: connection.lastSyncAt,
    lastErrorAt: connection.lastErrorAt,
    lastErrorCode: connection.lastErrorCode,
    lastErrorMessage: connection.lastErrorMessage,
    disconnectedAt: connection.disconnectedAt,
    emailSendEnabled: false,
    emailSendAvailable: false,
  };
}

async function usableMicrosoftAccessToken(
  connection: NonNullable<MicrosoftConnectionRecord>,
): Promise<{ token: string; connection: any }> {
  const expiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt).getTime() : 0;
  const currentToken = decryptMicrosoftSecret(connection.accessTokenEncrypted);
  if (currentToken && expiresAt > Date.now() + 60_000) {
    return { token: currentToken, connection };
  }
  if (!connection.refreshTokenEncrypted) {
    throw new ApiError(
      "CRM_MICROSOFT_RECONNECT_REQUIRED",
      "Microsoft access has expired. Reconnect the account.",
      401,
    );
  }
  const refreshToken = decryptMicrosoftSecret(connection.refreshTokenEncrypted);
  const tokens = await microsoftTokenExchange(new URLSearchParams({
    client_id: requiredMicrosoftEnv("MICROSOFT_CLIENT_ID"),
    client_secret: requiredMicrosoftEnv("MICROSOFT_CLIENT_SECRET"),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: MICROSOFT_OAUTH_SCOPES.join(" "),
  }));
  if (!tokens.access_token) {
    throw new ApiError(
      "CRM_MICROSOFT_RECONNECT_REQUIRED",
      "Microsoft did not return a refreshed access token",
      401,
    );
  }
  const updated = await prisma.crmIntegrationConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenEncrypted: encryptMicrosoftSecret(tokens.access_token),
      refreshTokenEncrypted: tokens.refresh_token
        ? encryptMicrosoftSecret(tokens.refresh_token)
        : connection.refreshTokenEncrypted,
      tokenExpiresAt: new Date(Date.now() + Math.max(60, Number(tokens.expires_in || 3600)) * 1000),
      scopes: String(tokens.scope || connection.scopes.join(" ")).split(/\s+/).filter(Boolean),
      status: CrmIntegrationStatus.CONNECTED,
      lastErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      disconnectedAt: null,
    },
  });
  return { token: tokens.access_token, connection: updated };
}

async function markMicrosoftConnectionError(connectionId: number, error: unknown) {
  const err: any = error;
  try {
    await prisma.crmIntegrationConnection.update({
      where: { id: connectionId },
      data: {
        status: CrmIntegrationStatus.ERROR,
        lastErrorAt: new Date(),
        lastErrorCode: nullableString(
          err?.code || err?.microsoftBody?.error?.code || "MICROSOFT_SYNC_ERROR",
          200,
        ),
        lastErrorMessage: nullableString(err?.message || "Microsoft synchronization failed", 2000),
      },
    });
  } catch (markError) {
    console.error("Failed to record Microsoft CRM integration error", markError);
  }
}

function microsoftRecipientEmails(values: any): string[] {
  return (Array.isArray(values) ? values : [])
    .map((item: any) => String(item?.emailAddress?.address || "").trim().toLowerCase())
    .filter(Boolean);
}

function microsoftMailDirection(accountEmail: string, message: any): CrmInteractionDirection {
  const account = accountEmail.toLowerCase();
  const from = String(message?.from?.emailAddress?.address || "").trim().toLowerCase();
  const sender = String(message?.sender?.emailAddress?.address || "").trim().toLowerCase();
  return from === account || sender === account
    ? CrmInteractionDirection.OUTBOUND
    : CrmInteractionDirection.INBOUND;
}

async function upsertMicrosoftEmailInteraction(args: {
  workspace: AgencyWorkspace;
  connection: any;
  accountEmail: string;
  message: any;
}) {
  const message = args.message;
  if (!message?.id) return false;
  const accountEmail = args.accountEmail.toLowerCase();
  const participantEmails = [
    String(message?.from?.emailAddress?.address || "").trim().toLowerCase(),
    String(message?.sender?.emailAddress?.address || "").trim().toLowerCase(),
    ...microsoftRecipientEmails(message?.toRecipients),
    ...microsoftRecipientEmails(message?.ccRecipients),
  ].filter((email) => email && email !== accountEmail);
  const contact = await matchedContactForEmails(args.workspace.agency.id, participantEmails);
  // Data minimisation: Outlook is a CRM source, not a mailbox mirror. Only retain
  // messages involving an active CRM contact in this agency.
  if (!contact) return false;
  const occurredRaw = message?.sentDateTime || message?.receivedDateTime || message?.createdDateTime;
  const occurredAt = occurredRaw ? new Date(occurredRaw) : new Date();
  if (Number.isNaN(occurredAt.getTime())) return false;
  const subject = String(message?.subject || "Email").trim().slice(0, 500) || "Email";
  const summary = String(message?.bodyPreview || subject).trim().slice(0, 20000) || subject;
  const externalId = `${accountEmail}:outlook:${String(message.id)}`;
  const conversationId = nullableString(message?.conversationId, 1000);

  await prisma.crmInteraction.upsert({
    where: {
      agencyId_sourceProvider_externalId: {
        agencyId: args.workspace.agency.id,
        sourceProvider: CrmInteractionProvider.MICROSOFT,
        externalId,
      },
    },
    create: {
      agencyId: args.workspace.agency.id,
      contactId: contact.id,
      companyId: contact.companyId || null,
      ownerMemberId: args.connection.memberId,
      type: CrmInteractionType.EMAIL,
      direction: microsoftMailDirection(accountEmail, message),
      subject,
      summary,
      occurredAt,
      sourceProvider: CrmInteractionProvider.MICROSOFT,
      externalId,
      externalThreadId: conversationId ? `${accountEmail}:outlook-conversation:${conversationId}` : null,
      externalUrl: nullableString(message?.webLink, 2000),
      createdByUserId: args.connection.userId,
    },
    update: {
      contactId: contact.id,
      companyId: contact.companyId || null,
      ownerMemberId: args.connection.memberId,
      direction: microsoftMailDirection(accountEmail, message),
      subject,
      summary,
      occurredAt,
      externalThreadId: conversationId ? `${accountEmail}:outlook-conversation:${conversationId}` : null,
      externalUrl: nullableString(message?.webLink, 2000),
    },
  });
  return true;
}

async function microsoftMailSync(workspace: AgencyWorkspace, connection: any, token: string) {
  const since = new Date(Date.now() - MICROSOFT_INITIAL_MAIL_LOOKBACK_DAYS * 86400000).toISOString();
  const params = new URLSearchParams({
    "$select": "id,conversationId,subject,bodyPreview,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,createdDateTime,webLink",
    "$filter": `receivedDateTime ge ${since}`,
    "$orderby": "receivedDateTime desc",
    "$top": "100",
  });
  let nextUrl: string | null = `https://graph.microsoft.com/v1.0/me/messages?${params.toString()}`;
  let pages = 0;
  let seen = 0;
  let imported = 0;
  let skipped = 0;
  while (nextUrl && pages < 10) {
    const page = await microsoftJson<any>(nextUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const messages = Array.isArray(page?.value) ? page.value : [];
    seen += messages.length;
    for (const message of messages) {
      const matched = await upsertMicrosoftEmailInteraction({
        workspace,
        connection,
        accountEmail: connection.accountEmail,
        message,
      });
      if (matched) imported += 1;
      else skipped += 1;
    }
    nextUrl = page?.["@odata.nextLink"] ? String(page["@odata.nextLink"]) : null;
    pages += 1;
  }
  return {
    seen,
    imported,
    skipped,
    pages,
    mode: "window",
    lookbackDays: MICROSOFT_INITIAL_MAIL_LOOKBACK_DAYS,
  };
}

function microsoftCalendarDirection(accountEmail: string, event: any): CrmInteractionDirection {
  const organizer = String(event?.organizer?.emailAddress?.address || "").trim().toLowerCase();
  return organizer && organizer === accountEmail.toLowerCase()
    ? CrmInteractionDirection.OUTBOUND
    : CrmInteractionDirection.INBOUND;
}

async function upsertMicrosoftCalendarInteraction(args: {
  workspace: AgencyWorkspace;
  connection: any;
  accountEmail: string;
  event: any;
}) {
  const event = args.event;
  if (!event?.id || event?.isCancelled === true || event?.["@removed"]) return false;
  const startRaw = event?.start?.dateTime;
  if (!startRaw) return false;
  const occurredAt = new Date(startRaw);
  if (Number.isNaN(occurredAt.getTime())) return false;
  const endRaw = event?.end?.dateTime;
  const endAt = endRaw ? new Date(endRaw) : null;
  const durationMinutes = endAt && !Number.isNaN(endAt.getTime())
    ? Math.max(0, Math.round((endAt.getTime() - occurredAt.getTime()) / 60000))
    : null;
  const attendeeEmails = (Array.isArray(event?.attendees) ? event.attendees : [])
    .map((attendee: any) => String(attendee?.emailAddress?.address || "").trim().toLowerCase())
    .filter((email: string) => email && email !== args.accountEmail.toLowerCase());
  const organizerEmail = String(event?.organizer?.emailAddress?.address || "").trim().toLowerCase();
  if (organizerEmail && organizerEmail !== args.accountEmail.toLowerCase()) attendeeEmails.push(organizerEmail);
  const contact = await matchedContactForEmails(args.workspace.agency.id, attendeeEmails);
  // Data minimisation: only retain Microsoft calendar events involving an active CRM contact.
  if (!contact) return false;
  const subject = String(event?.subject || "Meeting").trim().slice(0, 500) || "Meeting";
  const bodyPreview = String(event?.bodyPreview || "").trim();
  const location = String(event?.location?.displayName || "").trim();
  const summary = ([bodyPreview, location ? `Location: ${location}` : ""].filter(Boolean).join("\n\n") || subject).slice(0, 20000);
  const accountEmail = args.accountEmail.toLowerCase();
  const externalId = `${accountEmail}:outlook-calendar:${String(event.id)}`;
  const seriesMasterId = nullableString(event?.seriesMasterId, 1000);

  await prisma.crmInteraction.upsert({
    where: {
      agencyId_sourceProvider_externalId: {
        agencyId: args.workspace.agency.id,
        sourceProvider: CrmInteractionProvider.MICROSOFT,
        externalId,
      },
    },
    create: {
      agencyId: args.workspace.agency.id,
      contactId: contact.id,
      companyId: contact.companyId || null,
      ownerMemberId: args.connection.memberId,
      type: CrmInteractionType.MEETING,
      direction: microsoftCalendarDirection(accountEmail, event),
      subject,
      summary,
      occurredAt,
      durationMinutes,
      sourceProvider: CrmInteractionProvider.MICROSOFT,
      externalId,
      externalThreadId: seriesMasterId ? `${accountEmail}:outlook-calendar-series:${seriesMasterId}` : null,
      externalUrl: nullableString(event?.webLink, 2000),
      createdByUserId: args.connection.userId,
    },
    update: {
      contactId: contact.id,
      companyId: contact.companyId || null,
      ownerMemberId: args.connection.memberId,
      direction: microsoftCalendarDirection(accountEmail, event),
      subject,
      summary,
      occurredAt,
      durationMinutes,
      externalThreadId: seriesMasterId ? `${accountEmail}:outlook-calendar-series:${seriesMasterId}` : null,
      externalUrl: nullableString(event?.webLink, 2000),
    },
  });
  return true;
}

async function microsoftCalendarSync(workspace: AgencyWorkspace, connection: any, token: string) {
  const startDateTime = new Date(Date.now() - MICROSOFT_INITIAL_CALENDAR_LOOKBACK_DAYS * 86400000).toISOString();
  const endDateTime = new Date(Date.now() + MICROSOFT_INITIAL_CALENDAR_FORWARD_DAYS * 86400000).toISOString();
  const params = new URLSearchParams({
    startDateTime,
    endDateTime,
    "$top": "250",
  });
  let nextUrl: string | null = `https://graph.microsoft.com/v1.0/me/calendarView?${params.toString()}`;
  let pages = 0;
  let imported = 0;
  let skipped = 0;
  while (nextUrl && pages < 20) {
    const page = await microsoftJson<any>(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    });
    for (const event of Array.isArray(page?.value) ? page.value : []) {
      const matched = await upsertMicrosoftCalendarInteraction({
        workspace,
        connection,
        accountEmail: connection.accountEmail,
        event,
      });
      if (matched) imported += 1;
      else skipped += 1;
    }
    nextUrl = page?.["@odata.nextLink"] ? String(page["@odata.nextLink"]) : null;
    pages += 1;
  }
  return {
    imported,
    skipped,
    mode: "window",
    lookbackDays: MICROSOFT_INITIAL_CALENDAR_LOOKBACK_DAYS,
    forwardDays: MICROSOFT_INITIAL_CALENDAR_FORWARD_DAYS,
  };
}

router.get("/integrations/microsoft/status", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const connection = await microsoftConnectionForWorkspace(workspace);
    return res.json({
      ok: true,
      configured: Boolean(
        process.env.MICROSOFT_CLIENT_ID &&
        process.env.MICROSOFT_CLIENT_SECRET &&
        process.env.MICROSOFT_OAUTH_REDIRECT_URI &&
        process.env.CRM_MICROSOFT_TOKEN_ENCRYPTION_KEY
      ),
      tenant: microsoftTenant(),
      connection: publicMicrosoftConnection(connection),
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/integrations/microsoft/connect", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const state = encodeMicrosoftState({
      agencyId: workspace.agency.id,
      memberId: workspace.membership.id,
      userId: workspace.membership.userId,
      nonce: crypto.randomBytes(18).toString("base64url"),
      exp: Date.now() + MICROSOFT_OAUTH_STATE_TTL_MS,
    });
    const params = new URLSearchParams({
      client_id: requiredMicrosoftEnv("MICROSOFT_CLIENT_ID"),
      response_type: "code",
      redirect_uri: microsoftRedirectUri(),
      response_mode: "query",
      scope: MICROSOFT_OAUTH_SCOPES.join(" "),
      state,
      prompt: "select_account",
    });
    return res.json({
      ok: true,
      authorizationUrl: `https://login.microsoftonline.com/${encodeURIComponent(microsoftTenant())}/oauth2/v2.0/authorize?${params.toString()}`,
      redirectUri: microsoftRedirectUri(),
      scopes: [...MICROSOFT_OAUTH_SCOPES],
      tenant: microsoftTenant(),
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/integrations/microsoft/exchange", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const code = requiredString(req.body?.code, "code", 10000);
    const state = requiredString(req.body?.state, "state", 10000);
    const payload = decodeMicrosoftState(state);
    if (
      Number(payload.agencyId) !== workspace.agency.id ||
      Number(payload.memberId) !== workspace.membership.id ||
      Number(payload.userId) !== workspace.membership.userId
    ) {
      throw new ApiError(
        "CRM_MICROSOFT_OAUTH_STATE_INVALID",
        "Microsoft connection state does not match this user",
        403,
      );
    }
    const existing = await microsoftConnectionForWorkspace(workspace);
    const tokens = await microsoftTokenExchange(new URLSearchParams({
      client_id: requiredMicrosoftEnv("MICROSOFT_CLIENT_ID"),
      client_secret: requiredMicrosoftEnv("MICROSOFT_CLIENT_SECRET"),
      code,
      grant_type: "authorization_code",
      redirect_uri: microsoftRedirectUri(),
      scope: MICROSOFT_OAUTH_SCOPES.join(" "),
    }));
    if (!tokens.access_token) {
      throw new ApiError("CRM_MICROSOFT_OAUTH_FAILED", "Microsoft did not return an access token", 400);
    }
    const profile = await microsoftJson<any>(
      "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    const accountEmail = String(profile?.mail || profile?.userPrincipalName || "").trim().toLowerCase();
    if (!accountEmail) {
      throw new ApiError(
        "CRM_MICROSOFT_ACCOUNT_EMAIL_MISSING",
        "Microsoft account email could not be resolved",
        400,
      );
    }
    const grantedScopes = String(tokens.scope || MICROSOFT_OAUTH_SCOPES.join(" "))
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
    const connection = await prisma.crmIntegrationConnection.upsert({
      where: {
        agencyId_memberId_provider_connectionKey: {
          agencyId: workspace.agency.id,
          memberId: workspace.membership.id,
          provider: MICROSOFT_PROVIDER,
          connectionKey: MICROSOFT_CONNECTION_KEY,
        },
      },
      create: {
        agencyId: workspace.agency.id,
        memberId: workspace.membership.id,
        userId: workspace.membership.userId,
        provider: MICROSOFT_PROVIDER,
        connectionKey: MICROSOFT_CONNECTION_KEY,
        status: CrmIntegrationStatus.CONNECTED,
        accountEmail,
        externalAccountId: nullableString(profile?.id, 500),
        scopes: grantedScopes,
        accessTokenEncrypted: encryptMicrosoftSecret(tokens.access_token),
        refreshTokenEncrypted: tokens.refresh_token ? encryptMicrosoftSecret(tokens.refresh_token) : null,
        tokenExpiresAt: new Date(Date.now() + Math.max(60, Number(tokens.expires_in || 3600)) * 1000),
      },
      update: {
        userId: workspace.membership.userId,
        status: CrmIntegrationStatus.CONNECTED,
        accountEmail,
        externalAccountId: nullableString(profile?.id, 500),
        scopes: grantedScopes,
        accessTokenEncrypted: encryptMicrosoftSecret(tokens.access_token),
        refreshTokenEncrypted: tokens.refresh_token
          ? encryptMicrosoftSecret(tokens.refresh_token)
          : existing?.refreshTokenEncrypted || null,
        tokenExpiresAt: new Date(Date.now() + Math.max(60, Number(tokens.expires_in || 3600)) * 1000),
        // These cursor columns are provider-scoped by the connection row. Clear any stale
        // cursor state when a different Microsoft account replaces the previous one.
        gmailHistoryId: existing?.accountEmail && existing.accountEmail !== accountEmail ? null : existing?.gmailHistoryId,
        calendarSyncToken: existing?.accountEmail && existing.accountEmail !== accountEmail ? null : existing?.calendarSyncToken,
        lastErrorAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        disconnectedAt: null,
      },
    });
    await prisma.agencyAuditLog.create({
      data: {
        agencyId: workspace.agency.id,
        actorUserId: workspace.membership.userId,
        actorAgencyMemberId: workspace.membership.id,
        effectiveUserId: workspace.membership.userId,
        action: "CRM_MICROSOFT_CONNECTED",
        entityType: "CrmIntegrationConnection",
        entityId: String(connection.id),
        afterState: { provider: connection.provider, status: connection.status, accountEmail },
        changedFields: ["crmIntegrationConnections"],
        metadata: { source: "agencyContacts", provider: "MICROSOFT", accountEmail },
        ...requestMeta(req),
      },
    });
    return res.json({ ok: true, connection: publicMicrosoftConnection(connection) });
  } catch (error) {
    return handleError(res, error);
  }
});

async function syncMicrosoftConnection(
  workspace: AgencyWorkspace,
  connection: any,
  options: {
    mail?: boolean;
    calendar?: boolean;
    auditMode?: CrmSyncAuditMode;
    auditSource?: string;
    requestMetadata?: Record<string, unknown>;
  } = {},
) {
  const requestedMail = options.mail !== false;
  const requestedCalendar = options.calendar !== false;
  const auditMode = options.auditMode || "always";
  const auditSource = options.auditSource || "agencyContacts";
  const requestMetadata = options.requestMetadata || {};
  const connectionId = Number(connection?.id || 0) || null;

  try {
    if (!connection || connection.status === CrmIntegrationStatus.DISCONNECTED) {
      throw new ApiError(
        "CRM_MICROSOFT_NOT_CONNECTED",
        "Connect a Microsoft account before synchronizing",
        409,
      );
    }
    if (!requestedMail && !requestedCalendar) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Select Outlook Mail, Calendar, or both to synchronize",
        400,
      );
    }

    const access = await usableMicrosoftAccessToken(connection);
    let liveConnection: any = access.connection;
    const result: any = { mail: null, calendar: null };
    const now = new Date();

    if (requestedMail) {
      result.mail = await microsoftMailSync(workspace, liveConnection, access.token);
      liveConnection = await prisma.crmIntegrationConnection.update({
        where: { id: connection.id },
        data: {
          lastEmailSyncAt: now,
          lastSyncAt: now,
          status: CrmIntegrationStatus.CONNECTED,
          lastErrorAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
    }

    if (requestedCalendar) {
      result.calendar = await microsoftCalendarSync(workspace, liveConnection, access.token);
      liveConnection = await prisma.crmIntegrationConnection.update({
        where: { id: connection.id },
        data: {
          lastCalendarSyncAt: now,
          lastSyncAt: now,
          status: CrmIntegrationStatus.CONNECTED,
          lastErrorAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
    }

    console.info("CRM Microsoft sync completed", {
      agencyId: workspace.agency.id,
      memberId: workspace.membership.id,
      mailImported: result.mail?.imported ?? null,
      mailSkipped: result.mail?.skipped ?? null,
      calendarImported: result.calendar?.imported ?? null,
      calendarSkipped: result.calendar?.skipped ?? null,
    });

    if (shouldWriteCrmSyncAudit(auditMode, result)) {
      await prisma.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: workspace.membership.userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: workspace.membership.userId,
          action: "CRM_MICROSOFT_SYNCED",
          entityType: "CrmIntegrationConnection",
          entityId: String(connection.id),
          changedFields: ["crmInteractions"],
          metadata: {
            source: auditSource,
            provider: "MICROSOFT",
            mailSeen: result.mail?.seen ?? null,
            mailImported: result.mail?.imported ?? null,
            mailSkipped: result.mail?.skipped ?? null,
            mailPages: result.mail?.pages ?? null,
            calendarImported: result.calendar?.imported ?? null,
            calendarSkipped: result.calendar?.skipped ?? null,
          },
          ...requestMetadata,
        },
      });
    }

    return { result, liveConnection };
  } catch (error) {
    if (connectionId) await markMicrosoftConnectionError(connectionId, error);
    throw error;
  }
}

router.post("/integrations/microsoft/sync", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const connection = await microsoftConnectionForWorkspace(workspace);
    const { result, liveConnection } = await syncMicrosoftConnection(workspace, connection, {
      mail: req.body?.mail !== false && req.body?.email !== false,
      calendar: req.body?.calendar !== false,
      requestMetadata: requestMeta(req),
    });

    return res.json({
      ok: true,
      result,
      connection: publicMicrosoftConnection(liveConnection),
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/integrations/microsoft/disconnect", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertCanManageCrm(workspace);
    const connection = await microsoftConnectionForWorkspace(workspace);
    if (!connection) {
      return res.json({ ok: true, connection: publicMicrosoftConnection(null) });
    }
    const updated = await prisma.crmIntegrationConnection.update({
      where: { id: connection.id },
      data: {
        status: CrmIntegrationStatus.DISCONNECTED,
        accessTokenEncrypted: encryptMicrosoftSecret(""),
        refreshTokenEncrypted: null,
        tokenExpiresAt: null,
        gmailHistoryId: null,
        calendarSyncToken: null,
        disconnectedAt: new Date(),
      },
    });
    await prisma.agencyAuditLog.create({
      data: {
        agencyId: workspace.agency.id,
        actorUserId: workspace.membership.userId,
        actorAgencyMemberId: workspace.membership.id,
        effectiveUserId: workspace.membership.userId,
        action: "CRM_MICROSOFT_DISCONNECTED",
        entityType: "CrmIntegrationConnection",
        entityId: String(connection.id),
        changedFields: ["crmIntegrationConnections"],
        metadata: {
          source: "agencyContacts",
          provider: "MICROSOFT",
          accountEmail: connection.accountEmail,
        },
        ...requestMeta(req),
      },
    });
    return res.json({ ok: true, connection: publicMicrosoftConnection(updated) });
  } catch (error) {
    return handleError(res, error);
  }
});


/* CRM IMAP / CalDAV integration */

const IMAP_CALDAV_PROVIDER = CrmIntegrationProvider.IMAP_CALDAV;
const IMAP_CALDAV_ICLOUD_CONNECTION_KEY = "icloud";
const IMAP_CALDAV_MAIL_LOOKBACK_DAYS = 30;
const IMAP_CALDAV_CALENDAR_LOOKBACK_DAYS = 90;
const IMAP_CALDAV_CALENDAR_FORWARD_DAYS = 365;

type ImapCaldavConfiguration = {
  type: "ICLOUD" | "CUSTOM";
  username?: string;
  imap: {
    host: string;
    port: number;
    secure: boolean;
  };
  caldav?: {
    serverUrl: string;
  } | null;
};

function imapCaldavEncryptionKey(): Buffer {
  const raw = String(
    process.env.CRM_IMAP_CALDAV_ENCRYPTION_KEY || "",
  ).trim();

  if (!raw) {
    throw new ApiError(
      "CRM_IMAP_CALDAV_CONFIGURATION_ERROR",
      "CRM_IMAP_CALDAV_ENCRYPTION_KEY is not configured",
      503,
    );
  }

  let key: Buffer;

  try {
    key = Buffer.from(raw, "base64");
  } catch {
    key = Buffer.alloc(0);
  }

  if (key.length !== 32) {
    throw new ApiError(
      "CRM_IMAP_CALDAV_CONFIGURATION_ERROR",
      "CRM_IMAP_CALDAV_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
      503,
    );
  }

  return key;
}

function encryptImapCaldavSecret(value: string): string {
  const key = imapCaldavEncryptionKey();
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    key,
    iv,
  );

  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

function decryptImapCaldavSecret(value: string): string {
  const [version, ivRaw, tagRaw, encryptedRaw] =
    String(value || "").split(":");

  if (
    version !== "v1" ||
    !ivRaw ||
    !tagRaw ||
    encryptedRaw == null
  ) {
    throw new ApiError(
      "CRM_IMAP_CALDAV_CREDENTIAL_INVALID",
      "Stored IMAP / CalDAV credential could not be read",
      500,
    );
  }

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      imapCaldavEncryptionKey(),
      Buffer.from(ivRaw, "base64url"),
    );

    decipher.setAuthTag(
      Buffer.from(tagRaw, "base64url"),
    );

    return Buffer.concat([
      decipher.update(
        Buffer.from(encryptedRaw, "base64url"),
      ),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new ApiError(
      "CRM_IMAP_CALDAV_CREDENTIAL_INVALID",
      "Stored IMAP / CalDAV credential could not be decrypted",
      500,
    );
  }
}

function imapCaldavCustomConnectionKey(email: string): string {
  return `custom:${String(email || "").trim().toLowerCase()}`;
}

async function imapCaldavConnectionForWorkspace(
  workspace: AgencyWorkspace,
  selector?: { connectionId?: number | null; connectionKey?: string | null },
) {
  const connectionId = selector?.connectionId || null;
  if (connectionId) {
    return prisma.crmIntegrationConnection.findFirst({
      where: {
        id: connectionId,
        agencyId: workspace.agency.id,
        memberId: workspace.membership.id,
        provider: IMAP_CALDAV_PROVIDER,
      },
    });
  }

  const connectionKey =
    String(selector?.connectionKey || IMAP_CALDAV_ICLOUD_CONNECTION_KEY).trim() ||
    IMAP_CALDAV_ICLOUD_CONNECTION_KEY;

  return prisma.crmIntegrationConnection.findUnique({
    where: {
      agencyId_memberId_provider_connectionKey: {
        agencyId: workspace.agency.id,
        memberId: workspace.membership.id,
        provider: IMAP_CALDAV_PROVIDER,
        connectionKey,
      },
    },
  });
}

function normaliseImapCaldavConfiguration(
  value: unknown,
): ImapCaldavConfiguration | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw: any = value;

  const username = String(raw.username || "").trim();

  const type =
    String(raw.type || "").toUpperCase() === "ICLOUD"
      ? "ICLOUD"
      : "CUSTOM";

  const host = String(
    raw.imap?.host || "",
  ).trim().toLowerCase();

  const port = Number(raw.imap?.port || 0);

  /*
   * HAVN only permits encrypted IMAP connections.
   * No plaintext port 143 connector is exposed.
   */
  const secure = raw.imap?.secure !== false;

  if (
    !host ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !secure
  ) {
    return null;
  }

  const serverUrl =
    String(raw.caldav?.serverUrl || "").trim();

  if (serverUrl) {
    try {
      const parsed = new URL(serverUrl);

      if (parsed.protocol !== "https:") {
        return null;
      }

      if (!parsed.hostname) {
        return null;
      }
    } catch {
      return null;
    }
  }

  return {
    type,
    ...(username ? { username } : {}),
    imap: {
      host,
      port,
      secure: true,
    },
    caldav: serverUrl
      ? {
          serverUrl,
        }
      : null,
  };
}

function publicImapCaldavConnection(
  connection: any,
) {
  const configuration =
    normaliseImapCaldavConfiguration(
      connection?.configuration,
    );

  if (!connection) {
    return {
      provider: IMAP_CALDAV_PROVIDER,
      connectionKey: null,
      connected: false,
      status:
        CrmIntegrationStatus.DISCONNECTED,
      accountEmail: null,
      configuration: null,
      scopes: [],
      lastEmailSyncAt: null,
      lastCalendarSyncAt: null,
      lastSyncAt: null,
      lastErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      disconnectedAt: null,
    };
  }

  return {
    id: connection.id,
    provider: connection.provider,
    connectionKey: connection.connectionKey,
    type: configuration?.type || null,
    supportsCalendar: Boolean(configuration?.caldav),
    connected:
      connection.status ===
      CrmIntegrationStatus.CONNECTED,
    status: connection.status,
    accountEmail: connection.accountEmail,
    configuration,
    scopes: connection.scopes,
    lastEmailSyncAt:
      connection.lastEmailSyncAt,
    lastCalendarSyncAt:
      connection.lastCalendarSyncAt,
    lastSyncAt: connection.lastSyncAt,
    lastErrorAt: connection.lastErrorAt,
    lastErrorCode: connection.lastErrorCode,
    lastErrorMessage:
      connection.lastErrorMessage,
    disconnectedAt:
      connection.disconnectedAt,
  };
}

function isPrivateOrUnsafeIp(
  address: string,
): boolean {
  const value = String(address || "")
    .trim()
    .toLowerCase();

  if (!value) return true;

  /*
   * IPv6 local/private/link-local.
   */
  if (
    value === "::1" ||
    value === "::" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe8") ||
    value.startsWith("fe9") ||
    value.startsWith("fea") ||
    value.startsWith("feb")
  ) {
    return true;
  }

  /*
   * IPv4-mapped IPv6.
   */
  const ipv4 =
    value.startsWith("::ffff:")
      ? value.slice(7)
      : value;

  const parts = ipv4
    .split(".")
    .map((part) => Number(part));

  if (
    parts.length !== 4 ||
    parts.some(
      (part) =>
        !Number.isInteger(part) ||
        part < 0 ||
        part > 255,
    )
  ) {
    return false;
  }

  const [a, b] = parts;

  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;

  if (
    a === 100 &&
    b >= 64 &&
    b <= 127
  ) {
    return true;
  }

  if (
    a === 169 &&
    b === 254
  ) {
    return true;
  }

  if (
    a === 172 &&
    b >= 16 &&
    b <= 31
  ) {
    return true;
  }

  if (
    a === 192 &&
    b === 168
  ) {
    return true;
  }

  if (
    a === 198 &&
    (b === 18 || b === 19)
  ) {
    return true;
  }

  if (a >= 224) {
    return true;
  }

  return false;
}

async function assertPublicConnectorHostname(
  hostname: string,
) {
  const host = String(hostname || "")
    .trim()
    .toLowerCase();

  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new ApiError(
      "CRM_IMAP_CALDAV_HOST_BLOCKED",
      "This mail or calendar server address is not allowed",
      400,
    );
  }

  let resolved: {
    address: string;
    family: number;
  }[];

  try {
    resolved = await dns.lookup(host, {
      all: true,
      verbatim: true,
    });
  } catch {
    throw new ApiError(
      "CRM_IMAP_CALDAV_HOST_NOT_FOUND",
      `Could not resolve server ${host}`,
      400,
    );
  }

  if (
    !resolved.length ||
    resolved.some((entry) =>
      isPrivateOrUnsafeIp(entry.address),
    )
  ) {
    throw new ApiError(
      "CRM_IMAP_CALDAV_HOST_BLOCKED",
      "Private or internal mail/calendar servers cannot be accessed by this connector",
      400,
    );
  }
}

async function validateImapCaldavNetworkTargets(
  configuration: ImapCaldavConfiguration,
) {
  await assertPublicConnectorHostname(
    configuration.imap.host,
  );

  if (
    configuration.caldav?.serverUrl
  ) {
    const url = new URL(
      configuration.caldav.serverUrl,
    );

    await assertPublicConnectorHostname(
      url.hostname,
    );
  }
}

function imapCaldavSettingsFromBody(body: any) {
  const email = requiredString(body?.email, "email", 320).trim().toLowerCase();
  if (extractEmails(email).length !== 1 || extractEmails(email)[0] !== email) {
    throw new ApiError("VALIDATION_ERROR", "email must be a valid email address", 400);
  }

  const password = requiredString(body?.password, "password", 1000);
  const requestedType = String(body?.type || "").trim().toUpperCase() === "ICLOUD"
    ? "ICLOUD"
    : "CUSTOM";
  const username = requestedType === "ICLOUD"
    ? email
    : (nullableString(body?.username, 500) || email);

  const configuration: ImapCaldavConfiguration = requestedType === "ICLOUD"
    ? {
        type: "ICLOUD",
        username,
        imap: { host: "imap.mail.me.com", port: 993, secure: true },
        caldav: { serverUrl: "https://caldav.icloud.com" },
      }
    : {
        type: "CUSTOM",
        username,
        imap: {
          host: requiredString(body?.imapHost, "imapHost", 500),
          port: Number(body?.imapPort || 993),
          secure: true,
        },
        caldav: body?.caldavServerUrl
          ? { serverUrl: requiredString(body?.caldavServerUrl, "caldavServerUrl", 1000) }
          : null,
      };

  const normalisedConfiguration = normaliseImapCaldavConfiguration(configuration);
  if (!normalisedConfiguration) {
    throw new ApiError("VALIDATION_ERROR", "IMAP / CalDAV configuration is invalid", 400);
  }

  const connectionKey = requestedType === "ICLOUD"
    ? IMAP_CALDAV_ICLOUD_CONNECTION_KEY
    : imapCaldavCustomConnectionKey(email);

  return { email, username, password, requestedType, configuration: normalisedConfiguration, connectionKey };
}

function imapCaldavConnectionIdFromRequest(req: AgentRequest): number | null {
  const raw = req.body?.connectionId ?? req.query?.connectionId;
  if (raw == null || raw === "") return null;
  const parsed = asPositiveInt(raw);
  if (!parsed) throw new ApiError("VALIDATION_ERROR", "connectionId must be a positive integer", 400);
  return parsed;
}

async function testImapConnection(args: {
  email: string;
  username?: string;
  password: string;
  configuration:
    ImapCaldavConfiguration;
}) {
  await assertPublicConnectorHostname(args.configuration.imap.host);
  const client = new ImapFlow({
    host: args.configuration.imap.host,
    port: args.configuration.imap.port,
    secure: true,
    auth: {
      user: args.username || args.configuration.username || args.email,
      pass: args.password,
    },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    logger: false,
  });

  // ImapFlow emits EventEmitter "error" events as well as rejecting connect()/
  // command promises. Always attach a listener so bad credentials, disconnects or
  // socket timeouts are returned through the request instead of becoming an
  // unhandled process-level error.
  client.on("error", (error) => {
    console.warn("CRM IMAP connection error", {
      host: args.configuration.imap.host,
      code: nullableString((error as any)?.code, 100),
      message: nullableString((error as any)?.message, 500),
    });
  });

  try {
    await client.connect();
  } finally {
    if (client.usable) {
      try {
        await client.logout();
      } catch (logoutError) {
        console.warn("CRM IMAP logout failed after connection test", {
          host: args.configuration.imap.host,
          code: nullableString((logoutError as any)?.code, 100),
          message: nullableString((logoutError as any)?.message, 500),
        });
        try {
          client.close();
        } catch {
          // Best-effort cleanup only.
        }
      }
    } else {
      try {
        client.close();
      } catch {
        // Best-effort cleanup only.
      }
    }
  }
}

async function testCaldavConnection(args: {
  email: string;
  username?: string;
  password: string;
  configuration:
    ImapCaldavConfiguration;
}) {
  if (
    !args.configuration.caldav?.serverUrl
  ) {
    return;
  }

  const caldavUrl = new URL(args.configuration.caldav.serverUrl);
  await assertPublicConnectorHostname(caldavUrl.hostname);

  const client = await createDAVClient({
    serverUrl:
      args.configuration.caldav.serverUrl,
    credentials: {
      username: args.username || args.configuration.username || args.email,
      password: args.password,
    },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });

  await client.fetchCalendars();
}

async function markImapCaldavConnectionError(
  connectionId: number,
  error: unknown,
) {
  const err: any = error;

  try {
    await prisma.crmIntegrationConnection.update({
      where: {
        id: connectionId,
      },
      data: {
        status:
          CrmIntegrationStatus.ERROR,
        lastErrorAt: new Date(),
        lastErrorCode: nullableString(
          err?.code ||
            "IMAP_CALDAV_SYNC_ERROR",
          200,
        ),
        lastErrorMessage: nullableString(
          err?.message ||
            "IMAP / CalDAV synchronization failed",
          2000,
        ),
      },
    });
  } catch (markError) {
    console.error(
      "Failed to record IMAP / CalDAV CRM integration error",
      markError,
    );
  }
}

function imapAddressEmails(
  values: any,
): string[] {
  const list = Array.isArray(values)
    ? values
    : values
      ? [values]
      : [];

  const result: string[] = [];

  for (const value of list) {
    const address = String(
      value?.address || "",
    )
      .trim()
      .toLowerCase();

    if (address) {
      result.push(address);
      continue;
    }

    const mailbox = String(
      value?.mailbox || "",
    ).trim();

    const host = String(
      value?.host || "",
    ).trim();

    if (mailbox && host) {
      result.push(
        `${mailbox}@${host}`.toLowerCase(),
      );
    }
  }

  return [...new Set(result)];
}

function imapMailDirection(
  accountEmail: string,
  envelope: any,
): CrmInteractionDirection {
  const account =
    accountEmail.toLowerCase();

  const from =
    imapAddressEmails(envelope?.from);

  return from.includes(account)
    ? CrmInteractionDirection.OUTBOUND
    : CrmInteractionDirection.INBOUND;
}

async function upsertImapEmailInteraction(
  args: {
    workspace: AgencyWorkspace;
    connection: any;
    accountEmail: string;
    mailboxPath: string;
    uidValidity: string;
    message: any;
  },
) {
  const message = args.message;

  if (!message?.uid) {
    return false;
  }

  const envelope = message.envelope || {};

  const accountEmail =
    args.accountEmail.toLowerCase();

  const participantEmails = [
    ...imapAddressEmails(envelope.from),
    ...imapAddressEmails(envelope.to),
    ...imapAddressEmails(envelope.cc),
    ...imapAddressEmails(envelope.bcc),
    ...imapAddressEmails(envelope.replyTo),
  ].filter(
    (email) =>
      email &&
      email !== accountEmail,
  );

  const contact =
    await matchedContactForEmails(
      args.workspace.agency.id,
      participantEmails,
    );

  /*
   * Data minimisation:
   * IMAP is a CRM source, not a mailbox mirror.
   */
  if (!contact) {
    return false;
  }

  const occurredRaw =
    envelope?.date ||
    message?.internalDate ||
    new Date();

  const occurredAt =
    occurredRaw instanceof Date
      ? occurredRaw
      : new Date(occurredRaw);

  if (
    Number.isNaN(
      occurredAt.getTime(),
    )
  ) {
    return false;
  }

  const subject =
    String(
      envelope?.subject || "Email",
    )
      .trim()
      .slice(0, 500) || "Email";

  /*
   * We deliberately do not ingest entire
   * email bodies at this stage.
   */
  const summary = subject;

  const mailboxKey =
    String(args.mailboxPath || "mail")
      .trim()
      .toLowerCase();

  const externalId =
    `${accountEmail}:imap:${mailboxKey}:${args.uidValidity}:${String(message.uid)}`;

  const messageId =
    nullableString(
      envelope?.messageId,
      1000,
    );

  await prisma.crmInteraction.upsert({
    where: {
      agencyId_sourceProvider_externalId: {
        agencyId:
          args.workspace.agency.id,
        sourceProvider:
          CrmInteractionProvider.IMAP_CALDAV,
        externalId,
      },
    },
    create: {
      agencyId:
        args.workspace.agency.id,
      contactId: contact.id,
      companyId:
        contact.companyId || null,
      ownerMemberId:
        args.connection.memberId,
      type: CrmInteractionType.EMAIL,
      direction: imapMailDirection(
        accountEmail,
        envelope,
      ),
      subject,
      summary,
      occurredAt,
      sourceProvider:
        CrmInteractionProvider.IMAP_CALDAV,
      sourceConnectionId:
        args.connection.id,
      externalId,
      externalThreadId: messageId
        ? `${accountEmail}:imap-message:${messageId}`
        : null,
      externalUrl: null,
      createdByUserId:
        args.connection.userId,
    },
    update: {
      contactId: contact.id,
      companyId:
        contact.companyId || null,
      ownerMemberId:
        args.connection.memberId,
      sourceConnectionId:
        args.connection.id,
      direction: imapMailDirection(
        accountEmail,
        envelope,
      ),
      subject,
      summary,
      occurredAt,
      externalThreadId: messageId
        ? `${accountEmail}:imap-message:${messageId}`
        : null,
    },
  });

  return true;
}

async function imapMailSync(
  workspace: AgencyWorkspace,
  connection: any,
  password: string,
  configuration:
    ImapCaldavConfiguration,
) {
  await assertPublicConnectorHostname(configuration.imap.host);
  const client = new ImapFlow({
    host: configuration.imap.host,
    port: configuration.imap.port,
    secure: true,
    auth: {
      user: configuration.username || connection.accountEmail,
      pass: password,
    },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    logger: false,
  });

  client.on("error", (error) => {
    console.warn("CRM IMAP sync connection error", {
      connectionId: connection.id,
      host: configuration.imap.host,
      code: nullableString((error as any)?.code, 100),
      message: nullableString((error as any)?.message, 500),
    });
  });

  const since = new Date(
    Date.now() -
      IMAP_CALDAV_MAIL_LOOKBACK_DAYS *
        86400000,
  );

  let seen = 0;
  let imported = 0;
  let skipped = 0;
  let mailboxes = 0;

  try {
    await client.connect();

    const availableMailboxes =
      await client.list();

    const targets =
      availableMailboxes.filter(
        (mailbox: any) => {
          const path =
            String(
              mailbox?.path || "",
            )
              .trim()
              .toLowerCase();

          const specialUse =
            String(
              mailbox?.specialUse || "",
            )
              .trim()
              .toLowerCase();

          const pathParts =
            path
              .split(/[\/\\]/)
              .filter(Boolean);

          const folderName =
            pathParts[
              pathParts.length - 1
            ] || path;

          const isInbox =
            path === "inbox";

          const sentFolderNames = new Set([
            "sent",
            "sent mail",
            "sent messages",
            "sent items",
            "sent-mail",
            "sent_messages",
          ]);

          const isSent =
            specialUse === "\\sent" ||
            sentFolderNames.has(folderName);

          return isInbox || isSent;
        },
      );

    /*
     * Every IMAP server has INBOX,
     * even when LIST did not flag it.
     */
    if (
      !targets.some(
        (mailbox: any) =>
          String(
            mailbox?.path || "",
          ).toLowerCase() === "inbox",
      )
    ) {
      targets.unshift({
        path: "INBOX",
      } as any);
    }

    for (const mailbox of targets) {
      const path =
        String(
          mailbox?.path || "INBOX",
        ).trim();

      let lock: any = null;

      try {
        lock =
          await client.getMailboxLock(
            path,
          );

        const mailboxInfo: any =
          client.mailbox;

        const uidValidity =
          String(
            mailboxInfo?.uidValidity ||
              "0",
          );

        const uids =
          await client.search(
            {
              since,
            },
            {
              uid: true,
            },
          );

        const uidList = Array.isArray(
          uids,
        )
          ? uids
          : [];

        seen += uidList.length;
        mailboxes += 1;

        for (
          let offset = 0;
          offset < uidList.length;
          offset += 100
        ) {
          const chunk = uidList.slice(
            offset,
            offset + 100,
          );

          if (!chunk.length) {
            continue;
          }

          const range =
            chunk.join(",");

          for await (
            const message of client.fetch(
              range,
              {
                uid: true,
                envelope: true,
                internalDate: true,
              },
              {
                uid: true,
              },
            )
          ) {
            const matched =
              await upsertImapEmailInteraction(
                {
                  workspace,
                  connection,
                  accountEmail:
                    connection.accountEmail,
                  mailboxPath: path,
                  uidValidity,
                  message,
                },
              );

            if (matched) {
              imported += 1;
            } else {
              skipped += 1;
            }
          }
        }
      } finally {
        if (lock) {
          lock.release();
        }
      }
    }
  } finally {
    if (client.usable) {
      try {
        await client.logout();
      } catch (logoutError) {
        console.warn("CRM IMAP logout failed after sync", {
          connectionId: connection.id,
          host: configuration.imap.host,
          code: nullableString((logoutError as any)?.code, 100),
          message: nullableString((logoutError as any)?.message, 500),
        });
        try {
          client.close();
        } catch {
          // Best-effort cleanup only.
        }
      }
    } else {
      try {
        client.close();
      } catch {
        // Best-effort cleanup only.
      }
    }
  }

  return {
    seen,
    imported,
    skipped,
    mailboxes,
    mode: "window",
    lookbackDays:
      IMAP_CALDAV_MAIL_LOOKBACK_DAYS,
  };
}

function unfoldIcalLines(
  data: string,
): string[] {
  const rawLines =
    String(data || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n");

  const lines: string[] = [];

  for (const line of rawLines) {
    if (
      /^[ \t]/.test(line) &&
      lines.length
    ) {
      lines[
        lines.length - 1
      ] += line.slice(1);
    } else {
      lines.push(line);
    }
  }

  return lines;
}

function icalPropertyValue(
  lines: string[],
  name: string,
): string | null {
  const prefix =
    name.toUpperCase();

  const line = lines.find(
    (value) => {
      const left =
        String(value)
          .split(":", 1)[0]
          ?.split(";", 1)[0]
          ?.toUpperCase();

      return left === prefix;
    },
  );

  if (!line) {
    return null;
  }

  const colon =
    line.indexOf(":");

  if (colon < 0) {
    return null;
  }

  return line
    .slice(colon + 1)
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function icalPropertyLines(
  lines: string[],
  name: string,
): string[] {
  const prefix =
    name.toUpperCase();

  return lines.filter((line) => {
    const left =
      String(line)
        .split(":", 1)[0]
        ?.split(";", 1)[0]
        ?.toUpperCase();

    return left === prefix;
  });
}

function icalPropertyValues(
  lines: string[],
  name: string,
): string[] {
  return icalPropertyLines(
    lines,
    name,
  )
    .map((line) => {
      const colon =
        line.indexOf(":");

      return colon >= 0
        ? line
            .slice(colon + 1)
            .trim()
        : "";
    })
    .filter(Boolean);
}

function parseIcalDate(
  value: string | null,
): Date | null {
  if (!value) {
    return null;
  }

  const raw =
    String(value).trim();

  const dateOnly =
    /^(\d{4})(\d{2})(\d{2})$/.exec(
      raw,
    );

  if (dateOnly) {
    const date = new Date(
      Date.UTC(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3]),
      ),
    );

    return Number.isNaN(
      date.getTime(),
    )
      ? null
      : date;
  }

  const dateTime =
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(
      raw,
    );

  if (!dateTime) {
    const fallback =
      new Date(raw);

    return Number.isNaN(
      fallback.getTime(),
    )
      ? null
      : fallback;
  }

  /*
   * Values without Z are treated as
   * floating calendar time. HAVN stores
   * the normalized instant returned here.
   */
  const date = new Date(
    Date.UTC(
      Number(dateTime[1]),
      Number(dateTime[2]) - 1,
      Number(dateTime[3]),
      Number(dateTime[4]),
      Number(dateTime[5]),
      Number(dateTime[6]),
    ),
  );

  return Number.isNaN(
    date.getTime(),
  )
    ? null
    : date;
}

function icalEmail(
  value: string | null,
): string | null {
  if (!value) return null;

  const cleaned =
    String(value)
      .trim()
      .replace(/^mailto:/i, "")
      .toLowerCase();

  return extractEmails(cleaned)[0] || null;
}

function icalEmailsFromPropertyLine(
  line: string | null,
): string[] {
  if (!line) return [];

  /*
   * CalDAV providers (notably Apple) may expose a participant
   * email in the property value, an EMAIL/CN/SENT-BY parameter,
   * or a percent-encoded parameter while using a UUID/URN as the
   * actual property value. Work from the complete property line so
   * provider-specific parameter placement does not hide the address.
   */
  const candidates = new Set<string>();
  const raw = String(line).trim();

  const addEmails = (value: string) => {
    for (const email of extractEmails(value)) {
      candidates.add(email.toLowerCase());
    }
  };

  addEmails(raw);
  addEmails(raw.replace(/\\@/g, "@"));

  try {
    addEmails(decodeURIComponent(raw));
  } catch {
    // Ignore malformed percent encoding and retain the raw-line result.
  }

  const mailtoMatches = raw.match(/mailto:([^;,:\s\"]+@[^;,:\s\"]+)/gi) || [];
  for (const match of mailtoMatches) {
    addEmails(match);
  }

  return [...candidates];
}

function icalEmailFromPropertyLine(
  line: string | null,
): string | null {
  return icalEmailsFromPropertyLine(line)[0] || null;
}

function icalParticipantEmails(
  lines: string[],
): string[] {
  const participantLines = [
    ...icalPropertyLines(lines, "ATTENDEE"),
    ...icalPropertyLines(lines, "ORGANIZER"),
  ];

  return [
    ...new Set(
      participantLines.flatMap(icalEmailsFromPropertyLine),
    ),
  ];
}

function parseCalendarEventsFromIcal(
  data: string,
) {
  const lines =
    unfoldIcalLines(data);

  const events: any[] = [];

  let current:
    | string[]
    | null = null;

  for (const line of lines) {
    if (
      line.toUpperCase() ===
      "BEGIN:VEVENT"
    ) {
      current = [];
      continue;
    }

    if (
      line.toUpperCase() ===
      "END:VEVENT"
    ) {
      if (current) {
        const attendeeEmails = [
          ...new Set(
            icalPropertyLines(
              current,
              "ATTENDEE",
            ).flatMap(
              icalEmailsFromPropertyLine,
            ),
          ),
        ];

        const participantEmails =
          icalParticipantEmails(current);

        events.push({
          uid: icalPropertyValue(
            current,
            "UID",
          ),
          recurrenceId:
            icalPropertyValue(
              current,
              "RECURRENCE-ID",
            ),
          status:
            icalPropertyValue(
              current,
              "STATUS",
            ),
          summary:
            icalPropertyValue(
              current,
              "SUMMARY",
            ),
          description:
            icalPropertyValue(
              current,
              "DESCRIPTION",
            ),
          location:
            icalPropertyValue(
              current,
              "LOCATION",
            ),
          start:
            parseIcalDate(
              icalPropertyValue(
                current,
                "DTSTART",
              ),
            ),
          end:
            parseIcalDate(
              icalPropertyValue(
                current,
                "DTEND",
              ),
            ),
          organizerEmail:
            icalEmailFromPropertyLine(
              icalPropertyLines(
                current,
                "ORGANIZER",
              )[0] || null,
            ),
          attendeeEmails,
          participantEmails,
        });
      }

      current = null;
      continue;
    }

    if (current) {
      current.push(line);
    }
  }

  return events;
}

function imapCaldavCalendarDirection(
  accountEmail: string,
  organizerEmail:
    | string
    | null,
): CrmInteractionDirection {
  return (
    organizerEmail &&
    organizerEmail.toLowerCase() ===
      accountEmail.toLowerCase()
  )
    ? CrmInteractionDirection.OUTBOUND
    : CrmInteractionDirection.INBOUND;
}

async function upsertCaldavCalendarInteraction(
  args: {
    workspace: AgencyWorkspace;
    connection: any;
    accountEmail: string;
    calendarUrl: string;
    objectUrl: string;
    event: any;
  },
): Promise<{
  imported: boolean;
  reason: string;
  diagnostics: Record<string, unknown>;
}> {
  const event = args.event;
  const accountEmail =
    args.accountEmail.toLowerCase();

  const safeDiagnostics = {
    uid: nullableString(event?.uid, 500),
    summary: nullableString(event?.summary, 500),
    start:
      event?.start instanceof Date
        ? event.start.toISOString()
        : nullableString(event?.start, 200),
    organizerEmail:
      nullableString(event?.organizerEmail, 320),
    attendeeEmails: Array.isArray(event?.attendeeEmails)
      ? event.attendeeEmails.slice(0, 25)
      : [],
    participantEmails: Array.isArray(event?.participantEmails)
      ? event.participantEmails.slice(0, 25)
      : [],
  };

  if (!event?.uid) {
    return { imported: false, reason: "missing_uid", diagnostics: safeDiagnostics };
  }

  if (!event?.start) {
    return { imported: false, reason: "missing_start", diagnostics: safeDiagnostics };
  }

  if (
    String(event?.status || "").toUpperCase() ===
    "CANCELLED"
  ) {
    return { imported: false, reason: "cancelled", diagnostics: safeDiagnostics };
  }

  const occurredAt =
    event.start instanceof Date
      ? event.start
      : new Date(event.start);

  if (Number.isNaN(occurredAt.getTime())) {
    return { imported: false, reason: "invalid_start", diagnostics: safeDiagnostics };
  }

  const participantEmails = [
    ...(Array.isArray(event.participantEmails)
      ? event.participantEmails
      : []),
    ...(Array.isArray(event.attendeeEmails)
      ? event.attendeeEmails
      : []),
    event.organizerEmail,
  ]
    .filter(Boolean)
    .map((email) =>
      String(email).trim().toLowerCase(),
    )
    .filter((email) => email !== accountEmail);

  const uniqueParticipantEmails =
    [...new Set(participantEmails)];

  if (!uniqueParticipantEmails.length) {
    return {
      imported: false,
      reason: "no_external_participant_email",
      diagnostics: {
        ...safeDiagnostics,
        matchedParticipantEmails: [],
      },
    };
  }

  const contact =
    await matchedContactForEmails(
      args.workspace.agency.id,
      uniqueParticipantEmails,
    );

  /*
   * Data minimisation:
   * only retain calendar events that
   * involve an active CRM contact.
   */
  if (!contact) {
    return {
      imported: false,
      reason: "no_active_crm_contact",
      diagnostics: {
        ...safeDiagnostics,
        matchedParticipantEmails:
          uniqueParticipantEmails.slice(0, 25),
      },
    };
  }

  const subject =
    String(event.summary || "Meeting")
      .trim()
      .slice(0, 500) || "Meeting";

  const description =
    String(event.description || "").trim();

  const location =
    String(event.location || "").trim();

  const summary =
    (
      [
        description,
        location ? `Location: ${location}` : "",
      ]
        .filter(Boolean)
        .join("\n\n") ||
      subject
    ).slice(0, 20000);

  const endAt =
    event.end instanceof Date
      ? event.end
      : event.end
        ? new Date(event.end)
        : null;

  const durationMinutes =
    endAt && !Number.isNaN(endAt.getTime())
      ? Math.max(
          0,
          Math.round(
            (endAt.getTime() -
              occurredAt.getTime()) /
              60000,
          ),
        )
      : null;

  const calendarKey =
    crypto
      .createHash("sha256")
      .update(args.calendarUrl)
      .digest("hex")
      .slice(0, 24);

  const recurrenceKey =
    event.recurrenceId
      ? `:${String(event.recurrenceId)}`
      : "";

  const externalId =
    `${accountEmail}:caldav:${calendarKey}:${String(event.uid)}${recurrenceKey}`;

  await prisma.crmInteraction.upsert({
    where: {
      agencyId_sourceProvider_externalId: {
        agencyId: args.workspace.agency.id,
        sourceProvider:
          CrmInteractionProvider.IMAP_CALDAV,
        externalId,
      },
    },
    create: {
      agencyId: args.workspace.agency.id,
      contactId: contact.id,
      companyId: contact.companyId || null,
      ownerMemberId: args.connection.memberId,
      type: CrmInteractionType.MEETING,
      direction:
        imapCaldavCalendarDirection(
          accountEmail,
          event.organizerEmail,
        ),
      subject,
      summary,
      occurredAt,
      durationMinutes,
      sourceProvider:
        CrmInteractionProvider.IMAP_CALDAV,
      sourceConnectionId:
        args.connection.id,
      externalId,
      externalThreadId:
        `${accountEmail}:caldav-series:${String(event.uid)}`,
      externalUrl:
        nullableString(args.objectUrl, 2000),
      createdByUserId:
        args.connection.userId,
    },
    update: {
      contactId: contact.id,
      companyId: contact.companyId || null,
      ownerMemberId: args.connection.memberId,
      sourceConnectionId: args.connection.id,
      direction:
        imapCaldavCalendarDirection(
          accountEmail,
          event.organizerEmail,
        ),
      subject,
      summary,
      occurredAt,
      durationMinutes,
      externalThreadId:
        `${accountEmail}:caldav-series:${String(event.uid)}`,
      externalUrl:
        nullableString(args.objectUrl, 2000),
    },
  });

  return {
    imported: true,
    reason: "imported",
    diagnostics: {
      ...safeDiagnostics,
      matchedParticipantEmails:
        uniqueParticipantEmails.slice(0, 25),
      contactId: contact.id,
    },
  };
}

function caldavEventIsInsideWindow(
  event: any,
  windowStartMs: number,
  windowEndMs: number,
): boolean {
  const start =
    event?.start instanceof Date
      ? event.start
      : event?.start
        ? new Date(event.start)
        : null;

  if (!start || Number.isNaN(start.getTime())) {
    return false;
  }

  const end =
    event?.end instanceof Date
      ? event.end
      : event?.end
        ? new Date(event.end)
        : null;

  const startMs = start.getTime();
  const endMs =
    end && !Number.isNaN(end.getTime())
      ? end.getTime()
      : startMs;

  /*
   * Treat an event as relevant when its interval intersects the CRM
   * calendar window. This is deliberately checked locally even when the
   * CalDAV server was asked to filter by time range. It protects HAVN
   * from provider quirks and prevents a fallback fetch from importing an
   * entire historical calendar.
   */
  return endMs >= windowStartMs && startMs <= windowEndMs;
}

function caldavObjectUrlFilter(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname || "";

    /*
     * tsdav defaults to URLs containing ".ics". CalDAV does not require
     * that filename convention, so accept any non-collection resource and
     * let the VEVENT parser decide whether it contains calendar data.
     */
    return Boolean(path) && !path.endsWith("/");
  } catch {
    return Boolean(url) && !String(url).endsWith("/");
  }
}

function caldavParsedEventsForObjects(
  calendarObjects: any[],
) {
  return calendarObjects.flatMap((object) =>
    parseCalendarEventsFromIcal(
      String(object?.data || ""),
    ).map((event) => ({
      event,
      objectUrl: String(object?.url || ""),
    })),
  );
}

async function caldavCalendarSync(
  workspace: AgencyWorkspace,
  connection: any,
  password: string,
  configuration:
    ImapCaldavConfiguration,
) {
  if (
    !configuration.caldav?.serverUrl
  ) {
    return {
      imported: 0,
      skipped: 0,
      calendars: 0,
      objects: 0,
      disabled: true,
    };
  }

  const caldavUrl = new URL(configuration.caldav.serverUrl);
  await assertPublicConnectorHostname(caldavUrl.hostname);

  const client =
    await createDAVClient({
      serverUrl:
        configuration.caldav.serverUrl,
      credentials: {
        username:
          configuration.username || connection.accountEmail,
        password,
      },
      authMethod: "Basic",
      defaultAccountType:
        "caldav",
    });

  const calendars =
    await client.fetchCalendars();

  const windowStartMs =
    Date.now() -
    IMAP_CALDAV_CALENDAR_LOOKBACK_DAYS *
      86400000;

  const windowEndMs =
    Date.now() +
    IMAP_CALDAV_CALENDAR_FORWARD_DAYS *
      86400000;

  const start =
    new Date(windowStartMs).toISOString();

  const end =
    new Date(windowEndMs).toISOString();

  let imported = 0;
  let skipped = 0;
  let objects = 0;
  let parsedEvents = 0;
  let inWindowParsedEvents = 0;
  let outOfWindowEvents = 0;
  let fallbackCalendars = 0;
  let fallbackObjects = 0;
  const skipReasons: Record<string, number> = {};
  const skippedEventDiagnostics: Array<Record<string, unknown>> = [];
  const calendarDiagnostics: Array<Record<string, unknown>> = [];

  for (const calendar of calendars) {
    const calendarUrl =
      String((calendar as any)?.url || "");

    const calendarName =
      nullableString(
        (calendar as any)?.displayName ||
          (calendar as any)?.description,
        250,
      );

    /*
     * Apple/iCloud compatibility strategy:
     *
     * 1. Ask the server for the CRM window and request recurrence expansion.
     * 2. Avoid tsdav's default ".ics" URL restriction because CalDAV does
     *    not require event resources to use that suffix.
     * 3. Avoid the extra calendar-multiget path. Some CalDAV servers behave
     *    more consistently when calendar-data is returned directly from the
     *    calendar-query REPORT.
     * 4. If the window query yields no actually in-window VEVENTs, fall back
     *    once to a full collection fetch for that calendar and enforce the
     *    CRM date window locally before any database write.
     */
    let calendarObjects =
      await client.fetchCalendarObjects({
        calendar,
        timeRange: {
          start,
          end,
        },
        expand: true,
        useMultiGet: false,
        urlFilter: caldavObjectUrlFilter,
      });

    let parsedForCalendar =
      caldavParsedEventsForObjects(
        calendarObjects as any[],
      );

    let inWindowForCalendar =
      parsedForCalendar.filter(({ event }) =>
        caldavEventIsInsideWindow(
          event,
          windowStartMs,
          windowEndMs,
        ),
      );

    const windowObjectCount =
      calendarObjects.length;
    const windowParsedCount =
      parsedForCalendar.length;
    const windowInRangeCount =
      inWindowForCalendar.length;

    let usedFallback = false;
    let fallbackObjectCount = 0;
    let fallbackParsedCount = 0;
    let fallbackInRangeCount = 0;

    /*
     * Apple can return a technically non-empty time-range result that is
     * still incomplete. A recurring personal event is enough to make a
     * simple "zero results" fallback check look healthy, while a newer
     * event in the same collection can be absent.
     *
     * Treat the window response as usable only when it contains at least
     * one in-window VEVENT with an external participant. When it does not,
     * fetch the collection once without a server-side time filter, merge
     * the two object sets, and enforce HAVN's date window locally. This keeps
     * historical events out of CRM while still recovering events omitted by
     * Apple's REPORT response.
     */
    const windowHasExternalParticipant =
      inWindowForCalendar.some(({ event }) => {
        const accountEmail =
          String(connection.accountEmail || "")
            .trim()
            .toLowerCase();
        return [
          ...(Array.isArray(event?.attendeeEmails)
            ? event.attendeeEmails
            : []),
          event?.organizerEmail,
        ]
          .filter(Boolean)
          .map((email) => String(email).trim().toLowerCase())
          .some((email) => email && email !== accountEmail);
      });

    if (!windowHasExternalParticipant) {
      const allCalendarObjects =
        await client.fetchCalendarObjects({
          calendar,
          useMultiGet: false,
          urlFilter: caldavObjectUrlFilter,
        });

      fallbackObjectCount = allCalendarObjects.length;
      fallbackObjects += fallbackObjectCount;

      /*
       * Merge by URL when available, otherwise by a short content hash.
       * The window query can contain expanded data while the collection
       * fetch contains the underlying resource, so do not discard either
       * representation unless it is genuinely the same object payload.
       */
      const merged = new Map<string, any>();
      const addObject = (object: any) => {
        const objectUrl = String(object?.url || "");
        const data = String(object?.data || "");
        const key = objectUrl
          ? `url:${objectUrl}`
          : `data:${crypto
              .createHash("sha256")
              .update(data)
              .digest("hex")}`;

        const existing = merged.get(key);
        if (!existing || data.length > String(existing?.data || "").length) {
          merged.set(key, object);
        }
      };

      for (const object of calendarObjects) addObject(object);
      for (const object of allCalendarObjects) addObject(object);

      const mergedObjects = [...merged.values()];
      const mergedParsed =
        caldavParsedEventsForObjects(
          mergedObjects as any[],
        );
      const mergedInWindow =
        mergedParsed.filter(({ event }) =>
          caldavEventIsInsideWindow(
            event,
            windowStartMs,
            windowEndMs,
          ),
        );

      fallbackParsedCount = mergedParsed.length;
      fallbackInRangeCount = mergedInWindow.length;

      calendarObjects = mergedObjects;
      parsedForCalendar = mergedParsed;
      inWindowForCalendar = mergedInWindow;
      usedFallback = true;
      fallbackCalendars += 1;
    }

    objects += calendarObjects.length;
    parsedEvents += parsedForCalendar.length;
    inWindowParsedEvents += inWindowForCalendar.length;
    outOfWindowEvents += Math.max(
      0,
      parsedForCalendar.length -
        inWindowForCalendar.length,
    );

    if (calendarDiagnostics.length < 25) {
      calendarDiagnostics.push({
        calendarName,
        calendarUrlHash:
          calendarUrl
            ? crypto
                .createHash("sha256")
                .update(calendarUrl)
                .digest("hex")
                .slice(0, 12)
            : null,
        windowObjects: windowObjectCount,
        windowParsedEvents: windowParsedCount,
        windowInRangeEvents: windowInRangeCount,
        windowHasExternalParticipant,
        usedFallback,
        fallbackObjects: fallbackObjectCount,
        fallbackParsedEvents: fallbackParsedCount,
        fallbackInRangeEvents: fallbackInRangeCount,
        selectedObjects: calendarObjects.length,
        selectedParsedEvents: parsedForCalendar.length,
        selectedInRangeEvents: inWindowForCalendar.length,
      });
    }

    for (const { event, objectUrl } of parsedForCalendar) {
      if (
        !caldavEventIsInsideWindow(
          event,
          windowStartMs,
          windowEndMs,
        )
      ) {
        /*
         * Provider/server returned this VEVENT outside HAVN's requested
         * window. Count it separately; do not feed it into contact matching
         * or persistence and do not expose it as a normal CRM skip reason.
         */
        continue;
      }

      const result =
        await upsertCaldavCalendarInteraction(
          {
            workspace,
            connection,
            accountEmail:
              connection.accountEmail,
            calendarUrl,
            objectUrl,
            event,
          },
        );

      if (result.imported) {
        imported += 1;
      } else {
        skipped += 1;
        skipReasons[result.reason] =
          (skipReasons[result.reason] || 0) + 1;

        if (skippedEventDiagnostics.length < 20) {
          skippedEventDiagnostics.push({
            reason: result.reason,
            ...result.diagnostics,
          });
        }
      }
    }
  }

  return {
    imported,
    skipped,
    calendars:
      calendars.length,
    objects,
    parsedEvents,
    inWindowParsedEvents,
    outOfWindowEvents,
    fallbackCalendars,
    fallbackObjects,
    skipReasons,
    skippedEventDiagnostics,
    calendarDiagnostics,
    mode: "window_with_safe_fallback",
    lookbackDays:
      IMAP_CALDAV_CALENDAR_LOOKBACK_DAYS,
    forwardDays:
      IMAP_CALDAV_CALENDAR_FORWARD_DAYS,
  };
}

router.get(
  "/integrations/imap-caldav/status",
  async (req: AgentRequest, res) => {
    try {
      const workspace = await workspaceFor(req);
      const connectionId = imapCaldavConnectionIdFromRequest(req);
      const connection = await imapCaldavConnectionForWorkspace(workspace, { connectionId });
      return res.json({
        ok: true,
        configured: Boolean(process.env.CRM_IMAP_CALDAV_ENCRYPTION_KEY),
        connection: publicImapCaldavConnection(connection),
      });
    } catch (error) {
      return handleError(res, error);
    }
  },
);

router.get(
  "/integrations/imap-caldav/connections",
  async (req: AgentRequest, res) => {
    try {
      const workspace = await workspaceFor(req);
      const connections = await prisma.crmIntegrationConnection.findMany({
        where: {
          agencyId: workspace.agency.id,
          memberId: workspace.membership.id,
          provider: IMAP_CALDAV_PROVIDER,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return res.json({
        ok: true,
        configured: Boolean(process.env.CRM_IMAP_CALDAV_ENCRYPTION_KEY),
        connections: connections.map(publicImapCaldavConnection),
      });
    } catch (error) {
      return handleError(res, error);
    }
  },
);

router.post(
  "/integrations/imap-caldav/test",
  async (req: AgentRequest, res) => {
    try {
      const workspace = await workspaceFor(req);
      assertCanManageCrm(workspace);
      imapCaldavEncryptionKey();
      const settings = imapCaldavSettingsFromBody(req.body || {});
      if (settings.requestedType !== "CUSTOM") {
        throw new ApiError("VALIDATION_ERROR", "The connection test endpoint is for custom mail accounts", 400);
      }
      await validateImapCaldavNetworkTargets(settings.configuration);
      await testImapConnection({
        email: settings.email,
        username: settings.username,
        password: settings.password,
        configuration: settings.configuration,
      });

      let calendar: any = {
        configured: Boolean(settings.configuration.caldav),
        ok: !settings.configuration.caldav,
        error: null,
      };
      if (settings.configuration.caldav) {
        try {
          await testCaldavConnection({
            email: settings.email,
            username: settings.username,
            password: settings.password,
            configuration: settings.configuration,
          });
          calendar = { configured: true, ok: true, error: null };
        } catch (error) {
          calendar = {
            configured: true,
            ok: false,
            error: nullableString((error as any)?.message || "CalDAV connection failed", 1000),
          };
        }
      }

      return res.json({
        ok: true,
        mail: { ok: true },
        calendar,
        accountEmail: settings.email,
        username: settings.username,
      });
    } catch (error) {
      return handleError(res, error);
    }
  },
);

router.post(
  "/integrations/imap-caldav/connect",
  async (req: AgentRequest, res) => {
    try {
      const workspace = await workspaceFor(req);
      assertCanManageCrm(workspace);
      imapCaldavEncryptionKey();

      const settings = imapCaldavSettingsFromBody(req.body || {});
      await validateImapCaldavNetworkTargets(settings.configuration);

      await testImapConnection({
        email: settings.email,
        username: settings.username,
        password: settings.password,
        configuration: settings.configuration,
      });

      let effectiveConfiguration = settings.configuration;
      let calendarWarning: string | null = null;
      if (settings.configuration.caldav) {
        try {
          await testCaldavConnection({
            email: settings.email,
            username: settings.username,
            password: settings.password,
            configuration: settings.configuration,
          });
        } catch (error) {
          if (settings.requestedType === "ICLOUD") throw error;
          calendarWarning = nullableString((error as any)?.message || "CalDAV connection failed", 1000);
          effectiveConfiguration = { ...settings.configuration, caldav: null };
        }
      }

      const encryptedCredential = encryptImapCaldavSecret(settings.password);
      const connection = await prisma.crmIntegrationConnection.upsert({
        where: {
          agencyId_memberId_provider_connectionKey: {
            agencyId: workspace.agency.id,
            memberId: workspace.membership.id,
            provider: IMAP_CALDAV_PROVIDER,
            connectionKey: settings.connectionKey,
          },
        },
        create: {
          agencyId: workspace.agency.id,
          memberId: workspace.membership.id,
          userId: workspace.membership.userId,
          provider: IMAP_CALDAV_PROVIDER,
          connectionKey: settings.connectionKey,
          status: CrmIntegrationStatus.CONNECTED,
          accountEmail: settings.email,
          externalAccountId: settings.email,
          scopes: ["mail.read", ...(effectiveConfiguration.caldav ? ["calendar.read"] : [])],
          accessTokenEncrypted: encryptedCredential,
          refreshTokenEncrypted: null,
          tokenExpiresAt: null,
          configuration: effectiveConfiguration as Prisma.InputJsonValue,
          lastErrorAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          disconnectedAt: null,
        },
        update: {
          userId: workspace.membership.userId,
          status: CrmIntegrationStatus.CONNECTED,
          accountEmail: settings.email,
          externalAccountId: settings.email,
          scopes: ["mail.read", ...(effectiveConfiguration.caldav ? ["calendar.read"] : [])],
          accessTokenEncrypted: encryptedCredential,
          refreshTokenEncrypted: null,
          tokenExpiresAt: null,
          configuration: effectiveConfiguration as Prisma.InputJsonValue,
          gmailHistoryId: null,
          calendarSyncToken: null,
          lastErrorAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          disconnectedAt: null,
        },
      });

      await prisma.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: workspace.membership.userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: workspace.membership.userId,
          action: "CRM_IMAP_CALDAV_CONNECTED",
          entityType: "CrmIntegrationConnection",
          entityId: String(connection.id),
          afterState: {
            provider: connection.provider,
            connectionKey: connection.connectionKey,
            status: connection.status,
            accountEmail: settings.email,
            type: effectiveConfiguration.type,
            calendarEnabled: Boolean(effectiveConfiguration.caldav),
          },
          changedFields: ["crmIntegrationConnections"],
          metadata: {
            source: "agencyContacts",
            provider: "IMAP_CALDAV",
            connectionKey: connection.connectionKey,
            accountEmail: settings.email,
            type: effectiveConfiguration.type,
            calendarEnabled: Boolean(effectiveConfiguration.caldav),
            calendarWarning,
          },
          ...requestMeta(req),
        },
      });

      return res.json({
        ok: true,
        connection: publicImapCaldavConnection(connection),
        mail: { connected: true },
        calendar: effectiveConfiguration.caldav
          ? { configured: true, connected: true, warning: null }
          : { configured: Boolean(settings.configuration.caldav), connected: false, warning: calendarWarning },
      });
    } catch (error) {
      return handleError(res, error);
    }
  },
);

async function syncImapCaldavConnection(
  workspace: AgencyWorkspace,
  connection: any,
  options: {
    mail?: boolean;
    calendar?: boolean;
    auditMode?: CrmSyncAuditMode;
    auditSource?: string;
    requestMetadata?: Record<string, unknown>;
  } = {},
) {
  const requestedMailOption = options.mail !== false;
  const requestedCalendarOption = options.calendar !== false;
  const auditMode = options.auditMode || "always";
  const auditSource = options.auditSource || "agencyContacts";
  const requestMetadata = options.requestMetadata || {};
  const connectionId = Number(connection?.id || 0) || null;

  try {
    if (!connection || connection.status === CrmIntegrationStatus.DISCONNECTED) {
      throw new ApiError(
        "CRM_IMAP_CALDAV_NOT_CONNECTED",
        "Connect an IMAP / CalDAV account before synchronizing",
        409,
      );
    }

    const configuration = normaliseImapCaldavConfiguration(connection.configuration);
    if (!configuration) {
      throw new ApiError(
        "CRM_IMAP_CALDAV_CONFIGURATION_INVALID",
        "Stored IMAP / CalDAV configuration is invalid",
        500,
      );
    }

    await validateImapCaldavNetworkTargets(configuration);
    const password = decryptImapCaldavSecret(connection.accessTokenEncrypted);
    if (!password) {
      throw new ApiError(
        "CRM_IMAP_CALDAV_RECONNECT_REQUIRED",
        "Reconnect the mail account before synchronizing",
        401,
      );
    }

    const requestedMail = requestedMailOption;
    const requestedCalendar = requestedCalendarOption && Boolean(configuration.caldav);
    if (!requestedMail && !requestedCalendar) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Select Mail, Calendar, or both to synchronize",
        400,
      );
    }

    const result: any = { mail: null, calendar: null };
    let liveConnection: any = connection;

    if (requestedMail) {
      result.mail = await imapMailSync(
        workspace,
        liveConnection,
        password,
        configuration,
      );
      const now = new Date();
      liveConnection = await prisma.crmIntegrationConnection.update({
        where: { id: connection.id },
        data: {
          lastEmailSyncAt: now,
          lastSyncAt: now,
          status: CrmIntegrationStatus.CONNECTED,
          lastErrorAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
    }

    if (requestedCalendar) {
      result.calendar = await caldavCalendarSync(
        workspace,
        liveConnection,
        password,
        configuration,
      );
      const now = new Date();
      liveConnection = await prisma.crmIntegrationConnection.update({
        where: { id: connection.id },
        data: {
          lastCalendarSyncAt: now,
          lastSyncAt: now,
          status: CrmIntegrationStatus.CONNECTED,
          lastErrorAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
    }

    console.info("CRM IMAP / CalDAV sync completed", {
      agencyId: workspace.agency.id,
      memberId: workspace.membership.id,
      connectionId: connection.id,
      connectionKey: connection.connectionKey,
      accountEmail: connection.accountEmail,
      type: configuration.type,
      mailImported: result.mail?.imported ?? null,
      mailSkipped: result.mail?.skipped ?? null,
      calendarImported: result.calendar?.imported ?? null,
      calendarSkipped: result.calendar?.skipped ?? null,
      calendars: result.calendar?.calendars ?? null,
      calendarObjects: result.calendar?.objects ?? null,
      calendarParsedEvents: result.calendar?.parsedEvents ?? null,
      calendarInWindowParsedEvents: result.calendar?.inWindowParsedEvents ?? null,
      calendarOutOfWindowEvents: result.calendar?.outOfWindowEvents ?? null,
      calendarFallbackCalendars: result.calendar?.fallbackCalendars ?? null,
      calendarFallbackObjects: result.calendar?.fallbackObjects ?? null,
      calendarSkipReasons: result.calendar?.skipReasons ?? null,
      calendarSkippedEvents: result.calendar?.skippedEventDiagnostics ?? null,
      calendarDiagnostics: result.calendar?.calendarDiagnostics ?? null,
    });

    if (shouldWriteCrmSyncAudit(auditMode, result)) {
      await prisma.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: workspace.membership.userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: workspace.membership.userId,
          action: "CRM_IMAP_CALDAV_SYNCED",
          entityType: "CrmIntegrationConnection",
          entityId: String(connection.id),
          changedFields: ["crmInteractions"],
          metadata: {
            source: auditSource,
            provider: "IMAP_CALDAV",
            connectionKey: connection.connectionKey,
            accountEmail: connection.accountEmail,
            type: configuration.type,
            mailSeen: result.mail?.seen ?? null,
            mailImported: result.mail?.imported ?? null,
            mailSkipped: result.mail?.skipped ?? null,
            mailboxes: result.mail?.mailboxes ?? null,
            calendarImported: result.calendar?.imported ?? null,
            calendarSkipped: result.calendar?.skipped ?? null,
            calendars: result.calendar?.calendars ?? null,
            calendarObjects: result.calendar?.objects ?? null,
            calendarParsedEvents: result.calendar?.parsedEvents ?? null,
            calendarInWindowParsedEvents: result.calendar?.inWindowParsedEvents ?? null,
            calendarOutOfWindowEvents: result.calendar?.outOfWindowEvents ?? null,
            calendarFallbackCalendars: result.calendar?.fallbackCalendars ?? null,
          },
          ...requestMetadata,
        },
      });
    }

    return { result, liveConnection };
  } catch (error) {
    if (connectionId) await markImapCaldavConnectionError(connectionId, error);
    throw error;
  }
}

router.post(
  "/integrations/imap-caldav/sync",
  async (req: AgentRequest, res) => {
    try {
      const workspace = await workspaceFor(req);
      assertCanManageCrm(workspace);
      const requestedConnectionId = imapCaldavConnectionIdFromRequest(req);
      const connection = await imapCaldavConnectionForWorkspace(workspace, {
        connectionId: requestedConnectionId,
      });
      const { result, liveConnection } = await syncImapCaldavConnection(
        workspace,
        connection,
        {
          mail: req.body?.mail !== false && req.body?.email !== false,
          calendar: req.body?.calendar !== false,
          requestMetadata: requestMeta(req),
        },
      );

      return res.json({
        ok: true,
        result,
        connection: publicImapCaldavConnection(liveConnection),
      });
    } catch (error) {
      return handleError(res, error);
    }
  },
);

router.post(
  "/integrations/imap-caldav/disconnect",
  async (
    req: AgentRequest,
    res,
  ) => {
    try {
      const workspace =
        await workspaceFor(req);

      assertCanManageCrm(
        workspace,
      );

      const requestedConnectionId = imapCaldavConnectionIdFromRequest(req);
      const connection =
        await imapCaldavConnectionForWorkspace(
          workspace,
          { connectionId: requestedConnectionId },
        );

      if (!connection) {
        return res.json({
          ok: true,
          connection:
            publicImapCaldavConnection(
              null,
            ),
        });
      }

      const updated =
        await prisma.crmIntegrationConnection.update(
          {
            where: {
              id: connection.id,
            },
            data: {
              status:
                CrmIntegrationStatus.DISCONNECTED,
              /*
               * Destroy the usable
               * credential while
               * retaining the row for
               * connection history.
               */
              accessTokenEncrypted:
                encryptImapCaldavSecret(
                  "",
                ),
              refreshTokenEncrypted:
                null,
              tokenExpiresAt: null,
              gmailHistoryId: null,
              calendarSyncToken:
                null,
              disconnectedAt:
                new Date(),
            },
          },
        );

      await prisma.agencyAuditLog.create(
        {
          data: {
            agencyId:
              workspace.agency.id,
            actorUserId:
              workspace.membership
                .userId,
            actorAgencyMemberId:
              workspace.membership.id,
            effectiveUserId:
              workspace.membership
                .userId,
            action:
              "CRM_IMAP_CALDAV_DISCONNECTED",
            entityType:
              "CrmIntegrationConnection",
            entityId: String(
              connection.id,
            ),
            changedFields: [
              "crmIntegrationConnections",
            ],
            metadata: {
              source:
                "agencyContacts",
              provider:
                "IMAP_CALDAV",
              connectionKey: connection.connectionKey,
              accountEmail:
                connection.accountEmail,
              type:
                normaliseImapCaldavConfiguration(
                  connection.configuration,
                )?.type || null,
            },
            ...requestMeta(req),
          },
        },
      );

      return res.json({
        ok: true,
        connection:
          publicImapCaldavConnection(
            updated,
          ),
      });
    } catch (error) {
      return handleError(
        res,
        error,
      );
    }
  },
);


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

export async function runCrmBackgroundSyncCycle() {
  const connections = await prisma.crmIntegrationConnection.findMany({
    where: { status: CrmIntegrationStatus.CONNECTED },
    orderBy: [{ agencyId: "asc" }, { memberId: "asc" }, { id: "asc" }],
  });

  const summary = {
    scanned: connections.length,
    synced: 0,
    failed: 0,
    skipped: 0,
  };

  for (const connection of connections) {
    try {
      const workspace = await requireAgencyWorkspace(connection.userId);
      if (
        workspace.agency.id !== connection.agencyId ||
        workspace.membership.id !== connection.memberId
      ) {
        summary.skipped += 1;
        console.warn("CRM background sync skipped connection with workspace mismatch", {
          connectionId: connection.id,
          agencyId: connection.agencyId,
          memberId: connection.memberId,
          userId: connection.userId,
        });
        continue;
      }

      if (connection.provider === GOOGLE_PROVIDER) {
        await syncGoogleConnection(workspace, connection, {
          gmail: true,
          calendar: true,
          auditMode: "changes",
          auditSource: "crmBackgroundSync",
        });
      } else if (connection.provider === MICROSOFT_PROVIDER) {
        await syncMicrosoftConnection(workspace, connection, {
          mail: true,
          calendar: true,
          auditMode: "changes",
          auditSource: "crmBackgroundSync",
        });
      } else if (connection.provider === IMAP_CALDAV_PROVIDER) {
        await syncImapCaldavConnection(workspace, connection, {
          mail: true,
          calendar: true,
          auditMode: "changes",
          auditSource: "crmBackgroundSync",
        });
      } else {
        summary.skipped += 1;
        continue;
      }

      summary.synced += 1;
    } catch (error) {
      summary.failed += 1;
      console.error("CRM background sync connection failed", {
        connectionId: connection.id,
        provider: connection.provider,
        agencyId: connection.agencyId,
        memberId: connection.memberId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summary;
}

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
