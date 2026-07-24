import crypto from "crypto";
import { Router } from "express";
import {
  AnalyticsEventType,
  MarketMode,
  Prisma,
} from "@prisma/client";

import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth";

const router = Router();

const ALLOWED_EVENT_TYPES = new Set<AnalyticsEventType>([
  AnalyticsEventType.SEARCH,
  AnalyticsEventType.PROPERTY_VIEW,
  AnalyticsEventType.PROPERTY_SAVE,
  AnalyticsEventType.PROPERTY_CONTACT,
  AnalyticsEventType.SEARCH_SAVE,
  AnalyticsEventType.FEATURED_CLICK,
  AnalyticsEventType.PROPERTY_SHARE,
]);

const ALLOWED_MODES = new Set<MarketMode>([
  MarketMode.BUY,
  MarketMode.RENT,
  MarketMode.SHARE,
]);

const MAX_SESSION_ID_LENGTH = 100;
const MAX_PATH_LENGTH = 500;
const MAX_REFERRER_LENGTH = 1_000;
const MAX_USER_AGENT_LENGTH = 500;
const MAX_PAYLOAD_BYTES = 12_000;

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();

  if (!cleaned) {
    return null;
  }

  return cleaned.slice(0, maxLength);
}

function positiveInt(value: unknown): number | null {
  if (
    typeof value !== "number" &&
    typeof value !== "string"
  ) {
    return null;
  }

  const text = String(value).trim();

  if (!/^\d+$/.test(text)) {
    return null;
  }

  const parsed = Number(text);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function normaliseEventType(value: unknown): AnalyticsEventType | null {
  const eventType = cleanString(value, 100)?.toUpperCase();

  if (
    !eventType ||
    !ALLOWED_EVENT_TYPES.has(eventType as AnalyticsEventType)
  ) {
    return null;
  }

  return eventType as AnalyticsEventType;
}

function normaliseMode(value: unknown): MarketMode | null {
  const mode = cleanString(value, 20)?.toUpperCase();

  if (!mode || !ALLOWED_MODES.has(mode as MarketMode)) {
    return null;
  }

  return mode as MarketMode;
}

function getClientIp(req: any): string | null {
  const forwarded = req.headers["x-forwarded-for"];

  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]).split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || null;
}

function hashIp(ip: string | null): string | null {
  if (!ip) {
    return null;
  }

  const salt = process.env.ANALYTICS_IP_SALT;

  /*
   * Do not store a reversible or unsalted representation of an IP address.
   * If the salt is absent, IP-based analytics are simply disabled.
   */
  if (!salt) {
    return null;
  }

  return crypto
    .createHmac("sha256", salt)
    .update(ip)
    .digest("hex");
}

function sanitisePayload(
  value: unknown,
): Prisma.InputJsonValue | null {
  if (
    value === undefined ||
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  try {
    const serialised = JSON.stringify(value);

    if (Buffer.byteLength(serialised, "utf8") > MAX_PAYLOAD_BYTES) {
      return null;
    }

    return JSON.parse(serialised) as Prisma.InputJsonValue;
  } catch {
    return null;
  }
}

/*
 * POST /api/events
 *
 * Accepts anonymous and authenticated analytics events.
 * A valid Bearer token automatically links the event to the user.
 */
router.post("/", requireAuth.optional, async (req: any, res) => {
  try {
    const eventType = normaliseEventType(req.body?.eventType);
    const sessionId = cleanString(
      req.body?.sessionId,
      MAX_SESSION_ID_LENGTH,
    );

    if (!eventType) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_EVENT_TYPE",
      });
    }

    if (!sessionId) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_SESSION_ID",
      });
    }

    const propertyId = positiveInt(req.body?.propertyId);
    const locationId = positiveInt(req.body?.locationId);
    const mode = normaliseMode(req.body?.mode);

    const path = cleanString(req.body?.path, MAX_PATH_LENGTH);
    const bodyReferrer = cleanString(
      req.body?.referrer,
      MAX_REFERRER_LENGTH,
    );
    const headerReferrer = cleanString(
      req.get("referer"),
      MAX_REFERRER_LENGTH,
    );

    const userAgent = cleanString(
      req.get("user-agent"),
      MAX_USER_AGENT_LENGTH,
    );

    const payload = sanitisePayload(req.body?.payload);
    const userId = positiveInt(req.user?.userId);

    /*
     * Foreign keys are validated before insertion so malformed or stale
     * frontend values do not turn into server errors.
     */
    if (propertyId) {
      const propertyExists = await prisma.property.findUnique({
        where: { id: propertyId },
        select: { id: true },
      });

      if (!propertyExists) {
        return res.status(400).json({
          ok: false,
          error: "INVALID_PROPERTY",
        });
      }
    }

    if (locationId) {
      const locationExists = await prisma.location.findUnique({
        where: { id: locationId },
        select: { id: true },
      });

      if (!locationExists) {
        return res.status(400).json({
          ok: false,
          error: "INVALID_LOCATION",
        });
      }
    }

    await prisma.analyticsEvent.create({
      data: {
        eventType,
        sessionId,
        userId,
        propertyId,
        locationId,
        mode,
        path,
        referrer: bodyReferrer || headerReferrer,
        userAgent,
        ipHash: hashIp(getClientIp(req)),
        payload,
      },
    });

    return res.status(202).json({
      ok: true,
    });
  } catch (error) {
    console.error("ANALYTICS_EVENT_ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "ANALYTICS_EVENT_FAILED",
    });
  }
});

export default router;