import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import requireAuth from "../middleware/requireAuth";
import { prisma } from "../lib/prisma";
import {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
  sendEmailChangeVerificationEmail,
  sendAccountDeletionScheduledEmail,
  sendAccountDeletionCancelledEmail,
} from "../lib/mail";
import crypto from "crypto";
const archiver: any = require("archiver");

const router = Router();

const APP_URL = (process.env.APP_URL || "https://havn.ie").replace(/\/+$/, "");

const GOOGLE_CLIENT_ID =
  String(process.env.GOOGLE_CLIENT_ID || "").trim();

const GOOGLE_CLIENT_SECRET =
  String(process.env.GOOGLE_CLIENT_SECRET || "").trim();

const GOOGLE_CALLBACK_URL =
  String(
    process.env.GOOGLE_CALLBACK_URL ||
      "https://api.havn.ie/api/auth/google/callback"
  ).trim();

const GOOGLE_OAUTH_ENABLED =
  Boolean(
    GOOGLE_CLIENT_ID &&
      GOOGLE_CLIENT_SECRET &&
      GOOGLE_CALLBACK_URL
  );

const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;
const ACCOUNT_DELETION_GRACE_DAYS = 30;

function passwordIsValid(password: string) {
  return (
    password.length >= MIN_PASSWORD_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH
  );
}

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function makeToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
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

function emailIsValid(email: string) {
  return (
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET missing");
  }

  return secret;
}

function signAuthToken(user: { id: number; role: any; email: string }) {
  return jwt.sign(
    { role: user.role, email: user.email },
    getJwtSecret(),
    {
      subject: String(user.id),
      expiresIn: "2h",
      algorithm: "HS256",
    }
  );
}

function validJsonObject(value: any) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function makeOAuthFrontendRedirect(
  values: Record<string, string>
) {
  const fragment = new URLSearchParams(values).toString();

  return `${APP_URL}/oauth-callback.html#${fragment}`;
}


/*
 * GOOGLE PASSPORT STRATEGY
 */
if (GOOGLE_OAUTH_ENABLED) {
  passport.use(
    "google",
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
      },
      async (
        _accessToken,
        _refreshToken,
        profile,
        done
      ) => {
        try {
          const googleId = String(profile.id || "").trim();

          const googleEmail = String(
            profile.emails?.[0]?.value || ""
          )
            .trim()
            .toLowerCase();

          const googleEmailVerified =
            (profile as any)?._json?.email_verified !== false;

          const displayName =
            String(profile.displayName || "")
              .trim()
              .replace(/\s+/g, " ") ||
            [
              profile.name?.givenName,
              profile.name?.familyName,
            ]
              .filter(Boolean)
              .join(" ")
              .trim() ||
            null;

          if (
            !googleId ||
            !emailIsValid(googleEmail) ||
            !googleEmailVerified
          ) {
            return done(null, false, {
              message:
                "Google did not provide a verified email address",
            });
          }

          const linkedUser = await prisma.user.findUnique({
            where: {
              googleId,
            },
          });

          if (linkedUser) {
            if (linkedUser.deletedAt) {
              return done(null, false, {
                message: "This HAVN account is unavailable",
              });
            }

            const user = await prisma.user.update({
              where: {
                id: linkedUser.id,
              },
              data: {
                googleEmail,
                googleLinkedAt:
                  linkedUser.googleLinkedAt || new Date(),
                lastAuthProvider: "google",
                emailVerified:
                  linkedUser.email === googleEmail
                    ? true
                    : linkedUser.emailVerified,
              },
            });

            return done(null, user);
          }

          const emailUser = await prisma.user.findUnique({
            where: {
              email: googleEmail,
            },
          });

          if (emailUser) {
            if (emailUser.deletedAt) {
              return done(null, false, {
                message: "This HAVN account is unavailable",
              });
            }

            if (
              emailUser.googleId &&
              emailUser.googleId !== googleId
            ) {
              return done(null, false, {
                message:
                  "A different Google account is already connected",
              });
            }

            const user = await prisma.user.update({
              where: {
                id: emailUser.id,
              },
              data: {
                googleId,
                googleEmail,
                googleLinkedAt:
                  emailUser.googleLinkedAt || new Date(),
                lastAuthProvider: "google",
                emailVerified: true,
              },
            });

            return done(null, user);
          }

          const user = await prisma.user.create({
            data: {
              email: googleEmail,
              password: null,
              name: displayName,
              emailVerified: true,
              googleId,
              googleEmail,
              googleLinkedAt: new Date(),
              lastAuthProvider: "google",
            },
          });

          void sendWelcomeEmail({
            to: user.email,
            name: user.name || null,
          }).catch((error) => {
            console.error(
              "Google signup welcome email failed",
              error
            );
          });

          return done(null, user);
        } catch (error) {
          console.error(
            "Google OAuth strategy error",
            error
          );

          return done(error as Error);
        }
      }
    )
  );
} else {
  console.warn(
    "Google OAuth disabled: required environment variables are missing"
  );
}

