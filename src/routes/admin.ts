// src/routes/admin.ts
import { Router } from "express";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth";
import { sendClosedListingEmail } from "../lib/mail";

const router = Router();

function requireAdmin(req: any, res: any, next: any) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ ok: false, error: "Admin only" });
  }
  next();
}

function normalizeListingStatus(raw: any) {
  const s = String(raw || "").trim().toUpperCase();

  if (s === "SUBMITTED" || s === "PENDING") return "SUBMITTED";
  if (s === "PUBLISHED" || s === "LIVE" || s === "APPROVED") return "PUBLISHED";
  if (s === "REJECTED") return "REJECTED";
  if (s === "DRAFT") return "DRAFT";
  if (s === "CLOSED") return "CLOSED";
  if (s === "ARCHIVED") return "ARCHIVED";

  return "OTHER";
}

function normalizePayload(body: any) {
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

function asOptionalDate(raw: any): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

router.get("/ping", (_req, res) => {
  res.json({ ok: true, route: "admin", ts: Date.now() });
});

router.get("/properties", requireAuth, requireAdmin, async (req, res) => {
  try {
    const statusFilter = String(req.query.status || "").trim().toUpperCase();
    const q = String(req.query.q || "").trim().toLowerCase();

    const items = await prisma.property.findMany({
      orderBy: [
        { isFeatured: "desc" },
        { updatedAt: "desc" },
      ],
    });

    let filtered = items as any[];

    if (statusFilter && statusFilter !== "ALL") {
      filtered = filtered.filter((p) => normalizeListingStatus(p.listingStatus) === statusFilter);
    }

    if (q) {
      filtered = filtered.filter((p) => {
        const hay = [
          p.id,
          p.slug,
          p.title,
          p.address1,
          p.address2,
          p.city,
          p.county,
          p.eircode,
          p.listingStatus,
          p.marketStatus,
        ]
          .map((x: any) => String(x || "").toLowerCase())
          .join(" · ");

        return hay.includes(q);
      });
    }

    res.json({ ok: true, items: filtered });
  } catch (err: any) {
    console.error("GET /api/admin/properties error:", err);
    res.status(500).json({ ok: false, error: err?.message || "Failed to load admin properties" });
  }
});

router.get("/statuses", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const items = await prisma.property.findMany({
      select: { listingStatus: true },
    });

    const counts: Record<string, number> = {
      ALL: items.length,
      SUBMITTED: 0,
      PUBLISHED: 0,
      DRAFT: 0,
      REJECTED: 0,
      CLOSED: 0,
      ARCHIVED: 0,
      OTHER: 0,
    };

    for (const it of items as any[]) {
      const s = normalizeListingStatus(it.listingStatus);
      counts[s] = (counts[s] || 0) + 1;
    }

    res.json({ ok: true, counts });
  } catch (err: any) {
    console.error("GET /api/admin/statuses error:", err);
    res.status(500).json({ ok: false, error: err?.message || "Failed to load status counts" });
  }
});

router.post("/properties/:id/feature", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid property id" });
    }

    const payload = normalizePayload(req.body);
    const featuredUntil = asOptionalDate(payload.featuredUntil);

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ ok: false, message: "Property not found" });
    }

    if (existing.listingStatus !== "PUBLISHED") {
      return res.status(409).json({ ok: false, message: "Only published listings can be featured" });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        isFeatured: true,
        featuredUntil,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /api/admin/properties/:id/feature error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.post("/properties/:id/unfeature", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid property id" });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        isFeatured: false,
        featuredUntil: null,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /api/admin/properties/:id/unfeature error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.post("/properties/:id/close", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid property id" });
    }

    const payload = normalizePayload(req.body);
    const rawOutcome = String(payload.outcome || "SOLD").trim().toUpperCase();
    const outcome = ["SOLD", "RENTED", "CANCELLED", "OTHER"].includes(rawOutcome)
      ? rawOutcome
      : "OTHER";

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "CLOSED",
        archivedAt: new Date(),
        marketStatus: outcome,
        isFeatured: false,
        featuredUntil: null,
      },
      include: { user: true },
    });

    let emailSent = false;
    let emailError = "";

    try {
      if (!updated.user?.email) {
        emailError = "The listing owner has no email address";
      } else {
        const propertyAddress = [
          updated.address1,
          updated.address2,
          updated.city,
          updated.county,
          updated.eircode,
        ]
          .map((value) => String(value || "").trim())
          .filter(Boolean)
          .join(", ");

        const emailResult = await sendClosedListingEmail({
          to: updated.user.email,
          recipientName: updated.user.name,
          listingTitle: updated.title || "Untitled listing",
          closeOutcome: outcome,
          myListingsUrl: "https://havn.ie/my-listings.html",
          propertyAddress,
          propertyMode: updated.mode,
          listingPackage: updated.listingPackage,
          price: updated.price,
        });

        emailSent = Boolean(
          emailResult &&
            !(emailResult as any).error &&
            ((emailResult as any).data?.id || (emailResult as any).id)
        );

        if (!emailSent) {
          emailError = String(
            (emailResult as any)?.error?.message ||
              (emailResult as any)?.message ||
              "Resend did not return an email ID"
          );
        }
      }
    } catch (emailErr: any) {
      emailError = String(emailErr?.message || emailErr || "Unknown email error");
      console.warn("Closed listing email failed:", emailErr);
    }

    return res.json({
      ok: true,
      item: updated,
      outcome,
      emailSent,
      message: emailSent
        ? "Listing closed and email sent"
        : `Listing closed, but email failed: ${emailError || "Unknown email error"}`,
    });
  } catch (err: any) {
    console.error("POST /api/admin/properties/:id/close error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});
router.post("/properties/:id/reopen", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid property id" });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "PUBLISHED",
        archivedAt: null,
        publishedAt: new Date(),
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /api/admin/properties/:id/reopen error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});


router.delete("/properties/:id", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        message: "Invalid property id",
      });
    }

    const existing = await prisma.property.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({
        ok: false,
        message: "Property not found",
      });
    }

    await prisma.property.delete({
      where: { id },
    });

    return res.json({
      ok: true,
      deletedId: id,
    });
  } catch (err: any) {
    console.error("DELETE /api/admin/properties/:id error:", err);

    return res.status(500).json({
      ok: false,
      message: "Server error",
      error: err?.message || String(err),
    });
  }
});


export default router;