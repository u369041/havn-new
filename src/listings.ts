// src/listings.ts
import { PrismaClient, Prisma, Status } from "@prisma/client";

const prisma = new PrismaClient();

/** Simple slugger */
function slugify(input: string) {
  const base = String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base}-${suffix}`;
}

export async function listProperties(opts: {
  category?: string;
  subtype?: string;
  status?: keyof typeof Status | string;
  minPrice?: number;
  maxPrice?: number;
  beds?: number;
  take?: number;
  skip?: number;
  sort?: "price_asc" | "price_desc" | "date_desc";
}) {
  const o = opts || {};

  // Build where
  const where: any = {};
  if (o.status) {
    const s = String(o.status).toUpperCase();
    if (s in Status) where.status = s;
  }

  const cat = String(o.category || "").toUpperCase();
  const sub = String(o.subtype || "").toUpperCase();
  if (cat && sub) where.type = `${cat}/${sub}`;
  else if (cat) where.type = { startsWith: `${cat}/` };
  else if (sub) where.type = { endsWith: `/${sub}` };

  if (typeof o.beds === "number") where.bedrooms = { gte: o.beds };
  if (typeof o.minPrice === "number" || typeof o.maxPrice === "number") {
    where.price = {};
    if (typeof o.minPrice === "number") where.price.gte = o.minPrice;
    if (typeof o.maxPrice === "number") where.price.lte = o.maxPrice;
  }

  // Sorting & pagination
  let orderBy: any = [{ createdAt: "desc" }];
  if (o.sort === "price_asc") orderBy = [{ price: "asc" }];
  if (o.sort === "price_desc") orderBy = [{ price: "desc" }];

  const take = typeof o.take === "number" ? Math.max(1, Math.min(100, o.take)) : 24;
  const skip = typeof o.skip === "number" ? Math.max(0, o.skip) : 0;

  const [count, properties] = await Promise.all([
    prisma.property.count({ where }),
    prisma.property.findMany({
      where,
      take,
      skip,
      orderBy,
      include: { images: { orderBy: { sortOrder: "asc" } } }
    })
  ]);

  return { count, properties };
}

export async function getPropertyBySlug(slug: string) {
  return prisma.property.findUnique({
    where: { slug },
    include: { images: { orderBy: { sortOrder: "asc" } } }
  });
}

export async function createProperty(payload: any) {
  const p = payload || {};
  const title = typeof p.title === "string" ? p.title.trim() : "";
  const price =
    typeof p.price === "number" ? p.price :
    typeof p.price === "string" ? Number(p.price) : NaN;
  const type = typeof p.type === "string" ? p.type.trim() : "";

  if (!title) throw new Error("title is required");
  if (!Number.isFinite(price)) throw new Error("price must be a number");
  if (!type) throw new Error("type is required");

  const beds =
    typeof p.beds === "number" ? p.beds :
    typeof p.beds === "string" && p.beds.trim() ? Number(p.beds) : null;

  const baths =
    typeof p.baths === "number" ? p.baths :
    typeof p.baths === "string" && p.baths.trim() ? Number(p.baths) : null;

  const images: any[] = Array.isArray(p.images) ? p.images : [];

  const slug = slugify(title);

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.property.create({
      data: {
        slug,
        title,
        status: "DRAFT",
        price,
        type,
        address: typeof p.address === "string" ? p.address : null,
        bedrooms: beds,
        bathrooms: baths,
        description: typeof p.description === "string" ? p.description : null,
        images: {
          create: images.map((im: any, idx: number) => ({
            publicId: String(im?.publicId || im?.public_id || ""),
            url: String(im?.url || im?.secure_url || ""),
            sortOrder: idx
          }))
        }
      },
      include: { images: { orderBy: { sortOrder: "asc" } } }
    });

    return created;
  });
}

export async function setImageOrder(propertyId: string, imageIds: string[]) {
  if (!propertyId) throw new Error("propertyId is required");
  if (!Array.isArray(imageIds)) throw new Error("imageIds must be an array");

  await prisma.$transaction(
    imageIds.map((id, idx) =>
      prisma.image.update({
        where: { id },
        data: { sortOrder: idx }
      })
    )
  );

  return prisma.image.findMany({
    where: { propertyId },
    orderBy: { sortOrder: "asc" }
  });
}

export async function setStatus(id: string, status: keyof typeof Status | string) {
  const s = String(status || "").toUpperCase();
  if (!(s in Status)) throw new Error("invalid_status");
  return prisma.property.update({
    where: { id },
    data: { status: s as keyof typeof Status }
  });
}
