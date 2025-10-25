import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import dotenv from "dotenv";
import propertiesRouter from "./routes/properties.js";
import debugRouter from "./routes/debug.js";
import { prisma } from "./prisma.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Security + middleware
app.use(helmet());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: ["https://havn.ie", "https://www.havn.ie", "https://havn-new.onrender.com"],
  })
);

// Rate limiter (60 req/min)
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
  })
);

// === ROUTES ===
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/properties", propertiesRouter);
app.use("/api/debug", debugRouter);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("🔻 SIGINT received. Closing Prisma...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("🔻 SIGTERM received. Closing Prisma...");
  await prisma.$disconnect();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`✅ HAVN API running on port ${PORT}`);
});
