import express, { Router } from "express";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth"; // default import
import requireAdminAuth from "../middleware/adminAuth";
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
const VIEW_DEDUP_WINDOW_MS = 30 * 60 * 1000;
const MAX_VIEW_DEDUP_ENTRIES = 10000;

const intelligenceBuildsInProgress = new Set<number>();
const recentPropertyViews = new Map<string, number>();

router.use(
  express.text({
    type: ["text/plain", "text/*"],
    limit: "5mb",
  })
);

function isOwner(user: any, ownerId: number) {
  if (!user) return false;

  const userId = Number(user.userId);
  const propertyOwnerId = Number(ownerId);

  if (!Number.isFinite(userId) || !Number.isFinite(propertyOwnerId)) {
    return false;
  }

  return userId === propertyOwnerId;
}

function safeText(v: any) {
  return v === null || v === undefined ? "" : String(v);
}

function isSafeHttpUrl(raw: any): boolean {
  const value = safeText(raw).trim();
  if (!value) return true;

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function getViewIdentity(req: any): string {
  const forwarded = safeText(req.headers?.["x-forwarded-for"])
    .split(",")[0]
    .trim();

  return forwarded || safeText(req.ip).trim() || "unknown";
}

function pruneRecentPropertyViews(now: number) {
  if (recentPropertyViews.size < MAX_VIEW_DEDUP_ENTRIES) return;

  for (const [key, seenAt] of recentPropertyViews.entries()) {
    if (now - seenAt >= VIEW_DEDUP_WINDOW_MS) {
      recentPropertyViews.delete(key);
    }
  }

  if (recentPropertyViews.size >= MAX_VIEW_DEDUP_ENTRIES) {
    const oldestKeys = [...recentPropertyViews.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, Math.ceil(MAX_VIEW_DEDUP_ENTRIES * 0.1))
      .map(([key]) => key);

    for (const key of oldestKeys) {
      recentPropertyViews.delete(key);
    }
  }
}

function toPositiveSafeInt(raw: any): number | null {
  const text = String(raw ?? "").trim();

  if (!/^\d+$/.test(text)) {
    return null;
  }

  const value = Number(text);

  if (!Number.isSafeInteger(value) || value <= 0) {
    return null;
  }

  return value;
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


type PhotoCategory =
  | "Exterior"
  | "Kitchen"
  | "Living Room"
  | "Bedroom"
  | "Bathroom"
  | "Garden"
  | "Floorplan"
  | "Interior"
  | "Other";

function clampPhotoCategory(raw: any): PhotoCategory {
  const s = safeText(raw).trim().toLowerCase();

  if (s.includes("exterior") || s.includes("front") || s.includes("facade")) return "Exterior";
  if (s.includes("kitchen")) return "Kitchen";
  if (s.includes("living") || s.includes("reception") || s.includes("sitting")) return "Living Room";
  if (s.includes("bed")) return "Bedroom";
  if (s.includes("bath")) return "Bathroom";
  if (s.includes("garden") || s.includes("outdoor") || s.includes("patio")) return "Garden";
  if (s.includes("floor")) return "Floorplan";
  if (s.includes("interior")) return "Interior";

  return "Other";
}

function buildPhotoAnalysisPrompt() {
  return [
    "You are analysing real estate listing photos for HAVN, Ireland's Property Intelligence Platform.",
    "Classify the image into exactly one category:",
    "Exterior, Kitchen, Living Room, Bedroom, Bathroom, Garden, Floorplan, Interior, Other.",
    "Also estimate image quality from 0 to 100.",
    "Return only valid JSON with this shape:",
    '{"category":"Exterior","confidence":0.95,"qualityScore":88,"suggestedCover":false,"reason":"Short reason"}',
  ].join("\n");
}

async function analyseSinglePropertyPhoto(url: string, index: number) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_PHOTO_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildPhotoAnalysisPrompt(),
            },
            {
              type: "input_image",
              image_url: url,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_object",
        },
      },
    }),
  });

  const data: any = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenAI photo analysis failed");
  }

  const rawText =
    data?.output_text ||
    data?.output?.[0]?.content?.[0]?.text ||
    "";

  let parsed: any = {};
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = {};
  }

  const category = clampPhotoCategory(parsed.category);
  const confidence = Number(parsed.confidence);
  const qualityScore = Number(parsed.qualityScore);

  return {
    url,
    index,
    category,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    qualityScore: Number.isFinite(qualityScore) ? Math.max(0, Math.min(100, Math.round(qualityScore))) : 0,
    suggestedCover: false,
    reason: safeText(parsed.reason).trim() || null,
  };
}

function chooseSuggestedCover(photoRows: any[]) {
  if (!photoRows.length) return photoRows;

  const categoryBoost: Record<string, number> = {
    Exterior: 18,
    Kitchen: 12,
    "Living Room": 10,
    Garden: 8,
    Bedroom: 4,
    Bathroom: 2,
    Interior: 1,
    Floorplan: -20,
    Other: -5,
  };

  let bestIndex = 0;
  let bestScore = -9999;

  photoRows.forEach((row, idx) => {
    const quality = Number(row.qualityScore || 0);
    const confidence = Number(row.confidence || 0) * 10;
    const boost = categoryBoost[row.category] ?? 0;
    const earlyPhotoBoost = Math.max(0, 6 - idx);

    const score = quality + confidence + boost + earlyPhotoBoost;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = idx;
    }
  });

  return photoRows.map((row, idx) => ({
    ...row,
    suggestedCover: idx === bestIndex,
  }));
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
  if (score >= 92) return "Exceptional";
  if (score >= 84) return "Excellent";
  if (score >= 70) return "Strong";
  if (score >= 55) return "Good";
  if (score >= 40) return "Moderate";
  return "Limited";
}

function calibrateAreaScore(rawScore: number) {
  const score = clampAreaScore(rawScore, 100);

  if (score >= 98) return 94;
  if (score >= 95) return 92;
  if (score >= 90) return Math.round(86 + (score - 90) * 1.0);
  if (score >= 85) return Math.round(82 + (score - 85) * 0.8);

  return score;
}

