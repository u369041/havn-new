import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import Stripe from "stripe";
import requireAuth from "../middleware/requireAuth";
import requireAdminAuth from "../middleware/adminAuth";
import { prisma } from "../lib/prisma";
import {
  sendAgentApplicationReceivedEmail,
  sendAdminAgentApplicationNotificationEmail,
  sendEmailVerificationEmail,
  sendAgentApprovedEmail,
  sendAgentRejectedEmail,
  sendAdminAgentModerationConfirmationEmail,
} from "../lib/mail";

const router = Router();

const APP_URL = (process.env.APP_URL || "https://havn.ie").replace(
  /\/+$/,
  ""
);

const STRIPE_SECRET_KEY = String(
  process.env.STRIPE_SECRET_KEY || ""
).trim();

const STRIPE_AGENT_MONTHLY_PRICE_ID = String(
  process.env.STRIPE_AGENT_MONTHLY_PRICE_ID || ""
).trim();

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY)
  : null;

function getStripeClient() {
  if (!stripe) {
    throw new Error("STRIPE_SECRET_KEY is missing");
  }

  return stripe;
}

const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;

function passwordIsValid(password: string) {
  return (
    password.length >= MIN_PASSWORD_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH
  );
}

function emailIsValid(email: string) {
  return (
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

function makeToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET missing");
  }

  return secret;
}

function signAuthToken(user: {
  id: number;
  role: any;
  email: string;
}) {
  return jwt.sign(
    {
      role: user.role,
      email: user.email,
    },
    getJwtSecret(),
    {
      subject: String(user.id),
      expiresIn: "2h",
      algorithm: "HS256",
    }
  );
}

