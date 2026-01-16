import { prisma } from "../lib/prisma";

/**
 * requireVerifiedEmail
 * - Must be placed AFTER requireAuth.
 * - Blocks users with emailVerified=false (admins bypass).
 */
export default async function requireVerifiedEmail(req: any, res: any, next: any) {
  try {
    const userId = req?.user?.userId;
    const role = req?.user?.role;

    if (!userId) {
      return res.status(401).json({ ok: false, code: "AUTH_REQUIRED", message: "Authentication required" });
    }

    // Admin bypass
    if (role === "admin") return next();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerified: true },
    });

    if (!user) {
      return res.status(401).json({ ok: false, code: "AUTH_REQUIRED", message: "User not found" });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        ok: false,
        code: "EMAIL_NOT_VERIFIED",
        message: "Please verify your email to continue.",
      });
    }

    return next();
  } catch (err) {
    console.error("requireVerifiedEmail error:", err);
    return res.status(500).json({ ok: false, code: "SERVER_ERROR", message: "Server error" });
  }
}
