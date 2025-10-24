import { Router, Request, Response } from "express";
import { prisma } from "../prisma.js";

const router = Router();

// Admin key header (must match your Render ENV SEED_TOKEN)
const ADMIN_KEY = process.env.SEED_TOKEN || "";

router.post("/seed-demo", async (req: Request, res: Response) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  try {
    // 1. Clear old data
    await prisma.property.deleteMany();

    // 2. Generate 30 mock properties
    const demoRecords = Array.from({ length: 30 }).map((_, i) => ({
      slug: `demo-property-${i + 1}`,
      title: `Demo Property ${i + 1}`,
      price: 250000 + i * 10000,
      beds: 3,
      baths: 2,
      ber: "B2",
      eircode: `D0${i}XYZ`,
      type: "House",
      photos: [
        "https://res.cloudinary.com/demo/image/upload/v1699999999/sample.jpg",
      ],
      overview: "A beautiful demo home in Ireland for testing.",
      features: ["Parking", "Garden", "Central Heating"],
    }));

    // 3. Insert in chunks of 10 to avoid overload
    const chunkSize = 10;
    for (let i = 0; i < demoRecords.length; i += chunkSize) {
      const chunk = demoRecords.slice(i, i + chunkSize);
      await prisma.$transaction(chunk.map((data) => prisma.property.create({ data })));
    }

    res.json({ ok: true, inserted: demoRecords.length });
  } catch (err) {
    console.error("❌ Seed failed:", err);
    res.status(500).json({ ok: false, error: "seed_failed" });
  }
});

// Simple column introspection
router.get("/columns/:table", async (req: Request, res: Response) => {
  const table = req.params.table;
  try {
    const columns = await prisma.$queryRawUnsafe<
      { column_name: string; data_type: string }[]
    >(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${table}'`
    );
    res.json({ ok: true, columns });
  } catch (err) {
    res.status(500).json({ ok: false, error: "query_failed" });
  }
});

export default router;