function toPositiveSafeInt(raw: any): number | null {
  const text = String(raw ?? "").trim();

  if (!/^\d+$/.test(text)) {
    return null;
  }

  const value = Number(text);

  if (!Number.isSafeInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function requiredText(
  value: unknown,
  maximumLength: number
): string | null {
  const text = String(value ?? "").trim();

  if (!text || text.length > maximumLength) {
    return null;
  }

  return text;
}

function optionalText(
  value: unknown,
  maximumLength: number
): string | null {
  const text = String(value ?? "").trim();

  if (!text) {
    return null;
  }

  if (text.length > maximumLength) {
    return null;
  }

  return text;
}

function normalizePsraLicenceNumber(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/**
 * POST /api/agents/register
 *
 * Creates:
 * - User with role "user"
 * - AgentProfile with status PENDING_APPROVAL
 *
 * The professional role is only granted after admin approval.
 */
router.post("/register", async (req, res) => {
  try {
    const firstName = requiredText(req.body?.firstName, 100);
    const lastName = requiredText(req.body?.lastName, 100);
    const companyName = requiredText(
      req.body?.companyName,
      200
    );

    const addressLine1 = requiredText(
      req.body?.addressLine1,
      200
    );
    const addressLine2 = optionalText(
      req.body?.addressLine2,
      200
    );
    const townCity = requiredText(req.body?.townCity, 120);
    const county = requiredText(req.body?.county, 100);
    const eircode = requiredText(req.body?.eircode, 20);

    const phoneNumber = requiredText(
      req.body?.phoneNumber,
      40
    );

    const psraLicenceNumber = normalizePsraLicenceNumber(
      req.body?.psraLicenceNumber
    );

    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();

    const password = String(req.body?.password || "");

    const declarationAccepted =
      req.body?.declarationAccepted === true;

    if (
      !firstName ||
      !lastName ||
      !companyName ||
      !addressLine1 ||
      !townCity ||
      !county ||
      !eircode ||
      !phoneNumber ||
      !psraLicenceNumber ||
      !email ||
      !password
    ) {
      return res.status(400).json({
        ok: false,
        message: "All required fields must be completed",
      });
    }

    if (!emailIsValid(email)) {
      return res.status(400).json({
        ok: false,
        message: "Please enter a valid email address",
      });
    }

    if (!passwordIsValid(password)) {
      return res.status(400).json({
        ok: false,
        message:
          `Password must be between ${MIN_PASSWORD_LENGTH} ` +
          `and ${MAX_PASSWORD_LENGTH} characters`,
      });
    }

    if (
      psraLicenceNumber.length < 3 ||
      psraLicenceNumber.length > 50
    ) {
      return res.status(400).json({
        ok: false,
        message: "Please enter a valid PSRA licence number",
      });
    }

    if (!declarationAccepted) {
      return res.status(400).json({
        ok: false,
        message:
          "You must accept the professional agent declaration",
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      return res.status(409).json({
        ok: false,
        message:
          "An account with these details already exists",
      });
    }

    const existingLicence =
      await prisma.agentProfile.findUnique({
        where: {
          psraLicenceNumber,
        },
        select: {
          id: true,
        },
      });

    if (existingLicence) {
      return res.status(409).json({
        ok: false,
        message:
          "An application already exists for this PSRA licence number",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = makeToken(24);
    const verificationExpiry = new Date(
      Date.now() + 30 * 60 * 1000
    );
    const declarationAcceptedAt = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          name: `${firstName} ${lastName}`,
          role: "user",
          emailVerifyToken: verificationToken,
          emailVerifyTokenExp: verificationExpiry,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      });

      const agentProfile = await tx.agentProfile.create({
        data: {
          userId: user.id,

          firstName,
          lastName,
          companyName,

          addressLine1,
          addressLine2,
          townCity,
          county,
          eircode,

          phoneNumber,
          psraLicenceNumber,

          status: "PENDING_APPROVAL",
          declarationAcceptedAt,
          psraVerified: false,
          subscriptionStatus: "NOT_STARTED",
        },
        select: {
          id: true,
          status: true,
          submittedAt: true,
          companyName: true,
          psraLicenceNumber: true,
          subscriptionStatus: true,
        },
      });

      return {
        user,
        agentProfile,
      };
    });

    const verifyUrl =
      `${APP_URL}/verify-email.html?token=` +
      encodeURIComponent(verificationToken);

    const mailPayload = {
      to: result.user.email,
      firstName,
      lastName,
      companyName,
      psraLicenceNumber,
      phoneNumber,
      addressLine1,
      addressLine2,
      townCity,
      county,
      eircode,
      submittedAt: result.agentProfile.submittedAt,
      adminUrl: `${APP_URL}/admin.html`,
    };

    /*
     * Email delivery must not roll back a valid application.
     * Failures are logged within the mail helpers.
     */
    void Promise.allSettled([
      sendAgentApplicationReceivedEmail(mailPayload),
      sendAdminAgentApplicationNotificationEmail(mailPayload),
      sendEmailVerificationEmail({
        to: result.user.email,
        name: result.user.name,
        verifyUrl,
      }),
    ]);

    const token = signAuthToken(result.user);

    return res.status(201).json({
      ok: true,
      token,
      application: {
        id: result.agentProfile.id,
        companyName: result.agentProfile.companyName,
        psraLicenceNumber:
          result.agentProfile.psraLicenceNumber,
        status: result.agentProfile.status,
        subscriptionStatus:
          result.agentProfile.subscriptionStatus,
        submittedAt: result.agentProfile.submittedAt,
      },
      message:
        "Your professional agent application has been submitted for review",
    });
  } catch (error: any) {
    if (error?.code === "P2002") {
      return res.status(409).json({
        ok: false,
        message:
          "An account or application with these details already exists",
      });
    }

    console.error(
      "POST /api/agents/register error",
      error
    );

    return res.status(500).json({
      ok: false,
      message:
        "Could not submit the professional agent application",
    });
  }
});

/**
 * POST /api/agents/login
 *
 * Pending, rejected and suspended applicants may authenticate so
 * the frontend can display their current application status.
 */
router.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();

    const password = String(req.body?.password || "");

    if (
      !emailIsValid(email) ||
      !password ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      return res.status(401).json({
        ok: false,
        message: "Invalid email or password",
      });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        agentProfile: {
          select: {
            id: true,
            companyName: true,
            psraLicenceNumber: true,
            status: true,
            psraVerified: true,
            submittedAt: true,
            approvedAt: true,
            rejectedAt: true,
            rejectedReason: true,
            suspendedAt: true,
            suspensionReason: true,
            archivedAt: true,

            subscriptionStatus: true,
            subscriptionStartedAt: true,
            subscriptionCurrentPeriodEnd: true,
            subscriptionCancelledAt: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(401).json({
        ok: false,
        message: "Invalid email or password",
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatches) {
      return res.status(401).json({
        ok: false,
        message: "Invalid email or password",
      });
    }

    if (!user.agentProfile) {
      return res.status(403).json({
        ok: false,
        error: "AGENT_APPLICATION_NOT_FOUND",
        message:
          "No professional agent application is associated with this account",
      });
    }

    await prisma.user
      .update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          loginCount: {
            increment: 1,
          },
        },
      })
      .catch(() => null);

    const token = signAuthToken(user);

    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
      },
      application: user.agentProfile,
    });
  } catch (error) {
    console.error("POST /api/agents/login error", error);

    return res.status(500).json({
      ok: false,
      message: "Could not sign in",
    });
  }
});

