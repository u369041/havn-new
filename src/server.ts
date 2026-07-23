import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRouter from "./routes/auth";
import propertiesRouter from "./routes/properties";
import uploadsRouter from "./routes/uploads";
import moderationRouter from "./routes/moderation";
import stripeRouter from "./routes/stripe";
import adminRouter from "./routes/admin";
import digestRouter from "./routes/digest";
import seoRouter from "./routes/seo";
import locationsRouter from "./routes/locations";

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

/* security */
app.use(helmet());

function isStripeWebhook(req: express.Request): boolean {
  return req.originalUrl.split("?")[0] === "/api/stripe/webhook";
}

const generalApiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/health" || isStripeWebhook(req),
  handler: (_req, res) => {
    return res.status(429).json({
      ok: false,
      error: "TOO_MANY_REQUESTS",
    });
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    return res.status(429).json({
      ok: false,
      error: "TOO_MANY_AUTH_REQUESTS",
    });
  },
});

const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    return res.status(429).json({
      ok: false,
      error: "TOO_MANY_REQUESTS",
    });
  },
});

const stripeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isStripeWebhook,
  handler: (_req, res) => {
    return res.status(429).json({
      ok: false,
      error: "TOO_MANY_REQUESTS",
    });
  },
});

/* body */

/*
 * Stripe signature verification requires the original raw request body.
 * This must remain before express.json().
 */
app.use(
  "/api/stripe/webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
);

app.use(express.json({ limit: "2mb" }));

/* CORS */
const ALLOWED = new Set([
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com",
]);

const corsOptions = {
  origin(origin: any, cb: any) {
    /*
     * Requests without an Origin header include server-to-server calls,
     * Stripe webhooks and tools such as curl.
     */
    if (!origin) {
      return cb(null, true);
    }

    if (ALLOWED.has(origin)) {
      return cb(null, true);
    }

    return cb(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-admin-key"],
  optionsSuccessStatus: 204,
};

app.options("*", cors(corsOptions));
app.use(cors(corsOptions));

/* health */
app.get("/api/health", (_req, res) => {
  return res.json({ ok: true });
});

/* SEO */
app.use("/", seoRouter);

/*
 * Apply a general abuse-prevention limit across the API.
 * Stripe webhooks and the health endpoint are excluded above.
 */
app.use("/api", generalApiLimiter);

/* public routes */
app.use("/api/properties", propertiesRouter);
app.use("/api/locations", locationsRouter);

/* protected and rate-limited routes */
app.use("/api/auth", authLimiter, authRouter);
app.use("/api/uploads", strictLimiter, uploadsRouter);
app.use("/api/stripe", stripeLimiter, stripeRouter);
app.use("/api/admin", strictLimiter, adminRouter);
app.use("/api/admin/moderation", strictLimiter, moderationRouter);
app.use("/api/digest", strictLimiter, digestRouter);

/* 404 */
app.use((_req, res) => {
  return res.status(404).json({
    ok: false,
    error: "NOT_FOUND",
  });
});

/* error handler */
app.use((err: any, req: any, res: any, next: any) => {
  console.error("SERVER_ERROR:", err);

  if (res.headersSent) {
    return next(err);
  }

  const origin = req.headers?.origin;

  if (origin && ALLOWED.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }

  return res.status(500).json({
    ok: false,
    error: "SERVER_ERROR",
  });
});

const PORT = Number(process.env.PORT || 8080);

app.listen(PORT, () => {
  console.log(`HAVN API running on ${PORT}`);
});