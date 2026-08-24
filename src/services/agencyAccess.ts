import { AgencyMemberRole, AgencyMemberStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";

export type AgencyWorkspacePermissions = {
  canViewAgencyWorkspace: boolean;

  canViewAllInventory: boolean;
  canCreateInventory: boolean;
  canEditAllInventory: boolean;
  canEditAssignedInventory: boolean;
  canAssignInventory: boolean;

  canViewContacts: boolean;
  canManageContacts: boolean;

  canViewEnquiries: boolean;
  canManageEnquiries: boolean;

  canViewDeals: boolean;
  canManageDeals: boolean;

  canViewAuditLog: boolean;

  canManageTeam: boolean;
  canChangeMemberRoles: boolean;

  canManageAgencySettings: boolean;
  canManageBilling: boolean;
  canArchiveAgency: boolean;
};

export type AgencyWorkspace = {
  agency: {
    id: number;
    name: string;
    legalName: string | null;
    slug: string;
    psraLicenceNumber: string | null;
    primaryEmail: string | null;
    billingEmail: string | null;
    phoneNumber: string | null;
    websiteUrl: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    townCity: string | null;
    county: string | null;
    eircode: string | null;
    status: string;
  };

  membership: {
    id: number;
    userId: number;
    role: AgencyMemberRole;
    status: AgencyMemberStatus;
    jobTitle: string | null;
    isPrimary: boolean;
    joinedAt: Date;
  };

  permissions: AgencyWorkspacePermissions;
};

const NO_PERMISSIONS: AgencyWorkspacePermissions = {
  canViewAgencyWorkspace: false,

  canViewAllInventory: false,
  canCreateInventory: false,
  canEditAllInventory: false,
  canEditAssignedInventory: false,
  canAssignInventory: false,

  canViewContacts: false,
  canManageContacts: false,

  canViewEnquiries: false,
  canManageEnquiries: false,

  canViewDeals: false,
  canManageDeals: false,

  canViewAuditLog: false,

  canManageTeam: false,
  canChangeMemberRoles: false,

  canManageAgencySettings: false,
  canManageBilling: false,
  canArchiveAgency: false,
};

const OWNER_PERMISSIONS: AgencyWorkspacePermissions = {
  canViewAgencyWorkspace: true,

  canViewAllInventory: true,
  canCreateInventory: true,
  canEditAllInventory: true,
  canEditAssignedInventory: true,
  canAssignInventory: true,

  canViewContacts: true,
  canManageContacts: true,

  canViewEnquiries: true,
  canManageEnquiries: true,

  canViewDeals: true,
  canManageDeals: true,

  canViewAuditLog: true,

  canManageTeam: true,
  canChangeMemberRoles: true,

  canManageAgencySettings: true,
  canManageBilling: true,
  canArchiveAgency: true,
};

const ADMIN_PERMISSIONS: AgencyWorkspacePermissions = {
  canViewAgencyWorkspace: true,

  canViewAllInventory: true,
  canCreateInventory: true,
  canEditAllInventory: true,
  canEditAssignedInventory: true,
  canAssignInventory: true,

  canViewContacts: true,
  canManageContacts: true,

  canViewEnquiries: true,
  canManageEnquiries: true,

  canViewDeals: true,
  canManageDeals: true,

  canViewAuditLog: true,

  canManageTeam: true,
  canChangeMemberRoles: true,

  canManageAgencySettings: true,
  canManageBilling: false,
  canArchiveAgency: false,
};

const AGENT_PERMISSIONS: AgencyWorkspacePermissions = {
  canViewAgencyWorkspace: true,

  canViewAllInventory: true,
  canCreateInventory: true,
  canEditAllInventory: false,
  canEditAssignedInventory: true,
  canAssignInventory: false,

  canViewContacts: true,
  canManageContacts: true,

  canViewEnquiries: true,
  canManageEnquiries: true,

  canViewDeals: true,
  canManageDeals: true,

  canViewAuditLog: false,

  canManageTeam: false,
  canChangeMemberRoles: false,

  canManageAgencySettings: false,
  canManageBilling: false,
  canArchiveAgency: false,
};

const VIEWER_PERMISSIONS: AgencyWorkspacePermissions = {
  canViewAgencyWorkspace: true,

  canViewAllInventory: true,
  canCreateInventory: false,
  canEditAllInventory: false,
  canEditAssignedInventory: false,
  canAssignInventory: false,

  canViewContacts: true,
  canManageContacts: false,

  canViewEnquiries: true,
  canManageEnquiries: false,

  canViewDeals: true,
  canManageDeals: false,

  canViewAuditLog: false,

  canManageTeam: false,
  canChangeMemberRoles: false,

  canManageAgencySettings: false,
  canManageBilling: false,
  canArchiveAgency: false,
};

export function getAgencyPermissions(
  role: AgencyMemberRole
): AgencyWorkspacePermissions {
  switch (role) {
    case "OWNER":
      return { ...OWNER_PERMISSIONS };

    case "ADMIN":
      return { ...ADMIN_PERMISSIONS };

    case "AGENT":
      return { ...AGENT_PERMISSIONS };

    case "VIEWER":
      return { ...VIEWER_PERMISSIONS };

    default:
      return { ...NO_PERMISSIONS };
  }
}

/**
 * Resolve the active agency workspace for an authenticated user.
 *
 * V1 rule:
 * - A user may have multiple historical memberships.
 * - A user may have only one ACTIVE agency workspace at a time.
 *
 * The database currently permits more than one ACTIVE membership, so this
 * service deliberately refuses an ambiguous state rather than silently
 * selecting an arbitrary agency.
 */
export async function getAgencyWorkspace(
  userId: number
): Promise<AgencyWorkspace | null> {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return null;
  }

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
      userId: true,
      role: true,
      status: true,
      jobTitle: true,
      isPrimary: true,
      joinedAt: true,

      agency: {
        select: {
          id: true,
          name: true,
          legalName: true,
          slug: true,
          psraLicenceNumber: true,
          primaryEmail: true,
          billingEmail: true,
          phoneNumber: true,
          websiteUrl: true,
          addressLine1: true,
          addressLine2: true,
          townCity: true,
          county: true,
          eircode: true,
          status: true,
        },
      },
    },
  });

  if (memberships.length === 0) {
    return null;
  }

  if (memberships.length > 1) {
    throw new Error(
      `User ${userId} has multiple active agency memberships; an explicit workspace selector is required`
    );
  }

  const membership = memberships[0];

  return {
    agency: membership.agency,

    membership: {
      id: membership.id,
      userId: membership.userId,
      role: membership.role,
      status: membership.status,
      jobTitle: membership.jobTitle,
      isPrimary: membership.isPrimary,
      joinedAt: membership.joinedAt,
    },

    permissions: getAgencyPermissions(membership.role),
  };
}