/**
 * GET /api/agents/me
 *
 * Returns the authenticated applicant's current professional profile,
 * moderation status and subscription status.
 */
router.get("/me", requireAuth, async (req: any, res) => {
  try {
    const userId = toPositiveSafeInt(req.user?.userId);

    if (userId === null) {
      return res.status(401).json({
        ok: false,
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
        createdAt: true,
        lastLoginAt: true,

        agentProfile: {
          select: {
            id: true,

            firstName: true,
            lastName: true,
            companyName: true,

            addressLine1: true,
            addressLine2: true,
            townCity: true,
            county: true,
            eircode: true,

            phoneNumber: true,
            psraLicenceNumber: true,

            status: true,
            psraVerified: true,
            submittedAt: true,

            approvedAt: true,

            rejectedAt: true,
            rejectedReason: true,

            suspendedAt: true,
            suspensionReason: true,

            archivedAt: true,

            subscriptionStatus: true,
            stripePriceId: true,
            subscriptionStartedAt: true,
            subscriptionCurrentPeriodEnd: true,
            subscriptionCancelledAt: true,

            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "Account not found",
      });
    }

    if (!user.agentProfile) {
      return res.status(404).json({
        ok: false,
        error: "AGENT_APPLICATION_NOT_FOUND",
        message:
          "No professional agent application is associated with this account",
      });
    }

    return res.json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
      application: user.agentProfile,
    });
  } catch (error) {
    console.error("GET /api/agents/me error", error);

    return res.status(500).json({
      ok: false,
      message:
        "Could not load the professional agent account",
    });
  }
});

/**
 * GET /api/agents/admin/applications
 *
 * Lists professional agent applications for the admin control centre.
 * Optional query parameter: ?status=PENDING_APPROVAL|APPROVED|REJECTED|SUSPENDED|ARCHIVED
 */
