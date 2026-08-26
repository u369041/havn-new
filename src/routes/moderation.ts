// src/routes/moderation.ts
import express, { Router } from "express";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth";
import requireAdminAuth from "../middleware/adminAuth";
import { sendUserListingEmail } from "../lib/mail";

const router = Router();
router.use(express.json());

type ListingStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "PUBLISHED"
  | "REJECTED"
  | "CLOSED"
  | "ARCHIVED";

function safeText(v: any) {
  return v === null || v === undefined ? "" : String(v);
}

function normalizePayload(body: any): any {
  if (!body) return {};
  if (typeof body === "string") {
    const s = body.trim();
    if (!s) return {};
    try {
      return JSON.parse(s);
    } catch {
      return {};
    }
  }
  if (typeof body === "object") return body;
  return {};
}

function asListingStatus(raw: any): ListingStatus | null {
  const s = safeText(raw).trim().toUpperCase();

  if (s === "PENDING") return "SUBMITTED";

  if (
    s === "DRAFT" ||
    s === "SUBMITTED" ||
    s === "PUBLISHED" ||
    s === "REJECTED" ||
    s === "CLOSED" ||
    s === "ARCHIVED"
  ) {
    return s;
  }

  return null;
}

function buildModerationData(
  existing: any,
  nextStatus: ListingStatus,
  adminUserId: number,
  reason: string
) {
  const now = new Date();

  const base: any = {
    listingStatus: nextStatus,
  };

  if (nextStatus === "DRAFT") {
    base.publishedAt = null;
    base.approvedAt = null;
    base.approvedById = null;
  }

  if (nextStatus === "SUBMITTED") {
    base.submittedAt = existing.submittedAt || now;
    base.publishedAt = null;
    base.approvedAt = null;
    base.approvedById = null;
  }

  if (nextStatus === "PUBLISHED") {
    base.publishedAt = existing.publishedAt || now;
    base.approvedAt = now;
    base.approvedById = adminUserId;
    base.rejectedAt = null;
    base.rejectedById = null;
    base.rejectedReason = null;
  }

  if (nextStatus === "REJECTED") {
    base.rejectedAt = now;
    base.rejectedById = adminUserId;
    base.rejectedReason = reason || existing.rejectedReason || null;
    base.publishedAt = null;
    base.approvedAt = null;
    base.approvedById = null;
  }

  if (nextStatus === "CLOSED") {
    base.publishedAt = existing.publishedAt || null;
  }

  if (nextStatus === "ARCHIVED") {
    base.publishedAt = null;
  }

  return base;
}

function buildPropertyAddress(property: any): string {
  return [
    property?.address1,
    property?.address2,
    property?.city,
    property?.county,
    property?.eircode,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
}

function coverImage(property: any): string | null {
  if (!Array.isArray(property?.photos) || !property.photos.length) return null;

  const firstPhoto = property.photos[0];
  if (typeof firstPhoto === "string") return firstPhoto;

  if (firstPhoto && typeof firstPhoto === "object") {
    return firstPhoto.url || firstPhoto.secure_url || firstPhoto.src || null;
  }

  return null;
}

function listingDurationDays(property: any): number | null {
  if (!property?.listingExpiresAt || !property?.paidAt) return null;

  return Math.max(
    1,
    Math.round(
      (new Date(property.listingExpiresAt).getTime() -
        new Date(property.paidAt).getTime()) /
        86400000
    )
  );
}

async function sendModerationEmail(
  property: any,
  event: "APPROVED_LIVE" | "REJECTED",
  reason = ""
) {
  try {
    const result = await sendUserListingEmail({
      to: property.user.email,
      recipientName: property.user.name,
      event,
      listingTitle: property.title,
      slug: property.slug,
      listingId: property.id,
      publicUrl:
        event === "APPROVED_LIVE"
          ? `https://havn.ie/property.html?slug=${encodeURIComponent(property.slug)}`
          : undefined,
      myListingsUrl: "https://havn.ie/my-listings.html",
      editUrl:
        event === "REJECTED"
          ? `https://havn.ie/property-upload.html?id=${encodeURIComponent(String(property.id))}`
          : undefined,
      reason: event === "REJECTED" ? reason || property.rejectedReason || "" : undefined,
      coverImageUrl: coverImage(property),
      propertyAddress: buildPropertyAddress(property),
      propertyMode: property.mode,
      listingPackage: property.listingPackage,
      durationDays: listingDurationDays(property),
      price: property.price,
    });

    if (!result || (result as any).error) {
      console.warn(`${event} email was not accepted by Resend:`, result);
    }
  } catch (error) {
    console.warn(`${event} email failed (non-fatal):`, error);
  }
}

/**
 * PATCH /api/admin/properties/:id
 */
router.patch("/properties/:id", requireAuth, requireAdminAuth, async (req: any, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        message: "Invalid id",
      });
    }

    const payload = normalizePayload(req.body);
    const nextStatus = asListingStatus(payload.listingStatus ?? payload.status);
    const reason = safeText(payload.reason).trim();

    if (!nextStatus) {
      return res.status(400).json({
        ok: false,
        message: "Invalid listingStatus",
        received: payload.listingStatus ?? payload.status ?? null,
      });
    }

    const existing = await prisma.property.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!existing) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: buildModerationData(existing, nextStatus, req.user.userId, reason),
      include: { user: true },
    });

    if (existing.listingStatus !== nextStatus) {
      if (nextStatus === "PUBLISHED") {
        await sendModerationEmail(updated, "APPROVED_LIVE");
      } else if (nextStatus === "REJECTED") {
        await sendModerationEmail(updated, "REJECTED", reason);
      }
    }

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("admin generic status update error", err);
    return res.status(500).json({ ok: false, message: err?.message || "Server error" });
  }
});
/**
 * POST /api/admin/properties/:id/approve
 */