/**
 * ============================
 * GOOGLE AUTHENTICATION
 * ============================
 */

/**
 * GET /api/auth/google
 *
 * Starts the Google OAuth authentication flow.
 */
router.get("/google", (req, res, next) => {
  if (!GOOGLE_OAUTH_ENABLED) {
    return res.redirect(
      makeOAuthFrontendRedirect({
        error: "google_unavailable",
      })
    );
  }

  return passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
    prompt: "select_account",
  })(req, res, next);
});

/**
 * GET /api/auth/google/callback
 *
 * Google returns the user to this endpoint after authentication.
 * HAVN then issues its normal JWT and redirects to the frontend.
 */
router.get(
  "/google/callback",
  (req, res, next) => {
    if (!GOOGLE_OAUTH_ENABLED) {
      return res.redirect(
        makeOAuthFrontendRedirect({
          error: "google_unavailable",
        })
      );
    }

    return passport.authenticate(
      "google",
      {
        session: false,
      },
      async (
        error: any,
        user: any,
        info: any
      ) => {
        try {
          if (error) {
            console.error(
              "Google OAuth callback error",
              error
            );

            return res.redirect(
              makeOAuthFrontendRedirect({
                error: "google_authentication_failed",
              })
            );
          }

          if (!user || user.deletedAt) {
            console.warn(
              "Google OAuth rejected",
              info?.message || "No authenticated user"
            );

            return res.redirect(
              makeOAuthFrontendRedirect({
                error: "google_authentication_rejected",
              })
            );
          }

          const authenticatedUser =
            await prisma.user.update({
              where: {
                id: user.id,
              },
              data: {
                lastLoginAt: new Date(),
                loginCount: {
                  increment: 1,
                },
                lastAuthProvider: "google",
              },
              select: {
                id: true,
                role: true,
                email: true,
              },
            });

          const token =
            signAuthToken(authenticatedUser);

          return res.redirect(
            makeOAuthFrontendRedirect({
              provider: "google",
              token,
            })
          );
        } catch (callbackError) {
          console.error(
            "Google OAuth completion error",
            callbackError
          );

          return res.redirect(
            makeOAuthFrontendRedirect({
              error: "google_login_failed",
            })
          );
        }
      }
    )(req, res, next);
  }
);




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

    if (
      firstName.length > 100 ||
      lastName.length > 100 ||
      !emailIsValid(email)
    ) {
      return res.status(400).json({
        ok: false,
        message: "Please enter valid registration details",
      });
    }

    if (!passwordIsValid(password)) {
      return res.status(400).json({
        ok: false,
        message: `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`,
      });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({
        ok: false,
        message: "An account with these details already exists",
      });
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

    const token = signAuthToken(user);

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

    if (!emailIsValid(email) || !password || password.length > MAX_PASSWORD_LENGTH) {
      return res.status(401).json({ ok: false });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    
    if (!user || user.deletedAt) {
    return res.status(401).json({ ok: false });
    }

  if (!user.password) {
    return res.status(401).json({
      ok: false,
      message:
        "This account uses an external sign-in provider",
    });
  }

  const match = await bcrypt.compare(
    password,
    user.password
  );

  if (!match) {
    return res.status(401).json({ ok: false });
  }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        loginCount: { increment: 1 },
      },
    }).catch(() => null);

    const token = signAuthToken(user);

    res.json({ ok: true, token });
  } catch {
    res.status(500).json({ ok: false });
  }
});

/**
 * ME
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
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        emailVerified: true,
        lastLoginAt: true,
        loginCount: true,
        lastSearch: true,
        lastSearchAt: true,
        foundingOfferUsedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    return res.json({
      ok: true,
      user,
    });
  } catch (err) {
    console.error("GET /api/auth/me error", err);
    return res.status(500).json({ ok: false });
  }
});

/**
 * UPDATE PROFILE
 *
 * Allows an authenticated user to update their display name
 * and communication preferences.
 *
 * Email and password changes remain handled by their existing
 * dedicated security endpoints.
 */
