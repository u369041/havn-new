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

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function makeToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * REGISTER
 */
router.post("/register", async (req, res) => {
  try {
    const firstName = String(req.body.firstName || "").trim();
    const lastName = String(req.body.lastName || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ ok: false, message: "All fields required" });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ ok: false, message: "Email in use" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        name: `${firstName} ${lastName}`,
      },
    });

    sendWelcomeEmail({ to: email, name: user.name || null }).catch(() => {});

    const verifyToken = makeToken(24);
    const exp = new Date(Date.now() + 30 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifyToken: verifyToken,
        emailVerifyTokenExp: exp,
      },
    });

    const verifyUrl = `${APP_URL}/verify-email.html?token=${verifyToken}`;

    sendEmailVerificationEmail({
      to: email,
      name: user.name || null,
      verifyUrl,
    }).catch(() => {});

    const token = jwt.sign(
      { role: user.role, email: user.email },
      process.env.JWT_SECRET!,
      { subject: String(user.id), expiresIn: "2h" }
    );

    res.json({ ok: true, token });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

/**
 * LOGIN
 */
router.post("/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ ok: false });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ ok: false });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        loginCount: { increment: 1 },
      },
    }).catch(() => null);

    const token = jwt.sign(
      { role: user.role, email: user.email },
      process.env.JWT_SECRET!,
      { subject: String(user.id), expiresIn: "2h" }
    );

    res.json({ ok: true, token });
  } catch {
    res.status(500).json({ ok: false });
  }
});

/**
 * ME
 */
router.get("/me", requireAuth, async (req: any, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
  });

  res.json({
    ok: true,
    user: {
      ...user,
      lastSearch: user?.lastSearch,
      lastSearchAt: user?.lastSearchAt,
    },
  });
});

/**
 * LAST SEARCH
 */
router.post("/last-search", requireAuth, async (req: any, res) => {
  try {
    await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        lastSearch: req.body,
        lastSearchAt: new Date(),
      },
    });

    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

/**
 * ============================
 * SAVED SEARCHES
 * ============================
 */

router.post("/saved-searches", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.userId;
    const { name, filters } = req.body;

    if (!filters) {
      return res.status(400).json({ ok: false, message: "Filters required" });
    }

    const saved = await prisma.savedSearch.create({
      data: {
        userId,
        name: name || "My search",
        filters,
      },
    });

    res.json({ ok: true, saved });
  } catch {
    res.status(500).json({ ok: false });
  }
});

router.get("/saved-searches", requireAuth, async (req: any, res) => {
  try {
    const searches = await prisma.savedSearch.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: "desc" },
    });

    res.json({ ok: true, searches });
  } catch {
    res.status(500).json({ ok: false });
  }
});

router.delete("/saved-searches/:id", requireAuth, async (req: any, res) => {
  try {
    const id = Number(req.params.id);

    const existing = await prisma.savedSearch.findUnique({ where: { id } });

    if (!existing || existing.userId !== req.user.userId) {
      return res.status(404).json({ ok: false });
    }

    await prisma.savedSearch.delete({ where: { id } });

    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

/**
 * FORGOT PASSWORD
 */
router.post("/forgot-password", async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase();

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.json({ ok: true });

    const token = makeToken();
    const hash = sha256(token);

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });

    const resetUrl = `${APP_URL}/reset-password.html?token=${token}&email=${email}`;

    sendPasswordResetEmail({ to: email, resetUrl }).catch(() => {});

    res.json({ ok: true });
  } catch {
    res.json({ ok: true });
  }
});

/**
 * RESET PASSWORD
 */
router.post("/reset-password", async (req, res) => {
  try {
    const { token, email, newPassword } = req.body;

    const hash = sha256(token);

    const rec = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hash },
    });

    if (!rec) return res.status(400).json({ ok: false });

    const hashed = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: rec.userId },
      data: { password: hashed },
    });

    await prisma.passwordResetToken.deleteMany({
      where: { userId: rec.userId },
    });

    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

/**
 * VERIFY EMAIL
 */
router.post("/verify-email", async (req, res) => {
  try {
    const { token } = req.body;

    const user = await prisma.user.findFirst({
      where: { emailVerifyToken: token },
    });

    if (!user) return res.status(400).json({ ok: false });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerifyToken: null,
        emailVerifyTokenExp: null,
      },
    });

    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

export default router;