router.post("/properties/:id/approve", requireAuth, requireAdminAuth, async (req: any, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        message: "Invalid id",
      });
    }

    const existing = await prisma.property.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!existing) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    if (existing.listingStatus !== "SUBMITTED") {
      return res.status(409).json({
        ok: false,
        message: `Cannot approve from status ${existing.listingStatus}`,
      });
    }

    const now = new Date();
    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "PUBLISHED",
        publishedAt: now,
        approvedAt: now,
        approvedById: req.user.userId,
        rejectedAt: null,
        rejectedById: null,
        rejectedReason: null,
      },
      include: { user: true },
    });

    await sendModerationEmail(updated, "APPROVED_LIVE");

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("approve error", err);
    return res.status(500).json({ ok: false, message: err?.message || "Server error" });
  }
});

/**
 * POST /api/admin/properties/:id/reject
 */
router.post("/properties/:id/reject", requireAuth, requireAdminAuth, async (req: any, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        message: "Invalid id",
      });
    }

    const payload = normalizePayload(req.body);
    const reason = safeText(payload.reason).trim();

    const existing = await prisma.property.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!existing) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    if (existing.listingStatus !== "SUBMITTED") {
      return res.status(409).json({
        ok: false,
        message: `Cannot reject from status ${existing.listingStatus}`,
      });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "REJECTED",
        rejectedAt: new Date(),
        rejectedById: req.user.userId,
        rejectedReason: reason || null,
        approvedAt: null,
        approvedById: null,
        publishedAt: null,
      },
      include: { user: true },
    });

    await sendModerationEmail(updated, "REJECTED", reason);

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("reject error", err);
    return res.status(500).json({ ok: false, message: err?.message || "Server error" });
  }
});


const REVISION_FIELDS = [
  "address1",
  "address2",
  "city",
  "county",
  "eircode",
  "propertyType",
  "bedrooms",
  "bathrooms",
  "size",
  "sizeUnit",
] as const;

function revisionStateFromProperty(property: any) {
  return Object.fromEntries(
    REVISION_FIELDS.map((field) => [field, property?.[field] ?? null])
  );
}

function revisionStatesMatch(left: any, right: any): boolean {
  return REVISION_FIELDS.every(
    (field) =>
      JSON.stringify(left?.[field] ?? null) ===
      JSON.stringify(right?.[field] ?? null)
  );
}

function revisionPropertyData(proposedState: any) {
  return Object.fromEntries(
    REVISION_FIELDS.map((field) => [field, proposedState?.[field] ?? null])
  );
}

function validPositiveId(raw: any): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * GET /api/admin/revisions
 */
