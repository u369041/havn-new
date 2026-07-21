import { Router, type Request, type Response } from "express";

import {
  buildLocationSitemap,
  buildPagesSitemap,
  buildPropertySitemap,
  buildRobotsTxt,
  buildSitemapIndex,
} from "../lib/seo";

const router = Router();

const XML_CONTENT_TYPE = "application/xml; charset=utf-8";
const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

function setXmlHeaders(res: Response): void {
  res.setHeader("Content-Type", XML_CONTENT_TYPE);
  res.setHeader(
    "Cache-Control",
    "public, max-age=300, s-maxage=300, stale-while-revalidate=600"
  );
  res.setHeader("X-Robots-Tag", "noindex");
}

function setRobotsHeaders(res: Response): void {
  res.setHeader("Content-Type", TEXT_CONTENT_TYPE);
  res.setHeader(
    "Cache-Control",
    "public, max-age=300, s-maxage=300, stale-while-revalidate=600"
  );
}

function sendSeoError(
  res: Response,
  resourceName: string,
  error: unknown
): Response {
  console.error(`SEO_ROUTE_ERROR:${resourceName}:`, error);

  return res.status(500).type("text/plain").send("Unable to generate SEO file.");
}

router.get("/sitemap.xml", async (_req: Request, res: Response) => {
  try {
    const xml = await buildSitemapIndex();

    setXmlHeaders(res);
    return res.status(200).send(xml);
  } catch (error) {
    return sendSeoError(res, "sitemap-index", error);
  }
});

router.get("/sitemaps/pages.xml", (_req: Request, res: Response) => {
  try {
    const xml = buildPagesSitemap();

    setXmlHeaders(res);
    return res.status(200).send(xml);
  } catch (error) {
    return sendSeoError(res, "pages-sitemap", error);
  }
});

router.get(
  "/sitemaps/properties.xml",
  async (_req: Request, res: Response) => {
    try {
      const xml = await buildPropertySitemap();

      setXmlHeaders(res);
      return res.status(200).send(xml);
    } catch (error) {
      return sendSeoError(res, "properties-sitemap", error);
    }
  }
);

router.get(
  "/sitemaps/locations.xml",
  async (_req: Request, res: Response) => {
    try {
      const xml = await buildLocationSitemap();

      setXmlHeaders(res);
      return res.status(200).send(xml);
    } catch (error) {
      return sendSeoError(res, "locations-sitemap", error);
    }
  }
);

router.get("/robots.txt", (_req: Request, res: Response) => {
  try {
    const robots = buildRobotsTxt();

    setRobotsHeaders(res);
    return res.status(200).send(robots);
  } catch (error) {
    return sendSeoError(res, "robots", error);
  }
});

export default router;