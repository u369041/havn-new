import express, { Router } from "express";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth"; // default import
import requireVerifiedEmail from "../middleware/requireVerifiedEmail";
import {
  sendListingStatusEmail,
  sendUserListingEmail,
  sendPropertyLeadEmail,
} from "../lib/mail";
import { getTransportIntelligence } from "../services/transport-intelligence";

const router = Router();

const PRICE_DROP_ACTIVE_DAYS = 14;
const PRICE_DROP_ACTIVE_MS = PRICE_DROP_ACTIVE_DAYS * 24 * 60 * 60 * 1000;

router.use(
  express.text({
    type: ["text/plain", "text/*"],
    limit: "5mb",
  })
);

function isOwnerOrAdmin(user: any, ownerId: number) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return user.userId === ownerId;
}

function safeText(v: any) {
  return v === null || v === undefined ? "" : String(v);
}

function normalizeEircode(raw: any): string | null {
  const compact = safeText(raw).toUpperCase().replace(/\s+/g, "").trim();

  if (!compact) return null;

  if (!/^[A-Z0-9]{7}$/.test(compact)) {
    return safeText(raw).trim().toUpperCase() || null;
  }

  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

async function geocodeIrishEircode(
  eircodeRaw: any
): Promise<{ lat: number | null; lng: number | null }> {
  const eircode = normalizeEircode(eircodeRaw);

  if (!eircode) {
    return { lat: null, lng: null };
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    console.log("GOOGLE_GEOCODE_STATUS:", {
      eircode,
      status: "NO_API_KEY",
    });

    return { lat: null, lng: null };
  }

  try {
    const url =
      "https://maps.googleapis.com/maps/api/geocode/json?" +
      new URLSearchParams({
        address: `${eircode}, Ireland`,
        key: apiKey,
      }).toString();

    const response = await fetch(url);
    const data: any = await response.json();

    console.log("GOOGLE_GEOCODE_STATUS:", {
      eircode,
      status: data?.status || null,
      error: data?.error_message || null,
      results: Array.isArray(data?.results) ? data.results.length : 0,
    });

    const first = data?.results?.[0];
    const loc = first?.geometry?.location;

    const lat = Number(loc?.lat);
    const lng = Number(loc?.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { lat: null, lng: null };
    }

    return { lat, lng };
  } catch (err: any) {
    console.warn("Google geocode failed:", eircode, err?.message || err);

    return { lat: null, lng: null };
  }
}

function clampMode(raw: any): "BUY" | "RENT" | "SHARE" {
  const m = safeText(raw).trim().toUpperCase();
  if (m === "BUY" || m === "RENT" || m === "SHARE") return m;
  if (m === "B" || m === "FORSALE") return "BUY";
  return "BUY";
}

function slugify(input: string) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function generateUniqueSlug(base: string) {
  const clean = slugify(base) || "listing";
  let candidate = clean;
  let n = 2;

  while (true) {
    const existing = await prisma.property.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
    candidate = `${clean}-${n}`;
    n++;
    if (n > 50) candidate = `${clean}-${Date.now()}`;
  }
}

async function getUserEmailById(userId: number): Promise<string | null> {
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return u?.email || null;
  } catch {
    return null;
  }
}

function normalizePayload(body: any): any {
  if (!body) return {};
  if (typeof body === "string") {
    const s = body.trim();
    if (!s) return {};
    if (s.startsWith("{") || s.startsWith("[")) {
      try {
        return JSON.parse(s);
      } catch {
        return {};
      }
    }
    return {};
  }
  if (typeof body === "object") return body;
  return {};
}

type ListingStatus = "DRAFT" | "SUBMITTED" | "PUBLISHED" | "REJECTED" | "CLOSED" | "ARCHIVED";
type EnquiryStatus = "NEW" | "CONTACTED" | "VIEWING_BOOKED" | "OFFER_IN_PROGRESS" | "CLOSED" | "ARCHIVED";

function asListingStatus(raw: any): ListingStatus | null {
  const s = safeText(raw).trim().toUpperCase();
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

function asEnquiryStatus(raw: any): EnquiryStatus | null {
  const s = safeText(raw).trim().toUpperCase();
  if (
    s === "NEW" ||
    s === "CONTACTED" ||
    s === "VIEWING_BOOKED" ||
    s === "OFFER_IN_PROGRESS" ||
    s === "CLOSED" ||
    s === "ARCHIVED"
  ) {
    return s as EnquiryStatus;
  }
  return null;
}

function asOptionalString(raw: any): string | null {
  if (raw === undefined) return null;
  if (raw === null) return null;
  const s = String(raw).trim();
  return s ? s : null;
}

function asOptionalInt(raw: any): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function asOptionalFloat(raw: any): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function asOptionalBoolean(raw: any): boolean | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "boolean") return raw;
  const s = String(raw).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return null;
}

function asOptionalDate(raw: any): Date | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function asStringArray(raw: any): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v ?? "").trim()).filter(Boolean);
  }

  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];

    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
          return parsed.map((v) => String(v ?? "").trim()).filter(Boolean);
        }
      } catch {
        // fall through
      }
    }

    return s
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }

  return [];
}

function getIncomingMode(payload: any): "BUY" | "RENT" | "SHARE" {
  const raw = String(payload.mode ?? payload.marketStatus ?? payload.status ?? "")
    .trim()
    .toLowerCase();

  if (
    raw === "rent" ||
    raw === "to-rent" ||
    raw === "to_rent" ||
    raw === "rental" ||
    raw === "RENT".toLowerCase()
  ) {
    return "RENT";
  }

  if (
    raw === "share" ||
    raw === "room-share" ||
    raw === "room_share" ||
    raw === "flatshare" ||
    raw === "house-share" ||
    raw === "house_share"
  ) {
    return "SHARE";
  }

  return "BUY";
}

function isActiveFeaturedProperty(p: any) {
  if (!p || !p.isFeatured) return false;
  if (!p.featuredUntil) return true;

  const d = new Date(p.featuredUntil);
  if (Number.isNaN(d.getTime())) return true;

  return d.getTime() > Date.now();
}

function getActivePriceDropData(p: any) {
  if (!p) return null;

  const price = Number(p.price || 0);
  const previousPrice = Number((p as any).previousPrice || 0);
  const droppedAtRaw = (p as any).priceDroppedAt;

  if (!Number.isFinite(price) || !Number.isFinite(previousPrice)) return null;
  if (price <= 0 || previousPrice <= 0 || previousPrice <= price) return null;
  if (!droppedAtRaw) return null;

  const droppedAt = new Date(droppedAtRaw).getTime();

  if (!Number.isFinite(droppedAt)) return null;
  if (Date.now() - droppedAt > PRICE_DROP_ACTIVE_MS) return null;

  return {
    previousPrice,
    newPrice: price,
    reduction: previousPrice - price,
    priceDroppedAt: new Date(droppedAt),
    activeDays: PRICE_DROP_ACTIVE_DAYS,
  };
}

function isActivePriceDropProperty(p: any) {
  return !!getActivePriceDropData(p);
}

function sortActiveFeaturedFirst(items: any[]) {
  return [...items].sort((a, b) => {
    const af = isActiveFeaturedProperty(a) ? 1 : 0;
    const bf = isActiveFeaturedProperty(b) ? 1 : 0;

    if (af !== bf) return bf - af;

    const ad = isActivePriceDropProperty(a) ? 1 : 0;
    const bd = isActivePriceDropProperty(b) ? 1 : 0;

    if (ad !== bd) return bd - ad;

    const ap = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const bp = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;

    return bp - ap;
  });
}