router.patch("/profile", requireAuth, async (req: any, res) => {
  try {
    const userId = toPositiveSafeInt(req.user?.userId);

    if (userId === null) {
      return res.status(401).json({
        ok: false,
        message: "Invalid authentication session",
      });
    }

    if (!validJsonObject(req.body)) {
      return res.status(400).json({
        ok: false,
        message: "Valid profile data required",
      });
    }

    const allowedFields = [
      "name",
      "savedSearchEmailsEnabled",
      "listingEmailsEnabled",
      "productEmailsEnabled",
    ];

    const suppliedFields = Object.keys(req.body);

    const unsupportedFields = suppliedFields.filter(
      (field) => !allowedFields.includes(field)
    );

    if (unsupportedFields.length > 0) {
      return res.status(400).json({
        ok: false,
        message: "Unsupported profile field",
      });
    }

    if (suppliedFields.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "No profile changes supplied",
      });
    }

    const data: {
      name?: string;
      savedSearchEmailsEnabled?: boolean;
      listingEmailsEnabled?: boolean;
      productEmailsEnabled?: boolean;
    } = {};

    if (Object.prototype.hasOwnProperty.call(req.body, "name")) {
      const name = String(req.body.name ?? "")
        .trim()
        .replace(/\s+/g, " ");

      if (name.length < 2 || name.length > 200) {
        return res.status(400).json({
          ok: false,
          message: "Name must be between 2 and 200 characters",
        });
      }

      data.name = name;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        req.body,
        "savedSearchEmailsEnabled"
      )
    ) {
      if (typeof req.body.savedSearchEmailsEnabled !== "boolean") {
        return res.status(400).json({
          ok: false,
          message:
            "Saved search email preference must be true or false",
        });
      }

      data.savedSearchEmailsEnabled =
        req.body.savedSearchEmailsEnabled;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        req.body,
        "listingEmailsEnabled"
      )
    ) {
      if (typeof req.body.listingEmailsEnabled !== "boolean") {
        return res.status(400).json({
          ok: false,
          message:
            "Listing email preference must be true or false",
        });
      }

      data.listingEmailsEnabled =
        req.body.listingEmailsEnabled;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        req.body,
        "productEmailsEnabled"
      )
    ) {
      if (typeof req.body.productEmailsEnabled !== "boolean") {
        return res.status(400).json({
          ok: false,
          message:
            "Product email preference must be true or false",
        });
      }

      data.productEmailsEnabled =
        req.body.productEmailsEnabled;
    }

    const user = await prisma.user.update({
      where: {
        id: userId,
      },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        emailVerified: true,
        savedSearchEmailsEnabled: true,
        listingEmailsEnabled: true,
        productEmailsEnabled: true,
      },
    });

    return res.json({
      ok: true,
      account: {
        userId: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
      },
      preferences: {
        savedSearchEmailsEnabled:
          user.savedSearchEmailsEnabled,
        listingEmailsEnabled:
          user.listingEmailsEnabled,
        productEmailsEnabled:
          user.productEmailsEnabled,
      },
    });
  } catch (error) {
    console.error(
      "PATCH /api/auth/profile error",
      error
    );

    return res.status(500).json({
      ok: false,
      message: "Could not update account profile",
    });
  }
});


/**
 * GET /api/auth/export
 *
 * Streams a ZIP archive containing the authenticated user's HAVN account data.
 * Authentication secrets, reset tokens, verification tokens, payment identifiers,
 * internal moderation notes and other security-sensitive fields are deliberately excluded.
 */
