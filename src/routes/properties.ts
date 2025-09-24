import { Router, type Request, type Response } from "express";

const router = Router();

// tiny helpers
function toSlug(input: string) {
  return (input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "") || "listing";
}
function randId(len = 6) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

/**
 * POST /api/properties
 * Mock create: validates payload shape, caps images to 70,
 * returns a slug and echoes back a normalized property.
 */
router.post("/", (req: Request, res: Response) => {
  const b = (req.body ?? {}) as any;

  // required
  const title = (b.title ?? "").toString().trim();
  const description = (b.description ?? "").toString().trim();
  const price = Number(b.price ?? 0);
  if (!title || !description || !price) {
    return res.status(400).json({ ok: fals
