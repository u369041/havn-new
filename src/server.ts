import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

// ⬅️ default import (NOT a named import)
import propertiesRouter from "./routes/properties";

const app = express();

/* ------------ middleware ------------ */
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// basic rate limiting
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
app.use(limiter);

/* ------------ health checks ------------ */
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});
app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

/* ------------ API routes ------------ */
app.use("/api/properties", propertiesRouter);

/* ------------ 404 + error handlers ------------ */
app.use((_req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Internal server error" });
});

/* ------------ start server ------------ */
const PORT = Number(process.env.PORT) || 10000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

export default app;
