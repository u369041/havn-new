import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import "dotenv/config";

// Our API routes
import propertiesRouter from "./routes/properties";

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Healthcheck
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// Mount routes (our routes already include the /api prefix)
app.use(propertiesRouter);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

// Error handler (so unexpected errors return JSON)
app.use(
  (err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
);

const PORT = Number(process.env.PORT) || 10000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