router.get(
  "/admin/applications",
  requireAuth,
  requireAdminAuth,
  async (req: any, res) => {
    try {
      const requestedStatus = String(req.query?.status || "")
        .trim()
        .toUpperCase();

      const allowedStatuses = new Set([
        "PENDING_APPROVAL",
        "APPROVED",
        "REJECTED",
        "SUSPENDED",
        "ARCHIVED",
      ]);

      if (requestedStatus && !allowedStatuses.has(requestedStatus)) {
        return res.status(400).json({
          ok: false,
          message: "Invalid agent application status",
        });
      }

      const applications = await prisma.agentProfile.findMany({
        where: requestedStatus
          ? { status: requestedStatus as any }
          : undefined,
        orderBy: [
          { status: "asc" },
          { submittedAt: "desc" },
        ],
        select: {
          id: true,
          userId: true,
          firstName: true,
          lastName: true,
          companyName: true,
          addressLine1: true,
          addressLine2: true,
          townCity: true,
          county: true,
          eircode: true,
          phoneNumber: true,
          psraLicenceNumber: true,
          status: true,
          declarationAcceptedAt: true,
          psraVerified: true,
          submittedAt: true,
          approvedAt: true,
          rejectedAt: true,
          rejectedReason: true,
          suspendedAt: true,
          suspensionReason: true,
          archivedAt: true,
          internalNote: true,
          subscriptionStatus: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              emailVerified: true,
              createdAt: true,
              lastLoginAt: true,
            },
          },
          approvedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          rejectedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          suspendedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      const counts = await prisma.agentProfile.groupBy({
        by: ["status"],
        _count: { _all: true },
      });

      return res.json({
        ok: true,
        applications,
        counts: counts.reduce<Record<string, number>>((acc, row) => {
          acc[String(row.status)] = row._count._all;
          return acc;
        }, {}),
      });
    } catch (error) {
      console.error("GET /api/agents/admin/applications error", error);

      return res.status(500).json({
        ok: false,
        message: "Could not load professional agent applications",
      });
    }
  }
);

/**
 * POST /api/agents/admin/applications/:id/approve
 *
 * Approves a pending application, verifies the PSRA record and grants
 * the associated user the professional agent role in one transaction.
 */
router.post(
  "/admin/applications/:id/approve",
  requireAuth,
  requireAdminAuth,
  async (req: any, res) => {
    try {
      const applicationId = toPositiveSafeInt(req.params?.id);
      const adminUserId = toPositiveSafeInt(req.user?.userId);
      const internalNote = optionalText(req.body?.internalNote, 2000);

      if (applicationId === null || adminUserId === null) {
        return res.status(400).json({
          ok: false,
          message: "Invalid application or administrator account",
        });
      }

      const existing = await prisma.agentProfile.findUnique({
        where: { id: applicationId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      });

      if (!existing) {
        return res.status(404).json({
          ok: false,
          message: "Agent application not found",
        });
      }

      if (existing.status !== "PENDING_APPROVAL") {
        return res.status(409).json({
          ok: false,
          message: "Only pending agent applications can be approved",
        });
      }

      const moderatedAt = new Date();

      const updated = await prisma.$transaction(async (tx) => {
        const application = await tx.agentProfile.update({
          where: { id: applicationId },
          data: {
            status: "APPROVED",
            psraVerified: true,
            approvedAt: moderatedAt,
            approvedById: adminUserId,
            rejectedAt: null,
            rejectedById: null,
            rejectedReason: null,
            suspendedAt: null,
            suspendedById: null,
            suspensionReason: null,
            archivedAt: null,
            internalNote,
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                emailVerified: true,
              },
            },
          },
        });

        await tx.user.update({
          where: { id: existing.userId },
          data: { role: "agent" },
        });

        return application;
      });

      const adminUser = await prisma.user.findUnique({
        where: { id: adminUserId },
        select: { name: true, email: true },
      });

      const mailPayload = {
        to: existing.user.email,
        firstName: existing.firstName,
        lastName: existing.lastName,
        companyName: existing.companyName,
        psraLicenceNumber: existing.psraLicenceNumber,
        phoneNumber: existing.phoneNumber,
        addressLine1: existing.addressLine1,
        addressLine2: existing.addressLine2,
        townCity: existing.townCity,
        county: existing.county,
        eircode: existing.eircode,
        submittedAt: existing.submittedAt,
        adminUrl: `${APP_URL}/admin.html`,
        agentHubUrl: `${APP_URL}/app/#/agent`,
      };

      void Promise.allSettled([
        sendAgentApprovedEmail(mailPayload),
        sendAdminAgentModerationConfirmationEmail({
          ...mailPayload,
          action: "APPROVED",
          moderatedBy: adminUser?.name || adminUser?.email || null,
          moderatedAt,
        }),
      ]);

      return res.json({
        ok: true,
        application: {
          ...updated,
          user: {
            ...updated.user,
            role: "agent",
          },
        },
        message: "Agent application approved successfully",
      });
    } catch (error) {
      console.error(
        "POST /api/agents/admin/applications/:id/approve error",
        error
      );

      return res.status(500).json({
        ok: false,
        message: "Could not approve the agent application",
      });
    }
  }
);

/**
 * POST /api/agents/admin/applications/:id/reject
 *
 * Rejects a pending application. A clear reason is mandatory and the
 * associated user remains a standard user.
 */
