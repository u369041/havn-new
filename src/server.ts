import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRouter from "./routes/auth";
import propertiesRouter from "./routes/properties";
import uploadsRouter from "./routes/uploads";
import debugRouter from "./routes/debug";
import adminPropertiesRouter from "./routes/admin-properties";

const app = express();

/* security */
app.use(helmet());
app.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));
app.use(express.json({ limit: "2mb" }));

/* cors */
const ALLOWED = new Set([
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com",
]);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || ALLOWED.has(origin)) return cb(null, true);
      return cb(new Error("CORS blocked"));
    },
    credentials: true,
  })
);

/* health */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

/* routes */
app.use("/api/auth", authRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/properties", propertiesRouter);
app.use("/api/admin/properties", adminPropertiesRouter);
app.use("/api/debug", debugRouter);

/* fallback */
app.use((_req, res) => {
  res.status(404).json({ ok: false });
});

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);
  res.status(500).json({ ok: false });
});

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => {
  console.log(`HAVN API running on ${PORT}`);
});
