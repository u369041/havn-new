import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import requireAuth from "../middleware/requireAuth";
import { prisma } from "../lib/prisma";
import {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
} from "../lib/mail";
import crypto from "crypto";

const router = Router();

const APP_URL = (process.env.APP_URL || "https://havn.ie").replace(/\/+$/, "");

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

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function makeToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
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
        // emailVerified defaults false in schema
      },
    });

    // Welcome email (non-blocking)
    try {
      await withTimeout(sendWelcomeEmail({ to: user.email, name: user.name || null }), 3500);
    } catch (e: any) {
      console.error("REGISTER: welcome email failed (non-blocking):", e?.message || e);
    }

    // ✅ Email verification token + email (non-blocking)
    try {
      const verifyToken = makeToken(24);
      const exp = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

      await prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerifyToken: verifyToken,
          emailVerifyTokenExp: exp,
        },
      });

      const verifyUrl = `${APP_URL}/verify-email.html?token=${encodeURIComponent(verifyToken)}`;

      sendEmailVerificationEmail({
        to: user.email,
        name: user.name || null,
        verifyUrl,
      }).catch((e) => {
        console.error("REGISTER: verify email failed (non-blocking):", e?.message || e);
      });
    } catch (e: any) {
      console.error("REGISTER: verify token create failed (non-blocking):", e?.message || e);
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
        emailVerified: user.emailVerified,
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

    // Optional login tracking (safe / non-blocking)
    prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        loginCount: { increment: 1 },
      },
    }).catch(() => null);

    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        createdAt: user.createdAt,
        emailVerified: user.emailVerified,
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
        emailVerified: user.emailVerified,
      },
    });
  } catch (err: any) {
    console.error("GET /auth/me error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 * Always returns ok:true to prevent enumeration.
 */
router.post("/forgot-password", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.json({ ok: true });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.json({ ok: true });

    // Cleanup prior tokens for this user
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }).catch(() => null);

    const rawToken = makeToken(32);
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 60 min

    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    // ✅ FIX: include email param so reset-password.html can submit safely
    const resetUrl =
      `${APP_URL}/reset-password.html` +
      `?token=${encodeURIComponent(rawToken)}` +
      `&email=${encodeURIComponent(email)}`;

    // Non-blocking send
    sendPasswordResetEmail({ to: user.email, name: user.name || null, resetUrl }).catch((e) => {
      console.error("forgot-password: email failed:", e?.message || e);
    });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("POST /auth/forgot-password error", err);
    return res.json({ ok: true }); // enumeration-safe
  }
});

/**
 * POST /api/auth/reset-password
 * Body (new): { email, token, newPassword }
 * Body (legacy): { token, password }
 */
router.post("/reset-password", async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();

    // ✅ Accept both new + legacy fields
    const email = req.body.email != null ? String(req.body.email).trim().toLowerCase() : "";
    const newPassword =
      req.body.newPassword != null ? String(req.body.newPassword) :
      req.body.password != null ? String(req.body.password) :
      "";

    if (!token || newPassword.length < 8) {
      return res.status(400).json({ ok: false, message: "Invalid request" });
    }

    const tokenHash = sha256(token);

    const rec = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!rec) return res.status(400).json({ ok: false, message: "Invalid or expired token" });

    if (rec.expiresAt.getTime() < Date.now()) {
      await prisma.passwordResetToken.delete({ where: { id: rec.id } }).catch(() => null);
      return res.status(400).json({ ok: false, message: "Invalid or expired token" });
    }

    // ✅ If email was provided, enforce token belongs to that email's user
    if (email) {
      const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (!u || u.id !== rec.userId) {
        return res.status(400).json({ ok: false, message: "Invalid or expired token" });
      }
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    // ✅ Reset password + invalidate tokens
    await prisma.$transaction([
      prisma.user.update({
        where: { id: rec.userId },
        data: { password: hashed },
      }),
      prisma.passwordResetToken.delete({ where: { id: rec.id } }),
      prisma.passwordResetToken.deleteMany({ where: { userId: rec.userId } }),
    ]);

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("POST /auth/reset-password error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/auth/request-email-verify
 * Creates and stores token, and emails the link.
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

    const verifyToken = makeToken(24);
    const exp = new Date(Date.now() + 30 * 60 * 1000);

    await prisma.user.update({
      where: { id: userId },
      data: {
        emailVerifyToken: verifyToken,
        emailVerifyTokenExp: exp,
      },
    });

    const verifyUrl = `${APP_URL}/verify-email.html?token=${encodeURIComponent(verifyToken)}`;

    // Non-blocking send
    sendEmailVerificationEmail({ to: user.email, name: user.name || null, verifyUrl }).catch((e) => {
      console.error("request-email-verify: email failed:", e?.message || e);
    });

    return res.json({
      ok: true,
      message: "Verification email sent.",
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

/**
 * POST /api/auth/_send-welcome-test
 * Admin-only + feature-flagged.
 * Body: { to, name? }
 */
router.post("/_send-welcome-test", requireAuth, async (req: any, res) => {
  try {
    if (process.env.ENABLE_EMAIL_TEST_ENDPOINT !== "true") {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    const role = req.user?.role;
    if (role !== "admin") {
      return res.status(403).json({ ok: false, message: "Admin only" });
    }

    const to = String(req.body?.to || "").trim();
    const name = req.body?.name != null ? String(req.body.name) : null;
    if (!to) return res.status(400).json({ ok: false, message: "Missing 'to' email" });

    const result = await sendWelcomeEmail({ to, name });
    return res.json({ ok: true, result });
  } catch (err: any) {
    console.error("POST /auth/_send-welcome-test error", err);
    return res.status(500).json({ ok: false, message: "Failed", error: err?.message || String(err) });
  }
});

export default router;
