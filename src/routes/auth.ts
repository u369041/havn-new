import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
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

function getBaseUrl(req: any) {
  // Prefer env, fallback to request host
  // In Render you can set BASE_URL=https://api.havn.ie
  const envBase = process.env.BASE_URL;
  if (envBase) return envBase.replace(/\/+$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function authBearer(req: any): string | null {
  const auth = String(req.headers.authorization || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function requireUserFromJwt(req: any) {
  const token = authBearer(req);
  if (!token) throw new Error("Missing Bearer token");
  const secret = requireEnv("JWT_SECRET");
  const payload = jwt.verify(token, secret) as any;
  const userId = Number(payload?.sub);
  if (!userId) throw new Error("Invalid token");
  return { userId, role: payload?.role as "admin" | "user" };
}

/**
 * POST /api/auth/bootstrap-admin
 * - Creates first admin user (guarded by ADMIN_BOOTSTRAP_TOKEN)
 * - Only allowed if there are currently 0 admins in DB
 */
router.post("/bootstrap-admin", async (req, res) => {
  try {
    const token = requireEnv("ADMIN_BOOTSTRAP_TOKEN");
    const provided = String(req.headers["x-bootstrap-token"] || "");
    if (!provided || provided !== token) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const existingAdmins = await prisma.user.count({ where: { role: "admin" } });
    if (existingAdmins > 0) {
      return res.status(400).json({ ok: false, error: "Admin already exists" });
    }

    const { email, password, name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "email and password required" });
    }

    const hash = await bcrypt.hash(password, 10);

    const admin = await prisma.user.create({
      data: {
        email: String(email).toLowerCase(),
        password: hash,
        name: name ? String(name) : null,
        role: "admin",
        emailVerified: true, // ✅ bootstrap admin is verified
        emailVerifyToken: null,
        emailVerifySentAt: null,
      },
      select: { id: true, email: true, role: true, name: true, createdAt: true, emailVerified: true },
    });

    const jwtToken = signToken(admin.id, "admin");

    return res.json({ ok: true, admin, token: jwtToken });
  } catch (err: any) {
    console.error("[POST /auth/bootstrap-admin] error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
});

/**
 * POST /api/auth/register
 * - Creates normal user
 */
router.post("/register", async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "email and password required" });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(400).json({ ok: false, error: "Email already in use" });
    }

    const hash = await bcrypt.hash(String(password), 10);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hash,
        name: name ? String(name) : null,
        role: "user",
        emailVerified: false,
        emailVerifyToken: null,
        emailVerifySentAt: null,
      },
      select: { id: true, email: true, role: true, name: true, createdAt: true, emailVerified: true },
    });

    const token = signToken(user.id, "user");

    return res.json({ ok: true, user, token });
  } catch (err: any) {
    console.error("[POST /auth/register] error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
});

/**
 * POST /api/auth/login
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "email and password required" });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        password: true,
        role: true,
        name: true,
        createdAt: true,
        emailVerified: true,
      },
    });

    if (!user) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(String(password), user.password);
    if (!ok) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    const token = signToken(user.id, user.role);

    const safeUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      createdAt: user.createdAt,
      emailVerified: user.emailVerified,
    };

    return res.json({ ok: true, user: safeUser, token });
  } catch (err: any) {
    console.error("[POST /auth/login] error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
});

/**
 * GET /api/auth/me
 * - Returns user info for current token
 */
router.get("/me", async (req, res) => {
  try {
    const { userId } = await requireUserFromJwt(req);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, name: true, createdAt: true, emailVerified: true },
    });

    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    return res.json({ ok: true, user });
  } catch (err: any) {
    return res.status(401).json({ ok: false, error: err?.message || "Unauthorized" });
  }
});

/**
 * ✅ NEW: POST /api/auth/request-email-verify
 * - Must be logged in
 * - Generates a token and stores it on the user
 * - Returns verify URL (for now we return it; later we email it)
 */
router.post("/request-email-verify", async (req, res) => {
  try {
    const { userId, role } = await requireUserFromJwt(req);

    // Admins are always verified
    if (role === "admin") {
      return res.json({ ok: true, message: "Admin accounts are already verified." });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, emailVerified: true },
    });

    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    if (user.emailVerified) {
      return res.json({ ok: true, message: "Email already verified." });
    }

    const token = crypto.randomBytes(32).toString("hex");

    await prisma.user.update({
      where: { id: userId },
      data: {
        emailVerifyToken: token,
        emailVerifySentAt: new Date(),
      },
    });

    const base = getBaseUrl(req);
    const verifyUrl = `${base}/api/auth/verify-email?token=${token}`;

    // ✅ For now, we return the link in JSON.
    // Later: plug in Resend/SendGrid and email it.
    return res.json({
      ok: true,
      message: "Verification token generated.",
      verifyUrl,
    });
  } catch (err: any) {
    console.error("[POST /auth/request-email-verify] error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
});

/**
 * ✅ NEW: GET /api/auth/verify-email?token=...
 * - Marks the user verified and clears token
 */
router.get("/verify-email", async (req, res) => {
  try {
    const token = String(req.query.token || "").trim();
    if (!token) {
      return res.status(400).json({ ok: false, error: "Missing token" });
    }

    const user = await prisma.user.findFirst({
      where: { emailVerifyToken: token },
      select: { id: true, email: true, emailVerified: true },
    });

    if (!user) {
      return res.status(400).json({ ok: false, error: "Invalid or expired token" });
    }

    if (user.emailVerified) {
      // still clear token to avoid reuse
      await prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerifyToken: null,
          emailVerifySentAt: null,
          emailVerified: true,
        },
      });

      return res.json({ ok: true, message: "Email already verified." });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerifyToken: null,
        emailVerifySentAt: null,
      },
    });

    // Later: redirect to frontend success page
    return res.json({ ok: true, message: "Email verified successfully." });
  } catch (err: any) {
    console.error("[GET /auth/verify-email] error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
});

export default router;