router.post(
  "/admin/applications/:id/reject",
  requireAuth,
  requireAdminAuth,
  async (req: any, res) => {
    try {
      const applicationId = toPositiveSafeInt(req.params?.id);
      const adminUserId = toPositiveSafeInt(req.user?.userId);
      const reason = requiredText(req.body?.reason, 2000);
      const internalNote = optionalText(req.body?.internalNote, 2000);

      if (applicationId === null || adminUserId === null) {
        return res.status(400).json({
          ok: false,
          message: "Invalid application or administrator account",
        });
      }

      if (!reason) {
        return res.status(400).json({
          ok: false,
          message: "A rejection reason is required",
        });
      }

      const existing = await prisma.agentProfile.findUnique({
        where: { id: applicationId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      });

      if (!existing) {
        return res.status(404).json({
          ok: false,
          message: "Agent application not found",
        });
      }

      if (existing.status !== "PENDING_APPROVAL") {
        return res.status(409).json({
          ok: false,
          message: "Only pending agent applications can be rejected",
        });
      }

      const moderatedAt = new Date();

      const updated = await prisma.$transaction(async (tx) => {
        const application = await tx.agentProfile.update({
          where: { id: applicationId },
          data: {
            status: "REJECTED",
            psraVerified: false,
            rejectedAt: moderatedAt,
            rejectedById: adminUserId,
            rejectedReason: reason,
            approvedAt: null,
            approvedById: null,
            suspendedAt: null,
            suspendedById: null,
            suspensionReason: null,
            archivedAt: null,
            internalNote,
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                emailVerified: true,
              },
            },
          },
        });

        await tx.user.update({
          where: { id: existing.userId },
          data: { role: "user" },
        });

        return application;
      });

      const adminUser = await prisma.user.findUnique({
        where: { id: adminUserId },
        select: { name: true, email: true },
      });

      const mailPayload = {
        to: existing.user.email,
        firstName: existing.firstName,
        lastName: existing.lastName,
        companyName: existing.companyName,
        psraLicenceNumber: existing.psraLicenceNumber,
        phoneNumber: existing.phoneNumber,
        addressLine1: existing.addressLine1,
        addressLine2: existing.addressLine2,
        townCity: existing.townCity,
        county: existing.county,
        eircode: existing.eircode,
        submittedAt: existing.submittedAt,
        reason,
        adminUrl: `${APP_URL}/admin.html`,
      };

      void Promise.allSettled([
        sendAgentRejectedEmail(mailPayload),
        sendAdminAgentModerationConfirmationEmail({
          ...mailPayload,
          action: "REJECTED",
          moderatedBy: adminUser?.name || adminUser?.email || null,
          moderatedAt,
        }),
      ]);

      return res.json({
        ok: true,
        application: {
          ...updated,
          user: {
            ...updated.user,
            role: "user",
          },
        },
        message: "Agent application rejected",
      });
    } catch (error) {
      console.error(
        "POST /api/agents/admin/applications/:id/reject error",
        error
      );

      return res.status(500).json({
        ok: false,
        message: "Could not reject the agent application",
      });
    }
  }
);

/**
 * POST /api/agents/subscription/checkout
 *
 * Creates a Stripe Checkout Session for the approved agent's
 * €250/month HAVN Professional subscription.
 */