type AreaScoreBreakdownItem = {
  label: string;
  score: number;
  max: number;
  reason: string;
};

type AreaScoreResult = {
  score: number;
  label: string;
  summary: string;
  breakdown: AreaScoreBreakdownItem[];
};

function clampAreaScore(value: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.round(n)));
}

function scoreLabel(score: number) {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Strong";
  if (score >= 55) return "Good";
  if (score >= 40) return "Moderate";
  return "Limited";
}

function makeAreaScore(summary: string, breakdown: AreaScoreBreakdownItem[]): AreaScoreResult {
  const score = clampAreaScore(
    breakdown.reduce((total, item) => total + clampAreaScore(item.score, item.max), 0),
    100
  );

  return {
    score,
    label: scoreLabel(score),
    summary,
    breakdown: breakdown.map((item) => ({
      label: item.label,
      score: clampAreaScore(item.score, item.max),
      max: item.max,
      reason: item.reason,
    })),
  };
}

function asArray(raw: any): any[] {
  return Array.isArray(raw) ? raw : [];
}

function itemDistanceKm(item: any): number | null {
  const n = Number(item?.distanceKm);
  return Number.isFinite(n) ? n : null;
}

function nearestDistanceKm(items: any[]): number | null {
  const distances = asArray(items)
    .map(itemDistanceKm)
    .filter((n): n is number => Number.isFinite(Number(n)));

  if (!distances.length) return null;
  return Math.min(...distances);
}

function countWithinKm(items: any[], km: number) {
  return asArray(items).filter((item) => {
    const d = itemDistanceKm(item);
    return d !== null && d <= km;
  }).length;
}

function uniqueValues(items: any[], picker: (item: any) => any) {
  const values = new Set<string>();

  for (const item of asArray(items)) {
    const value = safeText(picker(item)).trim().toLowerCase();
    if (value && value !== "—") values.add(value);
  }

  return values;
}

function textIncludesAny(value: any, terms: string[]) {
  const s = safeText(value).toLowerCase();
  return terms.some((term) => s.includes(term.toLowerCase()));
}

function scoreByCount(count: number, max: number, bands: Array<[number, number]>) {
  for (const [threshold, score] of bands) {
    if (count >= threshold) return clampAreaScore(score, max);
  }
  return 0;
}

function calculateAreaScores(nearby: any): Record<string, AreaScoreResult> {
  const schools = asArray(nearby?.schools);
  const transport = asArray(nearby?.transport);
  const transportV3 = asArray(nearby?.transportV3);
  const shopping = asArray(nearby?.shopping);
  const healthcare = asArray(nearby?.healthcare);
  const parks = asArray(nearby?.parks);
  const restaurants = asArray(nearby?.restaurants);
  const gyms = asArray(nearby?.gyms);
  const childcare = asArray(nearby?.childcare);

  const allTransport = transportV3.length ? transportV3 : transport;
  const railItems = transportV3.filter((item) => safeText(item?.type).toLowerCase() === "rail");
  const busItems = transportV3.filter((item) => safeText(item?.type).toLowerCase() === "bus");
  const nearestTransport = nearestDistanceKm(allTransport);
  const nearestRail = nearestDistanceKm(railItems);

  const uniqueRoutes = uniqueValues(busItems, (item) => `${item?.provider || ""}|${item?.route || ""}`);
  const uniqueDestinations = uniqueValues(transportV3, (item) => item?.destination);
  const destinationText = Array.from(uniqueDestinations).join(" ");

  const majorDestinationTerms = [
    "dublin",
    "galway",
    "cork",
    "limerick",
    "waterford",
    "athlone",
    "ennis",
    "airport",
  ];

  const matchedMajorDestinations = majorDestinationTerms.filter((term) =>
    textIncludesAny(destinationText, [term])
  );

  const hasAirport = textIncludesAny(destinationText, ["airport"]);

  const railScore = railItems.length
    ? nearestRail !== null && nearestRail <= 2
      ? 30
      : nearestRail !== null && nearestRail <= 5
        ? 24
        : 18
    : 0;

  const busNetworkScore = scoreByCount(uniqueRoutes.size || busItems.length, 25, [
    [10, 25],
    [6, 22],
    [3, 16],
    [1, 10],
  ]);

  const distanceScore = nearestTransport === null
    ? 0
    : nearestTransport <= 0.8
      ? 10
      : nearestTransport <= 1.5
        ? 8
        : nearestTransport <= 3
          ? 6
          : nearestTransport <= 5
            ? 3
            : 0;

  const majorDestinationScore = scoreByCount(matchedMajorDestinations.length, 20, [
    [5, 20],
    [4, 18],
    [3, 15],
    [2, 10],
    [1, 6],
  ]);

  const connectivity = makeAreaScore(
    "Measures rail access, bus network depth, airport links, nearby stop distance and major destination access.",
    [
      {
        label: "Rail access",
        score: railScore,
        max: 30,
        reason: railItems.length
          ? `Rail services found${nearestRail !== null ? ` around ${nearestRail.toFixed(1)}km away` : " nearby"}.`
          : "No rail service was found in the current transport cache radius.",
      },
      {
        label: "Bus network",
        score: busNetworkScore,
        max: 25,
        reason: uniqueRoutes.size
          ? `${uniqueRoutes.size} unique bus route/operator combinations found nearby.`
          : busItems.length
            ? `${busItems.length} bus services found nearby.`
            : "No bus routes were found in the current transport cache radius.",
      },
      {
        label: "Airport connectivity",
        score: hasAirport ? 15 : 0,
        max: 15,
        reason: hasAirport
          ? "A direct airport destination appears in nearby transport services."
          : "No direct airport destination was found in nearby transport services.",
      },
      {
        label: "Distance to transport",
        score: distanceScore,
        max: 10,
        reason: nearestTransport !== null
          ? `Nearest transport option is about ${nearestTransport < 1 ? Math.round(nearestTransport * 1000) + "m" : nearestTransport.toFixed(1) + "km"} away.`
          : "No nearby transport distance was available.",
      },
      {
        label: "Major destinations",
        score: majorDestinationScore,
        max: 20,
        reason: matchedMajorDestinations.length
          ? `Connections detected for ${matchedMajorDestinations.join(", ")}.`
          : "No major destination connections were detected in nearby services.",
      },
    ]
  );

  const schoolCount = countWithinKm(schools, 5) || schools.length;
  const secondaryCount = schools.filter((item) =>
    textIncludesAny(item?.name, ["college", "secondary", "community school", "post primary", "coláiste"])
  ).length;
  const childcareCount = countWithinKm(childcare, 5) || childcare.length;
  const healthcareCount = countWithinKm(healthcare, 5) || healthcare.length;
  const parksCount = countWithinKm(parks, 5) || parks.length;

  const family = makeAreaScore(
    "Measures nearby schools, secondary education signals, childcare availability, healthcare and parks.",
    [
      {
        label: "Primary schools",
        score: scoreByCount(schoolCount, 25, [[8, 25], [5, 21], [3, 16], [1, 9]]),
        max: 25,
        reason: `${schoolCount} school result${schoolCount === 1 ? "" : "s"} found within the search radius.`,
      },
      {
        label: "Secondary schools",
        score: secondaryCount >= 2 ? 25 : secondaryCount === 1 ? 18 : schoolCount >= 6 ? 12 : 0,
        max: 25,
        reason: secondaryCount
          ? `${secondaryCount} likely secondary/post-primary result${secondaryCount === 1 ? "" : "s"} detected by name.`
          : schoolCount >= 6
            ? "Several schools found, but secondary schools were not clearly labelled in the source data."
            : "No clearly labelled secondary school was detected nearby.",
      },
      {
        label: "Childcare",
        score: scoreByCount(childcareCount, 20, [[5, 20], [3, 16], [1, 10]]),
        max: 20,
        reason: `${childcareCount} childcare or preschool result${childcareCount === 1 ? "" : "s"} found nearby.`,
      },
      {
        label: "Healthcare",
        score: scoreByCount(healthcareCount, 15, [[5, 15], [3, 12], [1, 8]]),
        max: 15,
        reason: `${healthcareCount} healthcare result${healthcareCount === 1 ? "" : "s"} found nearby.`,
      },
      {
        label: "Parks / recreation",
        score: scoreByCount(parksCount, 15, [[3, 15], [1, 10]]),
        max: 15,
        reason: `${parksCount} park or green-space result${parksCount === 1 ? "" : "s"} found nearby.`,
      },
    ]
  );

  const shoppingCount = countWithinKm(shopping, 5) || shopping.length;
  const pharmacyCount = healthcare.filter((item) => textIncludesAny(item?.name, ["pharmacy"])).length;
  const dailyServiceCount = shoppingCount + pharmacyCount;
  const transportCount = allTransport.length;

  const convenience = makeAreaScore(
    "Measures grocery/shopping options, healthcare, transport access and practical daily services.",
    [
      {
        label: "Shopping",
        score: scoreByCount(shoppingCount, 30, [[6, 30], [4, 24], [2, 16], [1, 10]]),
        max: 30,
        reason: `${shoppingCount} shopping or grocery result${shoppingCount === 1 ? "" : "s"} found nearby.`,
      },
      {
        label: "Healthcare",
        score: scoreByCount(healthcareCount, 20, [[5, 20], [3, 16], [1, 10]]),
        max: 20,
        reason: `${healthcareCount} healthcare result${healthcareCount === 1 ? "" : "s"} found nearby.`,
      },
      {
        label: "Transport",
        score: scoreByCount(transportCount, 20, [[20, 20], [10, 16], [5, 12], [1, 7]]),
        max: 20,
        reason: `${transportCount} transport option${transportCount === 1 ? "" : "s"} found nearby.`,
      },
      {
        label: "Daily services",
        score: scoreByCount(dailyServiceCount, 30, [[8, 30], [5, 24], [3, 16], [1, 8]]),
        max: 30,
        reason: `${dailyServiceCount} practical daily-service signal${dailyServiceCount === 1 ? "" : "s"} found across shopping and pharmacy data.`,
      },
    ]
  );

  const restaurantCount = countWithinKm(restaurants, 6) || restaurants.length;
  const cafeCount = restaurants.filter((item) => textIncludesAny(item?.name, ["cafe", "café", "coffee", "bistro"])).length;
  const leisureCount = countWithinKm(gyms, 6) || gyms.length;
  const lifestyleDiversity = [restaurantCount > 0, cafeCount > 0, leisureCount > 0, parksCount > 0].filter(Boolean).length;

  const lifestyle = makeAreaScore(
    "Measures restaurants, cafés, leisure/fitness options, parks and broader local amenity diversity.",
    [
      {
        label: "Restaurants",
        score: scoreByCount(restaurantCount, 20, [[8, 20], [5, 16], [2, 10], [1, 6]]),
        max: 20,
        reason: `${restaurantCount} restaurant result${restaurantCount === 1 ? "" : "s"} found nearby.`,
      },
      {
        label: "Cafés",
        score: scoreByCount(cafeCount, 15, [[4, 15], [2, 10], [1, 6]]),
        max: 15,
        reason: cafeCount
          ? `${cafeCount} café/coffee/bistro signal${cafeCount === 1 ? "" : "s"} detected by name.`
          : "No clearly labelled café result was detected in the current source data.",
      },
      {
        label: "Leisure",
        score: scoreByCount(leisureCount, 20, [[6, 20], [3, 15], [1, 9]]),
        max: 20,
        reason: `${leisureCount} gym or leisure result${leisureCount === 1 ? "" : "s"} found nearby.`,
      },
      {
        label: "Parks",
        score: scoreByCount(parksCount, 20, [[3, 20], [1, 14]]),
        max: 20,
        reason: `${parksCount} park or green-space result${parksCount === 1 ? "" : "s"} found nearby.`,
      },
      {
        label: "Attractions / amenity diversity",
        score: lifestyleDiversity >= 4 ? 25 : lifestyleDiversity === 3 ? 18 : lifestyleDiversity === 2 ? 12 : lifestyleDiversity === 1 ? 6 : 0,
        max: 25,
        reason: `${lifestyleDiversity} lifestyle amenity categor${lifestyleDiversity === 1 ? "y" : "ies"} represented across restaurants, cafés, leisure and parks.`,
      },
    ]
  );

  return {
    connectivity,
    family,
    convenience,
    lifestyle,
  };
}

