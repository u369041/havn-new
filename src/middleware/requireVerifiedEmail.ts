import { prisma } from "../lib/prisma";

/**
 * requireVerifiedEmail
 * - Must be placed AFTER requireAuth.
 * - Blocks users with emailVerified=false.
 * - Current admins bypass email verification.
 */
export default async function requireVerifiedEmail(
  req: any,
  res: any,
  next: any
) {
  try {
    const userId = req?.user?.userId;

    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({
        ok: false,
        code: "AUTH_REQUIRED",
        message: "Authentication required",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        emailVerified: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        ok: false,
        code: "AUTH_REQUIRED",
        message: "User not found",
      });
    }

    // Use the user's current database role rather than a stale JWT claim.
    if (user.role === "admin") {
      return next();
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

    return res.status(500).json({
      ok: false,
      code: "SERVER_ERROR",
      message: "Server error",
    });
  }
}