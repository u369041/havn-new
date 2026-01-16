import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import requireAuth from "../middleware/requireAuth";
import { prisma } from "../lib/prisma";
import { sendWelcomeEmail } from "../lib/mail";

const router = Router();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

/**
 * POST /api/auth/register
 * Body: { firstName, lastName, email, password }
 */
router.post("/register", async (req, res) => {
  try {
    const firstName = String(req.body.firstName || "").trim();
    const lastName = String(req.body.lastName || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ ok: false, message: "All fields are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, message: "Password must be at least 8 characters" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ ok: false, message: "Server misconfigured" });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ ok: false, message: "Email already in use" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const fullName = `${firstName} ${lastName}`.trim();

    const user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        role: "user",
        name: fullName,
        // keep emailVerified default behaviour (schema might default false)
      },
    });

    // Welcome email (await with short timeout; never blocks signup)
    console.log("REGISTER: attempting welcome email for", user.email);
    try {
      const result = await withTimeout(
        sendWelcomeEmail({ to: user.email, name: user.name || null }),
        3500
      );
      console.log("REGISTER: welcome email result", result);
    } catch (e: any) {
      console.error("REGISTER: welcome email failed (non-blocking):", e?.message || e);
    }

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
        emailVerified: (user as any).emailVerified ?? false,
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
        emailVerified: (user as any).emailVerified ?? false,
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
        emailVerified: (user as any).emailVerified ?? false,
      },
    });
  } catch (err: any) {
    console.error("GET /auth/me error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/auth/_send-welcome-test
 * Admin-only: send welcome email to any address without creating users.
 * Body: { to, name? }
 */
router.post("/_send-welcome-test", requireAuth, async (req: any, res) => {
  try {
    const role = req.user?.role;
    if (role !== "admin") {
      return res.status(403).json({ ok: false, message: "Admin only" });
    }

    const to = String(req.body?.to || "").trim();
    const name = req.body?.name != null ? String(req.body.name) : null;

    if (!to) {
      return res.status(400).json({ ok: false, message: "Missing 'to' email" });
    }

    const result = await sendWelcomeEmail({ to, name });

    return res.json({ ok: true, result });
  } catch (err: any) {
    console.error("POST /auth/_send-welcome-test error", err);
    return res.status(500).json({
      ok: false,
      message: "Failed to send welcome email",
      error: err?.message || String(err),
    });
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

    if ((user as any).emailVerified) {
      return res.json({ ok: true, message: "Email already verified." });
    }

    const verifyToken = cryptoRandomToken(32);

    // Token expires in 30 minutes
    const exp = new Date(Date.now() + 30 * 60 * 1000);

    await prisma.user.update({
      where: { id: userId },
      data: {
        emailVerifyToken: verifyToken as any,
        emailVerifyTokenExp: exp as any,
      } as any,
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
      where: { emailVerifyToken: token as any } as any,
    });

    if (!user) return res.status(400).json({ ok: false, message: "Invalid token" });

    // Token expired?
    if ((user as any).emailVerifyTokenExp && (user as any).emailVerifyTokenExp.getTime() < Date.now()) {
      return res.status(400).json({ ok: false, message: "Token expired" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true as any,
        emailVerifyToken: null as any,
        emailVerifyTokenExp: null as any,
      } as any,
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
