// src/routes/adminAnalytics.ts

import {
  AnalyticsEventType,
  Prisma,
} from "@prisma/client";
import { Router } from "express";

import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth";
import requireAdminAuth from "../middleware/adminAuth";

const router = Router();

/*
 * Every route in this file requires:
 * 1. A valid authenticated user.
 * 2. An administrator account.
 */
router.use(requireAuth, requireAdminAuth);

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const FUNNEL_EVENT_TYPES: AnalyticsEventType[] = [
  AnalyticsEventType.SEARCH,
  AnalyticsEventType.FEATURED_CLICK,
  AnalyticsEventType.PROPERTY_VIEW,
  AnalyticsEventType.PROPERTY_SAVE,
  AnalyticsEventType.PROPERTY_CONTACT,
];

type EventCounts = Record<
  AnalyticsEventType,
  number
>;

function positiveInteger(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  const parsed = Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0
  ) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

function startOfUtcDay(value: Date): Date {
  const result = new Date(value);

  result.setUTCHours(0, 0, 0, 0);

  return result;
}

function getDateRange(days: number) {
  const end = new Date();

  const start = startOfUtcDay(end);
  start.setUTCDate(
    start.getUTCDate() - (days - 1),
  );

  const previousEnd = new Date(start);

  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(
    previousStart.getUTCDate() - days,
  );

  return {
    start,
    end,
    previousStart,
    previousEnd,
  };
}

function percentage(
  numerator: number,
  denominator: number,
): number {
  if (!denominator) {
    return 0;
  }

  return Number(
    ((numerator / denominator) * 100).toFixed(1),
  );
}

function percentageChange(
  current: number,
  previous: number,
): number | null {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }

  return Number(
    (
      ((current - previous) / previous) *
      100
    ).toFixed(1),
  );
}

function uniqueStringCount(
  values: Array<string | null | undefined>,
): number {
  return new Set(
    values.filter(
      (value): value is string =>
        typeof value === "string" &&
        Boolean(value),
    ),
  ).size;
}

function emptyEventCounts(): EventCounts {
  return {
    SEARCH: 0,
    PROPERTY_VIEW: 0,
    PROPERTY_SAVE: 0,
    PROPERTY_CONTACT: 0,
    SEARCH_SAVE: 0,
    FEATURED_CLICK: 0,
    PROPERTY_SHARE: 0,
  };
}

function classifyDevice(
  userAgent: string | null,
): string {
  const ua = String(userAgent || "")
    .trim()
    .toLowerCase();

  if (!ua) {
    return "Unknown";
  }

  if (
    /ipad|tablet|kindle|silk|playbook/.test(
      ua,
    )
  ) {
    return "Tablet";
  }

  if (
    /mobi|iphone|ipod|android|blackberry|opera mini|iemobile/.test(
      ua,
    )
  ) {
    return "Mobile";
  }

  return "Desktop";
}

function classifyReferrer(
  referrer: string | null,
): string {
  if (!referrer) {
    return "Direct";
  }

  try {
    const hostname = new URL(
      referrer,
    ).hostname.toLowerCase();

    if (!hostname) {
      return "Direct";
    }

    if (
      hostname === "havn.ie" ||
      hostname.endsWith(".havn.ie") ||
      hostname === "havn-new.onrender.com"
    ) {
      return "Internal";
    }

    if (hostname.includes("google.")) {
      return "Google";
    }

    if (hostname.includes("bing.")) {
      return "Bing";
    }

    if (
      hostname.includes("facebook.") ||
      hostname.includes("fb.")
    ) {
      return "Facebook";
    }

    if (hostname.includes("instagram.")) {
      return "Instagram";
    }

    if (hostname.includes("linkedin.")) {
      return "LinkedIn";
    }

    if (
      hostname === "t.co" ||
      hostname.includes("twitter.") ||
      hostname === "x.com" ||
      hostname.endsWith(".x.com")
    ) {
      return "X / Twitter";
    }

    if (hostname.includes("reddit.")) {
      return "Reddit";
    }

    if (hostname.includes("youtube.")) {
      return "YouTube";
    }

    return hostname.replace(/^www\./, "");
  } catch {
    return "Other";
  }
}

