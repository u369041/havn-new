// src/server.ts
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { debug } from "./routes/debug.js";

const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: "1mb" }));

// mount routes
debug(app);

// health (fallback)
app.get("/api/health", (_req, res) => {
  const build =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    "dev";
  res.json({ ok: true, service: "havn-new", build });
});

// global error handler (so the process doesn’t crash)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("UNCAUGHT MIDDLEWARE ERROR:", err);
  res.status(500).json({ ok: false, error: String(err?.message ?? err) });
});

// log & keep process alive on unhandled errors
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`[havn-new] listening on :${port}`);
});
