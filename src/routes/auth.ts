import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import requireAuth from "../middleware/requireAuth";
import { prisma } from "../lib/prisma";
import { sendWelcomeEmail } from "../lib/mail";

const router = Router();

/**
 * POST /api/auth/register
 * Body: { email, password, name? }
 *
 * Creates a new user and returns JWT token (same shape as /login),
 * and sends "Welcome to HAVN.ie" email (fire-and-forget).
 */
router.post("/register", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const name = req.body.name !== undefined ? String(req.body.name || "").trim() : null;

    if (!email || !password) {
      return res.status(400).json({ ok: false, message: "Email and password required" });
    }

    // Basic sanity check (light-touch; frontend should validate too)
    if (!email.includes("@") || password.length < 8) {
      return res.status(400).json({
        ok: false,
        message: "Invalid email or password too short (min 8 chars)",
      });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ ok: false, message: "Email already registered" });
    }

    const hash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hash,
        role: "user",
        name: name || null,
        // emailVerified defaults handled by DB/schema if present
      },
    });

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ ok: false, message: "Server misconfigured" });

    const token = jwt.sign(
      { role: user.role, email: user.email },
      secret,
      { subject: String(user.id), expiresIn: "2h" }
    );

    // ✅ Welcome email (fire-and-forget; never blocks signup)
    void (async () => {
      try {
        await sendWelcomeEmail({ to: user.email, firstName: user.name || null });
      } catch (e) {
        console.warn("Welcome email failed (non-fatal):", e);
      }
    })();

    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        createdAt: user.createdAt,
        emailVerified: user.emailVerified ?? false,
      },
    });
  } catch (err: any) {
    console.error("POST /auth/register error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
router.post("/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ ok: false, message: "Email and password required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ ok: false, message: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ ok: false, message: "Invalid credentials" });

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ ok: false, message: "Server misconfigured" });

    const token = jwt.sign(
      { role: user.role, email: user.email },
      secret,
      { subject: String(user.id), expiresIn: "2h" }
    );

    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        createdAt: user.createdAt,
        emailVerified: user.emailVerified ?? false,
      },
    });
  } catch (err: any) {
    console.error("POST /auth/login error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * GET /api/auth/me
 */
router.get("/me", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ ok: false, message: "User not found" });

    return res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        createdAt: user.createdAt,
        emailVerified: user.emailVerified ?? false,
      },
    });
  } catch (err: any) {
    console.error("GET /auth/me error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/auth/request-email-verify
 * Creates and stores token (no email sending yet).
 */
router.post("/request-email-verify", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ ok: false, message: "User not found" });

    if (user.role === "admin") {
      return res.json({ ok: true, message: "Admin accounts are already verified." });
    }

    if (user.emailVerified) {
      return res.json({ ok: true, message: "Email already verified." });
    }

    const verifyToken = cryptoRandomToken(32);

    // Token expires in 30 minutes
    const exp = new Date(Date.now() + 30 * 60 * 1000);

    await prisma.user.update({
      where: { id: userId },
      data: {
        emailVerifyToken: verifyToken,
        emailVerifyTokenExp: exp,
      },
    });

    return res.json({
      ok: true,
      message: "Verification token created.",
      token: verifyToken,
      exp,
    });
  } catch (err: any) {
    console.error("POST /auth/request-email-verify error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/auth/verify-email
 * Body: { token }
 */
router.post("/verify-email", async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    if (!token) return res.status(400).json({ ok: false, message: "Token required" });

    const user = await prisma.user.findFirst({
      where: { emailVerifyToken: token },
    });

    if (!user) return res.status(400).json({ ok: false, message: "Invalid token" });

    // Token expired?
    if (user.emailVerifyTokenExp && user.emailVerifyTokenExp.getTime() < Date.now()) {
      return res.status(400).json({ ok: false, message: "Token expired" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerifyToken: null,
        emailVerifyTokenExp: null,
      },
    });

    return res.json({ ok: true, message: "Email verified." });
  } catch (err: any) {
    console.error("POST /auth/verify-email error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

function cryptoRandomToken(length: number) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export default router;
