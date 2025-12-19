import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";

import uploadsRouter from "./routes/uploads";
import propertiesRouter from "./routes/properties";

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

// Always answer preflight requests
app.options("*", cors({ origin: allowedOrigins }));

app.get("/api/health", (req, res) => res.json({ ok: true }));

// ✅ uploads signature route
app.use("/api/uploads", uploadsRouter);

// ✅ properties CRUD routes
app.use("/api/properties", propertiesRouter);

const port = process.env.PORT ? Number(process.env.PORT) : 8080;
app.listen(port, () => {
  console.log(`API listening on ${port}`);
});
