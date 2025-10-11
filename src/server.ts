import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";

// CommonJS build → normal relative imports (no .js suffix needed)
import uploadsRouter from "./routes/uploads";
import propertiesRouter from "./routes/properties";

const app = express();

/* Security + parsers */
app.use(helmet());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

/* CORS */
const allowedOrigins = [
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com"
];

const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) => {
    if (!origin) return callback(null, true); // same-origin/tools/curl
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: false,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 600
};

app.use(cors(corsOptions));

/* Rate limit (60 req/min/IP) */
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false
  })
);

/* Health */
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* Routers (order matters) */
app.use("/api/uploads", uploadsRouter);
app.use("/api/properties", propertiesRouter);

/* 404 */
app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found" }));

/* Error handler */
app.use(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[server] Error:", err?.message || err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
);

/* Start */
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`HAVN API live on port ${PORT}`));
}

export default app;
