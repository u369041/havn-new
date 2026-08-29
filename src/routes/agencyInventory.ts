import { Router, Request } from "express";
import crypto from "crypto";
import {
  InventoryMediaKind,
  InventoryMediaSource,
  InventoryContactNotificationLevel,
  InventoryMediaVisibility,
  InventoryStage,
  InventoryTransactionType,
  Prisma,
  ProfessionalContactRole,
} from "@prisma/client";

import { prisma } from "../lib/prisma";
import {
  sendListingRevisionAdminEmail,
  type ListingRevisionAdminEmailPayload,
} from "../lib/mail";
import requireActiveAgent from "../middleware/requireActiveAgent";
import {
  AgencyAccessError,
  AgencyWorkspace,
  assertAgencyPermission,
  canEditInventoryRecord,
  requireAgencyWorkspace,
} from "../services/agencyAccess";
import {
  inventoryMediaToListingSnapshot,
  inventoryToDraftListingData,
} from "../services/agencyPropertySync";

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
const MEDIA_KINDS = new Set<string>(Object.values(InventoryMediaKind));
const MEDIA_SOURCES = new Set<string>(Object.values(InventoryMediaSource));
const MEDIA_VISIBILITIES = new Set<string>(
  Object.values(InventoryMediaVisibility)
);
const CONTACT_NOTIFICATION_LEVELS = new Set<string>(
  Object.values(InventoryContactNotificationLevel)
);
const PROFESSIONAL_CONTACT_ROLES = new Set<string>(
  Object.values(ProfessionalContactRole)
);
const MAX_ACTIVE_PROPERTY_CONTACTS = 10;

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
  media: {
    orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
  },
  contacts: {
    where: { archivedAt: null },
    orderBy: [
      { isPrimary: "desc" as const },
      { createdAt: "asc" as const },
      { id: "asc" as const },
    ],
    include: {
      contact: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          companyName: true,
          primaryEmail: true,
          phoneNumber: true,
          roles: true,
          notes: true,
          isArchived: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      updatedBy: {
        select: { id: true, name: true, email: true },
      },
    },
  },
} satisfies Prisma.InventoryPropertyInclude;

function asPositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function propertySlugBase(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "property";
}