function asPayloadRecord(
  value: Prisma.JsonValue | null,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value as Record<string, unknown>;
}

function firstText(
  payload: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = payload[key];

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim().slice(0, 250);
    }
  }

  return null;
}

function firstNumber(
  payload: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = payload[key];

    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      continue;
    }

    const parsed = Number(value);

    if (
      Number.isFinite(parsed) &&
      parsed >= 0
    ) {
      return parsed;
    }
  }

  return null;
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/*
 * GET /api/admin/analytics/overview
 *
 * Main KPI cards, device mix and referrer mix.
 */
router.get(
  "/overview",
  async (req, res) => {
    try {
      const days = positiveInteger(
        req.query.days,
        DEFAULT_DAYS,
        MAX_DAYS,
      );

      const {
        start,
        end,
        previousStart,
        previousEnd,
      } = getDateRange(days);

      const [
        currentEvents,
        previousEvents,
      ] = await Promise.all([
        prisma.analyticsEvent.findMany({
          where: {
            createdAt: {
              gte: start,
              lte: end,
            },
          },
          select: {
            eventType: true,
            sessionId: true,
            referrer: true,
            userAgent: true,
            userId: true,
          },
        }),

        prisma.analyticsEvent.findMany({
          where: {
            createdAt: {
              gte: previousStart,
              lt: previousEnd,
            },
          },
          select: {
            eventType: true,
            sessionId: true,
            userId: true,
          },
        }),
      ]);

      const currentCounts =
        emptyEventCounts();

      const previousCounts =
        emptyEventCounts();

      for (const event of currentEvents) {
        currentCounts[event.eventType] += 1;
      }

      for (const event of previousEvents) {
        previousCounts[event.eventType] += 1;
      }

      const sessions = uniqueStringCount(
        currentEvents.map(
          (event) => event.sessionId,
        ),
      );

      const previousSessions =
        uniqueStringCount(
          previousEvents.map(
            (event) => event.sessionId,
          ),
        );

      const authenticatedUsers = new Set(
        currentEvents
          .map((event) => event.userId)
          .filter(
            (value): value is number =>
              Number.isSafeInteger(value),
          ),
      ).size;

      const deviceCounts =
        new Map<string, number>();

      const referrerCounts =
        new Map<string, number>();

      for (const event of currentEvents) {
        const device = classifyDevice(
          event.userAgent,
        );

        deviceCounts.set(
          device,
          (deviceCounts.get(device) || 0) + 1,
        );

        const referrer = classifyReferrer(
          event.referrer,
        );

        referrerCounts.set(
          referrer,
          (referrerCounts.get(referrer) ||
            0) + 1,
        );
      }

      const devices = Array.from(
        deviceCounts.entries(),
      )
        .map(([name, count]) => ({
          name,
          count,
          share: percentage(
            count,
            currentEvents.length,
          ),
        }))
        .sort(
          (a, b) => b.count - a.count,
        );

      const referrers = Array.from(
        referrerCounts.entries(),
      )
        .map(([name, count]) => ({
          name,
          count,
          share: percentage(
            count,
            currentEvents.length,
          ),
        }))
        .sort(
          (a, b) => b.count - a.count,
        )
        .slice(0, 12);

      return res.json({
        ok: true,

        range: {
          days,
          start: start.toISOString(),
          end: end.toISOString(),
          previousStart:
            previousStart.toISOString(),
          previousEnd:
            previousEnd.toISOString(),
        },

        kpis: {
          sessions: {
            value: sessions,
            previous: previousSessions,
            changePercent:
              percentageChange(
                sessions,
                previousSessions,
              ),
          },

          propertyViews: {
            value:
              currentCounts.PROPERTY_VIEW,
            previous:
              previousCounts.PROPERTY_VIEW,
            changePercent:
              percentageChange(
                currentCounts.PROPERTY_VIEW,
                previousCounts.PROPERTY_VIEW,
              ),
          },

          featuredClicks: {
            value:
              currentCounts.FEATURED_CLICK,
            previous:
              previousCounts.FEATURED_CLICK,
            changePercent:
              percentageChange(
                currentCounts.FEATURED_CLICK,
                previousCounts.FEATURED_CLICK,
              ),
          },

          contacts: {
            value:
              currentCounts.PROPERTY_CONTACT,
            previous:
              previousCounts.PROPERTY_CONTACT,
            changePercent:
              percentageChange(
                currentCounts.PROPERTY_CONTACT,
                previousCounts.PROPERTY_CONTACT,
              ),
          },

          saves: {
            value:
              currentCounts.PROPERTY_SAVE,
            previous:
              previousCounts.PROPERTY_SAVE,
            changePercent:
              percentageChange(
                currentCounts.PROPERTY_SAVE,
                previousCounts.PROPERTY_SAVE,
              ),
          },

          searches: {
            value: currentCounts.SEARCH,
            previous: previousCounts.SEARCH,
            changePercent:
              percentageChange(
                currentCounts.SEARCH,
                previousCounts.SEARCH,
              ),
          },
        },

        totals: {
          events: currentEvents.length,
          authenticatedUsers,
        },

        rates: {
          viewToContact: percentage(
            currentCounts.PROPERTY_CONTACT,
            currentCounts.PROPERTY_VIEW,
          ),

          viewToSave: percentage(
            currentCounts.PROPERTY_SAVE,
            currentCounts.PROPERTY_VIEW,
          ),

          featuredClickToView: percentage(
            currentCounts.PROPERTY_VIEW,
            currentCounts.FEATURED_CLICK,
          ),
        },

        devices,
        referrers,
      });
    } catch (error) {
      console.error(
        "GET /api/admin/analytics/overview error:",
        error,
      );

      return res.status(500).json({
        ok: false,
        error:
          "FAILED_TO_LOAD_ANALYTICS_OVERVIEW",
      });
    }
  },
);

