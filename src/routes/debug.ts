import { Router } from "express";
import { prisma } from "../prisma.js";

export const debug = Router();

// DB ping
debug.get("/ping-db", async (_req, res) => {
  try {
    const result = await prisma.$queryRaw`SELECT 1 AS ok`;
    res.json({ ok: true, result });
  } catch (err) {
    console.error("❌ ping-db failed:", err);
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// Static sample
debug.get("/sample", (_req, res) => {
  res.json({
    ok: true,
    property: {
      slug: "sample-slug",
      title: "Sample Home",
      price: 450000,
      beds: 3,
      baths: 2,
      ber: "B3",
      eircode: "V93 NNNN",
      type: "Detached",
      photos: ["/img/placeholder.jpg"],
      overview: "Demo property for smoke testing.",
      features: ["South-facing garden", "Near shops"]
    }
  });
});