router.get("/export", requireAuth, async (req: any, res) => {
  try {
    const userId = toPositiveSafeInt(req.user?.userId);

    if (userId === null) {
      return res.status(401).json({
        ok: false,
        message: "Invalid authentication session",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        emailVerified: true,
        lastLoginAt: true,
        loginCount: true,
        lastSearch: true,
        lastSearchAt: true,
        foundingOfferUsedAt: true,
        savedSearchEmailsEnabled: true,
        listingEmailsEnabled: true,
        productEmailsEnabled: true,
        deletionRequestedAt: true,
        deletionScheduledAt: true,
        deletionCancelledAt: true,
        agentProfile: {
          select: {
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
            createdAt: true,
            updatedAt: true,
            subscriptionStatus: true,
            subscriptionStartedAt: true,
            subscriptionCurrentPeriodEnd: true,
            subscriptionCancelledAt: true,
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

    const [listings, savedSearches, savedProperties, enquiries, analyticsEvents] =
      await Promise.all([
        prisma.property.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            slug: true,
            title: true,
            address1: true,
            address2: true,
            city: true,
            county: true,
            eircode: true,
            price: true,
            ber: true,
            berNo: true,
            bedrooms: true,
            bathrooms: true,
            propertyType: true,
            saleType: true,
            marketStatus: true,
            mode: true,
            features: true,
            description: true,
            photos: true,
            lat: true,
            lng: true,
            listingStatus: true,
            createdAt: true,
            updatedAt: true,
            submittedAt: true,
            publishedAt: true,
            archivedAt: true,
            rejectedAt: true,
            rejectedReason: true,
            availableFrom: true,
            berRating: true,
            deposit: true,
            furnished: true,
            outdoorSpace: true,
            parking: true,
            rentFrequency: true,
            size: true,
            sizeUnit: true,
            featuredUntil: true,
            isFeatured: true,
            views: true,
            billsIncluded: true,
            couplesAllowed: true,
            currentOccupants: true,
            ensuite: true,
            heatingType: true,
            leaseLength: true,
            minimumTerm: true,
            petsAllowed: true,
            roomType: true,
            saleCondition: true,
            viewingDetails: true,
            yearBuilt: true,
            previousPrice: true,
            priceDroppedAt: true,
            ownerOccupied: true,
            listingPackage: true,
            paymentStatus: true,
            amountPaidCents: true,
            paidAt: true,
            listingExpiresAt: true,
          },
        }),
        prisma.savedSearch.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            filters: true,
            createdAt: true,
            updatedAt: true,
            alertFrequency: true,
            alertsEnabled: true,
            lastDigestAt: true,
          },
        }),
        prisma.savedProperty.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            propertyId: true,
            createdAt: true,
            property: {
              select: {
                slug: true,
                title: true,
                address1: true,
                address2: true,
                city: true,
                county: true,
                eircode: true,
                price: true,
                mode: true,
                propertyType: true,
                listingStatus: true,
              },
            },
          },
        }),
        prisma.enquiry.findMany({
          where: { property: { userId } },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            propertyId: true,
            buyerName: true,
            buyerEmail: true,
            buyerPhone: true,
            message: true,
            intent: true,
            sourceUrl: true,
            createdAt: true,
            status: true,
            statusUpdatedAt: true,
            property: {
              select: {
                slug: true,
                title: true,
                address1: true,
                address2: true,
                city: true,
                county: true,
                eircode: true,
              },
            },
          },
        }),
        prisma.analyticsEvent.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: 10000,
          select: {
            id: true,
            eventType: true,
            path: true,
            referrer: true,
            payload: true,
            propertyId: true,
            locationId: true,
            createdAt: true,
          },
        }),
      ]);

    const generatedAt = new Date();
    const dateStamp = generatedAt.toISOString().slice(0, 10);
    const archiveName = `HAVN-Account-Export-${dateStamp}.zip`;
    const json = (value: unknown) =>
      JSON.stringify(
        value,
        (_key, item) =>
          typeof item === "bigint" ? item.toString() : item,
        2
      );

    const manifest = {
      product: "HAVN.ie",
      exportVersion: 1,
      generatedAt: generatedAt.toISOString(),
      accountId: user.id,
      files: [
        "README.txt",
        "manifest.json",
        "account.json",
        "preferences.json",
        "agent-profile.json",
        "listings.json",
        "saved-searches.json",
        "saved-properties.json",
        "enquiries.json",
        "activity.json",
      ],
      exclusions: [
        "Passwords and password hashes",
        "JWTs and authentication sessions",
        "Email verification and password-reset tokens",
        "Stripe customer, subscription, checkout and payment-intent identifiers",
        "Internal moderation and enquiry notes",
      ],
    };

    res.status(200);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${archiveName}"`
    );
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    archive.on("warning", (error: any) => {
      if (error?.code !== "ENOENT") {
        console.error("Account export archive warning", error);
      }
    });

    archive.on("error", (error: Error) => {
      console.error("Account export archive error", error);
      if (!res.headersSent) {
        res.status(500).json({
          ok: false,
          message: "Could not generate account export",
        });
      } else {
        res.destroy(error);
      }
    });

    archive.pipe(res);

    archive.append(
      [
        "HAVN.ie Account Data Export",
        "===========================",
        "",
        `Generated: ${generatedAt.toISOString()}`,
        `Account ID: ${user.id}`,
        "",
        "This archive contains the personal and account information associated with your HAVN account.",
        "Security credentials, authentication tokens, payment-provider identifiers and internal notes are not included.",
        "",
        "Open manifest.json for an index of the included files.",
        "",
      ].join("\n"),
      { name: "README.txt" }
    );

    archive.append(json(manifest), { name: "manifest.json" });
    archive.append(
      json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        emailVerified: user.emailVerified,
        lastLoginAt: user.lastLoginAt,
        loginCount: user.loginCount,
        lastSearch: user.lastSearch,
        lastSearchAt: user.lastSearchAt,
        foundingOfferUsedAt: user.foundingOfferUsedAt,
        deletionRequestedAt: user.deletionRequestedAt,
        deletionScheduledAt: user.deletionScheduledAt,
        deletionCancelledAt: user.deletionCancelledAt,
      }),
      { name: "account.json" }
    );
    archive.append(
      json({
        savedSearchEmailsEnabled: user.savedSearchEmailsEnabled,
        listingEmailsEnabled: user.listingEmailsEnabled,
        productEmailsEnabled: user.productEmailsEnabled,
      }),
      { name: "preferences.json" }
    );
    archive.append(json(user.agentProfile), { name: "agent-profile.json" });
    archive.append(json(listings), { name: "listings.json" });
    archive.append(json(savedSearches), { name: "saved-searches.json" });
    archive.append(json(savedProperties), { name: "saved-properties.json" });
    archive.append(json(enquiries), { name: "enquiries.json" });
    archive.append(json(analyticsEvents), { name: "activity.json" });

    await archive.finalize();
  } catch (error) {
    console.error("GET /api/auth/export error", error);

    if (!res.headersSent) {
      return res.status(500).json({
        ok: false,
        message: "Could not generate account export",
      });
    }

    return res.end();
  }
});

