import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

function signToken(user: any) {
  return jwt.sign(
    { role: user.role },
    process.env.JWT_SECRET!,
    {
      subject: String(user.id),
      expiresIn: "7d",
    }
  );
}

/**
 * POST /api/auth/login
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, message: "Missing email/password" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ ok: false, message: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ ok: false, message: "Invalid credentials" });
    }

    // ✅ AUTO-VERIFY ADMIN ACCOUNTS
    if (user.role === "admin" && user.emailVerified === false) {
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });
      user.emailVerified = true;
    }

    const token = signToken(user);

    res.json({
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
  } catch (e) {
    console.error("[POST /auth/login] error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * GET /api/auth/me
 */
router.get("/me", requireAuth, async (req: any, res) => {
  try {
    const userId = Number(req.user?.id);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        createdAt: true,
        emailVerified: true,
      },
    });

    if (!user) return res.status(404).json({ ok: false, message: "Not found" });

    res.json({ ok: true, user });
  } catch (e) {
    console.error("[GET /auth/me] error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/auth/request-email-verify
 */
router.post("/request-email-verify", requireAuth, async (req: any, res) => {
  try {
    const userId = Number(req.user?.id);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, emailVerified: true },
    });

    if (!user) return res.status(404).json({ ok: false, message: "Not found" });

    // ✅ Admin accounts automatically verified
    if (user.role === "admin") {
      if (!user.emailVerified) {
        await prisma.user.update({
          where: { id: user.id },
          data: { emailVerified: true },
        });
      }
      return res.json({ ok: true, message: "Admin accounts are already verified." });
    }

    if (user.emailVerified) {
      return res.json({ ok: true, message: "Email already verified." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1h

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifyToken: token,
        emailVerifyTokenExp: expiresAt,
      },
    });

    // ✅ Return verify URL (later we’ll email it)
    const verifyUrl = `https://api.havn.ie/api/auth/verify-email?token=${token}`;

    return res.json({ ok: true, verifyUrl });
  } catch (e) {
    console.error("[POST /auth/request-email-verify] error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * GET /api/auth/verify-email?token=...
 */
router.get("/verify-email", async (req, res) => {
  try {
    const token = String(req.query.token || "");
    if (!token) {
      return res.status(400).json({ ok: false, message: "Missing token" });
    }

    const user = await prisma.user.findFirst({
      where: {
        emailVerifyToken: token,
      },
    });

    if (!user) {
      return res.status(400).json({ ok: false, message: "Invalid token" });
    }

    if (!user.emailVerifyTokenExp || user.emailVerifyTokenExp < new Date()) {
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

    res.json({ ok: true, message: "Email verified successfully." });
  } catch (e) {
    console.error("[GET /auth/verify-email] error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;
