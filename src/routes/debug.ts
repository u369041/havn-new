// src/routes/debug.ts  (inside the POST /seed-one handler)
const r = {
  slug: `prop-${Math.random().toString(36).slice(2, 8)}`,
  title: "Seeded Property",
  price: 123456,
  // safe defaults for NOT NULL JSON columns
  photos: [] as any[],      // keep type loose for JSON
  features: [] as any[],    // keep type loose for JSON
};

const item = await prisma.property.upsert({
  where: { slug: r.slug },
  update: {
    title: r.title,
    price: r.price,
    photos: r.photos,       // ✅ ensure not null
    features: r.features,   // ✅ ensure not null
  },
  create: {
    slug: r.slug,
    title: r.title,
    price: r.price,
    photos: r.photos,       // ✅ ensure not null
    features: r.features,   // ✅ ensure not null
  },
  select: { id: true, slug: true, title: true, price: true },
});