/**
 * ============================
 * ACCOUNT DELETION
 * ============================
 */

/**
 * GET /api/auth/account-deletion-status
 *
 * Returns the authenticated user's current deletion status.
 */
router.get(
  "/account-deletion-status",
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

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          deletionRequestedAt: true,
          deletionScheduledAt: true,
          deletionCancelledAt: true,
          deletedAt: true,
        },
      });

      if (!user) {
        return res.status(404).json({
          ok: false,
          message: "Account not found",
        });
      }

      return res.json({
        ok: true,
        deletion: {
          pending:
            user.deletionRequestedAt !== null &&
            user.deletionScheduledAt !== null &&
            user.deletedAt === null,
          deletionRequestedAt: user.deletionRequestedAt,
          deletionScheduledAt: user.deletionScheduledAt,
          deletionCancelledAt: user.deletionCancelledAt,
          deletedAt: user.deletedAt,
        },
      });
    } catch (error) {
      console.error(
        "GET /api/auth/account-deletion-status error",
        error
      );

      return res.status(500).json({
        ok: false,
        message: "Could not load account deletion status",
      });
    }
  }
);

/**
 * POST /api/auth/delete-account
 *
 * Requires:
 * {
 *   currentPassword: string,
 *   confirmation: "DELETE"
 * }
 *
 * Schedules the account for deletion after a 30-day grace period.
 */
router.post(
  "/delete-account",
  requireAuth,
  async (req: any, res) => {
    try {
      const userId = toPositiveSafeInt(req.user?.userId);
      const currentPassword = String(
        req.body?.currentPassword || ""
      );
      const confirmation = String(
        req.body?.confirmation || ""
      ).trim();

      if (userId === null) {
        return res.status(401).json({
          ok: false,
          message: "Invalid authentication session",
        });
      }

      if (confirmation !== "DELETE") {
        return res.status(400).json({
          ok: false,
          message: "Type DELETE to confirm account deletion",
        });
      }

      if (
        !currentPassword ||
        currentPassword.length > MAX_PASSWORD_LENGTH
      ) {
        return res.status(400).json({
          ok: false,
          message: "Your current password is required",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          password: true,
          deletionRequestedAt: true,
          deletionScheduledAt: true,
          deletedAt: true,
        },
      });

      if (!user || user.deletedAt) {
        return res.status(404).json({
          ok: false,
          message: "Account not found",
        });
      }

      if (!user.password) {
        return res.status(400).json({
          ok: false,
          message:
            "This account does not currently have a password",
        });
      }

      const passwordMatches = await bcrypt.compare(
        currentPassword,
        user.password
      );

      if (!passwordMatches) {
        return res.status(401).json({
          ok: false,
          message: "Current password is incorrect",
        });
      }

      if (
        user.deletionRequestedAt &&
        user.deletionScheduledAt
      ) {
        return res.json({
          ok: true,
          alreadyScheduled: true,
          deletionScheduledAt: user.deletionScheduledAt,
          message: "Your account is already scheduled for deletion",
        });
      }

      const deletionRequestedAt = new Date();
      const deletionScheduledAt = new Date(
        deletionRequestedAt.getTime() +
          ACCOUNT_DELETION_GRACE_DAYS *
            24 *
            60 *
            60 *
            1000
      );

      await prisma.user.update({
        where: { id: user.id },
        data: {
          deletionRequestedAt,
          deletionScheduledAt,
          deletionCancelledAt: null,
        },
      });

      void sendAccountDeletionScheduledEmail({
        to: user.email,
        name: user.name,
        deletionScheduledAt,
        manageUrl: `${APP_URL}/app/`,
      }).catch((error) => {
        console.error(
          "Account deletion scheduled email failed",
          error
        );
      });

      return res.json({
        ok: true,
        deletionRequestedAt,
        deletionScheduledAt,
        gracePeriodDays: ACCOUNT_DELETION_GRACE_DAYS,
        message:
          "Your account has been scheduled for deletion. You may restore it during the next 30 days.",
      });
    } catch (error) {
      console.error(
        "POST /api/auth/delete-account error",
        error
      );

      return res.status(500).json({
        ok: false,
        message: "Could not schedule account deletion",
      });
    }
  }
);

