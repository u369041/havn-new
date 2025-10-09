// src/server.ts
import path from "path";
import express from "express";
import listingsRouter from "./listings";

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies if you ever POST/PUT later
app.use(express.json());

// API routes
app.use("/api", listingsRouter);

// Serve static site (public/)
const publicDir = path.join(process.cwd(), "public");
app.use(express.static(publicDir));

// Convenience routes (optional)
app.get("/", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
app.get("/properties.html", (_req, res) => res.sendFile(path.join(publicDir, "properties.html")));
app.get("/property.html", (_req, res) => res.sendFile(path.join(publicDir, "property.html")));

// Health
app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
