import { Router } from "express";
import { prisma } from "../lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendPasswordResetEmail } from "../lib/mail";

const router = Router();

/**
 * POST /api/auth/password/forgot
 * Request password reset email
 */
router.post("/forgot", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ ok: false, message: "Email required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    // Always return success (no email enumeration)
    if (!user) {
      return res.json({ ok: true });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = await bcrypt.hash(token, 10);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    // ✅ Mail helper expects { to, name?, resetUrl }
    // ✅ Put the token on the URL instead of passing a "token" prop.
    const resetUrl =
      "https://havn.ie/reset-password.html?token=" + encodeURIComponent(token) +
      "&email=" + encodeURIComponent(user.email);

    await sendPasswordResetEmail({
      to: user.email,
      name: user.name || undefined,
      resetUrl,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /auth/password/forgot error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/auth/password/reset
 * Reset password using token
 */
router.post("/reset", async (req, res) => {
  try {
    const token = String(req.body.token || "");
    const password = String(req.body.password || "");

    if (!token || password.length < 8) {
      return res.status(400).json({ ok: false, message: "Invalid request" });
    }

    const records = await prisma.passwordResetToken.findMany({
      where: {
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    const match = await Promise.all(
      records.map(async (r) => ({
        record: r,
        ok: await bcrypt.compare(token, r.tokenHash),
      }))
    ).then((rows) => rows.find((r) => r.ok)?.record);

    if (!match) {
      return res.status(400).json({ ok: false, message: "Invalid or expired token" });
    }

    const hash = await bcrypt.hash(password, 12);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: match.userId },
        data: { password: hash },
      }),
      prisma.passwordResetToken.update({
        where: { id: match.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /auth/password/reset error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;
