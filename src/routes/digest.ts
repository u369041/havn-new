import { Router } from "express";
import { prisma } from "../lib/prisma";
import { sendHavnWeeklyDigestEmail } from "../lib/mail";

const router = Router();

const APP_URL = (process.env.APP_URL || "https://havn.ie").replace(/\/+$/, "");
const DIGEST_CRON_SECRET = process.env.DIGEST_CRON_SECRET || "";

const PRICE_DROP_ACTIVE_DAYS = 14;
const PRICE_DROP_ACTIVE_MS = PRICE_DROP_ACTIVE_DAYS * 24 * 60 * 60 * 1000;

function isAuthorised(req: any) {
  const auth = String(req.headers.authorization || "");
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerSecret = String(req.headers["x-digest-secret"] || "").trim();

  return !!DIGEST_CRON_SECRET && (bearer === DIGEST_CRON_SECRET || headerSecret === DIGEST_CRON_SECRET);
}

function safeStr(v: any, fallback = "") {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s || fallback;
}

function isActivePriceDrop(property: any) {
  const price = Number(property?.price || 0);
  const previousPrice = Number(property?.previousPrice || 0);
  const droppedAtRaw = property?.priceDroppedAt;

  if (!Number.isFinite(price) || !Number.isFinite(previousPrice)) return false;
  if (price <= 0 || previousPrice <= 0 || previousPrice <= price) return false;
  if (!droppedAtRaw) return false;

  const droppedAt = new Date(droppedAtRaw).getTime();

  if (!Number.isFinite(droppedAt)) return false;

  return Date.now() - droppedAt <= PRICE_DROP_ACTIVE_MS;
}

function modeFromFilters(filters: any) {
  const mode = safeStr(filters?.mode, "buy").toLowerCase();
  if (mode === "rent") return "RENT";
  if (mode === "share") return "SHARE";
  return "BUY";
}

function priceBandRange(priceKey: any, mode: any): [number | null, number | null] {
  const key = safeStr(priceKey, "");
  const m = safeStr(mode, "buy").toLowerCase();

  if (!key) return [null, null];

  if (m === "rent") {
    if (key === "under-1500") return [0, 1500];
    if (key === "1500-2500") return [1500, 2500];
    if (key === "2500-3500") return [2500, 3500];
    if (key === "3500-plus") return [3500, null];
  }

  if (m === "share") {
    if (key === "under-700") return [0, 700];
    if (key === "700-1000") return [700, 1000];
    if (key === "1000-1500") return [1000, 1500];
    if (key === "1500-plus") return [1500, null];
  }

  if (key === "under-300k") return [0, 300000];
  if (key === "300-500k") return [300000, 500000];
  if (key === "500-800k") return [500000, 800000];
  if (key === "800k-plus") return [800000, null];

  return [null, null];
}

