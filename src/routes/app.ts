import { Router, RequestHandler } from "express";
import requireAuth from "../middleware/requireAuth";
import { prisma } from "../lib/prisma";
import { getAnalyticsOverview } from "../services/analytics";

const router = Router();

/**
 * Protected application responses must never be cached by
 * browsers, proxies or CDNs.
 */
router.use((_req, res, next) => {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, private"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  next();
});

function getSuperAdminUserIds(): Set<number> {
  const raw = String(
    process.env.HAVN_SUPER_ADMIN_USER_IDS || ""
  ).trim();

  if (!raw) {
    return new Set();
  }

  const ids = raw
    .split(",")
    .map((value) => Number(value.trim()))
    .filter(
      (value) =>
        Number.isSafeInteger(value) && value > 0
    );

  return new Set(ids);
}

/**
 * GET /api/app/session
 *
 * General secure application session.
 *
 * Available to every authenticated HAVN user.
 * This endpoint does not require an AgentProfile or subscription.
 */
const getAppSession: RequestHandler = async (
  req: any,
  res
) => {
  try {
    const userId = Number(req.user?.userId);

    if (
      !Number.isSafeInteger(userId) ||
      userId <= 0
    ) {
      return res.status(401).json({
        ok: false,
        error: "INVALID_AUTHENTICATION_SESSION",
        message: "Invalid authentication session",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        emailVerified: true,
        savedSearchEmailsEnabled: true,
        listingEmailsEnabled: true,
        productEmailsEnabled: true,
        agentProfile: {
          select: {
            id: true,
            companyName: true,
            status: true,
            subscriptionStatus: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "ACCOUNT_NOT_FOUND",
        message: "Account not found",
      });
    }

    const superAdminUserIds =
      getSuperAdminUserIds();

    const isSuperAdmin =
      user.role === "admin" &&
      superAdminUserIds.has(user.id);

    const hasApprovedAgentProfile =
      user.agentProfile?.status === "APPROVED";

    const hasActiveAgentSubscription =
      user.agentProfile?.subscriptionStatus ===
      "ACTIVE";

    const canAccessAgentHub =
      isSuperAdmin ||
      (
        user.role === "agent" &&
        user.emailVerified === true &&
        hasApprovedAgentProfile &&
        hasActiveAgentSubscription
      );

    const canAccessAdmin =
      user.role === "admin";

    return res.json({
      ok: true,

      application: {
        authenticated: true,
        defaultRoute: canAccessAgentHub
          ? "/app/agent"
          : "/app/dashboard",
      },

      account: {
        userId: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
        isSuperAdmin,
      },

      preferences: {
        savedSearchEmailsEnabled:
          user.savedSearchEmailsEnabled,
        listingEmailsEnabled:
          user.listingEmailsEnabled,
        productEmailsEnabled:
          user.productEmailsEnabled,
      },

      professional: {
        agentProfileId:
          user.agentProfile?.id ?? null,
        companyName:
          user.agentProfile?.companyName ?? null,
        applicationStatus:
          user.agentProfile?.status ?? null,
        subscriptionStatus:
          user.agentProfile?.subscriptionStatus ??
          null,
      },

      permissions: {
        canAccessApp: true,
        canAccessDashboard: true,
        canManageOwnListings: true,
        canAccessOwnEnquiries: true,
        canAccessSavedSearches: true,
        canAccessAgentHub,
        canAccessAdmin,
      },
    });
  } catch (error) {
    console.error(
      "GET /api/app/session error",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "APP_SESSION_FAILED",
      message:
        "Could not initialise the application session",
    });
  }
};

router.get(
  "/session",
  requireAuth,
  getAppSession
);

router.get(
  "/analytics/overview",
  requireAuth,
  async (req: any, res) => {
    const userId = Number(req.user?.userId);

    if (
      !Number.isSafeInteger(userId) ||
      userId <= 0
    ) {
      return res.status(401).json({
        ok: false,
        error: "INVALID_AUTHENTICATION_SESSION",
      });
    }

    const analytics =
      await getAnalyticsOverview({
        userId,
      });

    return res.json({
      ok: true,
      ...analytics,
    });
  }
);

export default router;