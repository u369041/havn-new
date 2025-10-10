import express from "express";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

// --- Healthcheck route ---
app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

// --- Example API route ---
app.get("/api/hello", (_req, res) => {
  res.json({ ok: true, message: "Hello from havn-new API!" });
});

// TODO: Uncomment and use when your routes are ready
// import propertiesRouter from "./routes/properties";
// app.use("/api/properties", propertiesRouter);

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`🚀 Server listening on port ${port}`);
});

export default app;
