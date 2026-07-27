import {
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";
import requireAuth from "./requireAuth";
import { prisma } from "../lib/prisma";

type AgentAccessRequest = Request & {
  user?: {
    userId: number;
    role: string;
    email?: string | null;
  };

  agentAccess?: {
    userId: number;
    agentProfileId: number | null;
    role: string;
    companyName: string | null;
    isSuperAdmin: boolean;
  };
};

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
 * Strict professional Agent Hub access middleware.
 *
 * Normal professional users must have:
 * - valid authentication
 * - verified email address
 * - AgentProfile
 * - APPROVED application status
 * - ACTIVE subscription
 *
 * Explicitly configured HAVN super-admin users may bypass
 * the AgentProfile and subscription requirements.
 */
const requireActiveAgent: RequestHandler = (
  req: AgentAccessRequest,
  res: Response,
  next: NextFunction
) => {
  return requireAuth(req, res, async () => {
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
          role: true,
          emailVerified: true,

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

      if (isSuperAdmin) {
        req.agentAccess = {
          userId: user.id,
          agentProfileId:
            user.agentProfile?.id ?? null,
          role: user.role,
          companyName:
            user.agentProfile?.companyName ?? null,
          isSuperAdmin: true,
        };

        return next();
      }

      if (!user.emailVerified) {
        return res.status(403).json({
          ok: false,
          error: "EMAIL_NOT_VERIFIED",
          message:
            "Your email address must be verified before accessing the Agent Hub",
        });
      }

      if (!user.agentProfile) {
        return res.status(403).json({
          ok: false,
          error: "AGENT_APPLICATION_NOT_FOUND",
          message:
            "A professional agent application is required",
        });
      }

      if (
        user.role !== "agent" ||
        user.agentProfile.status !== "APPROVED"
      ) {
        return res.status(403).json({
          ok: false,
          error: "AGENT_NOT_APPROVED",
          message:
            "Your professional agent application has not been approved",
        });
      }

      if (
        user.agentProfile.subscriptionStatus !==
        "ACTIVE"
      ) {
        return res.status(403).json({
          ok: false,
          error: "ACTIVE_SUBSCRIPTION_REQUIRED",
          message:
            "An active HAVN Professional subscription is required",
        });
      }

      req.agentAccess = {
        userId: user.id,
        agentProfileId: user.agentProfile.id,
        role: user.role,
        companyName:
          user.agentProfile.companyName,
        isSuperAdmin: false,
      };

      return next();
    } catch (error) {
      console.error(
        "requireActiveAgent middleware error",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "AGENT_ACCESS_CHECK_FAILED",
        message:
          "Could not verify professional account access",
      });
    }
  });
};

export default requireActiveAgent;