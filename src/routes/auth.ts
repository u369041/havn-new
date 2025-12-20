import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

const router = Router();

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function signToken(userId: number, role: "admin" | "user") {
  const secret = mustEnv("JWT_SECRET");
  return jwt.sign({ userId, role }, secret, { expiresIn: "7d" });
}

router.post("/bootstrap-admin", async (req, res) => {
  const bootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN;
  if (!bootstrapToken) {
    return res.status(403).json({ error: "Bootstrap disabled (ADMIN_BOOTSTRAP_TOKEN not set)" });
  }

  const headerToken = String(req.headers["x-bootstrap-token"] || "");
  if (!headerToken || headerToken !== bootstrapToken) {
    return res.status(401).json({ error: "Invalid bootstrap token" });
  }

  const { email, password, name } = req.body as { email?: string; password?: string; name?: string };
  if (!email || !password) {
    return res.status(400).json({ error: "Missing email/password" });
  }

  const existingAdmins = await prisma.user.count({ where: { role: "admin" } });
  if (existingAdmins > 0) {
    return res.status(409).json({ error: "Admin already exists. Bootstrap not allowed." });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "User already exists with that email" });
  }

  const hash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: { email, password: hash, role: "admin", name: name || null },
    select: { id: true, email: true, role: true, name: true },
  });

  const token = signToken(user.id, "admin");
  return res.json({ ok: true, token, user });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) return res.status(400).json({ error: "Missing email/password" });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "Invalid email or password" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: "Invalid email or password" });

  const token = signToken(user.id, user.role as "admin" | "user");
  return res.json({
    ok: true,
    token,
    user: { email: user.email, role: user.role, name: user.name },
  });
});

router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const me = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { email: true, role: true, name: true, createdAt: true },
  });
  if (!me) return res.status(404).json({ error: "User not found" });
  return res.json({ ok: true, user: me });
});

export default router;
