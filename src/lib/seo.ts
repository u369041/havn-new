import { prisma } from "./prisma";

const PUBLIC_SITE_URL = "https://havn.ie";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

type SitemapUrl = {
  loc: string;
  lastmod?: Date | string | null;
};

type SitemapEntry = {
  loc: string;
  lastmod?: Date | string | null;
};

type PublishedPropertySeoRecord = {
  slug: string;
  updatedAt: Date;
  publishedAt: Date | null;
  createdAt: Date;
  city: string;
  county: string;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function absoluteUrl(pathname: string): string {
  const baseUrl = normalizeBaseUrl(PUBLIC_SITE_URL);

  if (!pathname || pathname === "/") {
    return `${baseUrl}/`;
  }

  if (/^https?:\/\//i.test(pathname)) {
    return pathname;
  }

  return `${baseUrl}/${pathname.replace(/^\/+/, "")}`;
}

function formatLastModified(value?: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function slugifyLocation(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildUrlNode(entry: SitemapUrl): string {
  const lastmod = formatLastModified(entry.lastmod);

  return [
    "  <url>",
    `    <loc>${escapeXml(entry.loc)}</loc>`,
    lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : null,
    "  </url>",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function buildSitemapNode(entry: SitemapEntry): string {
  const lastmod = formatLastModified(entry.lastmod);

  return [
    "  <sitemap>",
    `    <loc>${escapeXml(entry.loc)}</loc>`,
    lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : null,
    "  </sitemap>",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function buildUrlSet(entries: SitemapUrl[]): string {
  const body = entries.map(buildUrlNode).join("\n");

  return [
    XML_HEADER,
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    body,
    "</urlset>",
    "",
  ].join("\n");
}

function buildSitemapIndexXml(entries: SitemapEntry[]): string {
  const body = entries.map(buildSitemapNode).join("\n");

  return [
    XML_HEADER,
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    body,
    "</sitemapindex>",
    "",
  ].join("\n");
}

async function getPublishedProperties(): Promise<
  PublishedPropertySeoRecord[]
> {
  return prisma.property.findMany({
    where: {
      listingStatus: "PUBLISHED",
    },
    select: {
      slug: true,
      updatedAt: true,
      publishedAt: true,
      createdAt: true,
      city: true,
      county: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

export async function buildSitemapIndex(): Promise<string> {
  const properties = await getPublishedProperties();

  const latestPropertyUpdate =
    properties[0]?.updatedAt ?? properties[0]?.publishedAt ?? null;

  return buildSitemapIndexXml([
    {
      loc: absoluteUrl("/sitemaps/pages.xml"),
    },
    {
      loc: absoluteUrl("/sitemaps/properties.xml"),
      lastmod: latestPropertyUpdate,
    },
    {
      loc: absoluteUrl("/sitemaps/locations.xml"),
      lastmod: latestPropertyUpdate,
    },
  ]);
}

export function buildPagesSitemap(): string {
  const pages: SitemapUrl[] = [
    {
      loc: absoluteUrl("/"),
    },
    {
      loc: absoluteUrl("/properties.html"),
    },
  ];

  return buildUrlSet(pages);
}

export async function buildPropertySitemap(): Promise<string> {
  const properties = await getPublishedProperties();

  const entries: SitemapUrl[] = properties
    .filter((property) => Boolean(property.slug?.trim()))
    .map((property) => ({
      loc: absoluteUrl(
        `/property.html?slug=${encodeURIComponent(property.slug.trim())}`
      ),
      lastmod:
        property.updatedAt ?? property.publishedAt ?? property.createdAt,
    }));

  return buildUrlSet(entries);
}

export async function buildLocationSitemap(): Promise<string> {
  const properties = await getPublishedProperties();

  const latestByLocation = new Map<string, Date>();

  for (const property of properties) {
    const modifiedAt =
      property.updatedAt ?? property.publishedAt ?? property.createdAt;

    const locations = [property.city, property.county]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));

    for (const location of locations) {
      const slug = slugifyLocation(location);

      if (!slug) {
        continue;
      }

      const existingDate = latestByLocation.get(slug);

      if (!existingDate || modifiedAt.getTime() > existingDate.getTime()) {
        latestByLocation.set(slug, modifiedAt);
      }
    }
  }

  const entries: SitemapUrl[] = Array.from(latestByLocation.entries())
    .sort(([slugA], [slugB]) => slugA.localeCompare(slugB))
    .map(([slug, lastmod]) => ({
      loc: absoluteUrl(`/${slug}`),
      lastmod,
    }));

  return buildUrlSet(entries);
}

export function buildRobotsTxt(): string {
  return [
    "User-agent: *",
    "Allow: /",
    "",
    "Disallow: /admin.html",
    "Disallow: /my-listings.html",
    "Disallow: /property-upload.html",
    "Disallow: /login.html",
    "Disallow: /signup.html",
    "Disallow: /forgot-password.html",
    "Disallow: /reset-password.html",
    "Disallow: /verify-email.html",
    "",
    `Sitemap: ${absoluteUrl("/sitemap.xml")}`,
    "",
  ].join("\n");
}