import {
  AnalyticsEventType,
  ListingStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma";

export interface AnalyticsOverviewOptions {
  userId: number;
  days?: number;
  timezone?: string;
}

type MetricTotals = {
  views: number;
  saves: number;
  enquiries: number;
  contacts: number;
  shares: number;
  featuredClicks: number;
};

type MetricComparison = {
  current: number;
  previous: number;
  change: number;
  changePercent: number | null;
};

type DailyTrendRow = {
  date: string;
  views: number;
  saves: number;
  enquiries: number;
  contacts: number;
  shares: number;
  featuredClicks: number;
};

const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 365;
const DEFAULT_TIMEZONE = "Europe/Dublin";
const TOP_LISTING_LIMIT = 10;

function normalizeDays(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_DAYS;
  }

  if (!Number.isFinite(value)) {
    return DEFAULT_DAYS;
  }

  return Math.min(
    MAX_DAYS,
    Math.max(MIN_DAYS, Math.trunc(value)),
  );
}

function normalizeTimezone(value: string | undefined): string {
  const timezone = String(value || DEFAULT_TIMEZONE).trim();

  try {
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
    }).format(new Date());

    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
    ),
  );
}

function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function dateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function emptyMetrics(): MetricTotals {
  return {
    views: 0,
    saves: 0,
    enquiries: 0,
    contacts: 0,
    shares: 0,
    featuredClicks: 0,
  };
}

function percentageChange(
  current: number,
  previous: number,
): number | null {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }

  return Number(
    (((current - previous) / previous) * 100).toFixed(1),
  );
}

function comparison(
  current: number,
  previous: number,
): MetricComparison {
  return {
    current,
    previous,
    change: current - previous,
    changePercent: percentageChange(current, previous),
  };
}

function safeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }

  return Number(((numerator / denominator) * 100).toFixed(2));
}

