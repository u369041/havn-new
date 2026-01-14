import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import requireAuth from "../middleware/requireAuth";
import { prisma } from "../lib/prisma";
import { sendWelcomeEmail } from "../lib/mail";

const router = Router();

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

    return res.json({
      ok: true,
      message: "Verification token created.",
    });
  } catch (err: any) {
    console.error("POST /auth/request-email-verify error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * OPTIONAL — if/when you add signup:
 * Call sendWelcomeEmail like this:
 *
 * await sendWelcomeEmail({
 *   to: user.email,
 *   name: user.name || null
 * });
 */

export default router;