async function uniquePropertySlug(
  tx: Prisma.TransactionClient,
  value: string,
): Promise<string> {
  const base = propertySlugBase(value);
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const existing = await tx.property.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  return `${base}-${Date.now()}`;
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
    lat: item.lat,
    lng: item.lng,
    intelligence: item.intelligence,
    intelligenceUpdatedAt: item.intelligenceUpdatedAt,
    transactionType: item.transactionType,
    stage: item.stage,
    askingPrice: item.askingPrice,
    valuationPrice: item.valuationPrice,
    listingTitle: item.listingTitle,
    description: item.description,
    features: item.features,
    berRating: item.berRating,
    berNo: item.berNo,
    parking: item.parking,
    outdoorSpace: item.outdoorSpace,
    saleCondition: item.saleCondition,
    yearBuilt: item.yearBuilt,
    heatingType: item.heatingType,
    viewingDetails: item.viewingDetails,
    rentFrequency: item.rentFrequency,
    deposit: item.deposit,
    availableFrom: item.availableFrom,
    furnished: item.furnished,
    leaseLength: item.leaseLength,
    minimumTerm: item.minimumTerm,
    billsIncluded: item.billsIncluded,
    petsAllowed: item.petsAllowed,
    roomType: item.roomType,
    ensuite: item.ensuite,
    currentOccupants: item.currentOccupants,
    couplesAllowed: item.couplesAllowed,
    ownerOccupied: item.ownerOccupied,
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

function listingPublicSnapshot(item: any) {
  return {
    title: item?.title ?? null,
    price: item?.price ?? 0,
    mode: item?.mode ?? null,
    address1: item?.address1 ?? null,
    address2: item?.address2 ?? null,
    city: item?.city ?? null,
    county: item?.county ?? null,
    eircode: item?.eircode ?? null,
    propertyType: item?.propertyType ?? null,
    bedrooms: item?.bedrooms ?? null,
    bathrooms: item?.bathrooms ?? null,
    size: item?.size ?? null,
    sizeUnit: item?.sizeUnit ?? null,
    description: item?.description ?? null,
    features: item?.features ?? [],
    berRating: item?.berRating ?? item?.ber ?? null,
    berNo: item?.berNo ?? null,
    parking: item?.parking ?? null,
    outdoorSpace: item?.outdoorSpace ?? null,
    saleCondition: item?.saleCondition ?? null,
    yearBuilt: item?.yearBuilt ?? null,
    heatingType: item?.heatingType ?? null,
    viewingDetails: item?.viewingDetails ?? null,
    rentFrequency: item?.rentFrequency ?? null,
    deposit: item?.deposit ?? null,
    availableFrom: item?.availableFrom ?? null,
    furnished: item?.furnished ?? null,
    leaseLength: item?.leaseLength ?? null,
    minimumTerm: item?.minimumTerm ?? null,
    billsIncluded: item?.billsIncluded ?? null,
    petsAllowed: item?.petsAllowed ?? null,
    roomType: item?.roomType ?? null,
    ensuite: item?.ensuite ?? null,
    currentOccupants: item?.currentOccupants ?? null,
    couplesAllowed: item?.couplesAllowed ?? null,
    ownerOccupied: item?.ownerOccupied ?? null,
  };
}

function inventoryPublicProposal(item: any) {
  return {
    title:
      item?.listingTitle ||
      [item?.address1, item?.city, item?.county].filter(Boolean).join(", "),
    price: item?.askingPrice ?? 0,
    mode:
      item?.transactionType === "SHARE"
        ? "SHARE"
        : item?.transactionType === "RENTAL"
          ? "RENT"
          : "BUY",
    address1: item?.address1 ?? null,
    address2: item?.address2 ?? null,
    city: item?.city ?? null,
    county: item?.county ?? null,
    eircode: item?.eircode ?? null,
    propertyType: item?.propertyType ?? null,
    bedrooms: item?.bedrooms ?? null,
    bathrooms: item?.bathrooms ?? null,
    size: item?.size ?? null,
    sizeUnit: item?.sizeUnit ?? null,
    description: item?.description ?? null,
    features: item?.features ?? [],
    berRating: item?.berRating ?? null,
    berNo: item?.berNo ?? null,
    parking: item?.parking ?? null,
    outdoorSpace: item?.outdoorSpace ?? null,
    saleCondition: item?.saleCondition ?? null,
    yearBuilt: item?.yearBuilt ?? null,
    heatingType: item?.heatingType ?? null,
    viewingDetails: item?.viewingDetails ?? null,
    rentFrequency: item?.rentFrequency ?? null,
    deposit: item?.deposit ?? null,
    availableFrom: item?.availableFrom ?? null,
    furnished: item?.furnished ?? null,
    leaseLength: item?.leaseLength ?? null,
    minimumTerm: item?.minimumTerm ?? null,
    billsIncluded: item?.billsIncluded ?? null,
    petsAllowed: item?.petsAllowed ?? null,
    roomType: item?.roomType ?? null,
    ensuite: item?.ensuite ?? null,
    currentOccupants: item?.currentOccupants ?? null,
    couplesAllowed: item?.couplesAllowed ?? null,
    ownerOccupied: item?.ownerOccupied ?? null,
  };
}

function changedPublicListingFields(before: any, proposed: any): string[] {
  const keys = Object.keys(before || {});

  return keys.filter((key) => {
    return JSON.stringify(before?.[key]) !== JSON.stringify(proposed?.[key]);
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

function parseContactNotificationLevel(
  value: unknown,
  fallback: InventoryContactNotificationLevel = "OFF"
): InventoryContactNotificationLevel {
  if (value == null || value === "") return fallback;
  const level = String(value).trim().toUpperCase();
  if (!CONTACT_NOTIFICATION_LEVELS.has(level)) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "notificationLevel must be OFF, MAJOR_ONLY or MEDIUM_AND_MAJOR",
      400
    );
  }
  return level as InventoryContactNotificationLevel;
}

function parseProfessionalContactRoles(value: unknown): ProfessionalContactRole[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new ApiError("VALIDATION_ERROR", "roles must be an array", 400);
  }
  const roles = [...new Set(
    value
      .map((role) => String(role || "").trim().toUpperCase())
      .filter(Boolean)
  )];
  if (roles.some((role) => !PROFESSIONAL_CONTACT_ROLES.has(role))) {
    throw new ApiError("VALIDATION_ERROR", "One or more contact roles are invalid", 400);
  }
  return roles as ProfessionalContactRole[];
}

function contactSnapshot(link: any) {
  if (!link) return null;
  const contact = link.contact || null;
  return {
    linkId: link.id,
    inventoryPropertyId: link.inventoryPropertyId,
    contactId: link.contactId,
    relationshipLabel: link.relationshipLabel,
    isPrimary: link.isPrimary,
    notificationLevel: link.notificationLevel,
    archivedAt: link.archivedAt,
    contact: contact
      ? {
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          companyName: contact.companyName,
          primaryEmail: contact.primaryEmail,
          phoneNumber: contact.phoneNumber,
          roles: contact.roles,
          isArchived: contact.isArchived,
        }
      : null,
  };
}

function contactDisplayName(contact: any): string {
  const personName = [contact?.firstName, contact?.lastName]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
  return personName || String(contact?.companyName || "").trim() || String(contact?.primaryEmail || "").trim() || "Contact";
}

async function lockInventoryContacts(
  tx: Prisma.TransactionClient,
  agencyId: number,
  inventoryPropertyId: number
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${agencyId}, ${inventoryPropertyId})`;
}

async function syncLegacyPrimaryContactLink(
  tx: Prisma.TransactionClient,
  params: {
    agencyId: number;
    inventoryPropertyId: number;
    contactId: number | null;
    userId: number;
  }
) {
  const { agencyId, inventoryPropertyId, contactId, userId } = params;
  await lockInventoryContacts(tx, agencyId, inventoryPropertyId);

  await tx.inventoryPropertyContact.updateMany({
    where: {
      agencyId,
      inventoryPropertyId,
      archivedAt: null,
      isPrimary: true,
    },
    data: {
      isPrimary: false,
      updatedByUserId: userId,
    },
  });

  if (contactId == null) return;

  const existing = await tx.inventoryPropertyContact.findUnique({
    where: {
      inventoryPropertyId_contactId: {
        inventoryPropertyId,
        contactId,
      },
    },
  });

  if (!existing || existing.archivedAt) {
    const activeCount = await tx.inventoryPropertyContact.count({
      where: { inventoryPropertyId, archivedAt: null },
    });
    if (activeCount >= MAX_ACTIVE_PROPERTY_CONTACTS) {
      throw new ApiError(
        "CONTACT_LIMIT_REACHED",
        `An Inventory property can have a maximum of ${MAX_ACTIVE_PROPERTY_CONTACTS} active contacts`,
        409
      );
    }
  }

  if (existing) {
    await tx.inventoryPropertyContact.update({
      where: { id: existing.id },
      data: {
        archivedAt: null,
        isPrimary: true,
        updatedByUserId: userId,
      },
    });
  } else {
    await tx.inventoryPropertyContact.create({
      data: {
        agencyId,
        inventoryPropertyId,
        contactId,
        relationshipLabel: "Primary contact",
        isPrimary: true,
        notificationLevel: "OFF",
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    });
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

function parseMediaKind(value: unknown): InventoryMediaKind {
  const kind = String(value || "").trim().toUpperCase();
  if (!MEDIA_KINDS.has(kind)) {
    throw new ApiError("VALIDATION_ERROR", "Invalid inventory media kind", 400);
  }
  return kind as InventoryMediaKind;
}

function parseMediaSource(value: unknown): InventoryMediaSource {
  const source = String(value || "CLOUDINARY").trim().toUpperCase();
  if (!MEDIA_SOURCES.has(source)) {
    throw new ApiError("VALIDATION_ERROR", "Invalid inventory media source", 400);
  }
  return source as InventoryMediaSource;
}

function parseMediaVisibility(value: unknown): InventoryMediaVisibility {
  const visibility = String(value || "LISTING_ELIGIBLE").trim().toUpperCase();
  if (!MEDIA_VISIBILITIES.has(visibility)) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Invalid inventory media visibility",
      400
    );
  }
  return visibility as InventoryMediaVisibility;
}

function nonNegativeInt(value: unknown, field: string): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `${field} must be a non-negative integer`,
      400
    );
  }
  return n;
}

function nullableBoolean(value: unknown, field: string): boolean | null {
  if (value == null || value === "") return null;
  if (value === true || value === false) return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  throw new ApiError("VALIDATION_ERROR", `${field} must be a boolean`, 400);
}

function requiredHttpsUrl(value: unknown, field: string): string {
  const text = requiredString(value, field, 2000);
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:") throw new Error("HTTPS required");
  } catch {
    throw new ApiError(
      "VALIDATION_ERROR",
      `${field} must be a valid HTTPS URL`,
      400
    );
  }
  return text;
}

function assertCloudinaryUrl(url: string) {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname !== "res.cloudinary.com") {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Cloudinary media URL must use res.cloudinary.com",
      400
    );
  }
}

function mediaSnapshot(item: any) {
  if (!item) return null;
  return {
    id: item.id,
    inventoryPropertyId: item.inventoryPropertyId,
    agencyId: item.agencyId,
    kind: item.kind,
    source: item.source,
    visibility: item.visibility,
    url: item.url,
    thumbnailUrl: item.thumbnailUrl,
    publicId: item.publicId,
    resourceType: item.resourceType,
    format: item.format,
    mimeType: item.mimeType,
    originalFilename: item.originalFilename,
    bytes: item.bytes,
    width: item.width,
    height: item.height,
    duration: item.duration,
    title: item.title,
    caption: item.caption,
    category: item.category,
    position: item.position,
    isCover: item.isCover,
    externalProvider: item.externalProvider,
    createdByUserId: item.createdByUserId,
    updatedByUserId: item.updatedByUserId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function snapshotChangedFields(before: any, after: any): string[] {
  const a = before || {};
  const b = after || {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter(
    (key) => JSON.stringify(a[key]) !== JSON.stringify(b[key])
  );
}

function cloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new ApiError(
      "MEDIA_CONFIGURATION_ERROR",
      "Inventory media storage is not configured",
      500
    );
  }
  return { cloudName, apiKey, apiSecret };
}

function cloudinarySignature(params: Record<string, string>, apiSecret: string) {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return crypto
    .createHash("sha1")
    .update(`${payload}${apiSecret}`)
    .digest("hex");
}

async function geocodeInventoryLocation(inventory: any) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    throw new ApiError(
      "LOCATION_CONFIGURATION_ERROR",
      "Property location services are not configured",
      500,
    );
  }

  const compactEircode = String(inventory.eircode || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .trim();

  if (!compactEircode) {
    throw new ApiError(
      "EIRCODE_REQUIRED",
      "An Eircode is required to confirm this property location",
      400,
    );
  }

  const eircode =
    /^[A-Z0-9]{7}$/.test(compactEircode)
      ? `${compactEircode.slice(0, 3)} ${compactEircode.slice(3)}`
      : String(inventory.eircode || "").trim().toUpperCase();

  const endpoint = new URL(
    "https://maps.googleapis.com/maps/api/geocode/json",
  );

  endpoint.searchParams.set("address", `${eircode}, Ireland`);
  endpoint.searchParams.set("region", "ie");
  endpoint.searchParams.set("key", apiKey);

  const response = await fetch(endpoint);
  const payload: any = await response.json().catch(() => null);

  const result = payload?.results?.[0];
  const location = result?.geometry?.location;

  const lat = Number(location?.lat);
  const lng = Number(location?.lng);

  if (
    !response.ok ||
    payload?.status !== "OK" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    throw new ApiError(
      "LOCATION_NOT_FOUND",
      payload?.error_message ||
        "HAVN could not confirm this property Eircode",
      422,
    );
  }

  return {
    lat,
    lng,
    formattedAddress: nullableString(
      result?.formatted_address,
      500,
    ),
    placeId: nullableString(result?.place_id, 300),
  };
}


async function destroyCloudinaryMedia(item: any) {
  if (item.source !== "CLOUDINARY" || !item.publicId) return;

  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = {
    invalidate: "true",
    public_id: String(item.publicId),
    timestamp,
  };
  const signature = cloudinarySignature(params, apiSecret);
  const resourceType = ["image", "video", "raw"].includes(
    String(item.resourceType || "").toLowerCase()
  )
    ? String(item.resourceType).toLowerCase()
    : item.kind === "VIDEO"
      ? "video"
      : item.kind === "DOCUMENT"
        ? "raw"
        : "image";

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/destroy`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...params,
        api_key: apiKey,
        signature,
      }),
    }
  );
  const result: any = await response.json().catch(() => null);
  if (!response.ok || !result || !["ok", "not found"].includes(result.result)) {
    throw new ApiError(
      "MEDIA_DELETE_FAILED",
      "Could not remove the stored media asset",
      502
    );
  }
}

function inventoryStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ApiError("VALIDATION_ERROR", `${field} must be an array`, 400);
  }
  if (value.length > 50) {
    throw new ApiError("VALIDATION_ERROR", `${field} cannot exceed 50 items`, 400);
  }
  return value
    .map((item) => String(item || "").trim().slice(0, 300))
    .filter(Boolean);
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
  if ("listingTitle" in body) {
    data.listingTitle = nullableString(body.listingTitle, 300);
  }
  if ("description" in body) {
    data.description = nullableString(body.description, 20000);
  }
  if ("features" in body) {
    data.features = inventoryStringArray(body.features, "features");
  }
  if ("berRating" in body) data.berRating = nullableString(body.berRating, 30);
  if ("berNo" in body) data.berNo = nullableString(body.berNo, 100);
  if ("parking" in body) data.parking = nullableString(body.parking, 200);
  if ("outdoorSpace" in body) data.outdoorSpace = nullableString(body.outdoorSpace, 200);
  if ("saleCondition" in body) data.saleCondition = nullableString(body.saleCondition, 200);
  if ("yearBuilt" in body) {
    const yearBuilt = nonNegativeInt(body.yearBuilt, "yearBuilt");
    if (yearBuilt != null && (yearBuilt < 1000 || yearBuilt > 2200)) {
      throw new ApiError("VALIDATION_ERROR", "yearBuilt must be between 1000 and 2200", 400);
    }
    data.yearBuilt = yearBuilt;
  }
  if ("heatingType" in body) data.heatingType = nullableString(body.heatingType, 200);
  if ("viewingDetails" in body) data.viewingDetails = nullableString(body.viewingDetails, 5000);
  if ("rentFrequency" in body) data.rentFrequency = nullableString(body.rentFrequency, 100);
  if ("deposit" in body) data.deposit = nonNegativeInt(body.deposit, "deposit");
  if ("availableFrom" in body) data.availableFrom = nullableDate(body.availableFrom, "availableFrom");
  if ("furnished" in body) data.furnished = nullableBoolean(body.furnished, "furnished");
  if ("leaseLength" in body) data.leaseLength = nullableString(body.leaseLength, 200);
  if ("minimumTerm" in body) data.minimumTerm = nullableString(body.minimumTerm, 200);
  if ("billsIncluded" in body) data.billsIncluded = nullableString(body.billsIncluded, 200);
  if ("petsAllowed" in body) data.petsAllowed = nullableString(body.petsAllowed, 200);
  if ("roomType" in body) data.roomType = nullableString(body.roomType, 200);
  if ("ensuite" in body) data.ensuite = nullableString(body.ensuite, 200);
  if ("currentOccupants" in body) {
    data.currentOccupants = nonNegativeInt(body.currentOccupants, "currentOccupants");
  }
  if ("couplesAllowed" in body) data.couplesAllowed = nullableString(body.couplesAllowed, 200);
  if ("ownerOccupied" in body) data.ownerOccupied = nullableString(body.ownerOccupied, 200);
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

