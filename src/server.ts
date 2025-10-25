// src/server.ts
import express from "express";
import cors from "cors";
import morgan from "morgan";

import listingsRouter from "./routes/listings.js";
import propertiesRouter from "./routes/properties.js";
import debugRouter from "./routes/debug.js";

const app = express();

// middleware
app.use(cors());
app.use(express.json());
app.use(morgan("tiny"));

// health
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, status: "healthy", timestamp: new Date().toISOString() });
});

// business routes
app.use("/api/listings", listingsRouter);
app.use("/api/properties", propertiesRouter);

// *** mount debug routes here ***
app.use("/api/debug", debugRouter);

// not found
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "not_found" });
});

// error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: typeof err?.message === "string" ? err.message : "internal_error" });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`API listening on :${port}`);
});