/**
 * POST /api/auth/cancel-account-deletion
 *
 * Cancels a pending deletion during the recovery period.
 */
router.post(
  "/cancel-account-deletion",
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

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          deletionRequestedAt: true,
          deletionScheduledAt: true,
          deletedAt: true,
        },
      });

      if (!user || user.deletedAt) {
        return res.status(404).json({
          ok: false,
          message: "Account not found",
        });
      }

      if (
        !user.deletionRequestedAt ||
        !user.deletionScheduledAt
      ) {
        return res.json({
          ok: true,
          alreadyCancelled: true,
          message: "Your account is not scheduled for deletion",
        });
      }

      if (user.deletionScheduledAt.getTime() <= Date.now()) {
        return res.status(409).json({
          ok: false,
          message:
            "The account recovery period has expired",
        });
      }

      const deletionCancelledAt = new Date();

      await prisma.user.update({
        where: { id: user.id },
        data: {
          deletionRequestedAt: null,
          deletionScheduledAt: null,
          deletionCancelledAt,
        },
      });

      void sendAccountDeletionCancelledEmail({
        to: user.email,
        name: user.name,
        accountUrl: `${APP_URL}/app/`,
      }).catch((error) => {
        console.error(
          "Account deletion cancelled email failed",
          error
        );
      });

      return res.json({
        ok: true,
        deletionCancelledAt,
        message:
          "Account deletion has been cancelled and your account remains active",
      });
    } catch (error) {
      console.error(
        "POST /api/auth/cancel-account-deletion error",
        error
      );

      return res.status(500).json({
        ok: false,
        message: "Could not restore the account",
      });
    }
  }
);

/**
 * LAST SEARCH
 */
router.post("/last-search", requireAuth, async (req: any, res) => {
  try {
    if (!validJsonObject(req.body)) {
      return res.status(400).json({
        ok: false,
        message: "Valid search object required",
      });
    }

    if (JSON.stringify(req.body).length > 20000) {
      return res.status(400).json({
        ok: false,
        message: "Search data is too large",
      });
    }

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

    if (!validJsonObject(filters)) {
      return res.status(400).json({
        ok: false,
        message: "Valid filters object required",
      });
    }

    if (JSON.stringify(filters).length > 20000) {
      return res.status(400).json({
        ok: false,
        message: "Saved search filters are too large",
      });
    }

    const safeName = String(name || "My search").trim();

    if (!safeName || safeName.length > 120) {
      return res.status(400).json({
        ok: false,
        message: "Saved search name is invalid",
      });
    }

    const saved = await prisma.savedSearch.create({
      data: {
        userId,
        name: safeName,
        filters,

        // alertsEnabled controls immediate saved-search alerts when a matching
        // property is approved/published.
        alertsEnabled: true,

        // alertFrequency controls digest inclusion. Keep weekly as the default
        // so the same saved search can also appear in the Sunday weekly digest.
        alertFrequency: "weekly",
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
    const id = toPositiveSafeInt(req.params.id);

    if (id === null) {
  	return res.status(400).json({
    	ok: false,
    	message: "Valid saved search ID required",
  	});
	}

const existing = await prisma.savedSearch.findUnique({
  where: { id },
});

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
 * ============================
 * SAVED PROPERTIES
 * ============================
 */

/**
 * POST /api/auth/saved-properties
 * Body: { propertyId }
 */
router.post("/saved-properties", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.userId;
    const propertyId = toPositiveSafeInt(req.body.propertyId);

    if (propertyId === null) {
  	return res.status(400).json({
    	ok: false,
    	message: "Valid propertyId required",
  	});
	}

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        id: true,
        listingStatus: true,
      },
    });

    if (!property) {
      return res.status(404).json({ ok: false, message: "Property not found" });
    }

    if (property.listingStatus !== "PUBLISHED") {
      return res.status(403).json({ ok: false, message: "Only published properties can be saved" });
    }

    const saved = await prisma.savedProperty.upsert({
      where: {
        userId_propertyId: {
          userId,
          propertyId,
        },
      },
      update: {},
      create: {
        userId,
        propertyId,
      },
      include: {
        property: true,
      },
    });

    res.json({ ok: true, saved });
  } catch (err) {
    console.error("POST /auth/saved-properties error", err);
    res.status(500).json({ ok: false, message: "Could not save property" });
  }
});

/**
 * GET /api/auth/saved-properties
 */
router.get("/saved-properties", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.userId;

    const savedProperties = await prisma.savedProperty.findMany({
      where: {
        userId,
        property: {
          listingStatus: "PUBLISHED",
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        property: true,
      },
    });

    res.json({ ok: true, savedProperties });
  } catch (err) {
    console.error("GET /auth/saved-properties error", err);
    res.status(500).json({ ok: false, message: "Could not load saved properties" });
  }
});