function makeAreaScore(summary: string, breakdown: AreaScoreBreakdownItem[]): AreaScoreResult {
  const rawScore = clampAreaScore(
    breakdown.reduce((total, item) => total + clampAreaScore(item.score, item.max), 0),
    100
  );
  const score = calibrateAreaScore(rawScore);

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


type ClassifiedSchoolType = "PRIMARY" | "SECONDARY" | "CHILDCARE" | "OTHER";

function classifySchoolType(item: any): ClassifiedSchoolType {
  const text = [item?.name, item?.address, item?.vicinity]
    .map(safeText)
    .join(" ")
    .toLowerCase();

  if (!text.trim()) return "OTHER";

  if (
    textIncludesAny(text, [
      "secondary",
      "post primary",
      "post-primary",
      "community school",
      "community college",
      "vocational school",
      "college",
      "coláiste",
      "grammar school",
      "high school",
      "comprehensive school",
    ])
  ) {
    return "SECONDARY";
  }

  if (
    textIncludesAny(text, [
      "national school",
      "primary school",
      "junior school",
      "educate together",
      "gaelscoil",
      "scoil",
      "ns",
      "n.s.",
    ])
  ) {
    return "PRIMARY";
  }

  if (
    textIncludesAny(text, [
      "montessori",
      "preschool",
      "pre-school",
      "pre school",
      "creche",
      "crèche",
      "childcare",
      "kindergarten",
      "playschool",
      "play school",
      "early years",
      "nursery",
    ])
  ) {
    return "CHILDCARE";
  }

  return "PRIMARY";
}

function schoolTypeLabel(type: ClassifiedSchoolType) {
  if (type === "PRIMARY") return "Primary";
  if (type === "SECONDARY") return "Secondary";
  if (type === "CHILDCARE") return "Childcare / preschool";
  return "School";
}

function classifySchoolPlaces(items: any[], defaultType?: ClassifiedSchoolType) {
  return asArray(items).map((item) => {
    const schoolType = defaultType || classifySchoolType(item);
    const label = schoolTypeLabel(schoolType);

    return {
      ...item,
      schoolType,
      schoolLevel: label,
      type: safeText(item?.type).trim() || label,
    };
  });
}

function dedupeSchoolPlaces(items: any[]) {
  const seen = new Set<string>();

  return asArray(items).filter((item) => {
    const key =
      safeText(item?.googlePlaceId).trim() ||
      `${safeText(item?.name).trim().toLowerCase()}|${safeText(item?.address).trim().toLowerCase()}`;

    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortPlacesByDistance(items: any[]) {
  return asArray(items).slice().sort((a, b) => {
    const ad = itemDistanceKm(a);
    const bd = itemDistanceKm(b);
    return (ad === null ? 9999 : ad) - (bd === null ? 9999 : bd);
  });
}

function placesWithinKm(items: any[], km: number) {
  return asArray(items).filter((item) => {
    const d = itemDistanceKm(item);
    return d !== null && d <= km;
  });
}

function nearestPlaces(items: any[], limit: number) {
  return sortPlacesByDistance(dedupeSchoolPlaces(items)).slice(0, limit);
}

function nearestSchoolDistanceText(items: any[]) {
  const d = nearestDistanceKm(items);
  if (d === null) return "no distance available";
  return d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`;
}

function scoreByCount(count: number, max: number, bands: Array<[number, number]>) {
  for (const [threshold, score] of bands) {
    if (count >= threshold) return clampAreaScore(score, max);
  }
  return 0;
}


function normaliseConvenienceBrand(name: any) {
  const text = safeText(name).trim().toLowerCase();

  if (!text) return "";

  if (text.includes("tesco")) return "tesco";
  if (text.includes("supervalu") || text.includes("super valu")) return "supervalu";
  if (text.includes("eurospar") || text.includes("spar")) return "spar";
  if (text.includes("lidl")) return "lidl";
  if (text.includes("aldi")) return "aldi";
  if (text.includes("dunnes")) return "dunnes";
  if (text.includes("marks") || text.includes("m&s")) return "marks and spencer";
  if (text.includes("fresh")) return "fresh";
  if (text.includes("centra")) return "centra";
  if (text.includes("mace")) return "mace";
  if (text.includes("gala")) return "gala";
  if (text.includes("daybreak")) return "daybreak";
  if (text.includes("asia market")) return "asia market";
  if (text.includes("boots")) return "boots";
  if (text.includes("lloyds")) return "lloyds pharmacy";
  if (text.includes("hickey")) return "hickeys pharmacy";
  if (text.includes("mccabes")) return "mccabes pharmacy";
  if (text.includes("careplus")) return "careplus pharmacy";
  if (text.includes("life pharmacy")) return "life pharmacy";
  if (text.includes("post office") || text.includes("an post")) return "post office";
  if (text.includes("bank of ireland")) return "bank of ireland";
  if (text.includes("aib")) return "aib";
  if (text.includes("permanent tsb") || text.includes("ptsb")) return "permanent tsb";
  if (text.includes("credit union")) return "credit union";
  if (text.includes("library")) return "library";
  if (text.includes("dry cleaner") || text.includes("laundrette") || text.includes("laundry")) return "laundry and dry cleaning";
  if (text.includes("dhl") || text.includes("parcel") || text.includes("locker") || text.includes("courier")) return "parcel services";
  if (text.includes("atm") || text.includes("cash machine")) return "atm";

  return text.replace(/[^a-z0-9]+/g, " ").trim();
}

function uniquePlaceBrands(items: any[]) {
  const brands = new Set<string>();

  for (const item of asArray(items)) {
    const brand = normaliseConvenienceBrand(item?.name);
    if (brand) brands.add(brand);
  }

  return brands;
}

function countUniquePlacesWithinKm(items: any[], km: number) {
  return uniquePlaceBrands(placesWithinKm(items, km)).size;
}

function serviceSignalCount(items: any[], km: number) {
  return uniquePlaceBrands(placesWithinKm(items, km)).size || countWithinKm(items, km) || asArray(items).length;
}

function uniquePlaceCount(items: any[], km: number) {
  const scoped = placesWithinKm(items, km);
  const rows = scoped.length ? scoped : asArray(items);
  const seen = new Set<string>();

  for (const item of rows) {
    const key =
      safeText(item?.googlePlaceId).trim() ||
      `${safeText(item?.name).trim().toLowerCase()}|${safeText(item?.address).trim().toLowerCase()}`;

    if (key) seen.add(key);
  }

  return seen.size;
}

function nearestDistanceText(items: any[]) {
  const d = nearestDistanceKm(items);
  if (d === null) return "no distance available";
  return d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`;
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
  const healthcareGroups = nearby?.healthcareGroups || {};
  const hospitalPlaces = asArray(healthcareGroups?.hospitals);
  const gpClinicPlaces = asArray(healthcareGroups?.gps);
  const dentalPlaces = asArray(healthcareGroups?.dental);
  const specialistPlaces = asArray(healthcareGroups?.specialists);
  const urgentCarePlaces = asArray(healthcareGroups?.urgentCare);

  const lifestyleGroups = nearby?.lifestyleGroups || {};
  const parkPlaces = asArray(lifestyleGroups?.parks).length ? asArray(lifestyleGroups.parks) : parks;
  const fitnessPlaces = asArray(lifestyleGroups?.fitness).length ? asArray(lifestyleGroups.fitness) : gyms;
  const foodCoffeePlaces = asArray(lifestyleGroups?.foodCoffee).length ? asArray(lifestyleGroups.foodCoffee) : restaurants;
  const culturePlaces = asArray(lifestyleGroups?.culture);

  const allTransport = transportV3.length ? transportV3 : transport;

  const transportType = (item: any) => safeText(item?.type).trim().toLowerCase();
  const transportRoute = (item: any) => safeText(item?.route).trim().toLowerCase();
  const transportProvider = (item: any) => safeText(item?.provider).trim().toLowerCase();
  const transportDestination = (item: any) => safeText(item?.destination).trim().toLowerCase();

  const luasItems = transportV3.filter((item) => {
    return transportType(item) === "tram" && transportProvider(item).includes("luas");
  });

  const dartItems = transportV3.filter((item) => {
    return transportType(item) === "rail" && transportRoute(item) === "dart";
  });

  const railItems = transportV3.filter((item) => {
    return transportType(item) === "rail" && transportRoute(item) !== "dart";
  });

  const busItems = transportV3.filter((item) => transportType(item) === "bus");

  const nearestTransport = nearestDistanceKm(allTransport);
  const nearestLuas = nearestDistanceKm(luasItems);
  const nearestDart = nearestDistanceKm(dartItems);
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
    "heuston",
    "connolly",
    "pearse",
  ];

  const matchedMajorDestinations = majorDestinationTerms.filter((term) =>
    textIncludesAny(destinationText, [term])
  );

  const hasAirport =
    textIncludesAny(destinationText, ["airport"]) ||
    transportV3.some((item) => {
      const combined = [
        item?.provider,
        item?.route,
        item?.destination,
        item?.stop,
      ].map(safeText).join(" ").toLowerCase();

      return (
        combined.includes("airport") ||
        combined.includes("aircoach") ||
        combined.includes("dublin express")
      );
    });

  function scoreByNearestDistance(distance: number | null, max: number, excellentKm: number, strongKm: number, goodKm: number, okKm: number) {
    if (distance === null) return 0;
    if (distance <= excellentKm) return max;
    if (distance <= strongKm) return Math.round(max * 0.9);
    if (distance <= goodKm) return Math.round(max * 0.72);
    if (distance <= okKm) return Math.round(max * 0.5);
    return Math.round(max * 0.28);
  }

  const busNetworkScore = scoreByCount(uniqueRoutes.size || busItems.length, 25, [
    [14, 25],
    [10, 22],
    [7, 20],
    [4, 15],
    [1, 8],
  ]);

  const distanceScore = nearestTransport === null
    ? 0
    : nearestTransport <= 0.5
      ? 10
      : nearestTransport <= 1
        ? 9
        : nearestTransport <= 1.5
          ? 7
          : nearestTransport <= 3
            ? 5
            : nearestTransport <= 5
              ? 2
              : 0;

  const majorDestinationScore = scoreByCount(matchedMajorDestinations.length, 5, [
    [5, 5],
    [4, 4],
    [3, 3],
    [2, 2],
    [1, 1],
  ]);

  type RawConnectivityBucket = {
    label: string;
    score: number;
    max: number;
    reason: string;
  };

  const rawConnectivityBuckets: RawConnectivityBucket[] = [];

  function addConnectivityBucket(label: string, score: number, max: number, reason: string) {
    if (max <= 0) return;
    rawConnectivityBuckets.push({
      label,
      score: clampAreaScore(score, max),
      max,
      reason,
    });
  }

  if (luasItems.length) {
    const routes = Array.from(uniqueValues(luasItems, (item) => item?.route))
      .map((x) => x.toUpperCase())
      .join(", ");

    addConnectivityBucket(
      "LUAS access",
      scoreByNearestDistance(nearestLuas, 18, 0.8, 1.5, 3, 5),
      18,
      `LUAS ${routes ? routes + " line " : ""}services found${nearestLuas !== null ? ` around ${nearestLuas.toFixed(1)}km away` : " nearby"}.`
    );
  }

  if (dartItems.length) {
    addConnectivityBucket(
      "DART access",
      scoreByNearestDistance(nearestDart, 18, 1, 2.5, 5, 8),
      18,
      `DART services found${nearestDart !== null ? ` around ${nearestDart.toFixed(1)}km away` : " nearby"}.`
    );
  }

  if (railItems.length) {
    addConnectivityBucket(
      "Irish Rail / intercity access",
      scoreByNearestDistance(nearestRail, 14, 1.5, 3, 6, 10),
      14,
      `Non-DART Irish Rail services found${nearestRail !== null ? ` around ${nearestRail.toFixed(1)}km away` : " nearby"}.`
    );
  }

  if (busItems.length) {
    addConnectivityBucket(
      "Bus network",
      busNetworkScore,
      25,
      uniqueRoutes.size
        ? `${uniqueRoutes.size} unique bus route/operator combinations found nearby.`
        : `${busItems.length} bus services found nearby.`
    );
  }

  if (hasAirport) {
    addConnectivityBucket(
      "Airport connectivity",
      10,
      10,
      "A direct airport destination or airport coach signal appears in nearby transport services."
    );
  }

  if (nearestTransport !== null) {
    addConnectivityBucket(
      "Distance to transport",
      distanceScore,
      10,
      `Nearest transport option is about ${nearestTransport < 1 ? Math.round(nearestTransport * 1000) + "m" : nearestTransport.toFixed(1) + "km"} away.`
    );
  }

  if (matchedMajorDestinations.length) {
    addConnectivityBucket(
      "Major destinations",
      majorDestinationScore,
      5,
      `Connections detected for ${matchedMajorDestinations.join(", ")}.`
    );
  }

  if (!rawConnectivityBuckets.length) {
    addConnectivityBucket(
      "Transport access",
      0,
      100,
      "No transport service was found in the current transport cache radius."
    );
  }

  const rawConnectivityMax = rawConnectivityBuckets.reduce((total, item) => total + item.max, 0) || 100;

  let normalizedRunningMax = 0;
  let normalizedRunningScore = 0;

  const normalizedConnectivityBreakdown = rawConnectivityBuckets.map((item, index) => {
    const isLast = index === rawConnectivityBuckets.length - 1;
    const normalizedMax = isLast
      ? Math.max(0, 100 - normalizedRunningMax)
      : Math.max(1, Math.round((item.max / rawConnectivityMax) * 100));

    const normalizedScore = clampAreaScore(
      item.max > 0 ? Math.round((item.score / item.max) * normalizedMax) : 0,
      normalizedMax
    );

    normalizedRunningMax += normalizedMax;
    normalizedRunningScore += normalizedScore;

    return {
      label: item.label,
      score: normalizedScore,
      max: normalizedMax,
      reason: item.reason,
    };
  });

  const connectivity = makeAreaScore(
    "Shows how easy it is to get around from this property, using nearby public transport, route depth and direct destination signals.",
    normalizedConnectivityBreakdown
  );

  const primarySchools = schools.filter((item) => classifySchoolType(item) === "PRIMARY");
  const secondarySchools = schools.filter((item) => classifySchoolType(item) === "SECONDARY");
  const schoolChildcare = schools.filter((item) => classifySchoolType(item) === "CHILDCARE");
  const combinedChildcare = dedupeSchoolPlaces([...childcare, ...schoolChildcare]);

  const primarySchoolsInScope = placesWithinKm(primarySchools, 3);
  const secondarySchoolsInScope = placesWithinKm(secondarySchools, 5);
  const childcareInScope = placesWithinKm(combinedChildcare, 3);

  const primarySchoolCount = primarySchoolsInScope.length;
  const secondaryCount = secondarySchoolsInScope.length;
  const childcareCount = childcareInScope.length;
  const parksCount = countWithinKm(parks, 5) || parks.length;

  const family = makeAreaScore(
    "Summarises nearby primary schools, secondary schools and childcare so families can quickly judge day-to-day suitability.",
    [
      {
        label: "Primary schools",
        score: scoreByCount(primarySchoolCount, 35, [[10, 35], [7, 31], [4, 25], [2, 18], [1, 10]]),
        max: 35,
        reason: primarySchoolCount
          ? `${primarySchoolCount} likely primary school${primarySchoolCount === 1 ? "" : "s"} found within 3km. Nearest is around ${nearestSchoolDistanceText(primarySchoolsInScope)}.`
          : "No likely primary school was found within 3km in the current source data.",
      },
      {
        label: "Secondary schools",
        score: scoreByCount(secondaryCount, 35, [[5, 35], [3, 30], [2, 24], [1, 16]]),
        max: 35,
        reason: secondaryCount
          ? `${secondaryCount} likely secondary/post-primary school${secondaryCount === 1 ? "" : "s"} found within 5km. Nearest is around ${nearestSchoolDistanceText(secondarySchoolsInScope)}.`
          : primarySchoolCount >= 4
            ? "Primary schools were found nearby, but no clearly labelled secondary school was detected within 5km."
            : "No clearly labelled secondary school was detected within 5km.",
      },
      {
        label: "Childcare / preschool",
        score: scoreByCount(childcareCount, 30, [[8, 30], [5, 26], [3, 20], [1, 12]]),
        max: 30,
        reason: childcareCount
          ? `${childcareCount} childcare, preschool or early-years result${childcareCount === 1 ? "" : "s"} found within 3km. Nearest is around ${nearestSchoolDistanceText(childcareInScope)}.`
          : "No childcare, preschool or early-years result was found within 3km in the current source data.",
      },
    ]
  );

  const convenienceGroups = nearby?.convenienceGroups || {};
  const groceryPlaces = asArray(convenienceGroups?.grocery).length ? asArray(convenienceGroups.grocery) : shopping;
  const pharmacyPlaces = asArray(convenienceGroups?.pharmacy).length
    ? asArray(convenienceGroups.pharmacy)
    : healthcare.filter((item) => textIncludesAny(item?.name, ["pharmacy", "chemist", "boots", "lloyds", "hickey", "mccabes"]));
  const dailyServicePlaces = asArray(convenienceGroups?.dailyServices);
  const retailPlaces = asArray(convenienceGroups?.retail);

  const groceryDiversityCount = countUniquePlacesWithinKm(groceryPlaces, 5);
  const groceryResultCount = countWithinKm(groceryPlaces, 5) || groceryPlaces.length;
  const pharmacyCount = serviceSignalCount(pharmacyPlaces, 5);
  const retailCount = serviceSignalCount(retailPlaces, 5);
  const dailyServiceCount = serviceSignalCount(dailyServicePlaces, 5);
  const practicalServicesCount = pharmacyCount + dailyServiceCount + retailCount;
  const transportCount = allTransport.length;

  const convenience = makeAreaScore(
    "Shows how convenient everyday life is, with grocery options, pharmacies, useful services, retail and transport practicality considered together.",
    [
      {
        label: "Grocery diversity",
        score: scoreByCount(groceryDiversityCount, 25, [[7, 25], [5, 22], [3, 17], [2, 12], [1, 7]]),
        max: 25,
        reason: groceryDiversityCount
          ? `${groceryDiversityCount} distinct grocery/convenience brand${groceryDiversityCount === 1 ? "" : "s"} detected from ${groceryResultCount} nearby grocery result${groceryResultCount === 1 ? "" : "s"}. Duplicate chains are counted once.`
          : "No grocery or convenience store signal was found nearby in the current source data.",
      },
      {
        label: "Pharmacy access",
        score: scoreByCount(pharmacyCount, 20, [[5, 20], [3, 17], [2, 13], [1, 8]]),
        max: 20,
        reason: pharmacyCount
          ? `${pharmacyCount} distinct pharmacy/chemist signal${pharmacyCount === 1 ? "" : "s"} found nearby.`
          : "No clear pharmacy or chemist signal was found nearby in the current source data.",
      },
      {
        label: "Transport practicality",
        score: scoreByCount(transportCount, 20, [[40, 20], [25, 18], [15, 15], [8, 11], [1, 6]]),
        max: 20,
        reason: `${transportCount} transport option${transportCount === 1 ? "" : "s"} found nearby.`,
      },
      {
        label: "Daily services",
        score: scoreByCount(practicalServicesCount, 20, [[10, 20], [7, 17], [4, 13], [2, 8], [1, 5]]),
        max: 20,
        reason: practicalServicesCount
          ? `${practicalServicesCount} practical service signal${practicalServicesCount === 1 ? "" : "s"} found across pharmacy, banking/postal, retail and daily-service searches.`
          : "No practical daily-service signal was found nearby in the current source data.",
      },
      {
        label: "Retail / shopping depth",
        score: scoreByCount(retailCount, 15, [[5, 15], [3, 12], [2, 9], [1, 5]]),
        max: 15,
        reason: retailCount
          ? `${retailCount} distinct retail or shopping-centre signal${retailCount === 1 ? "" : "s"} found nearby.`
          : "No clear retail or shopping-centre signal was found nearby in the current source data.",
      },
    ]
  );

  const hospitalCount = uniquePlaceCount(hospitalPlaces, 8);
  const gpClinicCount = uniquePlaceCount(gpClinicPlaces, 5);
  const dentalCount = uniquePlaceCount(dentalPlaces, 5);
  const specialistCount = uniquePlaceCount(specialistPlaces, 5);
  const urgentCareCount = uniquePlaceCount(urgentCarePlaces, 8);

  const healthcareScore = makeAreaScore(
    "Summarises access to real healthcare infrastructure including hospitals, GPs, dental care, specialists and urgent or out-of-hours services.",
    [
      {
        label: "Hospitals",
        score: scoreByCount(hospitalCount, 30, [[3, 30], [2, 25], [1, 18]]),
        max: 30,
        reason: hospitalCount
          ? `${hospitalCount} hospital signal${hospitalCount === 1 ? "" : "s"} found within 8km. Nearest is around ${nearestDistanceText(hospitalPlaces)}.`
          : "No hospital signal was found within the current search radius.",
      },
      {
        label: "GPs & medical clinics",
        score: scoreByCount(gpClinicCount, 25, [[8, 25], [5, 22], [3, 17], [1, 10]]),
        max: 25,
        reason: gpClinicCount
          ? `${gpClinicCount} GP, family practice or medical-clinic signal${gpClinicCount === 1 ? "" : "s"} found nearby. Nearest is around ${nearestDistanceText(gpClinicPlaces)}.`
          : "No GP or medical-clinic signal was found nearby in the current source data.",
      },
      {
        label: "Dental care",
        score: scoreByCount(dentalCount, 15, [[5, 15], [3, 12], [1, 7]]),
        max: 15,
        reason: dentalCount
          ? `${dentalCount} dental or orthodontic signal${dentalCount === 1 ? "" : "s"} found nearby. Nearest is around ${nearestDistanceText(dentalPlaces)}.`
          : "No dental-care signal was found nearby in the current source data.",
      },
      {
        label: "Specialists & therapy",
        score: scoreByCount(specialistCount, 20, [[8, 20], [5, 17], [3, 13], [1, 7]]),
        max: 20,
        reason: specialistCount
          ? `${specialistCount} physiotherapy, therapy or specialist-clinic signal${specialistCount === 1 ? "" : "s"} found nearby. Nearest is around ${nearestDistanceText(specialistPlaces)}.`
          : "No specialist or therapy-clinic signal was found nearby in the current source data.",
      },
      {
        label: "Urgent / out-of-hours care",
        score: scoreByCount(urgentCareCount, 10, [[2, 10], [1, 7]]),
        max: 10,
        reason: urgentCareCount
          ? `${urgentCareCount} urgent-care, walk-in or out-of-hours signal${urgentCareCount === 1 ? "" : "s"} found nearby. Nearest is around ${nearestDistanceText(urgentCarePlaces)}.`
          : "No clear urgent-care or out-of-hours signal was found nearby in the current source data.",
      },
    ]
  );

  const parksLifestyleCount = uniquePlaceCount(parkPlaces, 5);
  const fitnessLifestyleCount = uniquePlaceCount(fitnessPlaces, 5);
  const foodCoffeeCount = uniquePlaceCount(foodCoffeePlaces, 5);
  const cultureCount = uniquePlaceCount(culturePlaces, 8);
  const lifestyleDiversity = [
    parksLifestyleCount > 0,
    fitnessLifestyleCount > 0,
    foodCoffeeCount > 0,
    cultureCount > 0,
  ].filter(Boolean).length;

  const lifestyle = makeAreaScore(
    "Shows the local lifestyle offer across parks, fitness, cafés, restaurants, pubs and culture so users can picture daily life in the area.",
    [
      {
        label: "Parks & green space",
        score: scoreByCount(parksLifestyleCount, 25, [[5, 25], [3, 22], [2, 17], [1, 10]]),
        max: 25,
        reason: parksLifestyleCount
          ? `${parksLifestyleCount} park or green-space signal${parksLifestyleCount === 1 ? "" : "s"} found nearby. Nearest is around ${nearestDistanceText(parkPlaces)}.`
          : "No park or green-space signal was found nearby in the current source data.",
      },
      {
        label: "Fitness & sport",
        score: scoreByCount(fitnessLifestyleCount, 25, [[8, 25], [5, 22], [3, 17], [1, 10]]),
        max: 25,
        reason: fitnessLifestyleCount
          ? `${fitnessLifestyleCount} gym, leisure or sports signal${fitnessLifestyleCount === 1 ? "" : "s"} found nearby. Nearest is around ${nearestDistanceText(fitnessPlaces)}.`
          : "No gym, leisure or sports signal was found nearby in the current source data.",
      },
      {
        label: "Food & coffee",
        score: scoreByCount(foodCoffeeCount, 25, [[15, 25], [10, 22], [6, 18], [3, 11], [1, 6]]),
        max: 25,
        reason: foodCoffeeCount
          ? `${foodCoffeeCount} food, café, coffee or restaurant signal${foodCoffeeCount === 1 ? "" : "s"} found nearby. Nearest is around ${nearestDistanceText(foodCoffeePlaces)}.`
          : "No food or coffee signal was found nearby in the current source data.",
      },
      {
        label: "Culture & entertainment",
        score: scoreByCount(cultureCount, 15, [[5, 15], [3, 12], [2, 9], [1, 5]]),
        max: 15,
        reason: cultureCount
          ? `${cultureCount} culture, arts or entertainment signal${cultureCount === 1 ? "" : "s"} found nearby. Nearest is around ${nearestDistanceText(culturePlaces)}.`
          : "No clear culture or entertainment signal was found nearby in the current source data.",
      },
      {
        label: "Amenity diversity",
        score: lifestyleDiversity >= 4 ? 10 : lifestyleDiversity === 3 ? 8 : lifestyleDiversity === 2 ? 5 : lifestyleDiversity === 1 ? 2 : 0,
        max: 10,
        reason: `${lifestyleDiversity} lifestyle amenity categor${lifestyleDiversity === 1 ? "y is" : "ies are"} represented across parks, fitness, food/coffee and culture.`,
      },
    ]
  );

  return {
    connectivity,
    family,
    convenience,
    healthcare: healthcareScore,
    lifestyle,
  };
}

router.get("/mine", requireAuth, async (req: any, res) => {
  try {
    const user = req.user;

    if (!user || !Number.isFinite(Number(user.userId))) {
      return res.status(401).json({ ok: false, message: "Invalid auth session" });
    }

    const where = { userId: Number(user.userId) };

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
    });
  }
});

/**
 * draft hydration by numeric id
 * MUST appear before /:slug route
 */
router.get("/id/:id", requireAuth, async (req: any, res) => {
  try {
    const id = toPositiveSafeInt(req.params.id);

    if (id === null) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const user = req.user;
    const item = await prisma.property.findUnique({ where: { id } });

    if (!item) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    if (!isOwner(user, item.userId)) {
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

    const propertyWhere = { userId: Number(user.userId) };

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

	const id = toPositiveSafeInt(req.params.id);

	if (id === null) {
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

    if (!existing.property || !isOwner(user, existing.property.userId)) {
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

router.get("/_admin", requireAuth, requireAdminAuth, async (req: any, res) => {
  try {
    const idRaw = req.query.id;
    const slugRaw = req.query.slug;

    if (idRaw || slugRaw) {
      let item: any = null;

      if (idRaw) {
        const id = toPositiveSafeInt(idRaw);

        if (id === null) {
          return res.status(400).json({
            ok: false,
            message: "Invalid property id",
          });
        }

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
router.get("/_admin/enquiries", requireAuth, requireAdminAuth, async (req: any, res) => {
  try {
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
	router.patch(
  	"/_admin/enquiries/:id",
  	requireAuth,
  	requireAdminAuth,
  	express.json(),
  	async (req: any, res) => {
    	try {

    const id = toPositiveSafeInt(req.params.id);

    if (id === null) {
      return res.status(400).json({
        ok: false,
        message: "Invalid enquiry id",
      });
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
    const id = toPositiveSafeInt(req.params.id);

    if (id === null) {
      return res.status(400).json({
        ok: false,
        message: "Invalid property id",
      });
    }

    const payload = normalizePayload(req.body);

    const name = safeText(payload.name).trim();
    const email = safeText(payload.email).trim().toLowerCase();
    const phone = safeText(payload.phone).trim();
    const message = safeText(payload.message).trim();
    const intent = safeText(payload.intent).trim() || "GENERAL";
    const sourceUrl = safeText(payload.sourceUrl).trim();

    if (!name || name.length < 2 || name.length > 100) {
      return res.status(400).json({
        ok: false,
        message: "Please enter a valid name.",
      });
    }

    const emailOk =
      email.length <= 254 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    if (!emailOk) {
      return res.status(400).json({
        ok: false,
        message: "Please enter a valid email address.",
      });
    }

    if (phone.length > 50) {
      return res.status(400).json({
        ok: false,
        message: "Phone number is too long.",
      });
    }

    if (intent.length > 50) {
      return res.status(400).json({
        ok: false,
        message: "Invalid enquiry type.",
      });
    }

    if (!message || message.length < 8 || message.length > 5000) {
      return res.status(400).json({
        ok: false,
        message: "Please enter a message between 8 and 5,000 characters.",
      });
    }

    if (sourceUrl.length > 2048 || !isSafeHttpUrl(sourceUrl)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid source URL.",
      });
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
      ownerUserId: property.userId,
      intent,
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
    const id = toPositiveSafeInt(req.params.id);

    if (id === null) {
      return res.status(400).json({
        ok: false,
        message: "Invalid property id",
      });
    }

    const user = req.user;
    const existing = await prisma.property.findUnique({ where: { id } });

    if (!existing) {
      return res.status(404).json({ ok: false, message: "Property not found" });
    }

    if (!isOwner(user, existing.userId)) {
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

router.post(
  "/_admin/:id/analyse-photos",
  requireAuth,
  requireAdminAuth,
  async (req: any, res) => {
    try {
      const id = toPositiveSafeInt(req.params.id);

      if (id === null) {
        return res.status(400).json({
          ok: false,
          message: "Invalid property id",
        });
      }

    const property = await prisma.property.findUnique({ where: { id } });

    if (!property) {
      return res.status(404).json({ ok: false, message: "Property not found" });
    }

    const photos = Array.isArray(property.photos)
      ? property.photos.map((x) => safeText(x).trim()).filter(Boolean)
      : [];

    if (!photos.length) {
      return res.status(400).json({
        ok: false,
        message: "This property has no photos to analyse.",
      });
    }

    const maxPhotos = Math.min(photos.length, 20);
    const selectedPhotos = photos.slice(0, maxPhotos);

    const analysed: any[] = [];

    for (let i = 0; i < selectedPhotos.length; i++) {
      const url = selectedPhotos[i];

      try {
        const row = await analyseSinglePropertyPhoto(url, i);
        analysed.push(row);
      } catch (photoErr: any) {
        console.warn("Photo analysis failed for image", {
          propertyId: property.id,
          index: i,
          url,
          message: photoErr?.message || String(photoErr),
        });

        analysed.push({
          url,
          index: i,
          category: "Other",
          confidence: 0,
          qualityScore: 0,
          suggestedCover: false,
          reason: "Analysis failed",
          error: true,
        });
      }
    }

    const photosWithCover = chooseSuggestedCover(analysed);

    const photoMeta = {
      version: "photo-meta-v1",
      generatedAt: new Date().toISOString(),
      source: "openai_vision",
      model: process.env.OPENAI_PHOTO_MODEL || "gpt-4.1-mini",
      totalPhotos: photos.length,
      analysedPhotos: photosWithCover.length,
      photos: photosWithCover,
      categories: photosWithCover.reduce((acc: any, row: any) => {
        const key = row.category || "Other";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    };

    const updated = await prisma.property.update({
      where: { id: property.id },
      data: {
        photoMeta: photoMeta as any,
        photoMetaUpdatedAt: new Date(),
      },
      select: {
        id: true,
        slug: true,
        title: true,
        photos: true,
        photoMeta: true,
        photoMetaUpdatedAt: true,
      },
    });

    return res.json({
      ok: true,
      item: updated,
    });
  } catch (err: any) {
    console.error("POST /api/properties/_admin/:id/analyse-photos error", {
      message: err?.message,
      code: err?.code,
      meta: err?.meta,
      stack: err?.stack,
    });

    return res.status(500).json({
      ok: false,
      message: "Photo analysis failed",
    });
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
    const id = toPositiveSafeInt(req.params.id);

    if (id === null) {
      return res.status(400).json({
        ok: false,
        message: "Invalid property id",
      });
    }

    const property = await prisma.property.findUnique({
      where: { id },
      select: { id: true, listingStatus: true },
    });

    if (!property || property.listingStatus !== "PUBLISHED") {
      return res.status(404).json({ ok: false, message: "Property not found" });
    }

    const now = Date.now();
    const viewKey = `${id}:${getViewIdentity(req)}`;
    const lastSeenAt = recentPropertyViews.get(viewKey) || 0;

    if (now - lastSeenAt < VIEW_DEDUP_WINDOW_MS) {
      return res.json({ ok: true, counted: false });
    }

    pruneRecentPropertyViews(now);
    recentPropertyViews.set(viewKey, now);

    await prisma.property.update({
      where: { id },
      data: {
        views: {
          increment: 1,
        },
      },
    });

    return res.json({ ok: true, counted: true });
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
    const id = toPositiveSafeInt(req.params.id);

    if (id === null) {
      return res.status(400).json({
        ok: false,
        message: "Invalid property id",
      });
    }

    const property = await prisma.property.findUnique({ where: { id } });

    if (!property || property.listingStatus !== "PUBLISHED") {
      return res.status(404).json({ ok: false, message: "Property not found" });
    }

    const cached = (property as any).intelligence;
    const cachedAt = (property as any).intelligenceUpdatedAt
      ? new Date((property as any).intelligenceUpdatedAt)
      : null;

    const cacheFresh =
      cached &&
      (cached as any).version === "property-intelligence-v17" &&
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

    if (intelligenceBuildsInProgress.has(id)) {
      return res.status(202).json({
        ok: false,
        pending: true,
        message: "Property intelligence is currently being generated. Please retry shortly.",
      });
    }

    intelligenceBuildsInProgress.add(id);

    try {
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
            lat: Number.isFinite(placeLat) ? placeLat : null,
            lng: Number.isFinite(placeLng) ? placeLng : null,
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

    function textForPlace(item: any) {
      return [item?.name, item?.address, item?.vicinity, item?.type]
        .map(safeText)
        .join(" ")
        .toLowerCase();
    }

    function placeHasAny(item: any, terms: string[]) {
      const text = textForPlace(item);
      return terms.some((term) => text.includes(term.toLowerCase()));
    }

    function excludePlaceTerms(items: any[], terms: string[]) {
      return asArray(items).filter((item) => !placeHasAny(item, terms));
    }

    const foodContaminationTerms = [
      "park", "playground", "green", "garden", "beach",
      "school", "college", "academy", "church",
      "clinic", "medical", "pharmacy", "chemist", "dentist",
      "gym", "fitness", "leisure", "museum", "gallery",
      "theatre", "library", "hall", "studio"
    ];

    function cleanFoodPlaces(items: any[]) {
      return excludePlaceTerms(items, foodContaminationTerms);
    }

    function normalisePoiKey(value: any) {
      return safeText(value)
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/\b(ltd|limited|ireland|dublin|co|county)\b/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    }

    function normaliseFitnessName(name: any) {
      const text = safeText(name).trim();
      const key = normalisePoiKey(text);

      if (!key) return "";

      if (key.includes("west wood")) return "West Wood Club";
      if (key.includes("ucd") && (key.includes("sport") || key.includes("fitness") || key.includes("swimming"))) return "UCD Sports Campus";
      if (key.includes("dlr leisure")) return "DLR Leisure";
      if (key.includes("fitzpatrick")) return "The Club at Fitzpatrick's";
      if (key.includes("tullyvale")) return "Tullyvale Leisure Centre";
      if (key.includes("gym plus")) return "Gym Plus";
      if (key.includes("flyefit")) return "Flyefit";
      if (key.includes("anytime fitness")) return "Anytime Fitness";
      if (key.includes("ben dunne")) return "Ben Dunne Gym";
      if (key.includes("iconic health")) return "Iconic Health Clubs";
      if (key.includes("trinity") && key.includes("sport")) return "Trinity Sports Centre";

      return text.replace(/\s+/g, " ").trim();
    }

    function classifyFitnessType(item: any) {
      const key = normalisePoiKey([item?.name, item?.address].map(safeText).join(" "));

      if (key.includes("swimming") || key.includes("pool")) return "Swimming pool";
      if (key.includes("leisure")) return "Leisure centre";
      if (key.includes("sports") || key.includes("sport") || key.includes("club")) return "Sports club";
      if (key.includes("yoga") || key.includes("pilates")) return "Yoga / pilates";
      if (key.includes("gym") || key.includes("fitness") || key.includes("fit")) return "Gym / fitness";
      return "Fitness / sport";
    }

    function classifyFoodType(item: any) {
      const key = normalisePoiKey([item?.name, item?.address].map(safeText).join(" "));

      if (key.includes("pub") || key.includes("bar") || key.includes("gastropub")) return "Pub / bar";
      if (key.includes("cafe") || key.includes("coffee") || key.includes("espresso") || key.includes("bakery") || key.includes("patisserie") || key.includes("brunch")) return "Cafe / coffee";
      if (key.includes("restaurant") || key.includes("bistro") || key.includes("dining") || key.includes("kitchen")) return "Restaurant";
      return "Food / coffee";
    }

    function classifyCultureType(item: any) {
      const key = normalisePoiKey([item?.name, item?.address].map(safeText).join(" "));

      if (key.includes("cinema") || key.includes("odeon") || key.includes("imc")) return "Cinema";
      if (key.includes("theatre") || key.includes("performance") || key.includes("concert")) return "Theatre / performance";
      if (key.includes("museum") || key.includes("maritime")) return "Museum";
      if (key.includes("gallery") || key.includes("arts") || key.includes("studio") || key.includes("exhibition")) return "Arts / gallery";
      if (key.includes("library") || key.includes("lexicon")) return "Library / cultural centre";
      if (key.includes("heritage") || key.includes("castle") || key.includes("visitor")) return "Heritage / visitor attraction";
      return "Culture / entertainment";
    }

    function classifyParkType(item: any) {
      const key = normalisePoiKey([item?.name, item?.address].map(safeText).join(" "));

      if (key.includes("beach") || key.includes("seapoint")) return "Coastal / beach";
      if (key.includes("playground")) return "Playground";
      if (key.includes("garden")) return "Garden";
      if (key.includes("park") || key.includes("green")) return "Park / green space";
      return "Park / green space";
    }

    function enrichPoiItems(items: any[], classifier: (item: any) => string, group: string) {
      return asArray(items).map((item) => {
        const type = classifier(item);

        return {
          ...item,
          type,
          category: type,
          group,
        };
      });
    }

    function dedupeByDisplayName(items: any[], displayNamePicker: (item: any) => string) {
      const best = new Map<string, any>();

      for (const item of asArray(items)) {
        const displayName = displayNamePicker(item) || safeText(item?.name).trim();
        const key = normalisePoiKey(displayName);
        if (!key) continue;

        const next = {
          ...item,
          name: displayName,
        };

        const existing = best.get(key);
        const existingDistance = Number(existing?.distanceKm);
        const nextDistance = Number(next?.distanceKm);

        if (
          !existing ||
          (Number.isFinite(nextDistance) && (!Number.isFinite(existingDistance) || nextDistance < existingDistance))
        ) {
          best.set(key, next);
        }
      }

      return Array.from(best.values()).sort((a, b) => {
        const ad = Number.isFinite(Number(a.distanceKm)) ? Number(a.distanceKm) : 9999;
        const bd = Number.isFinite(Number(b.distanceKm)) ? Number(b.distanceKm) : 9999;
        return ad - bd;
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
      rawSchools,
      rawSecondarySchools,
      rawCommunitySchools,
      rawPostPrimarySchools,
      transport,
      transportV3,
      rawGrocery,
      rawPharmacies,
      rawPostOffices,
      rawBanks,
      rawAtms,
      rawDryCleaners,
      rawLibraries,
      rawParcelServices,
      rawRetail,
      rawHospitals,
      rawGpClinics,
      rawDental,
      rawSpecialists,
      rawUrgentCare,
      parks,
      rawCafes,
      rawRestaurants,
      rawPubs,
      gyms,
      rawCultureCore,
      rawCultureLibrary,
      rawCultureCinema,
      rawCultureHeritage,
      rawChildcare,
    ] = await Promise.all([
      nearby("school", 20, "school"),
      nearby("secondary school", 20, "school"),
      nearby("community school community college", 20, "school"),
      nearby("post primary school coláiste college", 20, "school"),
      nearbyTransport(20),
      Promise.race([
        getTransportIntelligence(lat, lng, 30),
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 15000)),
      ]),
      nearby("supermarket grocery convenience store", 20),
      nearby("pharmacy chemist boots lloyds", 20, "pharmacy"),
      nearby("post office an post", 10),
      nearby("bank credit union", 10, "bank"),
      nearby("atm cash machine", 10, "atm"),
      nearby("dry cleaner laundrette laundry", 10),
      nearby("library public library", 10, "library"),
      nearby("parcel locker courier post office", 10),
      nearby("shopping centre retail park market department store", 20),
      nearby("hospital emergency department university hospital private hospital", 20, "hospital"),
      nearby("doctor GP medical centre family practice primary care clinic", 20),
      nearby("dentist orthodontist dental clinic", 20),
      nearby("physiotherapy physiotherapist sports injury clinic chiropractor therapy clinic", 20),
      nearby("urgent care walk in clinic out of hours doctor swiftcare", 20),
      nearby("park beach green space playground garden", 20, "park"),
      nearby("cafe coffee bakery brunch patisserie", 20, "cafe"),
      nearby("restaurant bistro dining", 20, "restaurant"),
      nearby("pub bar gastropub", 12, "bar"),
      nearby("gym leisure centre fitness sports club swimming pool yoga pilates", 20, "gym"),
      nearby("theatre museum gallery arts centre music venue cultural centre concert hall performance exhibition", 20),
      nearby("library public library lexicon civic arts community centre", 20, "library"),
      nearby("cinema film theatre entertainment venue", 20, "movie_theater"),
      nearby("heritage maritime visitor centre historic attraction museum", 20),
      nearby("childcare creche preschool", 20, "school"),
    ]);

    const allSchoolResults = dedupeSchoolPlaces([
      ...rawSchools,
      ...rawSecondarySchools,
      ...rawCommunitySchools,
      ...rawPostPrimarySchools,
    ]);

    const allClassifiedSchools = dedupeSchoolPlaces(classifySchoolPlaces(allSchoolResults));
    const rawClassifiedChildcare = dedupeSchoolPlaces(
      classifySchoolPlaces(rawChildcare, "CHILDCARE")
    );

    const primarySchools = nearestPlaces(
      allClassifiedSchools.filter((item) => classifySchoolType(item) === "PRIMARY"),
      10
    );
    const secondarySchools = nearestPlaces(
      allClassifiedSchools.filter((item) => classifySchoolType(item) === "SECONDARY"),
      10
    );
    const schoolChildcare = nearestPlaces(
      allClassifiedSchools.filter((item) => classifySchoolType(item) === "CHILDCARE"),
      10
    );
    const childcare = nearestPlaces([...rawClassifiedChildcare, ...schoolChildcare], 10);
    const schools = nearestPlaces([...primarySchools, ...secondarySchools], 20);
    const schoolGroups = {
      primary: primarySchools,
      secondary: secondarySchools,
      childcare,
    };

    const groceryPlaces = nearestPlaces(dedupePlaces(rawGrocery), 20);
    const pharmacyPlaces = nearestPlaces(dedupePlaces(rawPharmacies), 12);
    const dailyServicePlaces = nearestPlaces(
      dedupePlaces([
        ...rawPostOffices,
        ...rawBanks,
        ...rawAtms,
        ...rawDryCleaners,
        ...rawLibraries,
        ...rawParcelServices,
      ]),
      20
    );
    const retailPlaces = nearestPlaces(dedupePlaces(rawRetail), 12);

    const convenienceGroups = {
      grocery: groceryPlaces,
      pharmacy: pharmacyPlaces,
      dailyServices: dailyServicePlaces,
      retail: retailPlaces,
    };

    const hospitalPlaces = nearestPlaces(dedupePlaces(rawHospitals), 12);
    const gpClinicPlaces = nearestPlaces(dedupePlaces(rawGpClinics), 12);
    const dentalPlaces = nearestPlaces(dedupePlaces(rawDental), 12);
    const specialistPlaces = nearestPlaces(dedupePlaces(rawSpecialists), 12);
    const urgentCarePlaces = nearestPlaces(dedupePlaces(rawUrgentCare), 12);

    const healthcareGroups = {
      hospitals: hospitalPlaces,
      gps: gpClinicPlaces,
      dental: dentalPlaces,
      specialists: specialistPlaces,
      urgentCare: urgentCarePlaces,
    };

    const healthcare = nearestPlaces([
      ...hospitalPlaces,
      ...gpClinicPlaces,
      ...dentalPlaces,
      ...specialistPlaces,
      ...urgentCarePlaces,
    ], 30);

    const parkPlaces = nearestPlaces(
      dedupeByDisplayName(
        enrichPoiItems(dedupePlaces(parks), classifyParkType, "parks"),
        (item) => safeText(item?.name).trim()
      ),
      12
    );

    const fitnessPlaces = nearestPlaces(
      dedupeByDisplayName(
        enrichPoiItems(dedupePlaces(gyms), classifyFitnessType, "fitness"),
        (item) => normaliseFitnessName(item?.name) || safeText(item?.name).trim()
      ),
      12
    );

    const cafePlaces = nearestPlaces(
      dedupeByDisplayName(
        enrichPoiItems(dedupePlaces(cleanFoodPlaces(rawCafes)), classifyFoodType, "cafes"),
        (item) => safeText(item?.name).trim()
      ),
      10
    );
    const restaurantPlaces = nearestPlaces(
      dedupeByDisplayName(
        enrichPoiItems(dedupePlaces(cleanFoodPlaces(rawRestaurants)), classifyFoodType, "restaurants"),
        (item) => safeText(item?.name).trim()
      ),
      10
    );
    const pubPlaces = nearestPlaces(
      dedupeByDisplayName(
        enrichPoiItems(dedupePlaces(cleanFoodPlaces(rawPubs)), classifyFoodType, "pubs"),
        (item) => safeText(item?.name).trim()
      ),
      8
    );
    const foodCoffeePlaces = nearestPlaces(
      dedupeByDisplayName(
        [
          ...cafePlaces,
          ...restaurantPlaces,
          ...pubPlaces,
        ],
        (item) => safeText(item?.name).trim()
      ),
      20
    );

    const culturePlaces = nearestPlaces(
      dedupeByDisplayName(
        enrichPoiItems(
          dedupePlaces([
            ...rawCultureCore,
            ...rawCultureLibrary,
            ...rawCultureCinema,
            ...rawCultureHeritage,
          ]),
          classifyCultureType,
          "culture"
        ),
        (item) => safeText(item?.name).trim()
      ),
      16
    );

    const lifestyleGroups = {
      parks: parkPlaces,
      fitness: fitnessPlaces,
      food: foodCoffeePlaces,
      foodCoffee: foodCoffeePlaces,
      foodCoffeeGroups: {
        cafes: cafePlaces,
        restaurants: restaurantPlaces,
        pubs: pubPlaces,
      },
      culture: culturePlaces,
    };

    const lifestyle = nearestPlaces([
      ...parkPlaces,
      ...fitnessPlaces,
      ...foodCoffeePlaces,
      ...culturePlaces,
    ], 30);

    const shopping = groceryPlaces;

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
    if (schools.length) insightParts.push(`${primarySchools.length} primary and ${secondarySchools.length} secondary school result${schools.length === 1 ? "" : "s"} found in the local school scan.`);
    if (transport.length) insightParts.push(`${transport.length} transport-related result${transport.length === 1 ? "" : "s"} found nearby.`);
    if (shopping.length) insightParts.push(`${shopping.length} grocery/convenience result${shopping.length === 1 ? "" : "s"} found nearby, with duplicate-chain inflation reduced in the convenience score.`);
    if (healthcare.length) insightParts.push(`${healthcare.length} healthcare-related result${healthcare.length === 1 ? "" : "s"} found nearby.`);
    if (lifestyle.length) insightParts.push(`${lifestyle.length} lifestyle result${lifestyle.length === 1 ? "" : "s"} found across parks, fitness, food/coffee and culture.`);

    const insight =
      insightParts.length
        ? insightParts.join(" ")
        : "HAVN found enough property and location data to support an initial viewing decision, but users should verify local amenities before committing.";

    const areaScores = calculateAreaScores({
      schools,
      transport,
      transportV3,
      shopping,
      convenienceGroups,
      healthcare,
      healthcareGroups,
      lifestyle,
      lifestyleGroups,
      parks,
      restaurants: foodCoffeePlaces,
      gyms,
      childcare,
    });

    const intelligence = {
      version: "property-intelligence-v17",
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
        schoolGroups,
        transport,
        transportV3,
        shopping,
        convenienceGroups,
        healthcare,
        healthcareGroups,
        lifestyle,
        lifestyleGroups,
        parks,
        restaurants: foodCoffeePlaces,
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
    } finally {
      intelligenceBuildsInProgress.delete(id);
    }
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
      if (!user || !isOwner(user, property.userId)) {
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
      if (!user || !isOwner(user, property.userId)) {
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
        photoMeta: payload.photoMeta !== undefined ? (payload.photoMeta as any) : undefined,
        photoMetaUpdatedAt: payload.photoMeta !== undefined ? new Date() : null,
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
    const id = toPositiveSafeInt(req.params.id);

    if (id === null) {
      return res.status(400).json({
        ok: false,
        message: "Invalid property id",
      });
    }

    const user = req.user;
    const existing = await prisma.property.findUnique({ where: { id } });

    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });
    if (!isOwner(user, existing.userId)) return res.status(403).json({ ok: false, message: "Forbidden" });

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
        photoMeta:
          payload.photoMeta !== undefined
            ? (payload.photoMeta as any)
            : (existing as any).photoMeta,
        photoMetaUpdatedAt:
          payload.photoMeta !== undefined
            ? new Date()
            : (existing as any).photoMetaUpdatedAt,
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

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("PATCH /properties/:id error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.post("/:id/submit", requireAuth, requireVerifiedEmail, async (req: any, res) => {
  try {
    const id = toPositiveSafeInt(req.params.id);

    if (id === null) {
      return res.status(400).json({
        ok: false,
        message: "Invalid property id",
      });
    }

    const user = req.user;
    const existing = await prisma.property.findUnique({ where: { id } });

    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });
    if (!isOwner(user, existing.userId)) return res.status(403).json({ ok: false, message: "Forbidden" });

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