function matchesSearch(filters: any, property: any) {
  const mode = safeStr(filters?.mode, "buy").toLowerCase();
  const wantedMode = modeFromFilters(filters);

  if (property.listingStatus !== "PUBLISHED") return false;
  if (safeStr(property.mode, "").toUpperCase() !== wantedMode) return false;

  const q = safeStr(filters?.q || filters?.location || filters?.county || filters?.city, "").toLowerCase();

  if (q) {
    const hay = [
      property.title,
      property.address1,
      property.address2,
      property.city,
      property.county,
      property.eircode,
      property.description,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (!hay.includes(q)) return false;
  }

  const wantedType = safeStr(filters?.type || filters?.propertyType, "").toUpperCase();

  if (wantedType && mode !== "share") {
    const actualType = safeStr(property.propertyType, "").toUpperCase();
    if (actualType && actualType !== wantedType) return false;
  }

  const bedsMin = Number(filters?.beds || filters?.bedrooms || "");
  if (Number.isFinite(bedsMin) && bedsMin > 0) {
    const beds = Number(property.bedrooms || "");
    if (!Number.isFinite(beds) || beds < bedsMin) return false;
  }

  const bathsMin = Number(filters?.baths || filters?.bathrooms || "");
  if (Number.isFinite(bathsMin) && bathsMin > 0) {
    const baths = Number(property.bathrooms || "");
    if (!Number.isFinite(baths) || baths < bathsMin) return false;
  }

  const [minPrice, maxPrice] = priceBandRange(filters?.price, mode);
  const price = Number(property.price || "");

  if (minPrice !== null && (!Number.isFinite(price) || price < minPrice)) return false;
  if (maxPrice !== null && (!Number.isFinite(price) || price > maxPrice)) return false;

  return true;
}

function propertyUrl(p: any) {
  return `${APP_URL}/property.html?slug=${encodeURIComponent(String(p.slug))}`;
}

function propertyLocation(p: any) {
  return [p.address1, p.city, p.county, p.eircode].filter(Boolean).join(", ");
}

function propertyImage(p: any) {
  return Array.isArray(p.photos) && p.photos.length ? p.photos[0] : null;
}

router.post("/run-weekly", async (req, res) => {
  try {
    if (!isAuthorised(req)) {
      return res.status(401).json({ ok: false, error: "UNAUTHORISED" });
    }

    const force = req.query.force === "1" || req.body?.force === true;
    const now = new Date();
    const weeklyCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const savedSearches = await prisma.savedSearch.findMany({
      where: {
        alertsEnabled: true,
        alertFrequency: "weekly",
      },
      include: {
        user: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const publishedProperties = await prisma.property.findMany({
      where: {
        listingStatus: "PUBLISHED",
      },
      orderBy: {
        publishedAt: "desc",
      },
      take: 500,
    });

    const featuredProperties = publishedProperties.filter((p) => {
      if (!p.isFeatured) return false;
      if (!p.featuredUntil) return true;
      return new Date(p.featuredUntil).getTime() > Date.now();
    });

    const activePriceDropProperties = publishedProperties.filter(isActivePriceDrop);

    const searchesByUser = new Map<number, typeof savedSearches>();

    for (const search of savedSearches) {
      if (!search.user || !search.user.email) continue;

      if (!force && search.lastDigestAt && search.lastDigestAt > weeklyCutoff) {
        continue;
      }

      const arr = searchesByUser.get(search.userId) || [];
      arr.push(search);
      searchesByUser.set(search.userId, arr);
    }

    let usersChecked = searchesByUser.size;
    let emailsSent = 0;
    let searchesUpdated = 0;
    let skippedNoMatches = 0;

    for (const [userId, searches] of searchesByUser.entries()) {
      const user = searches[0]?.user;
      if (!user?.email) continue;

      const digestSinceCandidates = searches
        .map((s) => s.lastDigestAt || s.createdAt)
        .filter(Boolean)
        .map((d) => new Date(d).getTime())
        .filter((t) => Number.isFinite(t));

      const digestSince = digestSinceCandidates.length
        ? new Date(Math.min(...digestSinceCandidates))
        : weeklyCutoff;

      const matched = new Map<number, any>();
      const matchedPriceDrops = new Map<number, any>();

      for (const search of searches) {
        const filters = search.filters || {};

        for (const property of publishedProperties) {
          const publishedAt = property.publishedAt || property.createdAt;

          if (!force && publishedAt && new Date(publishedAt).getTime() <= digestSince.getTime()) {
            continue;
          }

          if (matchesSearch(filters, property)) {
            matched.set(property.id, property);
          }
        }

        for (const property of activePriceDropProperties) {
          if (matchesSearch(filters, property)) {
            matchedPriceDrops.set(property.id, property);
            matched.set(property.id, property);
          }
        }
      }

      const matchedProperties = Array.from(matched.values())
        .sort((a, b) => {
          const ad = isActivePriceDrop(a) ? 1 : 0;
          const bd = isActivePriceDrop(b) ? 1 : 0;

          if (ad !== bd) return bd - ad;

          const af = a.isFeatured ? 1 : 0;
          const bf = b.isFeatured ? 1 : 0;

          if (af !== bf) return bf - af;

          const at = new Date(a.publishedAt || a.createdAt || 0).getTime();
          const bt = new Date(b.publishedAt || b.createdAt || 0).getTime();

          return bt - at;
        })
        .slice(0, 8);

      if (!matchedProperties.length) {
        skippedNoMatches += 1;

        await prisma.savedSearch.updateMany({
          where: {
            id: {
              in: searches.map((s) => s.id),
            },
          },
          data: {
            lastDigestAt: now,
          },
        });

        searchesUpdated += searches.length;
        continue;
      }

      const matchesUrl = `${APP_URL}/properties.html`;

      const sendResult = await sendHavnWeeklyDigestEmail({
        to: user.email,
        name: user.name || null,
        newMatchesCount: matched.size,
        featuredCount: featuredProperties.length,
        priceDropsCount: matchedPriceDrops.size,
        trendingAreasCount: 3,
        recentlyViewedCount: 0,
        matchesUrl,
        manageAlertsUrl: `${APP_URL}/my-listings.html`,
        properties: matchedProperties.slice(0, 4).map((p) => ({
          title: p.title,
          price: p.price,
          location: propertyLocation(p),
          beds: p.bedrooms,
          baths: p.bathrooms,
          url: propertyUrl(p),
          imageUrl: propertyImage(p),
          badge: isActivePriceDrop(p) ? "PRICE DROP" : "NEW",
        })),
      });

      if (sendResult) {
        emailsSent += 1;

        await prisma.savedSearch.updateMany({
          where: {
            id: {
              in: searches.map((s) => s.id),
            },
          },
          data: {
            lastDigestAt: now,
          },
        });

        searchesUpdated += searches.length;
      }
    }

    res.json({
      ok: true,
      mode: "weekly",
      force,
      usersChecked,
      emailsSent,
      searchesUpdated,
      skippedNoMatches,
      activePriceDrops: activePriceDropProperties.length,
    });
  } catch (err: any) {
    console.error("weekly digest failed:", err);
    res.status(500).json({
      ok: false,
      error: "DIGEST_FAILED",
      message: err?.message || "Unknown error",
    });
  }
});

export default router;