router.get("/revisions", requireAuth, requireAdminAuth, async (req: any, res) => {
  try {
    const rawStatus = safeText(req.query.status || "PENDING")
      .trim()
      .toUpperCase();

    const allowedStatuses = new Set([
      "PENDING",
      "APPROVED",
      "REJECTED",
      "SUPERSEDED",
    ]);

    if (!allowedStatuses.has(rawStatus)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid revision status",
      });
    }

    const items = await prisma.listingRevision.findMany({
      where: {
        status: rawStatus as any,
      },
      include: {
        property: {
          select: {
            id: true,
            slug: true,
            title: true,
            listingStatus: true,
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
            updatedAt: true,
          },
        },
        agency: {
          select: {
            id: true,
            name: true,
          },
        },
        submittedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        reviewedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      take: 500,
    });

    return res.json({ ok: true, items });
  } catch (err: any) {
    console.error("revision queue error", err);
    return res.status(500).json({
      ok: false,
      message: err?.message || "Server error",
    });
  }
});

/**
 * POST /api/admin/revisions/:id/approve
 */
router.post(
  "/revisions/:id/approve",
  requireAuth,
  requireAdminAuth,
  async (req: any, res) => {
    try {
      const id = validPositiveId(req.params.id);

      if (!id) {
        return res.status(400).json({
          ok: false,
          message: "Invalid revision id",
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        const revision = await tx.listingRevision.findUnique({
          where: { id },
          include: {
            property: true,
          },
        });

        if (!revision) {
          throw Object.assign(new Error("Revision not found"), {
            statusCode: 404,
          });
        }

        if (revision.status !== "PENDING") {
          throw Object.assign(
            new Error(`Cannot approve revision from status ${revision.status}`),
            { statusCode: 409 }
          );
        }

        if (revision.property.listingStatus !== "PUBLISHED") {
          throw Object.assign(
            new Error(
              `Cannot apply a revision to listing status ${revision.property.listingStatus}`
            ),
            { statusCode: 409 }
          );
        }

        const beforeState = revision.beforeState as any;
        const proposedState = revision.proposedState as any;
        const currentState = revisionStateFromProperty(revision.property);

        if (!revisionStatesMatch(beforeState, currentState)) {
          throw Object.assign(
            new Error(
              "The live listing changed after this revision was submitted. Review the current listing before approving."
            ),
            { statusCode: 409 }
          );
        }

        const now = new Date();

        const property = await tx.property.update({
          where: { id: revision.propertyId },
          data: {
            ...revisionPropertyData(proposedState),
            updatedByUserId: req.user.userId,
          },
          include: {
            user: true,
          },
        });

        const updatedRevision = await tx.listingRevision.update({
          where: { id },
          data: {
            status: "APPROVED",
            reviewedByUserId: req.user.userId,
            reviewedAt: now,
            rejectionReason: null,
          },
        });

        await tx.listingRevision.updateMany({
          where: {
            propertyId: revision.propertyId,
            status: "PENDING",
            id: { not: id },
          },
          data: {
            status: "SUPERSEDED",
            reviewedByUserId: req.user.userId,
            reviewedAt: now,
          },
        });

        return {
          property,
          revision: updatedRevision,
        };
      });

      return res.json({
        ok: true,
        item: result.revision,
        property: result.property,
      });
    } catch (err: any) {
      console.error("revision approve error", err);
      return res.status(err?.statusCode || 500).json({
        ok: false,
        message: err?.message || "Server error",
      });
    }
  }
);

/**
 * POST /api/admin/revisions/:id/reject
 */
router.post(
  "/revisions/:id/reject",
  requireAuth,
  requireAdminAuth,
  async (req: any, res) => {
    try {
      const id = validPositiveId(req.params.id);

      if (!id) {
        return res.status(400).json({
          ok: false,
          message: "Invalid revision id",
        });
      }

      const payload = normalizePayload(req.body);
      const reason = safeText(payload.reason).trim();

      const existing = await prisma.listingRevision.findUnique({
        where: { id },
      });

      if (!existing) {
        return res.status(404).json({
          ok: false,
          message: "Revision not found",
        });
      }

      if (existing.status !== "PENDING") {
        return res.status(409).json({
          ok: false,
          message: `Cannot reject revision from status ${existing.status}`,
        });
      }

      const updated = await prisma.listingRevision.update({
        where: { id },
        data: {
          status: "REJECTED",
          reviewedByUserId: req.user.userId,
          reviewedAt: new Date(),
          rejectionReason: reason || null,
        },
      });

      return res.json({
        ok: true,
        item: updated,
      });
    } catch (err: any) {
      console.error("revision reject error", err);
      return res.status(500).json({
        ok: false,
        message: err?.message || "Server error",
      });
    }
  }
);

export default router;

