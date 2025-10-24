import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import propertiesRouter from "./routes/properties.js";
import listingsRouter from "./routes/listings.js";
import debugRouter from "./routes/debug.js";

const app = express();
const PORT = process.env.PORT || 8080;

// === Security + Middleware ===
app.use(helmet());
app.use(
  cors({
    origin: [
      "https://havn.ie",
      "https://www.havn.ie",
      "https://havn-new.onrender.com",
    ],
  })
);
app.use(express.json({ limit: "10mb" }));

// Limit requests (basic safety)
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
  })
);

// === Routes ===
app.use("/api/properties", propertiesRouter);
app.use("/api/listings", listingsRouter);
app.use("/api/debug", debugRouter);

// === Health endpoint ===
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, status: "healthy", timestamp: new Date().toISOString() });
});

// === Start Server ===
const server = app.listen(PORT, () => {
  console.log(`✅ HAVN API listening on port ${PORT}`);
});

// === Graceful Shutdown ===
function shutdown() {
  console.log("🔻 Shutting down HAVN API...");
  server.close(() => {
    console.log("✅ Server closed.");
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (reason: unknown) => {
  console.error("❌ Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err: unknown) => {
  console.error("❌ Uncaught Exception:", err);
});
