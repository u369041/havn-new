import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { apiRouter } from "./routes/properties";

const app = express();

app.use(cors());
app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// global health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// mount the API router
app.use("/api", apiRouter);

// root ping
app.get("/", (_req, res) => res.json({ ok: true, service: "havn-new" }));

const PORT = Number(process.env.PORT || 10_000);
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
