import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import { prisma } from "./db.js";
import { listings } from "./listings.js";
import uploadRoutes from "./routes/uploads";


const app = express();

// Allow only these origins (plus localhost in non-prod)
const allowed = new Set<string>([
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com", // keep for testing
]);
if (process.env.NODE_ENV !== "production") {
  allowed.add("http://localhost:3000");
  allowed.add("http://localhost:5173");
}

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);          // curl / server-to-server
      return cb(null, allowed.has(origin));
    },
    credentials: false,
    optionsSuccessStatus: 200,
  })
);

app.use(express.json({ limit: "5mb" }));
app.use(morgan("dev"));
app.use(listings);
app.use("/api/uploads", uploadRoutes);


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
