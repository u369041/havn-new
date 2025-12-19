import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";

import uploadsRouter from "./routes/uploads";
import propertiesRouter from "./routes/properties";
import debugRouter from "./routes/debug";

const app = express();

app.use(helmet());
app.use(express.json({ limit: "10mb" }));

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
  })
);

const allowedOrigins = [
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com",
];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept", "x-admin-token"],
  })
);

app.options("*", cors({ origin: allowedOrigins }));

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Mount routers (explicit)
app.use("/api/uploads", uploadsRouter);
app.use("/api/properties", propertiesRouter);

// TEMP: route inventory for debugging
app.use("/api/debug", debugRouter);

const port = process.env.PORT ? Number(process.env.PORT) : 8080;
app.listen(port, () => {
  console.log(`API listening on ${port}`);
});