router.get("/:id/contacts", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertAgencyPermission(workspace, "canViewAllInventory");

    const id = asPositiveInt(req.params.id);
    if (!id) throw new ApiError("VALIDATION_ERROR", "Invalid inventory id", 400);

    const item = await inventoryForAgency(id, workspace.agency.id);
    if (!item) {
      throw new ApiError("INVENTORY_NOT_FOUND", "Inventory record not found", 404);
    }

    return res.json({
      ok: true,
      itemId: id,
      maxContacts: MAX_ACTIVE_PROPERTY_CONTACTS,
      contacts: item.contacts,
      permissions: {
        ...workspace.permissions,
        canEditThisInventory: canEditInventoryRecord(workspace, item.assignedMemberId),
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.get("/:id/contacts/search", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    assertAgencyPermission(workspace, "canViewAllInventory");

    const id = asPositiveInt(req.params.id);
    if (!id) throw new ApiError("VALIDATION_ERROR", "Invalid inventory id", 400);

    const item = await inventoryForAgency(id, workspace.agency.id);
    if (!item) {
      throw new ApiError("INVENTORY_NOT_FOUND", "Inventory record not found", 404);
    }

    const q = nullableString(req.query.q, 200);
    const contacts = await prisma.professionalContact.findMany({
      where: {
        agencyId: workspace.agency.id,
        isArchived: false,
        ...(q
          ? {
              OR: [
                { firstName: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
                { companyName: { contains: q, mode: "insensitive" } },
                { primaryEmail: { contains: q, mode: "insensitive" } },
                { phoneNumber: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        companyName: true,
        primaryEmail: true,
        phoneNumber: true,
        roles: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        propertyLinks: {
          where: { inventoryPropertyId: id, archivedAt: null },
          select: { id: true },
          take: 1,
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 25,
    });

    return res.json({
      ok: true,
      items: contacts.map((contact) => ({
        ...contact,
        alreadyLinked: contact.propertyLinks.length > 0,
        propertyLinks: undefined,
      })),
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/:id/contacts", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const id = asPositiveInt(req.params.id);
    if (!id) throw new ApiError("VALIDATION_ERROR", "Invalid inventory id", 400);

    const inventory = await inventoryForAgency(id, workspace.agency.id);
    if (!inventory) {
      throw new ApiError("INVENTORY_NOT_FOUND", "Inventory record not found", 404);
    }
    assertCanEdit(workspace, inventory.assignedMemberId);
    if (inventory.archivedAt) {
      throw new ApiError("INVENTORY_ARCHIVED", "Archived inventory records are read-only", 409);
    }

    const body = req.body || {};
    const requestedContactId = asPositiveInt(body.contactId);
    const relationshipLabel = nullableString(body.relationshipLabel, 200);
    const notificationLevel = parseContactNotificationLevel(body.notificationLevel, "OFF");
    const isPrimary = nullableBoolean(body.isPrimary, "isPrimary") === true;
    const userId = workspace.membership.userId;

    const result = await prisma.$transaction(async (tx) => {
      await lockInventoryContacts(tx, workspace.agency.id, id);

      const activeCount = await tx.inventoryPropertyContact.count({
        where: { inventoryPropertyId: id, archivedAt: null },
      });

      let contact: any;

      if (requestedContactId) {
        contact = await tx.professionalContact.findFirst({
          where: {
            id: requestedContactId,
            agencyId: workspace.agency.id,
            isArchived: false,
          },
        });
        if (!contact) {
          throw new ApiError(
            "CONTACT_NOT_FOUND",
            "Contact must belong to this agency and be active",
            404
          );
        }
      } else {
        const source = body.contact || body;
        const firstName = nullableString(source.firstName, 120);
        const lastName = nullableString(source.lastName, 120);
        const companyName = nullableString(source.companyName, 200);
        const primaryEmail = nullableString(source.primaryEmail, 320)?.toLowerCase() || null;
        const phoneNumber = nullableString(source.phoneNumber, 80);
        const roles = parseProfessionalContactRoles(source.roles);
        const notes = nullableString(source.notes, 5000);

        if (!firstName && !lastName && !companyName && !primaryEmail && !phoneNumber) {
          throw new ApiError(
            "VALIDATION_ERROR",
            "Provide a name, company, email or phone number for the contact",
            400
          );
        }

        if (primaryEmail) {
          const duplicate = await tx.professionalContact.findFirst({
            where: {
              agencyId: workspace.agency.id,
              isArchived: false,
              primaryEmail: { equals: primaryEmail, mode: "insensitive" },
            },
            select: { id: true, firstName: true, lastName: true, companyName: true },
          });
          if (duplicate) {
            throw new ApiError(
              "CONTACT_ALREADY_EXISTS",
              `A CRM contact with this email already exists (contact ${duplicate.id}). Link the existing contact instead.`,
              409
            );
          }
        }

        contact = await tx.professionalContact.create({
          data: {
            agencyId: workspace.agency.id,
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
        });
      }

      const existingLink = await tx.inventoryPropertyContact.findUnique({
        where: {
          inventoryPropertyId_contactId: {
            inventoryPropertyId: id,
            contactId: contact.id,
          },
        },
        include: { contact: true },
      });

      if (existingLink && !existingLink.archivedAt) {
        throw new ApiError(
          "CONTACT_ALREADY_LINKED",
          "This CRM contact is already linked to the Inventory property",
          409
        );
      }

      if (activeCount >= MAX_ACTIVE_PROPERTY_CONTACTS) {
        throw new ApiError(
          "CONTACT_LIMIT_REACHED",
          `An Inventory property can have a maximum of ${MAX_ACTIVE_PROPERTY_CONTACTS} active contacts`,
          409
        );
      }

      if (isPrimary) {
        await tx.inventoryPropertyContact.updateMany({
          where: {
            inventoryPropertyId: id,
            archivedAt: null,
            isPrimary: true,
          },
          data: { isPrimary: false, updatedByUserId: userId },
        });
      }

      const link = existingLink
        ? await tx.inventoryPropertyContact.update({
            where: { id: existingLink.id },
            data: {
              relationshipLabel,
              isPrimary,
              notificationLevel,
              archivedAt: null,
              updatedByUserId: userId,
            },
            include: { contact: true },
          })
        : await tx.inventoryPropertyContact.create({
            data: {
              agencyId: workspace.agency.id,
              inventoryPropertyId: id,
              contactId: contact.id,
              relationshipLabel,
              isPrimary,
              notificationLevel,
              createdByUserId: userId,
              updatedByUserId: userId,
            },
            include: { contact: true },
          });

      if (isPrimary) {
        await tx.inventoryProperty.update({
          where: { id },
          data: { primaryContactId: contact.id, updatedByUserId: userId },
        });
      }

      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: userId,
          action: "INVENTORY_CONTACT_LINKED",
          entityType: "InventoryProperty",
          entityId: String(id),
          afterState: contactSnapshot(link),
          changedFields: [
            "contacts",
            "contactId",
            "relationshipLabel",
            "isPrimary",
            "notificationLevel",
          ],
          metadata: {
            source: "agencyInventory",
            contactId: contact.id,
            contactName: contactDisplayName(contact),
            linkId: link.id,
          },
          ...requestMeta(req),
        },
      });

      return tx.inventoryProperty.findUniqueOrThrow({
        where: { id },
        include: inventoryInclude,
      });
    });

    return res.status(201).json({
      ok: true,
      item: result,
      contacts: result.contacts,
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.patch("/:id/contacts/:linkId", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const id = asPositiveInt(req.params.id);
    const linkId = asPositiveInt(req.params.linkId);
    if (!id || !linkId) {
      throw new ApiError("VALIDATION_ERROR", "Invalid inventory or contact link id", 400);
    }

    const inventory = await inventoryForAgency(id, workspace.agency.id);
    if (!inventory) {
      throw new ApiError("INVENTORY_NOT_FOUND", "Inventory record not found", 404);
    }
    assertCanEdit(workspace, inventory.assignedMemberId);
    if (inventory.archivedAt) {
      throw new ApiError("INVENTORY_ARCHIVED", "Archived inventory records are read-only", 409);
    }

    const body = req.body || {};
    const userId = workspace.membership.userId;

    const result = await prisma.$transaction(async (tx) => {
      await lockInventoryContacts(tx, workspace.agency.id, id);

      const before = await tx.inventoryPropertyContact.findFirst({
        where: {
          id: linkId,
          agencyId: workspace.agency.id,
          inventoryPropertyId: id,
          archivedAt: null,
        },
        include: { contact: true },
      });
      if (!before) {
        throw new ApiError("CONTACT_LINK_NOT_FOUND", "Property contact link not found", 404);
      }

      const data: Prisma.InventoryPropertyContactUncheckedUpdateInput = {
        updatedByUserId: userId,
      };
      if ("relationshipLabel" in body) {
        data.relationshipLabel = nullableString(body.relationshipLabel, 200);
      }
      if ("notificationLevel" in body) {
        data.notificationLevel = parseContactNotificationLevel(body.notificationLevel, before.notificationLevel);
      }

      let nextIsPrimary = before.isPrimary;
      if ("isPrimary" in body) {
        nextIsPrimary = nullableBoolean(body.isPrimary, "isPrimary") === true;
        data.isPrimary = nextIsPrimary;
      }

      if (nextIsPrimary && !before.isPrimary) {
        await tx.inventoryPropertyContact.updateMany({
          where: {
            inventoryPropertyId: id,
            archivedAt: null,
            isPrimary: true,
            NOT: { id: linkId },
          },
          data: { isPrimary: false, updatedByUserId: userId },
        });
      }

      const after = await tx.inventoryPropertyContact.update({
        where: { id: linkId },
        data,
        include: { contact: true },
      });

      if (nextIsPrimary) {
        await tx.inventoryProperty.update({
          where: { id },
          data: { primaryContactId: before.contactId, updatedByUserId: userId },
        });
      } else if (before.isPrimary && !nextIsPrimary) {
        await tx.inventoryProperty.update({
          where: { id },
          data: { primaryContactId: null, updatedByUserId: userId },
        });
      }

      const changed = snapshotChangedFields(contactSnapshot(before), contactSnapshot(after));
      if (changed.length > 0) {
        await tx.agencyAuditLog.create({
          data: {
            agencyId: workspace.agency.id,
            actorUserId: userId,
            actorAgencyMemberId: workspace.membership.id,
            effectiveUserId: userId,
            action: "INVENTORY_CONTACT_UPDATED",
            entityType: "InventoryProperty",
            entityId: String(id),
            beforeState: contactSnapshot(before),
            afterState: contactSnapshot(after),
            changedFields: changed.map((field) => `contacts.${field}`),
            metadata: {
              source: "agencyInventory",
              contactId: before.contactId,
              contactName: contactDisplayName(before.contact),
              linkId,
            },
            ...requestMeta(req),
          },
        });
      }

      return tx.inventoryProperty.findUniqueOrThrow({
        where: { id },
        include: inventoryInclude,
      });
    });

    return res.json({ ok: true, item: result, contacts: result.contacts });
  } catch (error) {
    return handleError(res, error);
  }
});

router.delete("/:id/contacts/:linkId", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const id = asPositiveInt(req.params.id);
    const linkId = asPositiveInt(req.params.linkId);
    if (!id || !linkId) {
      throw new ApiError("VALIDATION_ERROR", "Invalid inventory or contact link id", 400);
    }

    const inventory = await inventoryForAgency(id, workspace.agency.id);
    if (!inventory) {
      throw new ApiError("INVENTORY_NOT_FOUND", "Inventory record not found", 404);
    }
    assertCanEdit(workspace, inventory.assignedMemberId);
    if (inventory.archivedAt) {
      throw new ApiError("INVENTORY_ARCHIVED", "Archived inventory records are read-only", 409);
    }

    const userId = workspace.membership.userId;
    const result = await prisma.$transaction(async (tx) => {
      await lockInventoryContacts(tx, workspace.agency.id, id);

      const before = await tx.inventoryPropertyContact.findFirst({
        where: {
          id: linkId,
          agencyId: workspace.agency.id,
          inventoryPropertyId: id,
          archivedAt: null,
        },
        include: { contact: true },
      });
      if (!before) {
        throw new ApiError("CONTACT_LINK_NOT_FOUND", "Property contact link not found", 404);
      }

      const after = await tx.inventoryPropertyContact.update({
        where: { id: linkId },
        data: {
          archivedAt: new Date(),
          isPrimary: false,
          updatedByUserId: userId,
        },
        include: { contact: true },
      });

      if (before.isPrimary || inventory.primaryContactId === before.contactId) {
        await tx.inventoryProperty.update({
          where: { id },
          data: { primaryContactId: null, updatedByUserId: userId },
        });
      }

      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: userId,
          action: "INVENTORY_CONTACT_UNLINKED",
          entityType: "InventoryProperty",
          entityId: String(id),
          beforeState: contactSnapshot(before),
          afterState: contactSnapshot(after),
          changedFields: ["contacts", "archivedAt"],
          metadata: {
            source: "agencyInventory",
            contactId: before.contactId,
            contactName: contactDisplayName(before.contact),
            linkId,
          },
          ...requestMeta(req),
        },
      });

      return tx.inventoryProperty.findUniqueOrThrow({
        where: { id },
        include: inventoryInclude,
      });
    });

    return res.json({
      ok: true,
      deletedLinkId: linkId,
      item: result,
      contacts: result.contacts,
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
      const created = await tx.inventoryProperty.create({
        data: createData,
      });

      if (primaryContactId) {
        await syncLegacyPrimaryContactLink(tx, {
          agencyId: workspace.agency.id,
          inventoryPropertyId: created.id,
          contactId: primaryContactId,
          userId,
        });
      }

      const item = await tx.inventoryProperty.findUniqueOrThrow({
        where: { id: created.id },
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

router.post("/:id/location/geocode", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const id = asPositiveInt(req.params.id);
    if (!id) throw new ApiError("VALIDATION_ERROR", "Invalid inventory id", 400);
    const inventory = await inventoryForAgency(id, workspace.agency.id);
    if (!inventory) {
      throw new ApiError("INVENTORY_NOT_FOUND", "Inventory record not found", 404);
    }
    assertCanEdit(workspace, inventory.assignedMemberId);
    if (inventory.archivedAt) {
      throw new ApiError("INVENTORY_ARCHIVED", "Archived inventory records are read-only", 409);
    }

    const location = await geocodeInventoryLocation(inventory);
    const userId = workspace.membership.userId;
    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.inventoryProperty.update({
        where: { id },
        data: {
          lat: location.lat,
          lng: location.lng,
          intelligence: Prisma.DbNull,
          intelligenceUpdatedAt: null,
          updatedByUserId: userId,
        },
        include: inventoryInclude,
      });
      await tx.property.updateMany({
        where: {
          inventoryPropertyId: id,
          agencyId: workspace.agency.id,
          listingStatus: "DRAFT",
        },
        data: {
          lat: location.lat,
          lng: location.lng,
          intelligence: Prisma.DbNull,
          intelligenceUpdatedAt: null,
          updatedByUserId: userId,
        },
      });
      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: userId,
          action: "INVENTORY_LOCATION_CONFIRMED",
          entityType: "InventoryProperty",
          entityId: String(id),
          afterState: location,
          changedFields: ["lat", "lng", "intelligence"],
          metadata: { source: "agencyInventory", ...location },
          ...requestMeta(req),
        },
      });
      return item;
    });
    return res.json({ ok: true, item: updated, location });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/:id/listing", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const id = asPositiveInt(req.params.id);
    if (!id) {
      throw new ApiError("VALIDATION_ERROR", "Invalid inventory id", 400);
    }

    const inventory = await inventoryForAgency(id, workspace.agency.id);
    if (!inventory) {
      throw new ApiError("INVENTORY_NOT_FOUND", "Inventory record not found", 404);
    }
    assertCanEdit(workspace, inventory.assignedMemberId);
    if (inventory.archivedAt) {
      throw new ApiError(
        "INVENTORY_ARCHIVED",
        "Restore this Inventory property before creating a listing",
        409,
      );
    }

    const existingDraft = inventory.listings.find(
      (listing) => listing.listingStatus === "DRAFT",
    );
    if (existingDraft) {
      return res.json({ ok: true, created: false, item: existingDraft });
    }
    const activeListing = inventory.listings.find((listing) =>
      ["SUBMITTED", "PUBLISHED", "REJECTED"].includes(listing.listingStatus),
    );
    if (activeListing) {
      throw new ApiError(
        "LISTING_ALREADY_EXISTS",
        "This Inventory property already has a linked listing",
        409,
      );
    }

    const listingMedia = inventoryMediaToListingSnapshot(inventory.media);
    const title = [inventory.address1, inventory.city, inventory.county]
      .filter(Boolean)
      .join(", ");
    const mode: "BUY" | "RENT" | "SHARE" =
      inventory.transactionType === "SHARE"
        ? "SHARE"
        : inventory.transactionType === "RENTAL"
          ? "RENT"
          : "BUY";
    const userId = workspace.membership.userId;

    const listing = await prisma.$transaction(async (tx) => {
      const slug = await uniquePropertySlug(
        tx,
        [inventory.address1, inventory.city, inventory.eircode].filter(Boolean).join(" "),
      );
      const created = await tx.property.create({
        data: {
          slug,
          title: inventory.listingTitle || title || `Inventory property ${inventory.id}`,
          address1: inventory.address1,
          address2: inventory.address2,
          city: inventory.city,
          county: inventory.county,
          eircode: inventory.eircode,
          lat: inventory.lat,
          lng: inventory.lng,
          intelligence: inventory.intelligence ?? Prisma.DbNull,
          intelligenceUpdatedAt: inventory.intelligenceUpdatedAt,
          price: inventory.askingPrice ?? 0,
          description: inventory.description,
          features: inventory.features,
          ber: inventory.berRating,
          berRating: inventory.berRating,
          berNo: inventory.berNo,
          parking: inventory.parking,
          outdoorSpace: inventory.outdoorSpace,
          saleCondition: inventory.saleCondition,
          yearBuilt: inventory.yearBuilt,
          heatingType: inventory.heatingType,
          viewingDetails: inventory.viewingDetails,
          rentFrequency: inventory.rentFrequency,
          deposit: inventory.deposit,
          availableFrom: inventory.availableFrom,
          furnished: inventory.furnished,
          leaseLength: inventory.leaseLength,
          minimumTerm: inventory.minimumTerm,
          billsIncluded: inventory.billsIncluded,
          petsAllowed: inventory.petsAllowed,
          roomType: inventory.roomType,
          ensuite: inventory.ensuite,
          currentOccupants: inventory.currentOccupants,
          couplesAllowed: inventory.couplesAllowed,
          ownerOccupied: inventory.ownerOccupied,
          bedrooms: inventory.bedrooms,
          bathrooms: inventory.bathrooms,
          size: inventory.size,
          sizeUnit: inventory.sizeUnit,
          propertyType: inventory.propertyType || "house",
          photos: listingMedia.photos,
          photoMeta: listingMedia.photoMeta,
          photoMetaUpdatedAt: new Date(),
          presentationMedia: listingMedia.presentationMedia,
          userId,
          mode,
          listingStatus: "DRAFT",
          agencyId: workspace.agency.id,
          inventoryPropertyId: inventory.id,
          createdByUserId: userId,
          updatedByUserId: userId,
        },
      });

      if (["PROSPECT", "APPRAISAL", "INSTRUCTION"].includes(inventory.stage)) {
        await tx.inventoryProperty.update({
          where: { id: inventory.id },
          data: { stage: "PREPARING", updatedByUserId: userId },
        });
      }

      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: userId,
          action: "LISTING_DRAFT_CREATED_FROM_INVENTORY",
          entityType: "InventoryProperty",
          entityId: String(inventory.id),
          afterState: {
            listingId: created.id,
            listingSlug: created.slug,
            listingStatus: created.listingStatus,
            photoCount: listingMedia.photos.length,
            supportingMediaCount: Array.isArray(listingMedia.presentationMedia)
              ? listingMedia.presentationMedia.length
              : 0,
          },
          changedFields: [
            "Property.created",
            "Property.photos",
            "Property.photoMeta",
            "Property.presentationMedia",
          ],
          metadata: { source: "agencyInventory", propertyId: created.id },
          ...requestMeta(req),
        },
      });

      return created;
    });

    return res.status(201).json({ ok: true, created: true, item: listing });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/:id/media/signature", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const id = asPositiveInt(req.params.id);
    if (!id) {
      throw new ApiError("VALIDATION_ERROR", "Invalid inventory id", 400);
    }

    const inventory = await inventoryForAgency(id, workspace.agency.id);
    if (!inventory) {
      throw new ApiError("INVENTORY_NOT_FOUND", "Inventory record not found", 404);
    }
    assertCanEdit(workspace, inventory.assignedMemberId);
    if (inventory.archivedAt) {
      throw new ApiError(
        "INVENTORY_ARCHIVED",
        "Archived inventory records are read-only",
        409
      );
    }

    const kind = parseMediaKind(req.body?.kind || "IMAGE");
    const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
    const folder = `havn/agency-inventory/${workspace.agency.id}/${id}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const params = { folder, timestamp };
    const signature = cloudinarySignature(params, apiSecret);

    return res.json({
      ok: true,
      cloudName,
      apiKey,
      timestamp: Number(timestamp),
      folder,
      signature,
      resourceType: kind === "VIDEO" ? "video" : "auto",
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/:id/media", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const id = asPositiveInt(req.params.id);
    if (!id) {
      throw new ApiError("VALIDATION_ERROR", "Invalid inventory id", 400);
    }

    const inventory = await inventoryForAgency(id, workspace.agency.id);
    if (!inventory) {
      throw new ApiError("INVENTORY_NOT_FOUND", "Inventory record not found", 404);
    }
    assertCanEdit(workspace, inventory.assignedMemberId);
    if (inventory.archivedAt) {
      throw new ApiError(
        "INVENTORY_ARCHIVED",
        "Archived inventory records are read-only",
        409
      );
    }

    const body = req.body || {};
    const kind = parseMediaKind(body.kind);
    const source = parseMediaSource(body.source);
    const visibility = parseMediaVisibility(body.visibility);
    const url = requiredHttpsUrl(body.url, "url");
    const publicId = nullableString(body.publicId, 1000);

    if (source === "CLOUDINARY") {
      assertCloudinaryUrl(url);
      const expectedPrefix = `havn/agency-inventory/${workspace.agency.id}/${id}/`;
      if (!publicId || !publicId.startsWith(expectedPrefix)) {
        throw new ApiError(
          "VALIDATION_ERROR",
          "Cloudinary publicId does not belong to this inventory property",
          400
        );
      }
    } else if (publicId) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "External media must not include a Cloudinary publicId",
        400
      );
    }

    const limits: Record<InventoryMediaKind, number> = {
      IMAGE: 70,
      VIDEO: 10,
      FLOOR_PLAN: 20,
      DOCUMENT: 50,
    };
    const existingCount = await prisma.inventoryMedia.count({
      where: { inventoryPropertyId: id, kind },
    });
    if (existingCount >= limits[kind]) {
      throw new ApiError(
        "MEDIA_LIMIT_REACHED",
        `Maximum ${limits[kind]} ${kind.toLowerCase().replace("_", " ")} assets`,
        409
      );
    }

    const latest = await prisma.inventoryMedia.findFirst({
      where: { inventoryPropertyId: id },
      orderBy: [{ position: "desc" }, { id: "desc" }],
      select: { position: true },
    });
    const requestedCover = nullableBoolean(body.isCover, "isCover") === true;
    const shouldBeCover =
      kind === "IMAGE" &&
      (requestedCover ||
        !(await prisma.inventoryMedia.findFirst({
          where: { inventoryPropertyId: id, kind: "IMAGE", isCover: true },
          select: { id: true },
        })));
    const userId = workspace.membership.userId;

    const created = await prisma.$transaction(async (tx) => {
      if (shouldBeCover) {
        await tx.inventoryMedia.updateMany({
          where: { inventoryPropertyId: id, kind: "IMAGE", isCover: true },
          data: { isCover: false, updatedByUserId: userId },
        });
      }

      const media = await tx.inventoryMedia.create({
        data: {
          inventoryPropertyId: id,
          agencyId: workspace.agency.id,
          kind,
          source,
          visibility,
          url,
          thumbnailUrl:
            body.thumbnailUrl == null
              ? null
              : requiredHttpsUrl(body.thumbnailUrl, "thumbnailUrl"),
          publicId,
          resourceType: nullableString(body.resourceType, 30),
          format: nullableString(body.format, 30),
          mimeType: nullableString(body.mimeType, 100),
          originalFilename: nullableString(body.originalFilename, 500),
          bytes: nonNegativeInt(body.bytes, "bytes"),
          width: nonNegativeInt(body.width, "width"),
          height: nonNegativeInt(body.height, "height"),
          duration: nullableFloat(body.duration, "duration"),
          title: nullableString(body.title, 300),
          caption: nullableString(body.caption, 1000),
          category: nullableString(body.category, 100),
          position: (latest?.position ?? -1) + 1,
          isCover: shouldBeCover,
          externalProvider: nullableString(body.externalProvider, 100),
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
          action: "INVENTORY_MEDIA_CREATED",
          entityType: "InventoryProperty",
          entityId: String(id),
          afterState: mediaSnapshot(media),
          changedFields: Object.keys(mediaSnapshot(media) || {}),
          metadata: { source: "agencyInventory", mediaId: media.id, kind },
          ...requestMeta(req),
        },
      });

      await tx.inventoryProperty.update({
        where: { id },
        data: { updatedByUserId: userId },
      });
      return media;
    });

    return res.status(201).json({ ok: true, media: created });
  } catch (error) {
    return handleError(res, error);
  }
});

router.patch("/:id/media/order", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const id = asPositiveInt(req.params.id);
    if (!id) {
      throw new ApiError("VALIDATION_ERROR", "Invalid inventory id", 400);
    }
    const inventory = await inventoryForAgency(id, workspace.agency.id);
    if (!inventory) {
      throw new ApiError("INVENTORY_NOT_FOUND", "Inventory record not found", 404);
    }
    assertCanEdit(workspace, inventory.assignedMemberId);
    if (inventory.archivedAt) {
      throw new ApiError("INVENTORY_ARCHIVED", "Archived inventory records are read-only", 409);
    }

    const orderedIds = Array.isArray(req.body?.orderedIds)
      ? req.body.orderedIds.map(asPositiveInt)
      : [];
    if (!orderedIds.length || orderedIds.some((mediaId: number | null) => !mediaId)) {
      throw new ApiError("VALIDATION_ERROR", "orderedIds must contain valid media ids", 400);
    }
    if (new Set(orderedIds).size !== orderedIds.length) {
      throw new ApiError("VALIDATION_ERROR", "orderedIds must not contain duplicates", 400);
    }

    const media = await prisma.inventoryMedia.findMany({
      where: { inventoryPropertyId: id },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    if (
      media.length !== orderedIds.length ||
      media.some((item) => !orderedIds.includes(item.id))
    ) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "orderedIds must contain every media item exactly once",
        400
      );
    }

    const coverId = asPositiveInt(req.body?.coverId);
    if (coverId) {
      const cover = media.find((item) => item.id === coverId);
      if (!cover || cover.kind !== "IMAGE") {
        throw new ApiError("VALIDATION_ERROR", "coverId must identify an image", 400);
      }
    }
    const currentCover = media.find((item) => item.kind === "IMAGE" && item.isCover);
    const effectiveCoverId =
      coverId || currentCover?.id || media.find((item) => item.kind === "IMAGE")?.id || null;
    const userId = workspace.membership.userId;

    await prisma.$transaction(async (tx) => {
      await Promise.all(
        orderedIds.map((mediaId: number, position: number) =>
          tx.inventoryMedia.update({
            where: { id: mediaId },
            data: {
              position,
              isCover: mediaId === effectiveCoverId,
              updatedByUserId: userId,
            },
          })
        )
      );
      await tx.inventoryProperty.update({
        where: { id },
        data: { updatedByUserId: userId },
      });
      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: userId,
          action: "INVENTORY_MEDIA_REORDERED",
          entityType: "InventoryProperty",
          entityId: String(id),
          changedFields: ["media.position", "media.isCover"],
          metadata: {
            source: "agencyInventory",
            orderedIds,
            coverId: effectiveCoverId,
          },
          ...requestMeta(req),
        },
      });
    });

    const items = await prisma.inventoryMedia.findMany({
      where: { inventoryPropertyId: id },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    return res.json({ ok: true, items });
  } catch (error) {
    return handleError(res, error);
  }
});

router.patch("/:id/media/:mediaId", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const id = asPositiveInt(req.params.id);
    const mediaId = asPositiveInt(req.params.mediaId);
    if (!id || !mediaId) {
      throw new ApiError("VALIDATION_ERROR", "Invalid inventory or media id", 400);
    }
    const inventory = await inventoryForAgency(id, workspace.agency.id);
    if (!inventory) {
      throw new ApiError("INVENTORY_NOT_FOUND", "Inventory record not found", 404);
    }
    assertCanEdit(workspace, inventory.assignedMemberId);
    if (inventory.archivedAt) {
      throw new ApiError("INVENTORY_ARCHIVED", "Archived inventory records are read-only", 409);
    }
    const before = await prisma.inventoryMedia.findFirst({
      where: { id: mediaId, inventoryPropertyId: id, agencyId: workspace.agency.id },
    });
    if (!before) {
      throw new ApiError("MEDIA_NOT_FOUND", "Inventory media not found", 404);
    }

    const body = req.body || {};
    const data: Prisma.InventoryMediaUncheckedUpdateInput = {
      updatedByUserId: workspace.membership.userId,
    };
    if ("title" in body) data.title = nullableString(body.title, 300);
    if ("caption" in body) data.caption = nullableString(body.caption, 1000);
    if ("category" in body) data.category = nullableString(body.category, 100);
    if ("visibility" in body) data.visibility = parseMediaVisibility(body.visibility);
    if ("externalProvider" in body) {
      data.externalProvider = nullableString(body.externalProvider, 100);
    }

    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.inventoryMedia.update({ where: { id: mediaId }, data });
      await tx.inventoryProperty.update({
        where: { id },
        data: { updatedByUserId: workspace.membership.userId },
      });
      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: workspace.membership.userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: workspace.membership.userId,
          action: "INVENTORY_MEDIA_UPDATED",
          entityType: "InventoryProperty",
          entityId: String(id),
          beforeState: mediaSnapshot(before),
          afterState: mediaSnapshot(updated),
          changedFields: snapshotChangedFields(
            mediaSnapshot(before),
            mediaSnapshot(updated)
          ),
          metadata: { source: "agencyInventory", mediaId },
          ...requestMeta(req),
        },
      });
      return updated;
    });
    return res.json({ ok: true, media: after });
  } catch (error) {
    return handleError(res, error);
  }
});

router.delete("/:id/media/:mediaId", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);
    const id = asPositiveInt(req.params.id);
    const mediaId = asPositiveInt(req.params.mediaId);
    if (!id || !mediaId) {
      throw new ApiError("VALIDATION_ERROR", "Invalid inventory or media id", 400);
    }
    const inventory = await inventoryForAgency(id, workspace.agency.id);
    if (!inventory) {
      throw new ApiError("INVENTORY_NOT_FOUND", "Inventory record not found", 404);
    }
    assertCanEdit(workspace, inventory.assignedMemberId);
    if (inventory.archivedAt) {
      throw new ApiError("INVENTORY_ARCHIVED", "Archived inventory records are read-only", 409);
    }
    const before = await prisma.inventoryMedia.findFirst({
      where: { id: mediaId, inventoryPropertyId: id, agencyId: workspace.agency.id },
    });
    if (!before) {
      throw new ApiError("MEDIA_NOT_FOUND", "Inventory media not found", 404);
    }

    await destroyCloudinaryMedia(before);
    const userId = workspace.membership.userId;
    await prisma.$transaction(async (tx) => {
      await tx.inventoryMedia.delete({ where: { id: mediaId } });
      if (before.isCover && before.kind === "IMAGE") {
        const nextCover = await tx.inventoryMedia.findFirst({
          where: { inventoryPropertyId: id, kind: "IMAGE" },
          orderBy: [{ position: "asc" }, { id: "asc" }],
          select: { id: true },
        });
        if (nextCover) {
          await tx.inventoryMedia.update({
            where: { id: nextCover.id },
            data: { isCover: true, updatedByUserId: userId },
          });
        }
      }
      const remaining = await tx.inventoryMedia.findMany({
        where: { inventoryPropertyId: id },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      await Promise.all(
        remaining.map((item, position) =>
          tx.inventoryMedia.update({ where: { id: item.id }, data: { position } })
        )
      );
      await tx.inventoryProperty.update({
        where: { id },
        data: { updatedByUserId: userId },
      });
      await tx.agencyAuditLog.create({
        data: {
          agencyId: workspace.agency.id,
          actorUserId: userId,
          actorAgencyMemberId: workspace.membership.id,
          effectiveUserId: userId,
          action: "INVENTORY_MEDIA_DELETED",
          entityType: "InventoryProperty",
          entityId: String(id),
          beforeState: mediaSnapshot(before),
          changedFields: ["media.deleted"],
          metadata: { source: "agencyInventory", mediaId, kind: before.kind },
          ...requestMeta(req),
        },
      });
    });
    return res.json({ ok: true, deletedMediaId: mediaId });
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

router.post("/:id/archive", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);

    const id = asPositiveInt(req.params.id);
    if (!id) {
      throw new ApiError("VALIDATION_ERROR", "Invalid inventory id", 400);
    }

    const before = await inventoryForAgency(id, workspace.agency.id);
    if (!before) {
      throw new ApiError(
        "INVENTORY_NOT_FOUND",
        "Inventory record not found",
        404
      );
    }

    assertCanEdit(workspace, before.assignedMemberId);

    if (before.archivedAt) {
      return res.json({
        ok: true,
        item: before,
        alreadyArchived: true,
      });
    }

    const userId = workspace.membership.userId;
    const archivedAt = new Date();

    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.inventoryProperty.update({
        where: { id },
        data: {
          archivedAt,
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
          action: "INVENTORY_ARCHIVED",
          entityType: "InventoryProperty",
          entityId: String(id),
          beforeState: inventorySnapshot(before),
          afterState: inventorySnapshot(updated),
          changedFields: ["archivedAt", "updatedByUserId", "updatedAt"],
          metadata: {
            source: "agencyInventory",
          },
          ...requestMeta(req),
        },
      });

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

router.post("/:id/restore", async (req: AgentRequest, res) => {
  try {
    const workspace = await workspaceFor(req);

    const id = asPositiveInt(req.params.id);
    if (!id) {
      throw new ApiError("VALIDATION_ERROR", "Invalid inventory id", 400);
    }

    const before = await inventoryForAgency(id, workspace.agency.id);
    if (!before) {
      throw new ApiError(
        "INVENTORY_NOT_FOUND",
        "Inventory record not found",
        404
      );
    }

    assertCanEdit(workspace, before.assignedMemberId);

    if (!before.archivedAt) {
      return res.json({
        ok: true,
        item: before,
        alreadyActive: true,
      });
    }

    const userId = workspace.membership.userId;

    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.inventoryProperty.update({
        where: { id },
        data: {
          archivedAt: null,
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
          action: "INVENTORY_RESTORED",
          entityType: "InventoryProperty",
          entityId: String(id),
          beforeState: inventorySnapshot(before),
          afterState: inventorySnapshot(updated),
          changedFields: ["archivedAt", "updatedByUserId", "updatedAt"],
          metadata: {
            source: "agencyInventory",
          },
          ...requestMeta(req),
        },
      });

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

    if (["address1", "address2", "city", "county", "eircode"].some((field) => field in body)) {
      data.lat = null;
      data.lng = null;
      data.intelligence = Prisma.DbNull;
      data.intelligenceUpdatedAt = null;
    }

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

    const result = await prisma.$transaction(async (tx) => {
      const revisionNotifications: ListingRevisionAdminEmailPayload[] = [];
      let updated = await tx.inventoryProperty.update({
        where: { id },
        data,
        include: inventoryInclude,
      });

      if ("primaryContactId" in body) {
        const nextPrimaryContactId =
          body.primaryContactId == null || body.primaryContactId === ""
            ? null
            : asPositiveInt(body.primaryContactId);
        await syncLegacyPrimaryContactLink(tx, {
          agencyId: workspace.agency.id,
          inventoryPropertyId: id,
          contactId: nextPrimaryContactId,
          userId: workspace.membership.userId,
        });
        updated = await tx.inventoryProperty.findUniqueOrThrow({
          where: { id },
          include: inventoryInclude,
        });
      }

      await tx.property.updateMany({
        where: {
          inventoryPropertyId: id,
          agencyId: workspace.agency.id,
          listingStatus: "DRAFT",
        },
        data: {
          ...inventoryToDraftListingData(updated),
          updatedByUserId: workspace.membership.userId,
        },
      });

      const publishedListings = await tx.property.findMany({
        where: {
          inventoryPropertyId: id,
          agencyId: workspace.agency.id,
          listingStatus: "PUBLISHED",
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
          description: true,
          features: true,
          ber: true,
          berRating: true,
          berNo: true,
          parking: true,
          outdoorSpace: true,
          saleCondition: true,
          yearBuilt: true,
          heatingType: true,
          viewingDetails: true,
          rentFrequency: true,
          deposit: true,
          availableFrom: true,
          furnished: true,
          leaseLength: true,
          minimumTerm: true,
          billsIncluded: true,
          petsAllowed: true,
          roomType: true,
          ensuite: true,
          currentOccupants: true,
          couplesAllowed: true,
          ownerOccupied: true,
        },
      });

      for (const listing of publishedListings) {
        const beforeState = listingPublicSnapshot(listing);
        const proposedState = inventoryPublicProposal(updated);
        const revisionFields = changedPublicListingFields(
          beforeState,
          proposedState
        );

        const pendingRevisions = await tx.listingRevision.findMany({
          where: {
            propertyId: listing.id,
            status: "PENDING",
          },
          orderBy: { id: "desc" },
          select: { id: true },
        });

        if (revisionFields.length === 0) {
          if (pendingRevisions.length > 0) {
            await tx.listingRevision.updateMany({
              where: {
                id: { in: pendingRevisions.map((revision) => revision.id) },
              },
              data: {
                status: "SUPERSEDED",
              },
            });
          }

          continue;
        }

        const currentPending = pendingRevisions[0] || null;
        const olderPendingIds = pendingRevisions
          .slice(1)
          .map((revision) => revision.id);

        if (olderPendingIds.length > 0) {
          await tx.listingRevision.updateMany({
            where: {
              id: { in: olderPendingIds },
            },
            data: {
              status: "SUPERSEDED",
            },
          });
        }

        let savedRevision: { id: number; submittedAt: Date };

        if (currentPending) {
          savedRevision = await tx.listingRevision.update({
            where: { id: currentPending.id },
            data: {
              agencyId: workspace.agency.id,
              inventoryPropertyId: id,
              source: "INVENTORY_UPDATE",
              beforeState,
              proposedState,
              changedFields: revisionFields,
              submittedByUserId: workspace.membership.userId,
              submittedAt: new Date(),
              reviewedByUserId: null,
              reviewedAt: null,
              rejectionReason: null,
            },
            select: {
              id: true,
              submittedAt: true,
            },
          });
        } else {
          savedRevision = await tx.listingRevision.create({
            data: {
              propertyId: listing.id,
              agencyId: workspace.agency.id,
              inventoryPropertyId: id,
              status: "PENDING",
              source: "INVENTORY_UPDATE",
              beforeState,
              proposedState,
              changedFields: revisionFields,
              submittedByUserId: workspace.membership.userId,
            },
            select: {
              id: true,
              submittedAt: true,
            },
          });
        }

        revisionNotifications.push({
          revisionId: savedRevision.id,
          listingId: listing.id,
          listingTitle: listing.title,
          listingSlug: listing.slug,
          agencyName: workspace.agency.name,
          submittedByName: updated.updatedBy?.name,
          submittedByEmail: updated.updatedBy?.email,
          submittedAt: savedRevision.submittedAt,
          changedFields: revisionFields,
          beforeState,
          proposedState,
          adminUrl: "https://havn.ie/app/index.html#/admin/revisions",
        });
      }

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

      return {
        updated,
        revisionNotifications,
      };
    });

    if (result.revisionNotifications.length > 0) {
      const emailResults = await Promise.allSettled(
        result.revisionNotifications.map((notification) =>
          sendListingRevisionAdminEmail(notification)
        )
      );

      emailResults.forEach((emailResult, index) => {
        if (emailResult.status === "rejected") {
          console.warn("Listing revision admin email failed", {
            revisionId: result.revisionNotifications[index]?.revisionId,
          });
        }
      });
    }

    return res.json({
      ok: true,
      item: result.updated,
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
