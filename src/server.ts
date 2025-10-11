import express from "express";
import helmet from "helmet";
import cors from "cors";
import propertiesRouter from "./routes/properties";

const app = express();

// basic hardening & JSON parsing
app.use(helmet());
app.use(
  cors({
    origin: "*",
  })
);
app.use(express.json({ limit: "1mb" }));

// health
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// mount our API routes at /api
app.use("/api", propertiesRouter);

// 404 handler (after routes)
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

// generic error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Don’t leak internals to clients
  console.error(err);
  res.status(500).json({ ok: false, error: "Internal Server Error" });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