/**
 * DELETE /api/auth/saved-properties/:propertyId
 */
router.delete("/saved-properties/:propertyId", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.userId;
    const propertyId = toPositiveSafeInt(req.params.propertyId);

    if (propertyId === null) {
  	return res.status(400).json({
    	ok: false,
    	message: "Valid propertyId required",
  	});
	}

    await prisma.savedProperty.deleteMany({
      where: {
        userId,
        propertyId,
      },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /auth/saved-properties error", err);
    res.status(500).json({ ok: false, message: "Could not remove saved property" });
  }
});

/**
 * FORGOT PASSWORD
 */
router.post("/forgot-password", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!emailIsValid(email)) {
      return res.json({ ok: true });
    }

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

    const resetUrl =
      `${APP_URL}/reset-password.html?token=${encodeURIComponent(token)}` +
      `&email=${encodeURIComponent(email)}`;

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
    const token = String(req.body?.token || "").trim();
    const newPassword = String(req.body?.newPassword || "");

    if (!token || !passwordIsValid(newPassword)) {
      return res.status(400).json({
        ok: false,
        message: `Invalid reset request or password. Passwords must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`,
      });
    }

    const hash = sha256(token);

    const rec = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hash },
    });

    if (!rec || rec.usedAt || rec.expiresAt.getTime() <= Date.now()) {
      return res.status(400).json({
        ok: false,
        message: "This password reset link is invalid or has expired",
      });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: {
          id: rec.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });

      if (claimed.count !== 1) {
        throw new Error("RESET_TOKEN_ALREADY_USED_OR_EXPIRED");
      }

      await tx.user.update({
        where: { id: rec.userId },
        data: { password: hashed },
      });

      await tx.passwordResetToken.deleteMany({
        where: { userId: rec.userId },
      });
    });

    res.json({ ok: true });
  } catch (err: any) {
    if (err?.message === "RESET_TOKEN_ALREADY_USED_OR_EXPIRED") {
      return res.status(400).json({
        ok: false,
        message: "This password reset link is invalid or has expired",
      });
    }

    res.status(500).json({ ok: false });
  }
});


/**
 * CHANGE PASSWORD
 */
