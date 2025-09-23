import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import { prisma } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

const PORT = Number(process.env.PORT || 3000);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "api", ts: new Date().toISOString() });
});

app.get("/api/properties/ping", (_req, res) => {
  res.json({ ok: true, route: "/api/properties/ping" });
});

app.get("/api/db/ping", async (_req, res) => {
  const listingCount = await prisma.listing.count();
  res.json({ ok: true, listingCount });
});

app.listen(PORT, () => {
  console.log(`havn-new listening on http://localhost:${PORT}`);
});
