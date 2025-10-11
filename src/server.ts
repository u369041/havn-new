import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";

import uploadsRouter from "./routes/uploads";
import propertiesRouter from "./routes/properties"; // your existing DB-backed route

const app = express();

/* Security + parsers */
app.use(helmet());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

/* CORS setup */
const allowedOrigins = [
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com",
];

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // allow same-origin/tools
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  })
);

/* Basic rate limit (60 req/min/IP) */
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/* Health endpoint */
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* Mount routers (order matters — before 404) */
app.use("/api/uploads", uploadsRouter);
app.use("/api/properties", propertiesRouter);

/* 404 handler */
app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found" }));

/* Generic error handler */
app.use(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[server] Error:", err?.message || err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
);

/* Start server */
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`HAVN API live on port ${PORT}`);
  });
}

export default app;