function buildDailyRows(
  periodStart: Date,
  periodEnd: Date,
  timezone: string,
): DailyTrendRow[] {
  const rows = new Map<string, DailyTrendRow>();

  for (
    let cursor = startOfUtcDay(periodStart);
    cursor < periodEnd;
    cursor = addUtcDays(cursor, 1)
  ) {
    const key = dateKey(cursor, timezone);

    if (!rows.has(key)) {
      rows.set(key, {
        date: key,
        ...emptyMetrics(),
      });
    }
  }

  return Array.from(rows.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

function incrementDailyMetric(
  rows: Map<string, DailyTrendRow>,
  createdAt: Date,
  timezone: string,
  metric: keyof MetricTotals,
) {
  const key = dateKey(createdAt, timezone);
  const row = rows.get(key);

  if (row) {
    row[metric] += 1;
  }
}

function incrementPropertyMetric(
  map: Map<number, MetricTotals>,
  propertyId: number,
  metric: keyof MetricTotals,
) {
  const current = map.get(propertyId) || emptyMetrics();
  current[metric] += 1;
  map.set(propertyId, current);
}

export async function getAnalyticsOverview(
  options: AnalyticsOverviewOptions,
) {
  const userId = Number(options.userId);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("A valid userId is required");
  }

  const days = normalizeDays(options.days);
  const timezone = normalizeTimezone(options.timezone);
  const generatedAt = new Date();
  const periodEnd = generatedAt;
  const periodStart = addUtcDays(periodEnd, -days);
  const previousPeriodStart = addUtcDays(periodStart, -days);

  const ownerPropertyWhere = {
    userId,
  } as const;

  const engagementEventTypes: AnalyticsEventType[] = [
    AnalyticsEventType.PROPERTY_VIEW,
    AnalyticsEventType.PROPERTY_CONTACT,
    AnalyticsEventType.PROPERTY_SHARE,
    AnalyticsEventType.FEATURED_CLICK,
  ];

  const [
    statusGroups,
    propertyTotals,
    featuredListings,
    paidListings,
    allOwnerProperties,
    currentEvents,
    previousEvents,
    currentSaves,
    previousSaves,
    currentEnquiries,
    previousEnquiries,
  ] = await Promise.all([
    prisma.property.groupBy({
      by: ["listingStatus"],
      where: ownerPropertyWhere,
      _count: {
        _all: true,
      },
    }),

    prisma.property.aggregate({
      where: ownerPropertyWhere,
      _count: {
        _all: true,
      },
      _sum: {
        views: true,
      },
      _avg: {
        views: true,
      },
    }),

    prisma.property.count({
      where: {
        ...ownerPropertyWhere,
        isFeatured: true,
      },
    }),

    prisma.property.count({
      where: {
        ...ownerPropertyWhere,
        paymentStatus: "COMPLETED",
      },
    }),

    prisma.property.findMany({
      where: ownerPropertyWhere,
      select: {
        id: true,
        slug: true,
        title: true,
        city: true,
        county: true,
        mode: true,
        listingStatus: true,
        isFeatured: true,
        views: true,
        publishedAt: true,
        createdAt: true,
        _count: {
          select: {
            savedBy: true,
            enquiries: true,
          },
        },
      },
      orderBy: [
        {
          views: "desc",
        },
        {
          createdAt: "desc",
        },
      ],
    }),

    prisma.analyticsEvent.findMany({
      where: {
        createdAt: {
          gte: periodStart,
          lt: periodEnd,
        },
        eventType: {
          in: engagementEventTypes,
        },
        property: {
          is: {
            userId,
          },
        },
      },
      select: {
        createdAt: true,
        eventType: true,
        propertyId: true,
      },
    }),

    prisma.analyticsEvent.findMany({
      where: {
        createdAt: {
          gte: previousPeriodStart,
          lt: periodStart,
        },
        eventType: {
          in: engagementEventTypes,
        },
        property: {
          is: {
            userId,
          },
        },
      },
      select: {
        eventType: true,
      },
    }),

    prisma.savedProperty.findMany({
      where: {
        createdAt: {
          gte: periodStart,
          lt: periodEnd,
        },
        property: {
          userId,
        },
      },
      select: {
        createdAt: true,
        propertyId: true,
      },
    }),

    prisma.savedProperty.findMany({
      where: {
        createdAt: {
          gte: previousPeriodStart,
          lt: periodStart,
        },
        property: {
          userId,
        },
      },
      select: {
        id: true,
      },
    }),

    prisma.enquiry.findMany({
      where: {
        createdAt: {
          gte: periodStart,
          lt: periodEnd,
        },
        property: {
          userId,
        },
      },
      select: {
        createdAt: true,
        propertyId: true,
      },
    }),

    prisma.enquiry.findMany({
      where: {
        createdAt: {
          gte: previousPeriodStart,
          lt: periodStart,
        },
        property: {
          userId,
        },
      },
      select: {
        id: true,
      },
    }),
  ]);

  const listingStatus: Record<ListingStatus, number> = {
    DRAFT: 0,
    SUBMITTED: 0,
    PUBLISHED: 0,
    REJECTED: 0,
    ARCHIVED: 0,
    CLOSED: 0,
  };

  for (const group of statusGroups) {
    listingStatus[group.listingStatus] = group._count._all;
  }

  const currentMetrics = emptyMetrics();
  const previousMetrics = emptyMetrics();
  const propertyPeriodMetrics = new Map<number, MetricTotals>();

  const dailyRows = buildDailyRows(
    periodStart,
    periodEnd,
    timezone,
  );
  const dailyRowMap = new Map(
    dailyRows.map((row) => [row.date, row]),
  );

  for (const event of currentEvents) {
    let metric: keyof MetricTotals | null = null;

    switch (event.eventType) {
      case AnalyticsEventType.PROPERTY_VIEW:
        metric = "views";
        break;
      case AnalyticsEventType.PROPERTY_CONTACT:
        metric = "contacts";
        break;
      case AnalyticsEventType.PROPERTY_SHARE:
        metric = "shares";
        break;
      case AnalyticsEventType.FEATURED_CLICK:
        metric = "featuredClicks";
        break;
      default:
        break;
    }

    if (!metric) {
      continue;
    }

    currentMetrics[metric] += 1;
    incrementDailyMetric(
      dailyRowMap,
      event.createdAt,
      timezone,
      metric,
    );

    if (event.propertyId !== null) {
      incrementPropertyMetric(
        propertyPeriodMetrics,
        event.propertyId,
        metric,
      );
    }
  }

  for (const event of previousEvents) {
    switch (event.eventType) {
      case AnalyticsEventType.PROPERTY_VIEW:
        previousMetrics.views += 1;
        break;
      case AnalyticsEventType.PROPERTY_CONTACT:
        previousMetrics.contacts += 1;
        break;
      case AnalyticsEventType.PROPERTY_SHARE:
        previousMetrics.shares += 1;
        break;
      case AnalyticsEventType.FEATURED_CLICK:
        previousMetrics.featuredClicks += 1;
        break;
      default:
        break;
    }
  }

  currentMetrics.saves = currentSaves.length;
  previousMetrics.saves = previousSaves.length;
  currentMetrics.enquiries = currentEnquiries.length;
  previousMetrics.enquiries = previousEnquiries.length;

  for (const save of currentSaves) {
    incrementDailyMetric(
      dailyRowMap,
      save.createdAt,
      timezone,
      "saves",
    );
    incrementPropertyMetric(
      propertyPeriodMetrics,
      save.propertyId,
      "saves",
    );
  }

  for (const enquiry of currentEnquiries) {
    incrementDailyMetric(
      dailyRowMap,
      enquiry.createdAt,
      timezone,
      "enquiries",
    );
    incrementPropertyMetric(
      propertyPeriodMetrics,
      enquiry.propertyId,
      "enquiries",
    );
  }

  const topListings = allOwnerProperties
    .map((property) => {
      const periodMetrics =
        propertyPeriodMetrics.get(property.id) || emptyMetrics();

      const periodInterest =
        periodMetrics.views +
        periodMetrics.saves +
        periodMetrics.enquiries +
        periodMetrics.contacts +
        periodMetrics.shares +
        periodMetrics.featuredClicks;

      return {
        id: property.id,
        slug: property.slug,
        title: property.title,
        location: [property.city, property.county]
          .filter(Boolean)
          .join(", "),
        mode: property.mode,
        listingStatus: property.listingStatus,
        isFeatured: property.isFeatured,
        publishedAt: property.publishedAt,
        lifetime: {
          views: property.views,
          saves: property._count.savedBy,
          enquiries: property._count.enquiries,
        },
        period: {
          ...periodMetrics,
          totalInterest: periodInterest,
          enquiryRate: safeRate(
            periodMetrics.enquiries,
            periodMetrics.views,
          ),
          saveRate: safeRate(
            periodMetrics.saves,
            periodMetrics.views,
          ),
        },
      };
    })
    .sort((a, b) => {
      if (b.period.totalInterest !== a.period.totalInterest) {
        return b.period.totalInterest - a.period.totalInterest;
      }

      return b.lifetime.views - a.lifetime.views;
    })
    .slice(0, TOP_LISTING_LIMIT);

  const totalListings = propertyTotals._count._all;
  const totalViews = propertyTotals._sum.views || 0;
  const totalSaves = allOwnerProperties.reduce(
    (sum, property) => sum + property._count.savedBy,
    0,
  );
  const totalEnquiries = allOwnerProperties.reduce(
    (sum, property) => sum + property._count.enquiries,
    0,
  );

  return {
    version: 1,
    generatedAt: generatedAt.toISOString(),

    period: {
      days,
      timezone,
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      previousStart: previousPeriodStart.toISOString(),
      previousEnd: periodStart.toISOString(),
    },

    current: {
      totalListings,
      publishedListings: listingStatus.PUBLISHED,
      draftListings: listingStatus.DRAFT,
      submittedListings: listingStatus.SUBMITTED,
      rejectedListings: listingStatus.REJECTED,
      archivedListings: listingStatus.ARCHIVED,
      closedListings: listingStatus.CLOSED,
      featuredListings,
      paidListings,
      totalViews,
      totalSaves,
      totalEnquiries,
      averageViewsPerListing: Number(
        (propertyTotals._avg.views || 0).toFixed(1),
      ),
      lifetimeEnquiryRate: safeRate(totalEnquiries, totalViews),
      lifetimeSaveRate: safeRate(totalSaves, totalViews),
    },

    listingStatus,

    marketInterest: {
      current: currentMetrics,
      previous: previousMetrics,
      totalInterest:
        currentMetrics.views +
        currentMetrics.saves +
        currentMetrics.enquiries +
        currentMetrics.contacts +
        currentMetrics.shares +
        currentMetrics.featuredClicks,
      enquiryRate: safeRate(
        currentMetrics.enquiries,
        currentMetrics.views,
      ),
      saveRate: safeRate(
        currentMetrics.saves,
        currentMetrics.views,
      ),
      comparisons: {
        views: comparison(
          currentMetrics.views,
          previousMetrics.views,
        ),
        saves: comparison(
          currentMetrics.saves,
          previousMetrics.saves,
        ),
        enquiries: comparison(
          currentMetrics.enquiries,
          previousMetrics.enquiries,
        ),
        contacts: comparison(
          currentMetrics.contacts,
          previousMetrics.contacts,
        ),
        shares: comparison(
          currentMetrics.shares,
          previousMetrics.shares,
        ),
        featuredClicks: comparison(
          currentMetrics.featuredClicks,
          previousMetrics.featuredClicks,
        ),
      },
    },

    trends: {
      daily: Array.from(dailyRowMap.values()).sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
      comparisons: {
        views: comparison(
          currentMetrics.views,
          previousMetrics.views,
        ),
        saves: comparison(
          currentMetrics.saves,
          previousMetrics.saves,
        ),
        enquiries: comparison(
          currentMetrics.enquiries,
          previousMetrics.enquiries,
        ),
        contacts: comparison(
          currentMetrics.contacts,
          previousMetrics.contacts,
        ),
        shares: comparison(
          currentMetrics.shares,
          previousMetrics.shares,
        ),
        featuredClicks: comparison(
          currentMetrics.featuredClicks,
          previousMetrics.featuredClicks,
        ),
      },
    },

    topListings,

    metadata: {
      userId,
      topListingLimit: TOP_LISTING_LIMIT,
      dataSources: {
        lifetimeViews: "Property.views",
        periodViews: "AnalyticsEvent.PROPERTY_VIEW",
        saves: "SavedProperty",
        enquiries: "Enquiry",
        contacts: "AnalyticsEvent.PROPERTY_CONTACT",
        shares: "AnalyticsEvent.PROPERTY_SHARE",
        featuredClicks: "AnalyticsEvent.FEATURED_CLICK",
      },
    },
  };
}
