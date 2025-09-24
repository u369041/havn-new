import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import { prisma } from "./db.js";
import { listings } from "./listings.js";
import uploadRoutes from "./routes/uploads.js";
import propertyRoutes from "./routes/properties.js"; // <-- new

// Whitelisted origins (plus localhost when not in production)
const allowed = new Set<string>([
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com", // keep for testing
]);
if (process.env.NODE_ENV !== "production") {
  allowed.add("http://localhost:3000");
  allowed.add("http://localhost:5173");
}

// Explicit types for strict TS
type OriginCallback = (err: Error | null, allow?: boolean) => void;
type OriginFn = (origin: string | undefined, callback: OriginCallback) => void;

// CORS origin function
const corsOrigin: OriginFn = (origin, cb) => {
  if (!origin) return cb(null, true);          // server-to-server/tools
  return cb(null, allowed.has(origin));
};

// Global CORS (preflight handled by cors middleware)
const corsOptions: cors.CorsOptions = {
  origin: corsOrigin,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  optionsSuccessStatus: 204,
  maxAge: 86400,
};

const app = express();

// CORS must be first
app.use(cors(corsOptions));

// Body parsing & logging
app.use(express.json({ limit: "5mb" }));
app.use(morgan("dev"));

// Routes
app.use(listings);
app.use("/api/uploads", uploadRoutes);
app.use("/api/properties", propertyRoutes); // <-- new

// Health/check endpoints
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