router.get("/mine", requireAuth, async (req: any, res) => {
  try {
    const user = req.user;

    if (!user || !Number.isFinite(Number(user.userId))) {
      return res.status(401).json({ ok: false, message: "Invalid auth session" });
    }

    const where = user.role === "admin" ? {} : { userId: user.userId };

    const items = await prisma.property.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });

    return res.json({ ok: true, items });
  } catch (err: any) {
    console.error("GET /api/properties/mine error", {
      message: err?.message,
      code: err?.code,
      meta: err?.meta,
      stack: err?.stack,
      name: err?.name,
    });

    return res.status(500).json({
      ok: false,
      message: "Server error",
      error: err?.message || String(err),
      code: err?.code || null,
      meta: err?.meta || null,
      hint:
        "Likely Prisma/DB drift. Check Render logs for full stack. Common causes: missing column, wrong type for text[] (photos/features), or migration drift.",
    });
  }
});

/**
 * draft hydration by numeric id
 * MUST appear before /:slug route
 */
router.get("/id/:id", requireAuth, async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const user = req.user;
    const item = await prisma.property.findUnique({ where: { id } });

    if (!item) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    if (!isOwnerOrAdmin(user, item.userId)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    return res.json({ ok: true, item });
  } catch (err: any) {
    console.error("GET /api/properties/id/:id error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * seller enquiries feed
 * MUST appear before /:slug route
 */
router.get("/mine/enquiries", requireAuth, async (req: any, res) => {
  try {
    const user = req.user;

    if (!user || !Number.isFinite(Number(user.userId))) {
      return res.status(401).json({ ok: false, message: "Invalid auth session" });
    }

    const propertyWhere = user.role === "admin" ? {} : { userId: user.userId };

    const properties = await prisma.property.findMany({
      where: propertyWhere,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        slug: true,
        title: true,
        address1: true,
        address2: true,
        city: true,
        county: true,
        eircode: true,
        price: true,
        previousPrice: true,
        priceDroppedAt: true,
        bedrooms: true,
        bathrooms: true,
        propertyType: true,
        listingStatus: true,
        createdAt: true,
        updatedAt: true,
        photos: true,
        userId: true,
        isFeatured: true,
        featuredUntil: true,
      },
    });
    const propertyIds = properties.map((p) => p.id);

    if (!propertyIds.length) {
      return res.json({
        ok: true,
        properties,
        enquiries: [],
      });
    }

    const enquiries = await prisma.enquiry.findMany({
      where: {
        propertyId: { in: propertyIds },
      },
      orderBy: { createdAt: "desc" },
      include: {
        property: {
          select: {
            id: true,
            slug: true,
            title: true,
            address1: true,
            city: true,
            county: true,
            eircode: true,
            listingStatus: true,
            userId: true,
            isFeatured: true,
            featuredUntil: true,
          },
        },
      },
    });

    return res.json({
      ok: true,
      properties,
      enquiries,
    });
  } catch (err: any) {
    console.error("GET /api/properties/mine/enquiries error", {
      message: err?.message,
      code: err?.code,
      meta: err?.meta,
      stack: err?.stack,
      name: err?.name,
    });

    return res.status(500).json({
      ok: false,
      message: "Failed to load seller enquiries",
      error: err?.message || String(err),
      code: err?.code || null,
      meta: err?.meta || null,
    });
  }
});

/**
 * seller updates own enquiry status / note
 * MUST appear before /:slug route
 */
router.patch("/mine/enquiries/:id", requireAuth, express.json(), async (req: any, res) => {
  try {
    const user = req.user;
    if (!user || !Number.isFinite(Number(user.userId))) {
      return res.status(401).json({ ok: false, message: "Invalid auth session" });
    }

    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid enquiry id" });
    }

    const payload = normalizePayload(req.body);
    const nextStatus = asEnquiryStatus(payload.status);
    const internalNote = safeText(payload.internalNote).trim();

    if (!nextStatus && payload.status !== undefined) {
      return res.status(400).json({ ok: false, message: "Invalid enquiry status" });
    }

    const existing = await prisma.enquiry.findUnique({
      where: { id },
      include: {
        property: {
          select: {
            id: true,
            userId: true,
          },
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ ok: false, message: "Enquiry not found" });
    }

    if (!existing.property || !isOwnerOrAdmin(user, existing.property.userId)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const updated = await prisma.enquiry.update({
      where: { id },
      data: {
        status: nextStatus ?? existing.status,
        internalNote: payload.internalNote !== undefined ? (internalNote || null) : existing.internalNote,
        statusUpdatedAt: nextStatus && nextStatus !== existing.status ? new Date() : existing.statusUpdatedAt,
      },
      include: {
        property: {
          select: {
            id: true,
            slug: true,
            title: true,
            address1: true,
            city: true,
            county: true,
            eircode: true,
            listingStatus: true,
            userId: true,
            isFeatured: true,
            featuredUntil: true,
          },
        },
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("PATCH /api/properties/mine/enquiries/:id error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.get("/_admin", requireAuth, async (req: any, res) => {
  try {
    const user = req.user;

    if (!user || user.role !== "admin") {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const idRaw = req.query.id;
    const slugRaw = req.query.slug;

    if (idRaw || slugRaw) {
      let item: any = null;

      if (idRaw) {
        const id = parseInt(String(idRaw), 10);
        if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id see schema" });
        item = await prisma.property.findUnique({ where: { id } });
      } else if (slugRaw) {
        const slug = String(slugRaw);
        item = await prisma.property.findUnique({ where: { slug } });
      }

      if (!item) return res.status(404).json({ ok: false, message: "Not found" });
      return res.json({ ok: true, item });
    }

    const page = Math.max(parseInt(String(req.query.page || "1"), 10), 1);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "25"), 10), 1), 100);

    const where: any = {};

    const q = String(req.query.q || "").trim();
    const county = String(req.query.county || "").trim();
    const city = String(req.query.city || "").trim();
    const type = String(req.query.type || "").trim();
    const modeRaw = String(req.query.mode || "").trim();
    const mode = modeRaw ? clampMode(modeRaw) : "";

    const statusRaw = safeText(req.query.listingStatus).trim().toUpperCase();
    let mappedStatus: ListingStatus | null = null;

    if (statusRaw) {
      if (statusRaw === "PENDING") mappedStatus = "SUBMITTED";
      else if (statusRaw === "ARCHIVED") mappedStatus = "CLOSED";
      else mappedStatus = asListingStatus(statusRaw);
    }

    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { county: { contains: q, mode: "insensitive" } },
        { eircode: { contains: q, mode: "insensitive" } },
        { address1: { contains: q, mode: "insensitive" } },
        { address2: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
      ];
    }

    if (county) where.county = { contains: county, mode: "insensitive" };
    if (city) where.city = { contains: city, mode: "insensitive" };
    if (type) where.propertyType = type;
    if (mappedStatus) where.listingStatus = mappedStatus;
    if (mode) where.mode = mode;

    const [total, items] = await Promise.all([
      prisma.property.count({ where }),
      prisma.property.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [
          { isFeatured: "desc" },
          { updatedAt: "desc" },
        ],
      }),
    ]);

    return res.json({ ok: true, page, limit, total, items });
  } catch (err: any) {
    console.error("GET /api/properties/_admin error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * admin enquiries feed
 * MUST appear before /:slug route
 */
router.get("/_admin/enquiries", requireAuth, async (req: any, res) => {
  try {
    const user = req.user;

    if (!user || user.role !== "admin") {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const page = Math.max(parseInt(String(req.query.page || "1"), 10), 1);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "50"), 10), 1), 100);
    const q = safeText(req.query.q).trim();
    const status = asEnquiryStatus(req.query.status);

    const where: any = {};

    if (q) {
      where.OR = [
        { buyerName: { contains: q, mode: "insensitive" } },
        { buyerEmail: { contains: q, mode: "insensitive" } },
        { buyerPhone: { contains: q, mode: "insensitive" } },
        { message: { contains: q, mode: "insensitive" } },
        { intent: { contains: q, mode: "insensitive" } },
        { internalNote: { contains: q, mode: "insensitive" } },
        {
          property: {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { slug: { contains: q, mode: "insensitive" } },
              { address1: { contains: q, mode: "insensitive" } },
              { city: { contains: q, mode: "insensitive" } },
              { county: { contains: q, mode: "insensitive" } },
              { eircode: { contains: q, mode: "insensitive" } },
            ],
          },
        },
      ];
    }

    if (status) where.status = status;

    const [total, items] = await Promise.all([
      prisma.enquiry.count({ where }),
      prisma.enquiry.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          property: {
            select: {
              id: true,
              slug: true,
              title: true,
              address1: true,
              city: true,
              county: true,
              eircode: true,
              listingStatus: true,
              userId: true,
              isFeatured: true,
              featuredUntil: true,
            },
          },
        },
      }),
    ]);

    return res.json({ ok: true, page, limit, total, items });
  } catch (err: any) {
    console.error("GET /api/properties/_admin/enquiries error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * admin updates enquiry status / note
 * MUST appear before /:slug route
 */
router.patch("/_admin/enquiries/:id", requireAuth, express.json(), async (req: any, res) => {
  try {
    const user = req.user;

    if (!user || user.role !== "admin") {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid enquiry id" });
    }

    const payload = normalizePayload(req.body);
    const nextStatus = asEnquiryStatus(payload.status);
    const internalNote = safeText(payload.internalNote).trim();

    if (!nextStatus && payload.status !== undefined) {
      return res.status(400).json({ ok: false, message: "Invalid enquiry status" });
    }

    const existing = await prisma.enquiry.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ ok: false, message: "Enquiry not found" });
    }

    const updated = await prisma.enquiry.update({
      where: { id },
      data: {
        status: nextStatus ?? existing.status,
        internalNote: payload.internalNote !== undefined ? (internalNote || null) : existing.internalNote,
        statusUpdatedAt: nextStatus && nextStatus !== existing.status ? new Date() : existing.statusUpdatedAt,
      },
      include: {
        property: {
          select: {
            id: true,
            slug: true,
            title: true,
            address1: true,
            city: true,
            county: true,
            eircode: true,
            listingStatus: true,
            userId: true,
            isFeatured: true,
            featuredUntil: true,
          },
        },
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("PATCH /api/properties/_admin/enquiries/:id error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * CONTACT SELLER
 * Public lead capture for published listings.
 * Saves enquiry in DB if available, but does not block email delivery if DB write fails.
 */
router.post("/:id/contact", async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid property id" });
    }

    const payload = normalizePayload(req.body);

    const name = safeText(payload.name).trim();
    const email = safeText(payload.email).trim().toLowerCase();
    const phone = safeText(payload.phone).trim();
    const message = safeText(payload.message).trim();
    const intent = safeText(payload.intent).trim() || "GENERAL";
    const sourceUrl = safeText(payload.sourceUrl).trim();

    if (!name || name.length < 2) {
      return res.status(400).json({ ok: false, message: "Please enter your name." });
    }

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) {
      return res.status(400).json({ ok: false, message: "Please enter a valid email address." });
    }

    if (!message || message.length < 8) {
      return res.status(400).json({ ok: false, message: "Please enter a longer message." });
    }

    const property = await prisma.property.findUnique({ where: { id } });
    if (!property || property.listingStatus !== "PUBLISHED") {
      return res.status(404).json({ ok: false, message: "Property not found." });
    }

    const ownerEmail = await getUserEmailById(property.userId);
    if (!ownerEmail) {
      console.error("Property contact failed: owner email missing", {
        propertyId: property.id,
        ownerUserId: property.userId,
      });
      return res.status(500).json({ ok: false, message: "Could not deliver your message right now." });
    }

    console.log("HAVN_LEAD_CAPTURE", {
      propertyId: property.id,
      propertySlug: property.slug,
      propertyTitle: property.title,
      ownerUserId: property.userId,
      ownerEmail,
      lead: {
        name,
        email,
        phone: phone || null,
        message,
        intent,
        sourceUrl: sourceUrl || null,
      },
      receivedAt: new Date().toISOString(),
    });

    try {
      await prisma.enquiry.create({
        data: {
          propertyId: property.id,
          buyerName: name,
          buyerEmail: email,
          buyerPhone: phone || null,
          message,
          intent,
          sourceUrl: sourceUrl || null,
          status: "NEW",
        },
      });
    } catch (dbErr: any) {
      console.warn("Enquiry DB save failed, continuing with email delivery:", {
        message: dbErr?.message,
        code: dbErr?.code,
        meta: dbErr?.meta,
      });
    }

    const sent = await sendPropertyLeadEmail({
      to: ownerEmail,
      buyerName: name,
      buyerEmail: email,
      buyerPhone: phone || undefined,
      message,
      intent,
      listingTitle: property.title || "HAVN listing",
      slug: property.slug,
      listingId: property.id,
      propertyUrl: sourceUrl || `https://havn.ie/property.html?slug=${encodeURIComponent(property.slug)}`,
    });

    if (!sent) {
      return res.status(500).json({ ok: false, message: "Could not deliver your message right now." });
    }

    return res.json({
      ok: true,
      message: "Your message has been sent to the seller.",
    });
  } catch (err: any) {
    console.error("POST /api/properties/:id/contact error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * PRICE DROP ENGINE V1
 * Owner/admin can update price on a PUBLISHED listing only.
 *
 * Canonical rules:
 * - Active price drop = previousPrice > price AND priceDroppedAt within 14 days.
 * - Drops preserve the earliest previousPrice during an active window.
 * - Price increases do not create badges.
 * - If price is raised back to or above previousPrice, the active drop clears.
 * - If an old drop expired, a new lower price starts a fresh drop window.
 */
router.patch("/:id/price", requireAuth, express.json(), async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid property id" });
    }

    const user = req.user;
    const existing = await prisma.property.findUnique({ where: { id } });

    if (!existing) {
      return res.status(404).json({ ok: false, message: "Property not found" });
    }

    if (!isOwnerOrAdmin(user, existing.userId)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    if (existing.listingStatus !== "PUBLISHED") {
      return res.status(409).json({
        ok: false,
        message: "Only published listings can use price update.",
      });
    }

    const payload = normalizePayload(req.body);
    const nextPrice = asOptionalInt(payload.price);

    if (!Number.isFinite(Number(nextPrice)) || Number(nextPrice) <= 0) {
      return res.status(400).json({
        ok: false,
        message: "Valid price required.",
      });
    }

    const currentPrice = Number(existing.price || 0);
    const newPrice = Number(nextPrice);
    const currentPreviousPrice = Number((existing as any).previousPrice || 0);

    const existingActiveDrop = getActivePriceDropData(existing);
    const isLowerPrice = currentPrice > 0 && newPrice < currentPrice;
    const isRaisedBackToOriginal =
      currentPreviousPrice > 0 && newPrice >= currentPreviousPrice;

    let nextPreviousPrice: number | null = (existing as any).previousPrice ?? null;
    let nextPriceDroppedAt: Date | null = (existing as any).priceDroppedAt ?? null;
    let priceDropResponse: any = null;

    if (isLowerPrice) {
      if (existingActiveDrop) {
        nextPreviousPrice = existingActiveDrop.previousPrice;
        nextPriceDroppedAt = existingActiveDrop.priceDroppedAt;
      } else {
        nextPreviousPrice = currentPrice;
        nextPriceDroppedAt = new Date();
      }

      priceDropResponse = {
        previousPrice: nextPreviousPrice,
        newPrice,
        reduction: Number(nextPreviousPrice) - newPrice,
        activeDays: PRICE_DROP_ACTIVE_DAYS,
      };
    } else if (isRaisedBackToOriginal) {
      nextPreviousPrice = null;
      nextPriceDroppedAt = null;
      priceDropResponse = null;
    } else {
      priceDropResponse = getActivePriceDropData({
        ...existing,
        price: newPrice,
      });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        price: newPrice,
        previousPrice: nextPreviousPrice,
        priceDroppedAt: nextPriceDroppedAt,
      },
    });

    return res.json({
      ok: true,
      item: updated,
      priceDrop: priceDropResponse,
    });
  } catch (err: any) {
    console.error("PATCH /api/properties/:id/price error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.get("/", requireAuth.optional, async (req: any, res) => {
  try {
    const where: any = { listingStatus: "PUBLISHED" };

    const page = Math.max(parseInt(String(req.query.page || "1"), 10), 1);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "12"), 10), 1), 50);

    const q = String(req.query.q || "").trim();
    const county = String(req.query.county || "").trim();
    const city = String(req.query.city || "").trim();
    const type = String(req.query.type || "").trim();

    const modeRaw = String(req.query.mode || "").trim();
    if (modeRaw) {
      where.mode = clampMode(modeRaw);
    }

    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { county: { contains: q, mode: "insensitive" } },
        { eircode: { contains: q, mode: "insensitive" } },
      ];
    }

    if (county) where.county = { contains: county, mode: "insensitive" };
    if (city) where.city = { contains: city, mode: "insensitive" };
    if (type) where.propertyType = type;

    const [total, items] = await Promise.all([
      prisma.property.count({ where }),
      prisma.property.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [
          { isFeatured: "desc" },
          { publishedAt: "desc" },
        ],
      }),
    ]);

    return res.json({
      ok: true,
      page,
      limit,
      total,
      items: sortActiveFeaturedFirst(items),
    });
  } catch (err: any) {
    console.error("GET /api/properties error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.post("/:id/view", async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid property id" });
    }

    const property = await prisma.property.findUnique({
      where: { id },
      select: { id: true, listingStatus: true },
    });

    if (!property || property.listingStatus !== "PUBLISHED") {
      return res.status(404).json({ ok: false, message: "Property not found" });
    }

    await prisma.property.update({
      where: { id },
      data: {
        views: {
          increment: 1,
        },
      },
    });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("POST /api/properties/:id/view error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * Public property detail route used by property.html:
 * GET /api/properties/slug/:slug
 *
 * This MUST appear before /:slug, otherwise Express treats "slug" as the slug value.
 */

router.get("/:id/intelligence", async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid property id" });
    }

    const property = await prisma.property.findUnique({ where: { id } });

    if (!property || property.listingStatus !== "PUBLISHED") {
      return res.status(404).json({ ok: false, message: "Property not found" });
    }

    const cached = (property as any).intelligence;
    const cachedAt = (property as any).intelligenceUpdatedAt
      ? new Date((property as any).intelligenceUpdatedAt)
      : null;

       const forceRefresh =
       String(req.query.refresh || "").toLowerCase() === "true";

   const cacheFresh =
   !forceRefresh &&
  cached &&
  (cached as any).version === "property-intelligence-v6" &&
  cachedAt &&
  !Number.isNaN(cachedAt.getTime()) &&
  Date.now() - cachedAt.getTime() < 30 * 24 * 60 * 60 * 1000;

    if (cacheFresh) {
      return res.json({
        ok: true,
        cached: true,
        intelligence: cached,
        intelligenceUpdatedAt: cachedAt,
      });
    }

    const lat = Number((property as any).lat);
    const lng = Number((property as any).lng);
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(409).json({
        ok: false,
        message: "Property does not have lat/lng yet.",
      });
    }

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        message: "GOOGLE_MAPS_API_KEY missing.",
      });
    }

    function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
      const R = 6371;
      const toRad = (v: number) => (v * Math.PI) / 180;
      const dLat = toRad(bLat - aLat);
      const dLng = toRad(bLng - aLng);

      const x =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(aLat)) *
          Math.cos(toRad(bLat)) *
          Math.sin(dLng / 2) *
          Math.sin(dLng / 2);

      return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    }

    async function nearby(keyword: string, limit = 20, type?: string) {
      const params: any = {
        location: `${lat},${lng}`,
        radius: "5000",
        key: apiKey,
      };

      if (keyword) params.keyword = keyword;
      if (type) params.type = type;

      const url =
        "https://maps.googleapis.com/maps/api/place/nearbysearch/json?" +
        new URLSearchParams(params).toString();

      const response = await fetch(url);
      const data: any = await response.json();

      console.log("GOOGLE_PLACES_STATUS:", {
        propertyId: property.id,
        keyword,
        type: type || null,
        status: data?.status || null,
        error: data?.error_message || null,
        results: Array.isArray(data?.results) ? data.results.length : 0,
      });

      const rows = Array.isArray(data?.results) ? data.results : [];

      return rows
        .map((r: any) => {
          const placeLat = Number(r?.geometry?.location?.lat);
          const placeLng = Number(r?.geometry?.location?.lng);

          return {
            name: safeText(r?.name).trim(),
            address: safeText(r?.vicinity).trim(),
            rating: Number.isFinite(Number(r?.rating)) ? Number(r.rating) : null,
            distanceKm:
              Number.isFinite(placeLat) && Number.isFinite(placeLng)
                ? Number(distanceKm(lat, lng, placeLat, placeLng).toFixed(2))
                : null,
            googlePlaceId: safeText(r?.place_id).trim() || null,
          };
        })
        .filter((x: any) => x.name)
        .sort((a: any, b: any) => {
          const ad = Number.isFinite(Number(a.distanceKm)) ? Number(a.distanceKm) : 9999;
          const bd = Number.isFinite(Number(b.distanceKm)) ? Number(b.distanceKm) : 9999;
          return ad - bd;
        })
        .slice(0, limit);
    }

    function dedupePlaces(items: any[]) {
      const seen = new Set<string>();

      return items.filter((item: any) => {
        const key =
          safeText(item.googlePlaceId).trim() ||
          `${safeText(item.name).trim().toLowerCase()}|${safeText(item.address).trim().toLowerCase()}`;

        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    async function nearbyTransport(limit = 20) {
      const [trainStations, busStations, transitStations] = await Promise.all([
        nearby("train station", 10, "train_station"),
        nearby("bus station bus stop", 15, "bus_station"),
        nearby("public transport", 15, "transit_station"),
      ]);

      return dedupePlaces([
        ...trainStations,
        ...busStations,
        ...transitStations,
      ])
        .sort((a: any, b: any) => {
          const ad = Number.isFinite(Number(a.distanceKm)) ? Number(a.distanceKm) : 9999;
          const bd = Number.isFinite(Number(b.distanceKm)) ? Number(b.distanceKm) : 9999;
          return ad - bd;
        })
        .slice(0, limit);
    }

    const [
      schools,
      transport,
      transportV3,
      shopping,
      healthcare,
      parks,
      restaurants,
      gyms,
      childcare,
    ] = await Promise.all([
      nearby("school", 20, "school"),
      nearbyTransport(20),
      Promise.race([
        getTransportIntelligence(lat, lng, 30),
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 15000)),
      ]),
      nearby("supermarket shops grocery", 20, "supermarket"),
      nearby("pharmacy doctor hospital medical centre", 20),
      nearby("park beach green space", 20, "park"),
      nearby("restaurant cafe", 20, "restaurant"),
      nearby("gym leisure centre", 20, "gym"),
      nearby("childcare creche preschool", 20, "school"),
    ]);

    const mode = String(property.mode || "").toUpperCase();
    const county = property.county || property.city || "this area";
    const type = property.propertyType || "property";
    const ber = property.ber || property.berRating || null;
    const beds = property.bedrooms || null;
    const baths = property.bathrooms || null;
    const price = Number(property.price || 0);
    const size = Number((property as any).size || 0);

    const pricePerSqm =
      mode === "BUY" && price > 0 && size > 0
        ? Math.round(price / size)
        : null;

    const rentPerBedroom =
      (mode === "RENT" || mode === "SHARE") && price > 0 && beds && beds > 0
        ? Math.round(price / beds)
        : null;

    const commentary =
      mode === "BUY"
        ? `This ${type} in ${county} should be assessed around long-term liveability, nearby schools, transport access, amenities, BER performance and resale strength.`
        : mode === "RENT"
          ? `This rental in ${county} should be assessed around commute, monthly affordability, transport links, local services and day-to-day convenience.`
          : `This room-share in ${county} should be assessed around transport, nearby shops, house-share convenience, room suitability and local amenities.`;

    const insightParts: string[] = [];

    if (ber) insightParts.push(`BER ${ber} gives users an immediate energy-efficiency signal.`);
    if (beds) insightParts.push(`${beds} bedroom${beds === 1 ? "" : "s"} supports quick suitability screening.`);
    if (baths) insightParts.push(`${baths} bathroom${baths === 1 ? "" : "s"} adds useful comfort context.`);
    if (schools.length) insightParts.push(`${schools.length} nearby school result${schools.length === 1 ? "" : "s"} found within the search radius.`);
    if (transport.length) insightParts.push(`${transport.length} transport-related result${transport.length === 1 ? "" : "s"} found nearby.`);
    if (shopping.length) insightParts.push(`${shopping.length} shopping or grocery result${shopping.length === 1 ? "" : "s"} found nearby.`);
    if (healthcare.length) insightParts.push(`${healthcare.length} healthcare-related result${healthcare.length === 1 ? "" : "s"} found nearby.`);

    const insight =
      insightParts.length
        ? insightParts.join(" ")
        : "HAVN found enough property and location data to support an initial viewing decision, but users should verify local amenities before committing.";

    const areaScores = calculateAreaScores({
      schools,
      transport,
      transportV3,
      shopping,
      healthcare,
      parks,
      restaurants,
      gyms,
      childcare,
    });

    const intelligence = {
      version: "property-intelligence-v6",
      generatedAt: new Date().toISOString(),
      source: "google_places_cached",
      location: {
        lat,
        lng,
        eircode: property.eircode || null,
        city: property.city || null,
        county: property.county || null,
      },
      market: {
        mode,
        price: property.price,
        pricePerSqm,
        rentPerBedroom,
        ber,
        bedrooms: beds,
        bathrooms: baths,
        propertyType: type,
        views: property.views || 0,
        isFeatured: !!property.isFeatured,
        previousPrice: (property as any).previousPrice || null,
        priceDroppedAt: (property as any).priceDroppedAt || null,
      },
      nearby: {
        schools,
        transport,
        transportV3,
        shopping,
        healthcare,
        parks,
        restaurants,
        gyms,
        childcare,
      },
      areaScores,
      commentary,
      insight,
    };

    const updated = await prisma.property.update({
      where: { id: property.id },
      data: {
        intelligence: intelligence as any,
        intelligenceUpdatedAt: new Date(),
      },
      select: {
        intelligence: true,
        intelligenceUpdatedAt: true,
      },
    });

    return res.json({
      ok: true,
      cached: false,
      intelligence: updated.intelligence,
      intelligenceUpdatedAt: updated.intelligenceUpdatedAt,
    });
  } catch (err: any) {
    console.error("GET /api/properties/:id/intelligence error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});




router.get("/slug/:slug", requireAuth.optional, async (req: any, res) => {
  try {
    const slug = String(req.params.slug);
    const user = req.user || null;

    const property = await prisma.property.findUnique({ where: { slug } });

    if (!property) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    if (property.listingStatus !== "PUBLISHED") {
      if (!user || !isOwnerOrAdmin(user, property.userId)) {
        return res.status(404).json({ ok: false, error: "NOT_FOUND" });
      }
    }

    return res.json({ ok: true, item: property });
  } catch (err: any) {
    console.error("GET /api/properties/slug/:slug error", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.get("/:slug", requireAuth.optional, async (req: any, res) => {
  try {
    const slug = String(req.params.slug);
    const user = req.user || null;

    const property = await prisma.property.findUnique({ where: { slug } });
    if (!property) return res.status(404).json({ ok: false, message: "Not found" });

    if (property.listingStatus !== "PUBLISHED") {
      if (!user || !isOwnerOrAdmin(user, property.userId)) {
        return res.status(404).json({ ok: false, message: "Not found" });
      }
    }

    return res.json({ ok: true, item: property });
  } catch (err: any) {
    console.error("GET /properties/:slug error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.post("/", requireAuth, async (req: any, res) => {
  try {
    const user = req.user;
    const payload = normalizePayload(req.body);

    const title = String(payload.title || "Untitled listing").trim();
    const city = String(payload.city || "").trim();
    const eircode = normalizeEircode(payload.eircode) || "";
    const geo = await geocodeIrishEircode(eircode);

    let slug = String(payload.slug || "").trim();
    if (!slug) {
      const base = [title, city, eircode].filter(Boolean).join(" ");
      slug = await generateUniqueSlug(base);
    } else {
      const existing = await prisma.property.findUnique({ where: { slug } });
      if (existing) return res.status(409).json({ ok: false, message: "Slug already exists" });
    }

    const mode = getIncomingMode(payload);

    const created = await prisma.property.create({
      data: {
        slug,
        title,
        address1: safeText(payload.address1).trim(),
        address2: asOptionalString(payload.address2),
        city: safeText(payload.city).trim(),
        county: safeText(payload.county).trim(),
        eircode: eircode || null,
        lat: geo.lat,
        lng: geo.lng,
        price: asOptionalInt(payload.price) ?? 0,
        previousPrice: null,
        priceDroppedAt: null,
        ber: asOptionalString(payload.berRating ?? payload.ber),
        berRating: asOptionalString(payload.berRating ?? payload.ber),
        berNo: asOptionalString(payload.berNo),
        bedrooms: asOptionalInt(payload.bedrooms),
        bathrooms: asOptionalInt(payload.bathrooms),
        size: asOptionalFloat(payload.size),
        sizeUnit: asOptionalString(payload.sizeUnit),
        propertyType: asOptionalString(payload.propertyType) || "house",
        saleType: asOptionalString(payload.saleType),
        marketStatus: asOptionalString(payload.marketStatus ?? payload.status),
        description: asOptionalString(payload.description),
        features: asStringArray(payload.features),
        photos: asStringArray(payload.photos),
        rentFrequency: asOptionalString(payload.rentFrequency),
        deposit: asOptionalInt(payload.deposit),
        availableFrom: asOptionalDate(payload.availableFrom),
        furnished: asOptionalBoolean(payload.furnished),
        parking: asOptionalString(payload.parking),
        outdoorSpace: asOptionalString(payload.outdoorSpace),
        saleCondition: asOptionalString(payload.saleCondition),
        yearBuilt: asOptionalInt(payload.yearBuilt),
        heatingType: asOptionalString(payload.heatingType),
        viewingDetails: asOptionalString(payload.viewingDetails),
        leaseLength: asOptionalString(payload.leaseLength),
        minimumTerm: asOptionalString(payload.minimumTerm),
        billsIncluded: asOptionalString(payload.billsIncluded),
        petsAllowed: asOptionalString(payload.petsAllowed),
        roomType: asOptionalString(payload.roomType),
        ensuite: asOptionalString(payload.ensuite),
        currentOccupants: asOptionalInt(payload.currentOccupants),
        couplesAllowed: asOptionalString(payload.couplesAllowed),
        ownerOccupied: asOptionalString(payload.ownerOccupied),
        listingStatus: "DRAFT",
        isFeatured: false,
        featuredUntil: null,
        userId: user.userId,
        mode,
      },
    });

    void (async () => {
      try {
        const to =
          user?.email ||
          (user?.userId ? await getUserEmailById(user.userId) : null) ||
          (created?.userId ? await getUserEmailById(created.userId) : null);

        if (!to) return;

        await sendUserListingEmail({
          to,
          event: "DRAFT_CREATED",
          listingTitle: created.title || "Untitled listing",
          slug: created.slug,
          listingId: created.id,
          myListingsUrl: "https://havn.ie/my-listings.html",
        });
      } catch (e) {
        console.warn("Draft created email failed (non-fatal):", e);
      }
    })();

    return res.json({ ok: true, item: created });
  } catch (err: any) {
    console.error("POST /properties error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.patch("/:id", requireAuth, async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const user = req.user;
    const existing = await prisma.property.findUnique({ where: { id } });

    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });
    if (!isOwnerOrAdmin(user, existing.userId)) return res.status(403).json({ ok: false, message: "Forbidden" });

    if (existing.listingStatus !== "DRAFT") {
      return res.status(409).json({ ok: false, message: "Only drafts can be edited." });
    }

    const payload = normalizePayload(req.body);

    const nextEircode =
      payload.eircode !== undefined
        ? normalizeEircode(payload.eircode)
        : existing.eircode;

    const shouldGeocode =
      payload.eircode !== undefined &&
      normalizeEircode(payload.eircode) !== existing.eircode;

    const geo = shouldGeocode
      ? await geocodeIrishEircode(nextEircode)
      : { lat: existing.lat, lng: existing.lng };

    const nextMode =
      payload.mode || payload.marketMode || payload.listingMode || payload.marketStatus
        ? getIncomingMode(payload)
        : existing.mode;

    const updated = await prisma.property.update({
      where: { id },
      data: {
        title: payload.title ?? existing.title,
        address1: payload.address1 ?? existing.address1,
        address2: payload.address2 !== undefined ? asOptionalString(payload.address2) : existing.address2,
        city: payload.city ?? existing.city,
        county: payload.county ?? existing.county,
        eircode: nextEircode,
        lat: geo.lat,
        lng: geo.lng,
        price: payload.price !== undefined ? (asOptionalInt(payload.price) ?? 0) : existing.price,
        previousPrice: null,
        priceDroppedAt: null,
        ber:
          payload.berRating !== undefined || payload.ber !== undefined
            ? asOptionalString(payload.berRating ?? payload.ber)
            : existing.ber,
        berRating:
          payload.berRating !== undefined || payload.ber !== undefined
            ? asOptionalString(payload.berRating ?? payload.ber)
            : (existing as any).berRating,
        berNo: payload.berNo !== undefined ? asOptionalString(payload.berNo) : existing.berNo,
        bedrooms: payload.bedrooms !== undefined ? asOptionalInt(payload.bedrooms) : existing.bedrooms,
        bathrooms: payload.bathrooms !== undefined ? asOptionalInt(payload.bathrooms) : existing.bathrooms,
        size: payload.size !== undefined ? asOptionalFloat(payload.size) : (existing as any).size,
        sizeUnit: payload.sizeUnit !== undefined ? asOptionalString(payload.sizeUnit) : (existing as any).sizeUnit,
        propertyType: payload.propertyType ?? existing.propertyType,
        saleType: payload.saleType !== undefined ? asOptionalString(payload.saleType) : existing.saleType,
        marketStatus:
          payload.marketStatus !== undefined || payload.status !== undefined
            ? asOptionalString(payload.marketStatus ?? payload.status)
            : existing.marketStatus,
        description: payload.description !== undefined ? asOptionalString(payload.description) : existing.description,
        features:
          Array.isArray(payload.features) || typeof payload.features === "string"
            ? asStringArray(payload.features)
            : existing.features,
        photos:
          Array.isArray(payload.photos) || typeof payload.photos === "string"
            ? asStringArray(payload.photos)
            : existing.photos,
        rentFrequency:
          payload.rentFrequency !== undefined
            ? asOptionalString(payload.rentFrequency)
            : (existing as any).rentFrequency,
        deposit:
          payload.deposit !== undefined
            ? asOptionalInt(payload.deposit)
            : (existing as any).deposit,
        availableFrom:
          payload.availableFrom !== undefined
            ? asOptionalDate(payload.availableFrom)
            : (existing as any).availableFrom,
        furnished:
          payload.furnished !== undefined
            ? asOptionalBoolean(payload.furnished)
            : (existing as any).furnished,
        parking:
          payload.parking !== undefined
            ? asOptionalString(payload.parking)
            : (existing as any).parking,
        outdoorSpace:
          payload.outdoorSpace !== undefined
            ? asOptionalString(payload.outdoorSpace)
            : (existing as any).outdoorSpace,
        saleCondition:
          payload.saleCondition !== undefined
            ? asOptionalString(payload.saleCondition)
            : (existing as any).saleCondition,
        yearBuilt:
          payload.yearBuilt !== undefined
            ? asOptionalInt(payload.yearBuilt)
            : (existing as any).yearBuilt,
        heatingType:
          payload.heatingType !== undefined
            ? asOptionalString(payload.heatingType)
            : (existing as any).heatingType,
        viewingDetails:
          payload.viewingDetails !== undefined
            ? asOptionalString(payload.viewingDetails)
            : (existing as any).viewingDetails,
        leaseLength:
          payload.leaseLength !== undefined
            ? asOptionalString(payload.leaseLength)
            : (existing as any).leaseLength,
        minimumTerm:
          payload.minimumTerm !== undefined
            ? asOptionalString(payload.minimumTerm)
            : (existing as any).minimumTerm,
        billsIncluded:
          payload.billsIncluded !== undefined
            ? asOptionalString(payload.billsIncluded)
            : (existing as any).billsIncluded,
        petsAllowed:
          payload.petsAllowed !== undefined
            ? asOptionalString(payload.petsAllowed)
            : (existing as any).petsAllowed,
        roomType:
          payload.roomType !== undefined
            ? asOptionalString(payload.roomType)
            : (existing as any).roomType,
        ensuite:
          payload.ensuite !== undefined
            ? asOptionalString(payload.ensuite)
            : (existing as any).ensuite,
        currentOccupants:
          payload.currentOccupants !== undefined
            ? asOptionalInt(payload.currentOccupants)
            : (existing as any).currentOccupants,
        couplesAllowed:
          payload.couplesAllowed !== undefined
            ? asOptionalString(payload.couplesAllowed)
            : (existing as any).couplesAllowed,
        ownerOccupied:
          payload.ownerOccupied !== undefined
            ? asOptionalString(payload.ownerOccupied)
            : (existing as any).ownerOccupied,
        mode: nextMode,
      },
    });

    void (async () => {
      try {
        const to =
          user?.email ||
          (user?.userId ? await getUserEmailById(user.userId) : null) ||
          (existing?.userId ? await getUserEmailById(existing.userId) : null);

        if (!to) return;

        await sendUserListingEmail({
          to,
          event: "DRAFT_SAVED",
          listingTitle: updated.title || "Untitled listing",
          slug: updated.slug,
          listingId: updated.id,
          myListingsUrl: "https://havn.ie/my-listings.html",
        });
      } catch (e) {
        console.warn("Draft saved email failed (non-fatal):", e);
      }
    })();

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("PATCH /properties/:id error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.post("/:id/submit", requireAuth, requireVerifiedEmail, async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const user = req.user;
    const existing = await prisma.property.findUnique({ where: { id } });

    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });
    if (!isOwnerOrAdmin(user, existing.userId)) return res.status(403).json({ ok: false, message: "Forbidden" });

    if (existing.listingStatus !== "DRAFT") {
      return res.status(409).json({ ok: false, message: "Only drafts can be submitted." });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "SUBMITTED",
        submittedAt: new Date(),
      },
    });

    try {
      await sendListingStatusEmail({
        status: "SUBMITTED",
        listingTitle: updated.title || "Untitled listing",
        slug: updated.slug,
        listingId: updated.id,
        adminUrl: "https://havn.ie/admin.html",
      });
    } catch (e) {
      console.warn("Admin submitted email failed (non-fatal):", e);
    }

    try {
      const to =
        user?.email ||
        (user?.userId ? await getUserEmailById(user.userId) : null) ||
        (existing?.userId ? await getUserEmailById(existing.userId) : null);

      if (to) {
        await sendUserListingEmail({
          to,
          event: "SUBMITTED",
          listingTitle: updated.title || "Untitled listing",
          slug: updated.slug,
          listingId: updated.id,
          myListingsUrl: "https://havn.ie/my-listings.html",
        });
      }
    } catch (e) {
      console.warn("Submit email failed (non-fatal):", e);
    }

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /properties/:id/submit error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;