router.post(
  "/subscription/checkout",
  requireAuth,
  async (req: any, res) => {
    try {
      const userId = toPositiveSafeInt(req.user?.userId);

      if (userId === null) {
        return res.status(401).json({
          ok: false,
          message: "Invalid authentication session",
        });
      }

      if (
        !STRIPE_SECRET_KEY ||
        !STRIPE_AGENT_MONTHLY_PRICE_ID
      ) {
        console.error(
          "Professional subscription Stripe configuration missing",
          {
            hasStripeSecretKey: Boolean(STRIPE_SECRET_KEY),
            hasAgentMonthlyPriceId: Boolean(
              STRIPE_AGENT_MONTHLY_PRICE_ID
            ),
          }
        );

        return res.status(503).json({
          ok: false,
          message:
            "Professional subscription checkout is not configured",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          emailVerified: true,
          role: true,

          agentProfile: {
            select: {
              id: true,
              status: true,
              companyName: true,
              subscriptionStatus: true,
              stripeCustomerId: true,
              stripeSubscriptionId: true,
            },
          },
        },
      });

      if (!user) {
        return res.status(404).json({
          ok: false,
          message: "Account not found",
        });
      }

      if (!user.agentProfile) {
        return res.status(404).json({
          ok: false,
          error: "AGENT_APPLICATION_NOT_FOUND",
          message:
            "No professional agent application is associated with this account",
        });
      }

      const agentProfile = user.agentProfile;

      if (!user.emailVerified) {
        return res.status(403).json({
          ok: false,
          error: "EMAIL_NOT_VERIFIED",
          message:
            "Please verify your email address before subscribing",
        });
      }

      if (
        user.role !== "agent" ||
        agentProfile.status !== "APPROVED"
      ) {
        return res.status(403).json({
          ok: false,
          error: "AGENT_NOT_APPROVED",
          message:
            "Your professional agent application must be approved before subscribing",
        });
      }

      if (
        agentProfile.subscriptionStatus === "ACTIVE" ||
        agentProfile.subscriptionStatus === "PAST_DUE" ||
        agentProfile.subscriptionStatus ===
          "CHECKOUT_PENDING"
      ) {
        return res.status(409).json({
          ok: false,
          error: "SUBSCRIPTION_ALREADY_EXISTS",
          message:
            "A professional subscription already exists or checkout is already in progress",
        });
      }

      const checkoutParameters: any =
        {
          mode: "subscription",

          line_items: [
            {
              price:
                STRIPE_AGENT_MONTHLY_PRICE_ID,
              quantity: 1,
            },
          ],

          client_reference_id: String(user.id),

          success_url:
            `${APP_URL}/agent-dashboard.html` +
            "?subscription=success" +
            "&session_id={CHECKOUT_SESSION_ID}",

          cancel_url:
            `${APP_URL}/agent-subscription.html` +
            "?subscription=cancel",

          metadata: {
            checkoutType: "AGENT_SUBSCRIPTION",
            userId: String(user.id),
            agentProfileId: String(
              agentProfile.id
            ),
            stripePriceId:
              STRIPE_AGENT_MONTHLY_PRICE_ID,
          },

          subscription_data: {
            metadata: {
              checkoutType: "AGENT_SUBSCRIPTION",
              userId: String(user.id),
              agentProfileId: String(
                agentProfile.id
              ),
              stripePriceId:
                STRIPE_AGENT_MONTHLY_PRICE_ID,
            },
          },
        };

      if (agentProfile.stripeCustomerId) {
        checkoutParameters.customer =
          agentProfile.stripeCustomerId;
      } else {
        checkoutParameters.customer_email =
          user.email;
      }

      const session =
        await getStripeClient().checkout.sessions.create(
          checkoutParameters
        );

      if (!session.url) {
        throw new Error(
          "Stripe did not return a subscription Checkout URL"
        );
      }

      await prisma.agentProfile.update({
        where: {
          id: agentProfile.id,
        },
        data: {
          subscriptionStatus:
            "CHECKOUT_PENDING",
          stripePriceId:
            STRIPE_AGENT_MONTHLY_PRICE_ID,
        },
      });

      console.log(
        "Professional subscription Checkout Session created",
        {
          userId: user.id,
          agentProfileId: agentProfile.id,
          checkoutSessionId: session.id,
          stripePriceId:
            STRIPE_AGENT_MONTHLY_PRICE_ID,
        }
      );

      return res.json({
        ok: true,
        url: session.url,
        checkoutSessionId: session.id,
      });
    } catch (error: any) {
      console.error(
        "POST /api/agents/subscription/checkout error",
        {
          message: error?.message,
          type: error?.type,
          code: error?.code,
          stack: error?.stack,
        }
      );

      return res.status(500).json({
        ok: false,
        message:
          "Could not create professional subscription checkout",
      });
    }
  }
);

/**
 * POST /api/agents/subscription/portal
 *
 * Creates a Stripe Billing Portal session for an existing
 * professional subscriber.
 */
router.post(
  "/subscription/portal",
  requireAuth,
  async (req: any, res) => {
    try {
      const userId = toPositiveSafeInt(req.user?.userId);

      if (userId === null) {
        return res.status(401).json({
          ok: false,
          message: "Invalid authentication session",
        });
      }

      if (!STRIPE_SECRET_KEY) {
        return res.status(503).json({
          ok: false,
          message:
            "Stripe Billing Portal is not configured",
        });
      }

      const agentProfile =
        await prisma.agentProfile.findUnique({
          where: {
            userId,
          },
          select: {
            id: true,
            stripeCustomerId: true,
          },
        });

      if (!agentProfile) {
        return res.status(404).json({
          ok: false,
          error: "AGENT_APPLICATION_NOT_FOUND",
          message:
            "No professional agent application is associated with this account",
        });
      }

      if (!agentProfile.stripeCustomerId) {
        return res.status(400).json({
          ok: false,
          error: "STRIPE_CUSTOMER_NOT_FOUND",
          message:
            "No billing account exists for this professional account",
        });
      }

      const portalSession =
        await getStripeClient().billingPortal.sessions.create({
          customer:
            agentProfile.stripeCustomerId,
          return_url:
            `${APP_URL}/agent-dashboard.html`,
        });

      return res.json({
        ok: true,
        url: portalSession.url,
      });
    } catch (error: any) {
      console.error(
        "POST /api/agents/subscription/portal error",
        {
          message: error?.message,
          type: error?.type,
          code: error?.code,
          stack: error?.stack,
        }
      );

      return res.status(500).json({
        ok: false,
        message:
          "Could not open the Stripe Billing Portal",
      });
    }
  }
);

export default router;