router.post("/change-password", requireAuth, async (req: any, res) => {
  try {
    const userId = toPositiveSafeInt(req.user?.userId);
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");

    if (userId === null) {
      return res.status(401).json({ ok: false, message: "Invalid authentication session" });
    }

    if (!currentPassword || !passwordIsValid(newPassword)) {
      return res.status(400).json({
        ok: false,
        message: `New password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`,
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ ok: false, message: "Choose a different new password" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (
      !user ||
      !user.password ||
      !(await bcrypt.compare(currentPassword, user.password))
    ) {
      return res.status(401).json({ ok: false, message: "Current password is incorrect" });
    }

    const password = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { password, passwordChangedAt: new Date() },
    });

    await prisma.passwordResetToken.deleteMany({ where: { userId } });
    return res.json({ ok: true, message: "Your password has been changed" });
  } catch (err) {
    console.error("POST /api/auth/change-password error", err);
    return res.status(500).json({ ok: false, message: "Could not change password" });
  }
});

/**
 * REQUEST EMAIL CHANGE
 */
router.post("/change-email", requireAuth, async (req: any, res) => {
  try {
    const userId = toPositiveSafeInt(req.user?.userId);
    const newEmail = String(req.body?.newEmail || "").trim().toLowerCase();
    const currentPassword = String(req.body?.currentPassword || "");

    if (userId === null) {
      return res.status(401).json({ ok: false, message: "Invalid authentication session" });
    }

    if (!emailIsValid(newEmail) || !currentPassword) {
      return res.status(400).json({ ok: false, message: "Enter a valid email and your current password" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (
      !user ||
      !user.password ||
      !(await bcrypt.compare(currentPassword, user.password))
    ) {
      return res.status(401).json({ ok: false, message: "Current password is incorrect" });
    }

    if (newEmail === user.email) {
      return res.status(400).json({ ok: false, message: "That is already your account email" });
    }

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: newEmail }, { pendingEmail: newEmail }] },
      select: { id: true },
    });
    if (existing && existing.id !== user.id) {
      return res.status(409).json({ ok: false, message: "That email address is already in use" });
    }

    const rawToken = makeToken(32);
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        pendingEmail: newEmail,
        emailChangeTokenHash: tokenHash,
        emailChangeTokenExp: expiresAt,
      },
    });

    const verifyUrl = `${APP_URL}/verify-email.html?token=${encodeURIComponent(rawToken)}`;
    const emailResult = await sendEmailChangeVerificationEmail({
      to: newEmail,
      name: user.name || null,
      verifyUrl,
    });

    if (!emailResult || (emailResult as any).error) {
      return res.status(502).json({ ok: false, message: "We could not send the verification email" });
    }

    return res.json({ ok: true, message: `Verification sent to ${newEmail}` });
  } catch (err) {
    console.error("POST /api/auth/change-email error", err);
    return res.status(500).json({ ok: false, message: "Could not start email change" });
  }
});

/**
 * VERIFY EMAIL
 */
/**
 * RESEND EMAIL VERIFICATION
 */
router.post("/request-email-verify", requireAuth, async (req: any, res) => {
  try {
    const userId = toPositiveSafeInt(req.user?.userId);

    if (userId === null) {
  	return res.status(401).json({
    	ok: false,
    	message: "Invalid authentication session",
  	});
	}
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "Account not found",
      });
    }

    if (user.emailVerified) {
      return res.json({
        ok: true,
        alreadyVerified: true,
        message: "Your email address is already verified",
      });
    }

    const verifyToken = makeToken(24);
    const verifyTokenExp = new Date(Date.now() + 30 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifyToken: verifyToken,
        emailVerifyTokenExp: verifyTokenExp,
      },
    });

    const verifyUrl =
      `${APP_URL}/verify-email.html?token=${encodeURIComponent(verifyToken)}`;

    const emailResult = await sendEmailVerificationEmail({
      to: user.email,
      name: user.name || null,
      verifyUrl,
    });

    if (!emailResult || (emailResult as any).error) {
      console.error(
        "Resend verification email was not accepted:",
        emailResult
      );

      return res.status(502).json({
        ok: false,
        message: "We could not send the verification email. Please try again.",
      });
    }

    return res.json({
      ok: true,
      message: "A new verification email has been sent",
    });
  } catch (err: any) {
    console.error("POST /api/auth/request-email-verify error:", err);

    return res.status(500).json({
      ok: false,
      message: "Could not send a new verification email",
    });
  }
});


router.post("/verify-email", async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();

    if (!token) {
      return res.status(400).json({ ok: false, message: "Invalid verification link" });
    }

    const tokenHash = sha256(token);
    const pendingUser = await prisma.user.findFirst({
      where: {
        emailChangeTokenHash: tokenHash,
        emailChangeTokenExp: { gt: new Date() },
        pendingEmail: { not: null },
      },
      select: { id: true, pendingEmail: true },
    });

    if (pendingUser?.pendingEmail) {
      try {
        await prisma.user.update({
          where: { id: pendingUser.id },
          data: {
            email: pendingUser.pendingEmail,
            emailVerified: true,
            pendingEmail: null,
            emailChangeTokenHash: null,
            emailChangeTokenExp: null,
          },
        });
      } catch (error: any) {
        if (error?.code === "P2002") {
          return res.status(409).json({ ok: false, message: "That email address is already in use" });
        }
        throw error;
      }

      return res.json({ ok: true, emailChanged: true });
    }

    const verified = await prisma.user.updateMany({
      where: {
        emailVerifyToken: token,
        emailVerifyTokenExp: { gt: new Date() },
        emailVerified: false,
      },
      data: {
        emailVerified: true,
        emailVerifyToken: null,
        emailVerifyTokenExp: null,
      },
    });

    if (verified.count !== 1) {
      return res.status(400).json({
        ok: false,
        message: "This verification link is invalid or has expired",
      });
    }

    return res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

export default router;