export async function requireAgencyWorkspace(
  userId: number
): Promise<AgencyWorkspace> {
  const workspace = await getAgencyWorkspace(userId);

  if (!workspace) {
    throw new AgencyAccessError(
      "AGENCY_WORKSPACE_NOT_FOUND",
      "No active agency workspace is associated with this account",
      403
    );
  }

  return workspace;
}

export function canEditInventoryRecord(
  workspace: AgencyWorkspace,
  assignedMemberId: number | null | undefined
): boolean {
  if (workspace.permissions.canEditAllInventory) {
    return true;
  }

  if (!workspace.permissions.canEditAssignedInventory) {
    return false;
  }

  return (
    assignedMemberId != null &&
    assignedMemberId === workspace.membership.id
  );
}

export function assertAgencyPermission(
  workspace: AgencyWorkspace,
  permission: keyof AgencyWorkspacePermissions
): void {
  if (!workspace.permissions[permission]) {
    throw new AgencyAccessError(
      "AGENCY_PERMISSION_DENIED",
      "You do not have permission to perform this action",
      403
    );
  }
}

export class AgencyAccessError extends Error {
  code: string;
  status: number;

  constructor(
    code: string,
    message: string,
    status = 403
  ) {
    super(message);
    this.name = "AgencyAccessError";
    this.code = code;
    this.status = status;
  }
}
