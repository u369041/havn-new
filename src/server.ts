import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bodyParser from "body-parser";

import propertiesRouter from "./routes/properties.js";
import debugRouter from "./routes/debug.js";

const app = express();

app.use(helmet());
app.use(express.json({ limit: "5mb" }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(
  cors({
    origin: ["https://havn.ie", "https://www.havn.ie", "https://havn-new.onrender.com"],
    methods: ["GET", "POST", "DELETE", "OPTIONS"]
  })
);
app.use(rateLimit({ windowMs: 60_000, max: 60 }));

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, status: "healthy", timestamp: new Date().toISOString() });
});

app.get("/api/debug/env", (_req: Request, res: Response) => {
  const raw = process.env.DATABASE_URL || "";
  const host = raw.split("@")[1]?.split("/")[0] || "(unknown)";
  res.json({ ok: true, db_host: host, sslmode: /sslmode=require/i.test(raw) });
});

app.use("/api/properties", propertiesRouter);
app.use("/api/debug", debugRouter);

const PORT = Number(process.env.PORT) || 8080;
app.listen(PORT, () => console.log(`✅ HAVN API running on :${PORT}`));
