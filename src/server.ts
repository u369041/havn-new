// src/server.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";

import { prisma } from "./db.js";
import { listings } from "./listings.js";
import uploadRoutes from "./routes/uploads.js";
import propertiesRoutes from "./routes/properties.js";
import diagRoutes from "./routes/diag.js";
import adminRoutes from "./routes/admin.js";

const app = express();

/* ---------- CORS ---------- */
const allowed = new Set<string>([
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com",
]);
if (process.env.NODE_ENV !== "production") {
  allowed.add("http://localhost:3000");
  allowed.add("http://localhost:5173");
}
const corsOptions: cors.CorsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    return cb(null, allowed.has(origin));
  },
  credentials: true,
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","X-Requested-With","X-Admin-Key"],
  optionsSuccessStatus: 204,
  maxAge: 86400,
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

/* ---------- Middlewares ---------- */
app.use(express.json({ limit: "5mb" }));
app.use(morgan("dev"));

/* ---------- Routes ---------- */
app.use(listings);
app.use("/api/uploads", uploadRoutes);
app.use("/api/properties", propertiesRoutes);
app.use("/api/diag", diagRoutes);
app.use("/api/admin", adminRoutes); // <-- protected ping lives here

/* ---------- Health ---------- */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "api", ts: new Date().toISOString() });
});

app.get("/api/db/ping", async (_req, res) => {
  const listingCount = await prisma.listing.count().catch(() => -1);
  res.json({ ok: true, listingCount });
});

/* ---------- Start ---------- */
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`havn-new listening on http://localhost:${PORT}`);
});
