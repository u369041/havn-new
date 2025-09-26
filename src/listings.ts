// src/listings.ts
import { PrismaClient, Status } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Utility: generate a slug from title and a short suffix to ensure uniqueness.
 */
function slugify(input: string) {
  const base = (input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base}-${suffix}`;
}

/**
 * List properties with light filters & sorting.
 * sort: "price_asc" | "price_desc" | "date_desc" (default)
 */
export async function listProperties(opts: {
  type?: string;
  status?: keyof typeof Status;
  minPrice?: number;
  maxPrice?: number;
  beds?: number;
  take?: number;
  skip?: number;
  sort?: "price_asc" | "price_desc" | "date_desc";
}) {
  const {
    type,
    status,
    minPrice,
    maxPrice,
    beds,
    take = 24,
    skip = 0,
    sort = "date_desc",
  } = opts || {};

  const where: any = {};
  if (type) where.type = type;
  if (status && Status[status]) where.status = status;
  if (typeof beds === "number") where.bedrooms = { gte: beds };
  if (typeof minPrice === "number" || typeof maxPrice === "number") {
    where.price = {};
    if (typeof minPrice === "number") where.price.gte = minPrice;
    if (typeof maxPrice === "number") where.price.lte = maxPrice;
  }

  let orderBy: any = [{ createdAt: "desc" as const }];
  if (sort === "price_asc") orderBy = [{ price:]()_