/*
 * GET /api/admin/analytics/timeline
 *
 * Daily activity used by the dashboard line and bar charts.
 */
router.get(
  "/timeline",
  async (req, res) => {
    try {
      const days = positiveInteger(
        req.query.days,
        DEFAULT_DAYS,
        MAX_DAYS,
      );

      const { start, end } =
        getDateRange(days);

      const events =
        await prisma.analyticsEvent.findMany({
          where: {
            createdAt: {
              gte: start,
              lte: end,
            },
          },
          select: {
            createdAt: true,
            eventType: true,
            sessionId: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        });

      const buckets = new Map<
        string,
        {
          date: string;
          counts: EventCounts;
          sessions: Set<string>;
        }
      >();

      for (
        let offset = 0;
        offset < days;
        offset += 1
      ) {
        const day = new Date(start);

        day.setUTCDate(
          day.getUTCDate() + offset,
        );

        const key = dateKey(day);

        buckets.set(key, {
          date: key,
          counts: emptyEventCounts(),
          sessions: new Set<string>(),
        });
      }

      for (const event of events) {
        const key = dateKey(
          event.createdAt,
        );

        const bucket = buckets.get(key);

        if (!bucket) {
          continue;
        }

        bucket.counts[event.eventType] += 1;

        bucket.sessions.add(
          event.sessionId,
        );
      }

      return res.json({
        ok: true,

        range: {
          days,
          start: start.toISOString(),
          end: end.toISOString(),
        },

        items: Array.from(
          buckets.values(),
        ).map((bucket) => ({
          date: bucket.date,
          sessions:
            bucket.sessions.size,
          searches:
            bucket.counts.SEARCH,
          propertyViews:
            bucket.counts.PROPERTY_VIEW,
          featuredClicks:
            bucket.counts.FEATURED_CLICK,
          saves:
            bucket.counts.PROPERTY_SAVE,
          contacts:
            bucket.counts.PROPERTY_CONTACT,
          shares:
            bucket.counts.PROPERTY_SHARE,
        })),
      });
    } catch (error) {
      console.error(
        "GET /api/admin/analytics/timeline error:",
        error,
      );

      return res.status(500).json({
        ok: false,
        error:
          "FAILED_TO_LOAD_ANALYTICS_TIMELINE",
      });
    }
  },
);

/*
 * GET /api/admin/analytics/properties
 *
 * Property performance table.
 */
router.get(
  "/properties",
  async (req, res) => {
    try {
      const days = positiveInteger(
        req.query.days,
        DEFAULT_DAYS,
        MAX_DAYS,
      );

      const limit = positiveInteger(
        req.query.limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
      );

      const { start, end } =
        getDateRange(days);

      const events =
        await prisma.analyticsEvent.findMany({
          where: {
            createdAt: {
              gte: start,
              lte: end,
            },

            propertyId: {
              not: null,
            },

            eventType: {
              in: [
                AnalyticsEventType.PROPERTY_VIEW,
                AnalyticsEventType.FEATURED_CLICK,
                AnalyticsEventType.PROPERTY_SAVE,
                AnalyticsEventType.PROPERTY_CONTACT,
                AnalyticsEventType.PROPERTY_SHARE,
              ],
            },
          },

          select: {
            propertyId: true,
            eventType: true,
            sessionId: true,
          },
        });

      const propertyMap = new Map<
        number,
        {
          propertyId: number;
          views: number;
          featuredClicks: number;
          saves: number;
          contacts: number;
          shares: number;
          sessions: Set<string>;
        }
      >();

      for (const event of events) {
        if (!event.propertyId) {
          continue;
        }

        if (
          !propertyMap.has(
            event.propertyId,
          )
        ) {
          propertyMap.set(
            event.propertyId,
            {
              propertyId:
                event.propertyId,
              views: 0,
              featuredClicks: 0,
              saves: 0,
              contacts: 0,
              shares: 0,
              sessions:
                new Set<string>(),
            },
          );
        }

        const row = propertyMap.get(
          event.propertyId,
        )!;

        row.sessions.add(
          event.sessionId,
        );

        if (
          event.eventType ===
          AnalyticsEventType.PROPERTY_VIEW
        ) {
          row.views += 1;
        }

        if (
          event.eventType ===
          AnalyticsEventType.FEATURED_CLICK
        ) {
          row.featuredClicks += 1;
        }

        if (
          event.eventType ===
          AnalyticsEventType.PROPERTY_SAVE
        ) {
          row.saves += 1;
        }

        if (
          event.eventType ===
          AnalyticsEventType.PROPERTY_CONTACT
        ) {
          row.contacts += 1;
        }

        if (
          event.eventType ===
          AnalyticsEventType.PROPERTY_SHARE
        ) {
          row.shares += 1;
        }
      }

      const ranked = Array.from(
        propertyMap.values(),
      )
        .sort((a, b) => {
          if (
            b.contacts !== a.contacts
          ) {
            return (
              b.contacts - a.contacts
            );
          }

          if (b.views !== a.views) {
            return b.views - a.views;
          }

          return (
            b.featuredClicks -
            a.featuredClicks
          );
        })
        .slice(0, limit);

      const propertyIds = ranked.map(
        (row) => row.propertyId,
      );

      const properties =
        propertyIds.length > 0
          ? await prisma.property.findMany({
              where: {
                id: {
                  in: propertyIds,
                },
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
                mode: true,
                price: true,
                listingStatus: true,
                listingPackage: true,
                isFeatured: true,
                featuredUntil: true,
              },
            })
          : [];

      const propertyDetails = new Map(
        properties.map((property) => [
          property.id,
          property,
        ]),
      );

      return res.json({
        ok: true,

        range: {
          days,
          start: start.toISOString(),
          end: end.toISOString(),
        },

        items: ranked.map((row) => {
          const property =
            propertyDetails.get(
              row.propertyId,
            );

          return {
            propertyId:
              row.propertyId,

            slug:
              property?.slug || null,

            title:
              property?.title ||
              "Deleted or unavailable property",

            address1:
              property?.address1 || null,

            address2:
              property?.address2 || null,

            city:
              property?.city || null,

            county:
              property?.county || null,

            eircode:
              property?.eircode || null,

            mode:
              property?.mode || null,

            price:
              property?.price || null,

            listingStatus:
              property?.listingStatus ||
              null,

            listingPackage:
              property?.listingPackage ||
              null,

            isFeatured:
              property?.isFeatured ||
              false,

            featuredUntil:
              property?.featuredUntil ||
              null,

            sessions:
              row.sessions.size,

            views:
              row.views,

            featuredClicks:
              row.featuredClicks,

            saves:
              row.saves,

            contacts:
              row.contacts,

            shares:
              row.shares,

            viewToContactRate:
              percentage(
                row.contacts,
                row.views,
              ),

            viewToSaveRate:
              percentage(
                row.saves,
                row.views,
              ),

            featuredClickToViewRate:
              percentage(
                row.views,
                row.featuredClicks,
              ),
          };
        }),
      });
    } catch (error) {
      console.error(
        "GET /api/admin/analytics/properties error:",
        error,
      );

      return res.status(500).json({
        ok: false,
        error:
          "FAILED_TO_LOAD_PROPERTY_ANALYTICS",
      });
    }
  },
);

/*
 * GET /api/admin/analytics/searches
 *
 * Search demand and zero-result intelligence.
 *
 * The frontend SEARCH event should preferably include fields such as:
 *
 * payload: {
 *   query: "Limerick",
 *   resultsCount: 12
 * }
 */
router.get(
  "/searches",
  async (req, res) => {
    try {
      const days = positiveInteger(
        req.query.days,
        DEFAULT_DAYS,
        MAX_DAYS,
      );

      const limit = positiveInteger(
        req.query.limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
      );

      const { start, end } =
        getDateRange(days);

      const events =
        await prisma.analyticsEvent.findMany({
          where: {
            createdAt: {
              gte: start,
              lte: end,
            },

            eventType:
              AnalyticsEventType.SEARCH,
          },

          select: {
            payload: true,
            sessionId: true,
            mode: true,
            locationId: true,
          },
        });

      const searchMap = new Map<
        string,
        {
          query: string;
          count: number;
          zeroResultCount: number;
          sessions: Set<string>;
          modes: Map<string, number>;
          locationIds: Set<number>;
        }
      >();

      let totalZeroResultSearches = 0;

      for (const event of events) {
        const payload =
          asPayloadRecord(
            event.payload,
          );

        const query =
          firstText(payload, [
            "query",
            "searchTerm",
            "term",
            "location",
            "locationName",
            "searchLocation",
            "destination",
          ]) || "Unspecified search";

        const key = query.toLowerCase();

        const resultCount =
          firstNumber(payload, [
            "resultsCount",
            "resultCount",
            "totalResults",
            "matches",
            "count",
          ]);

        if (!searchMap.has(key)) {
          searchMap.set(key, {
            query,
            count: 0,
            zeroResultCount: 0,
            sessions:
              new Set<string>(),
            modes:
              new Map<string, number>(),
            locationIds:
              new Set<number>(),
          });
        }

        const row = searchMap.get(key)!;

        row.count += 1;

        row.sessions.add(
          event.sessionId,
        );

        if (resultCount === 0) {
          row.zeroResultCount += 1;
          totalZeroResultSearches += 1;
        }

        if (event.mode) {
          const mode = String(
            event.mode,
          );

          row.modes.set(
            mode,
            (row.modes.get(mode) ||
              0) + 1,
          );
        }

        if (event.locationId) {
          row.locationIds.add(
            event.locationId,
          );
        }
      }

      const allItems = Array.from(
        searchMap.values(),
      ).map((row) => ({
        query:
          row.query,

        count:
          row.count,

        sessions:
          row.sessions.size,

        zeroResultCount:
          row.zeroResultCount,

        zeroResultRate:
          percentage(
            row.zeroResultCount,
            row.count,
          ),

        modes: Array.from(
          row.modes.entries(),
        )
          .map(([mode, count]) => ({
            mode,
            count,
          }))
          .sort(
            (a, b) =>
              b.count - a.count,
          ),

        locationIds: Array.from(
          row.locationIds,
        ),
      }));

      const items = [...allItems]
        .sort(
          (a, b) =>
            b.count - a.count,
        )
        .slice(0, limit);

      const zeroResultSearches = [
        ...allItems,
      ]
        .filter(
          (item) =>
            item.zeroResultCount > 0,
        )
        .sort((a, b) => {
          if (
            b.zeroResultCount !==
            a.zeroResultCount
          ) {
            return (
              b.zeroResultCount -
              a.zeroResultCount
            );
          }

          return b.count - a.count;
        })
        .slice(0, limit);

      return res.json({
        ok: true,

        range: {
          days,
          start: start.toISOString(),
          end: end.toISOString(),
        },

        totals: {
          searches:
            events.length,

          uniqueSearchTerms:
            searchMap.size,

          zeroResultSearches:
            totalZeroResultSearches,

          zeroResultRate:
            percentage(
              totalZeroResultSearches,
              events.length,
            ),
        },

        items,
        zeroResultSearches,
      });
    } catch (error) {
      console.error(
        "GET /api/admin/analytics/searches error:",
        error,
      );

      return res.status(500).json({
        ok: false,
        error:
          "FAILED_TO_LOAD_SEARCH_ANALYTICS",
      });
    }
  },
);

/*
 * GET /api/admin/analytics/funnel
 *
 * Session-level conversion funnel.
 */
router.get(
  "/funnel",
  async (req, res) => {
    try {
      const days = positiveInteger(
        req.query.days,
        DEFAULT_DAYS,
        MAX_DAYS,
      );

      const { start, end } =
        getDateRange(days);

      const events =
        await prisma.analyticsEvent.findMany({
          where: {
            createdAt: {
              gte: start,
              lte: end,
            },

            eventType: {
              in: FUNNEL_EVENT_TYPES,
            },
          },

          select: {
            eventType: true,
            sessionId: true,
          },
        });

      const sessionsByStage = new Map<
        AnalyticsEventType,
        Set<string>
      >();

      for (
        const eventType of FUNNEL_EVENT_TYPES
      ) {
        sessionsByStage.set(
          eventType,
          new Set<string>(),
        );
      }

      for (const event of events) {
        sessionsByStage
          .get(event.eventType)
          ?.add(event.sessionId);
      }

      const stages = [
        {
          key: "SEARCH",
          label: "Search",
          sessions:
            sessionsByStage.get(
              AnalyticsEventType.SEARCH,
            )?.size || 0,
        },

        {
          key: "FEATURED_CLICK",
          label: "Featured click",
          sessions:
            sessionsByStage.get(
              AnalyticsEventType.FEATURED_CLICK,
            )?.size || 0,
        },

        {
          key: "PROPERTY_VIEW",
          label: "Property view",
          sessions:
            sessionsByStage.get(
              AnalyticsEventType.PROPERTY_VIEW,
            )?.size || 0,
        },

        {
          key: "PROPERTY_SAVE",
          label: "Property save",
          sessions:
            sessionsByStage.get(
              AnalyticsEventType.PROPERTY_SAVE,
            )?.size || 0,
        },

        {
          key: "PROPERTY_CONTACT",
          label: "Property contact",
          sessions:
            sessionsByStage.get(
              AnalyticsEventType.PROPERTY_CONTACT,
            )?.size || 0,
        },
      ];

      return res.json({
        ok: true,

        range: {
          days,
          start: start.toISOString(),
          end: end.toISOString(),
        },

        stages: stages.map(
          (stage, index) => {
            const previous =
              index === 0
                ? null
                : stages[index - 1];

            return {
              ...stage,

              conversionFromPrevious:
                previous === null
                  ? 100
                  : percentage(
                      stage.sessions,
                      previous.sessions,
                    ),

              conversionFromSearch:
                percentage(
                  stage.sessions,
                  stages[0].sessions,
                ),
            };
          },
        ),
      });
    } catch (error) {
      console.error(
        "GET /api/admin/analytics/funnel error:",
        error,
      );

      return res.status(500).json({
        ok: false,
        error:
          "FAILED_TO_LOAD_ANALYTICS_FUNNEL",
      });
    }
  },
);

/*
 * GET /api/admin/analytics/geography
 *
 * Location-level analytics.
 */
router.get(
  "/geography",
  async (req, res) => {
    try {
      const days = positiveInteger(
        req.query.days,
        DEFAULT_DAYS,
        MAX_DAYS,
      );

      const limit = positiveInteger(
        req.query.limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
      );

      const { start, end } =
        getDateRange(days);

      const events =
        await prisma.analyticsEvent.findMany({
          where: {
            createdAt: {
              gte: start,
              lte: end,
            },

            locationId: {
              not: null,
            },
          },

          select: {
            locationId: true,
            eventType: true,
            sessionId: true,
          },
        });

      const locationMap = new Map<
        number,
        {
          locationId: number;
          events: number;
          searches: number;
          propertyViews: number;
          featuredClicks: number;
          saves: number;
          contacts: number;
          sessions: Set<string>;
        }
      >();

      for (const event of events) {
        if (!event.locationId) {
          continue;
        }

        if (
          !locationMap.has(
            event.locationId,
          )
        ) {
          locationMap.set(
            event.locationId,
            {
              locationId:
                event.locationId,

              events: 0,
              searches: 0,
              propertyViews: 0,
              featuredClicks: 0,
              saves: 0,
              contacts: 0,

              sessions:
                new Set<string>(),
            },
          );
        }

        const row = locationMap.get(
          event.locationId,
        )!;

        row.events += 1;

        row.sessions.add(
          event.sessionId,
        );

        if (
          event.eventType ===
          AnalyticsEventType.SEARCH
        ) {
          row.searches += 1;
        }

        if (
          event.eventType ===
          AnalyticsEventType.PROPERTY_VIEW
        ) {
          row.propertyViews += 1;
        }

        if (
          event.eventType ===
          AnalyticsEventType.FEATURED_CLICK
        ) {
          row.featuredClicks += 1;
        }

        if (
          event.eventType ===
          AnalyticsEventType.PROPERTY_SAVE
        ) {
          row.saves += 1;
        }

        if (
          event.eventType ===
          AnalyticsEventType.PROPERTY_CONTACT
        ) {
          row.contacts += 1;
        }
      }

      const ranked = Array.from(
        locationMap.values(),
      )
        .sort(
          (a, b) =>
            b.events - a.events,
        )
        .slice(0, limit);

      const locationIds = ranked.map(
        (row) => row.locationId,
      );

      const locations =
        locationIds.length > 0
          ? await prisma.location.findMany({
              where: {
                id: {
                  in: locationIds,
                },
              },

              select: {
                id: true,
                slug: true,
                name: true,
                canonicalName: true,
                displayName: true,
                type: true,
                county: true,
                latitude: true,
                longitude: true,
              },
            })
          : [];

      const locationDetails = new Map(
        locations.map((location) => [
          location.id,
          location,
        ]),
      );

      return res.json({
        ok: true,

        range: {
          days,
          start: start.toISOString(),
          end: end.toISOString(),
        },

        items: ranked.map((row) => {
          const location =
            locationDetails.get(
              row.locationId,
            );

          return {
            locationId:
              row.locationId,

            slug:
              location?.slug || null,

            name:
              location?.name ||
              "Unknown location",

            canonicalName:
              location?.canonicalName ||
              null,

            displayName:
              location?.displayName ||
              location?.name ||
              "Unknown location",

            type:
              location?.type || null,

            county:
              location?.county || null,

            latitude:
              location?.latitude || null,

            longitude:
              location?.longitude || null,

            events:
              row.events,

            sessions:
              row.sessions.size,

            searches:
              row.searches,

            propertyViews:
              row.propertyViews,

            featuredClicks:
              row.featuredClicks,

            saves:
              row.saves,

            contacts:
              row.contacts,

            viewToContactRate:
              percentage(
                row.contacts,
                row.propertyViews,
              ),
          };
        }),
      });
    } catch (error) {
      console.error(
        "GET /api/admin/analytics/geography error:",
        error,
      );

      return res.status(500).json({
        ok: false,
        error:
          "FAILED_TO_LOAD_GEOGRAPHIC_ANALYTICS",
      });
    }
  },
);

export default router;