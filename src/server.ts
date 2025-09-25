import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";

import { prisma } from "./db.js";
import { listings } from "./listings.js";
import uploadRoutes from "./routes/uploads.js";
import propertiesRoutes from "./routes/properties.js"; // <-- ensure this path & .js ext

const app = express();

/* ---------- CORS (only your domains + localhost in dev) ---------- */
const allowed = new Set<string>([
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com", // keep for testing if needed
]);
if (process.env.NODE_ENV !== "production") {
  allowed.add("http://localhost:3000");
  allowed.add("http://localhost:5173");
}
const corsOptions: cors.CorsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);        // server-to-server/tools
    return cb(null, allowed.has(origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  optionsSuccessStatus: 204,
  maxAge: 86400,
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

/* ---------- Common middleware ---------- */
app.use(express.json({ limit: "5mb" }));
app.use(morgan("dev"));

/* ---------- Routes ---------- */
app.use(listings);                           // legacy
app.use("/api/uploads", uploadRoutes);       // /api/uploads/cloudinary-signature
app.use("/api/properties", propertiesRoutes); // <-- MOUNTED HERE

/* ---------- Health & diagnostics ---------- */
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
