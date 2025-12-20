import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * Helpers
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function signToken(userId: number, role: "admin" | "user") {
  const secret = requireEnv("JWT_SECRET");
  return jwt.sign({ sub: userId, role }, secret, { expiresIn: "7d" });
}

/**
 * POST /api/auth/bootstrap-admin
 * - Creates first admin user (guarded by ADMIN_BOOTSTRAP_TOKEN)
 * - Only allowed if there are currently 0 admins in DB
 */
router.post("/bootstrap-admin", async (req, res) => {
  try {
    const token = requireEnv("ADMIN_BOOTSTRAP_TOKEN");
    const provided = (req.header("x-admin-bootstrap-token") || "").trim();

    if (!provided || provided !== token) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const { email, password, name } = req.body as {
      email?: string;
      password?: string;
      name?: string;
    };

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "email and password are required" });
    }

    // Now that role exists in Prisma, this works:
    const existingAdmins = await prisma.user.count({ where: { role: "admin" } });
    if (existingAdmins > 0) {
      return res.status(409).json({ ok: false, error: "Admin already exists" });
    }

    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      return res.status(409).json({ ok: false, error: "Email already in use" });
    }

    const hash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { email, password: hash, role: "admin", name: name || null },
      select: { id: true, email: true, role: true, name: true, createdAt: true },
    });

    const jwtToken = signToken(user.id, user.role as "admin" | "user");

    return res.status(201).json({
      ok: true,
      token: jwtToken,
      user: { email: user.email, role: user.role, name: user.name },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
});

/**
 * POST /api/auth/login
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "email and password are required" });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, password: true, role: true, name: true, createdAt: true },
    });

    if (!user) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    const token = signToken(user.id, user.role as "admin" | "user");

    return res.json({
      ok: true,
      token,
      user: { email: user.email, role: user.role, name: user.name },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
});

/**
 * GET /api/auth/me
 * - expects Authorization: Bearer <token>
 */
router.get("/me", async (req, res) => {
  try {
    const auth = req.header("authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

    const secret = requireEnv("JWT_SECRET");
    const payload = jwt.verify(m[1], secret) as any;
    const userId = Number(payload?.sub);
    if (!userId) return res.status(401).json({ ok: false, error: "Invalid token" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, role: true, name: true, createdAt: true },
    });

    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    return res.json({ ok: true, user });
  } catch (err: any) {
    return res.status(401).json({ ok: false, error: err?.message || "Unauthorized" });
  }
});

export default router;
