import { Router } from "express";
import Stripe from "stripe";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth";
import { sendUserListingEmail } from "../lib/mail";

const router = Router();

const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY || "").trim();
const stripeWebhookSecret = String(
  process.env.STRIPE_WEBHOOK_SECRET || ""
).trim();

if (!stripeSecretKey) {
  console.error("STRIPE_SECRET_KEY is missing");
}

const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey)
  : null;

function getStripeClient() {
  if (!stripe) {
    throw new Error("STRIPE_SECRET_KEY is missing");
  }

  return stripe;
}

type PropertyMode = "BUY" | "RENT" | "SHARE";
type ListingPackageName = "STANDARD" | "FEATURED";
type CheckoutFlow = "LISTING_PACKAGE" | "FEATURE_UPGRADE";

const ALLOWED_PACKAGES = new Set<ListingPackageName>([
  "STANDARD",
  "FEATURED",
]);

const ALLOWED_CHECKOUT_STATUSES = new Set([
  "DRAFT",
  "REJECTED",
  "SUBMITTED",
  "PUBLISHED",
]);

const PRICE_ENV_MAP: Record<
  PropertyMode,
  Record<ListingPackageName, string>
> = {
  BUY: {
    STANDARD: "STRIPE_PRICE_BUY_STANDARD",
    FEATURED: "STRIPE_PRICE_BUY_FEATURED",
  },
  RENT: {
    STANDARD: "STRIPE_PRICE_RENT_STANDARD",
    FEATURED: "STRIPE_PRICE_RENT_FEATURED",
  },
  SHARE: {
    STANDARD: "STRIPE_PRICE_SHARE_STANDARD",
    FEATURED: "STRIPE_PRICE_SHARE_FEATURED",
  },
};

const UPGRADE_PRICE_ENV_MAP: Record<PropertyMode, string> = {
  BUY: "STRIPE_PRICE_BUY_UPGRADE",
  RENT: "STRIPE_PRICE_RENT_UPGRADE",
  SHARE: "STRIPE_PRICE_SHARE_UPGRADE",
};

const LISTING_DURATION_DAYS: Record<PropertyMode, number> = {
  BUY: 60,
  RENT: 60,
  SHARE: 60,
};

function normalizeMode(value: unknown): PropertyMode | null {
  const mode = String(value || "")
    .trim()
    .toUpperCase();

  if (mode === "BUY" || mode === "RENT" || mode === "SHARE") {
    return mode;
  }

  return null;
}

function normalizePackage(value: unknown): ListingPackageName | null {
  const selectedPackage = String(value || "")
    .trim()
    .toUpperCase();

  if (ALLOWED_PACKAGES.has(selectedPackage as ListingPackageName)) {
    return selectedPackage as ListingPackageName;
  }

  return null;
}

function getConfiguredPriceId(
  mode: PropertyMode,
  selectedPackage: ListingPackageName,
  flow: CheckoutFlow = "LISTING_PACKAGE"
): string {
  const environmentKey =
    flow === "FEATURE_UPGRADE"
      ? UPGRADE_PRICE_ENV_MAP[mode]
      : PRICE_ENV_MAP[mode][selectedPackage];

  return String(process.env[environmentKey] || "").trim();
}

function getConfiguredPriceEnvironmentKey(
  mode: PropertyMode,
  selectedPackage: ListingPackageName,
  flow: CheckoutFlow
): string {
  return flow === "FEATURE_UPGRADE"
    ? UPGRADE_PRICE_ENV_MAP[mode]
    : PRICE_ENV_MAP[mode][selectedPackage];
}

function addDays(date: Date, days: number): Date {
  const output = new Date(date);
  output.setUTCDate(output.getUTCDate() + days);
  return output;
}

function getPaymentIntentId(
  paymentIntent: any
): string | null {
  if (!paymentIntent) return null;

  if (typeof paymentIntent === "string") {
    return paymentIntent;
  }

  if (
    typeof paymentIntent === "object" &&
    "id" in paymentIntent &&
    paymentIntent.id
  ) {
    return String(paymentIntent.id);
  }

  return null;
}


function buildPropertyAddress(property: any): string {
  return [
    property?.address1,
    property?.address2,
    property?.city,
    property?.county,
    property?.eircode,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
}

function checkoutWasCompleted(session: any): boolean {
  const paymentStatus = String(session.payment_status || "").toLowerCase();
  const checkoutStatus = String(session.status || "").toLowerCase();

  /*
   * Normal paid Checkout Sessions report "paid".
   * A 100%-discounted, zero-cost order can report
   * "no_payment_required".
   */
  const acceptablePaymentStatus =
    paymentStatus === "paid" ||
    paymentStatus === "no_payment_required";

  return checkoutStatus === "complete" && acceptablePaymentStatus;
}


type AgentSubscriptionStatusName =
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELLED"
  | "UNPAID";

function getStripeObjectId(value: any): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "object" &&
    "id" in value &&
    value.id
  ) {
    return String(value.id);
  }

  return null;
}

function stripeTimestampToDate(
  value: unknown
): Date | null {
  const seconds = Number(value);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return new Date(seconds * 1000);
}

function mapStripeSubscriptionStatus(
  value: unknown
): AgentSubscriptionStatusName {
  const status = String(value || "")
    .trim()
    .toLowerCase();

  if (
    status === "active" ||
    status === "trialing"
  ) {
    return "ACTIVE";
  }

  if (status === "past_due") {
    return "PAST_DUE";
  }

  if (status === "canceled") {
    return "CANCELLED";
  }

  return "UNPAID";
}

function getSubscriptionPriceId(
  subscription: any
): string | null {
  const firstItem =
    subscription?.items?.data?.[0];

  return getStripeObjectId(firstItem?.price);
}

async function findAgentProfileForSubscription(
  subscription: any
) {
  const metadata = subscription?.metadata || {};

  const agentProfileId = Number(
    metadata.agentProfileId
  );

  const userId = Number(metadata.userId);

  const stripeCustomerId = getStripeObjectId(
    subscription?.customer
  );

  if (
    Number.isSafeInteger(agentProfileId) &&
    agentProfileId > 0
  ) {
    const profile =
      await prisma.agentProfile.findUnique({
        where: {
          id: agentProfileId,
        },
        select: {
          id: true,
          userId: true,
          status: true,
        },
      });

    if (profile) {
      return profile;
    }
  }

  if (
    Number.isSafeInteger(userId) &&
    userId > 0
  ) {
    const profile =
      await prisma.agentProfile.findUnique({
        where: {
          userId,
        },
        select: {
          id: true,
          userId: true,
          status: true,
        },
      });

    if (profile) {
      return profile;
    }
  }

  if (stripeCustomerId) {
    return prisma.agentProfile.findUnique({
      where: {
        stripeCustomerId,
      },
      select: {
        id: true,
        userId: true,
        status: true,
      },
    });
  }

  return null;
}

async function syncAgentSubscription(
  subscription: any
) {
  const stripeSubscriptionId = String(
    subscription?.id || ""
  ).trim();

  if (!stripeSubscriptionId) {
    return {
      synced: false,
      reason: "missing_subscription_id",
    };
  }

  const agentProfile =
    await findAgentProfileForSubscription(
      subscription
    );

  if (!agentProfile) {
    console.warn(
      "Stripe agent subscription ignored: AgentProfile not found",
      {
        stripeSubscriptionId,
        stripeCustomerId:
          getStripeObjectId(
            subscription?.customer
          ),
        metadata: subscription?.metadata,
      }
    );

    return {
      synced: false,
      reason: "agent_profile_not_found",
    };
  }

  const configuredAgentPriceId = String(
    process.env.STRIPE_AGENT_MONTHLY_PRICE_ID || ""
  ).trim();

  const stripePriceId =
    getSubscriptionPriceId(subscription) ||
    String(
      subscription?.metadata?.stripePriceId ||
        ""
    ).trim() ||
    null;

  if (
    configuredAgentPriceId &&
    stripePriceId &&
    stripePriceId !== configuredAgentPriceId
  ) {
    console.warn(
      "Stripe agent subscription ignored: price mismatch",
      {
        agentProfileId: agentProfile.id,
        stripeSubscriptionId,
        stripePriceId,
        configuredAgentPriceId,
      }
    );

    return {
      synced: false,
      reason: "agent_price_mismatch",
    };
  }

  const subscriptionStatus =
    mapStripeSubscriptionStatus(
      subscription?.status
    );

  const stripeCustomerId = getStripeObjectId(
    subscription?.customer
  );

  const subscriptionStartedAt =
    stripeTimestampToDate(
      subscription?.start_date
    ) ||
    stripeTimestampToDate(
      subscription?.created
    );

  const subscriptionCurrentPeriodEnd =
    stripeTimestampToDate(
      subscription?.current_period_end
    ) ||
    stripeTimestampToDate(
      subscription?.items?.data?.[0]
        ?.current_period_end
    );

  const subscriptionCancelledAt =
    subscriptionStatus === "CANCELLED"
      ? stripeTimestampToDate(
          subscription?.canceled_at
        ) || new Date()
      : null;

  await prisma.agentProfile.update({
    where: {
      id: agentProfile.id,
    },
    data: {
      subscriptionStatus,
      stripeCustomerId:
        stripeCustomerId || undefined,
      stripeSubscriptionId,
      stripePriceId:
        stripePriceId || undefined,
      subscriptionStartedAt:
        subscriptionStartedAt || undefined,
      subscriptionCurrentPeriodEnd,
      subscriptionCancelledAt,
    },
  });

  console.log(
    "Stripe agent subscription synchronised",
    {
      agentProfileId: agentProfile.id,
      userId: agentProfile.userId,
      stripeSubscriptionId,
      stripeCustomerId,
      stripePriceId,
      subscriptionStatus,
      subscriptionCurrentPeriodEnd:
        subscriptionCurrentPeriodEnd
          ? subscriptionCurrentPeriodEnd.toISOString()
          : null,
    }
  );

  return {
    synced: true,
    agentProfileId: agentProfile.id,
    userId: agentProfile.userId,
    stripeSubscriptionId,
    subscriptionStatus,
  };
}

async function handleAgentCheckoutCompleted(
  session: any
) {
  const userId = Number(
    session?.metadata?.userId
  );

  const agentProfileId = Number(
    session?.metadata?.agentProfileId
  );

  if (
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    !Number.isSafeInteger(agentProfileId) ||
    agentProfileId <= 0
  ) {
    return {
      received: true,
      ignored: true,
      reason: "invalid_agent_metadata",
    };
  }

  const configuredAgentPriceId = String(
    process.env.STRIPE_AGENT_MONTHLY_PRICE_ID || ""
  ).trim();

  if (
    !configuredAgentPriceId ||
    String(
      session?.metadata?.stripePriceId ||
        ""
    ).trim() !== configuredAgentPriceId
  ) {
    return {
      received: true,
      ignored: true,
      reason:
        "agent_price_configuration_mismatch",
    };
  }

  const agentProfile =
    await prisma.agentProfile.findUnique({
      where: {
        id: agentProfileId,
      },
      select: {
        id: true,
        userId: true,
        status: true,
      },
    });

  if (
    !agentProfile ||
    agentProfile.userId !== userId ||
    agentProfile.status !== "APPROVED"
  ) {
    return {
      received: true,
      ignored: true,
      reason: "agent_profile_not_eligible",
    };
  }

  const stripeCustomerId =
    getStripeObjectId(session?.customer);

  const stripeSubscriptionId =
    getStripeObjectId(
      session?.subscription
    );

  if (!stripeSubscriptionId) {
    return {
      received: true,
      ignored: true,
      reason: "missing_subscription_id",
    };
  }

  if (stripeCustomerId) {
    await prisma.agentProfile.update({
      where: {
        id: agentProfile.id,
      },
      data: {
        stripeCustomerId,
      },
    });
  }

  const subscription =
    await getStripeClient().subscriptions.retrieve(
      stripeSubscriptionId,
      {
        expand: ["items.data.price"],
      } as any
    );

  const syncResult =
    await syncAgentSubscription(subscription);

  return {
    received: true,
    completed: true,
    checkoutType: "AGENT_SUBSCRIPTION",
    stripeCustomerId,
    stripeSubscriptionId,
    syncResult,
  };
}

router.get("/ping", (_req, res) => {
  res.json({
    ok: true,
    route: "stripe",
    pricingModel: "multi-tier-v1",
  });
});

/**
 * POST /api/stripe/create-checkout-session
 *
 * Body:
 * {
 *   propertyId: number,
 *   package?: "STANDARD" | "FEATURED"
 * }
 *
 * For temporary compatibility with the old Featured-only frontend,
 * package defaults to FEATURED when it is not supplied.
 */
router.post(
  "/create-checkout-session",
  requireAuth,
  async (req: any, res) => {
    try {
	const userId = Number(req.user?.userId);
	const propertyId = Number(req.body?.propertyId);

	if (!Number.isFinite(userId) || userId <= 0) {
  	return res.status(401).json({
    	ok: false,
    	message: "Invalid auth session",
  	});
	}

	const user = await prisma.user.findUnique({
  	where: { id: userId },
  	select: {
    	id: true,
  	},
	});

	if (!user) {
  	return res.status(401).json({
   	 ok: false,
    	message: "Account not found",
  	});
	}
      /*
       * The old frontend only sent propertyId because HAVN previously
       * had one Featured product. Defaulting to FEATURED keeps that
       * existing flow working until the package-selection page is added.
       */
      const requestedPackage =
        req.body?.package == null || String(req.body.package).trim() === ""
          ? "FEATURED"
          : req.body.package;

      const selectedPackage = normalizePackage(requestedPackage);

      if (!Number.isFinite(propertyId) || propertyId <= 0) {
        return res.status(400).json({
          ok: false,
          message: "Missing propertyId",
        });
      }

      if (!selectedPackage) {
        return res.status(400).json({
          ok: false,
          message: "Package must be STANDARD or FEATURED",
        });
      }

      if (!stripeSecretKey) {
        return res.status(503).json({
          ok: false,
          message: "Stripe is not configured",
        });
      }

      const property = await prisma.property.findUnique({
        where: {
          id: propertyId,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              foundingOfferUsedAt: true,
            },
          },
        },
      });

      if (!property) {
        return res.status(404).json({
          ok: false,
          message: "Property not found",
        });
      }

      if (property.userId !== userId) {
        return res.status(403).json({
          ok: false,
          message: "Not allowed",
        });
      }

      const listingStatus = String(
        property.listingStatus || ""
      ).toUpperCase();

      if (!ALLOWED_CHECKOUT_STATUSES.has(listingStatus)) {
        return res.status(400).json({
          ok: false,
          message:
            "This listing is not currently eligible for package checkout",
        });
      }

      const mode = normalizeMode(property.mode);

      if (!mode) {
        return res.status(400).json({
          ok: false,
          message: "Unsupported property mode",
        });
      }

      /*
       * A published property can use this endpoint to upgrade to
       * Featured. Buying Standard again for an already-published listing
       * is not a meaningful action.
       */
      if (
        listingStatus === "PUBLISHED" &&
        selectedPackage === "STANDARD"
      ) {
        return res.status(400).json({
          ok: false,
          message: "This property is already published",
        });
      }

      const alreadyFeatured =
        property.isFeatured === true &&
        property.featuredUntil != null &&
        new Date(property.featuredUntil).getTime() > Date.now();

      if (
        listingStatus === "PUBLISHED" &&
        selectedPackage === "FEATURED" &&
        alreadyFeatured
      ) {
        return res.status(400).json({
          ok: false,
          message: "Property is already featured",
        });
      }

      const flow: CheckoutFlow =
        listingStatus === "PUBLISHED"
          ? "FEATURE_UPGRADE"
          : "LISTING_PACKAGE";

      if (
        flow === "FEATURE_UPGRADE" &&
        normalizePackage(property.listingPackage) !== "STANDARD"
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Only published Standard listings can be upgraded to Featured",
        });
      }

      const stripePriceId = getConfiguredPriceId(
        mode,
        selectedPackage,
        flow
      );

      if (!stripePriceId) {
        const environmentKey = getConfiguredPriceEnvironmentKey(
          mode,
          selectedPackage,
          flow
        );

        console.error("Stripe price environment variable missing", {
          mode,
          selectedPackage,
          environmentKey,
        });

        return res.status(503).json({
          ok: false,
          message:
            "This listing package is not configured for checkout",
        });
      }

      const durationDays = LISTING_DURATION_DAYS[mode];

      /*
       * The founding coupon is automatically applied only when:
       * 1. the Render environment variable exists; and
       * 2. this HAVN account has not completed its founding offer.
       */
      const foundingCouponId = String(
        process.env.STRIPE_FOUNDING_COUPON_ID || ""
      ).trim();

	const foundingOfferEligible =
	  flow === "LISTING_PACKAGE" &&
	  Boolean(foundingCouponId) &&
	  !property.user.foundingOfferUsedAt;

      const checkoutParameters: any = {
        mode: "payment",

        line_items: [
          {
            price: stripePriceId,
            quantity: 1,
          },
        ],

        customer_email: property.user.email,

	/*
         * Always show the promotion-code field in Stripe Checkout.
         * This supports the public founding offer as well as private
         * admin/testing coupons.
         */
        allow_promotion_codes: true,

        success_url:
          "https://havn.ie/my-listings.html?payment=success&featured=success",

        cancel_url:
          "https://havn.ie/my-listings.html?payment=cancel&featured=cancel",

        metadata: {
          propertyId: String(property.id),
          userId: String(userId),
          propertyMode: mode,
          listingPackage: selectedPackage,
          durationDays: String(durationDays),
          stripePriceId,
          originalListingPackage: String(
            property.listingPackage || ""
          ),
          foundingOfferEligible: foundingOfferEligible ? "true" : "false",
          flow,
        },
      };

      const session = await getStripeClient().checkout.sessions.create(
        checkoutParameters
      );

      if (!session.url) {
        throw new Error(
          "Stripe did not return a Checkout Session URL"
        );
      }

      /*
       * For a new listing purchase, record the pending package checkout.
       * For an upgrade, leave the existing paid Standard listing untouched
       * until Stripe confirms payment through the signed webhook.
       */
      if (flow === "LISTING_PACKAGE") {
        await prisma.property.update({
          where: {
            id: property.id,
          },
          data: {
            listingPackage: selectedPackage,
            paymentStatus: "PENDING",
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: null,
            amountPaidCents: null,
            paidAt: null,
          },
        });
      }

      console.log("Stripe checkout session created", {
        propertyId: property.id,
        userId,
        mode,
        selectedPackage,
        stripePriceId,
        sessionId: session.id,
        foundingOfferEligible,
        flow,
      });

      return res.json({
        ok: true,
        url: session.url,
        checkoutSessionId: session.id,
        mode,
        package: selectedPackage,
        durationDays,
        foundingOfferApplied: foundingOfferEligible,
      });
    } catch (err: any) {
      console.error("Stripe session error:", {
        message: err?.message,
        type: err?.type,
        code: err?.code,
        stack: err?.stack,
      });

      return res.status(500).json({
        ok: false,
        message: "Could not create checkout session",
      });
    }
  }
);

/**
 * POST /api/stripe/webhook
 *
 * This endpoint receives the raw Stripe request body.
 * The raw-body middleware is already correctly configured in
 * the main Express startup file.
 */
router.post("/webhook", async (req: any, res) => {
  const signature = req.headers["stripe-signature"];

  if (!stripeWebhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is missing");

    return res.status(500).send(
      "Webhook signing secret is not configured"
    );
  }

  if (!signature || typeof signature !== "string") {
    return res.status(400).send(
      "Missing Stripe signature"
    );
  }

  let event: any;

  try {
    event = getStripeClient().webhooks.constructEvent(
      req.body,
      signature,
      stripeWebhookSecret
    );
  } catch (err: any) {
    console.error(
      "Stripe webhook signature failed:",
      err?.message
    );

    return res.status(400).send("Webhook Error");
  }

  try {
    if (
      event.type ===
        "customer.subscription.created" ||
      event.type ===
        "customer.subscription.updated" ||
      event.type ===
        "customer.subscription.deleted"
    ) {
      const subscription =
        event.data.object as any;

      const syncResult =
        await syncAgentSubscription(
          subscription
        );

      return res.json({
        received: true,
        eventType: event.type,
        syncResult,
      });
    }

    if (
      event.type !==
      "checkout.session.completed"
    ) {
      return res.json({
        received: true,
        ignored: true,
        eventType: event.type,
      });
    }

    const session =
      event.data.object as any;

    const checkoutType = String(
      session?.metadata?.checkoutType || ""
    )
      .trim()
      .toUpperCase();

    if (
      checkoutType ===
      "AGENT_SUBSCRIPTION"
    ) {
      const result =
        await handleAgentCheckoutCompleted(
          session
        );

      return res.json(result);
    }

    if (!checkoutWasCompleted(session)) {
      console.warn(
        "Stripe webhook ignored: checkout not completed",
        {
          sessionId: session.id,
          status: session.status,
          paymentStatus: session.payment_status,
        }
      );

      return res.json({
        received: true,
        ignored: true,
        reason: "checkout_not_completed",
      });
    }

    const propertyId = Number(
      session.metadata?.propertyId
    );

    const userId = Number(
      session.metadata?.userId
    );

    const mode = normalizeMode(
      session.metadata?.propertyMode
    );

    const selectedPackage = normalizePackage(
      session.metadata?.listingPackage
    );

	const durationDays = Number(
  	session.metadata?.durationDays
	);

	const foundingOfferEligible =
  	String(
    	session.metadata?.foundingOfferEligible || ""
  	) === "true";

	const discountAmountCents = Number(
  	session.total_details?.amount_discount || 0
	);

    const rawFlow = String(
      session.metadata?.flow || "LISTING_PACKAGE"
    );

	const flow: CheckoutFlow | null =
	  rawFlow === "LISTING_PACKAGE" ||
	  rawFlow === "FEATURE_UPGRADE"
	    ? rawFlow
	    : null;

	const foundingOfferApplied =
	  flow === "LISTING_PACKAGE" &&
  	foundingOfferEligible &&
  	discountAmountCents > 0;

    if (
      !Number.isFinite(propertyId) ||
      propertyId <= 0
    ) {
      console.warn(
        "Stripe webhook ignored: invalid propertyId",
        {
          sessionId: session.id,
          metadata: session.metadata,
        }
      );

      return res.json({
        received: true,
        ignored: true,
        reason: "invalid_property_id",
      });
    }

    if (
      !Number.isFinite(userId) ||
      userId <= 0
    ) {
      console.warn(
        "Stripe webhook ignored: invalid userId",
        {
          sessionId: session.id,
          metadata: session.metadata,
        }
      );

      return res.json({
        received: true,
        ignored: true,
        reason: "invalid_user_id",
      });
    }

    if (!mode || !selectedPackage || !flow) {
      console.warn(
        "Stripe webhook ignored: invalid package metadata",
        {
          sessionId: session.id,
          metadata: session.metadata,
        }
      );

      return res.json({
        received: true,
        ignored: true,
        reason: "invalid_package_metadata",
      });
    }

    if (
      flow === "FEATURE_UPGRADE" &&
      selectedPackage !== "FEATURED"
    ) {
      console.warn(
        "Stripe webhook ignored: invalid upgrade package",
        {
          sessionId: session.id,
          selectedPackage,
          flow,
        }
      );

      return res.json({
        received: true,
        ignored: true,
        reason: "invalid_upgrade_package",
      });
    }

    const expectedPriceId = getConfiguredPriceId(
      mode,
      selectedPackage,
      flow
    );

    if (
      !expectedPriceId ||
      String(session.metadata?.stripePriceId || "") !== expectedPriceId
    ) {
      console.warn(
        "Stripe webhook ignored: price configuration mismatch",
        {
          sessionId: session.id,
          mode,
          selectedPackage,
          flow,
        }
      );

      return res.json({
        received: true,
        ignored: true,
        reason: "price_configuration_mismatch",
      });
    }

    const expectedDuration =
      LISTING_DURATION_DAYS[mode];

    if (
      !Number.isFinite(durationDays) ||
      durationDays !== expectedDuration
    ) {
      console.warn(
        "Stripe webhook ignored: invalid duration",
        {
          sessionId: session.id,
          durationDays,
          expectedDuration,
        }
      );

      return res.json({
        received: true,
        ignored: true,
        reason: "invalid_duration",
      });
    }

    const property = await prisma.property.findUnique({
      where: {
        id: propertyId,
      },
      select: {
        id: true,
        userId: true,
        mode: true,
        title: true,
        slug: true,
        price: true,
        photos: true,
        address1: true,
        address2: true,
        city: true,
        county: true,
        eircode: true,
        listingStatus: true,
        listingPackage: true,
        paymentStatus: true,
        stripeCheckoutSessionId: true,
        isFeatured: true,
        featuredUntil: true,
        user: {
          select: {
            email: true,
            name: true,
          },
        },
      },
    });

    if (!property) {
      console.warn(
        "Stripe webhook ignored: property not found",
        {
          propertyId,
          sessionId: session.id,
        }
      );

      return res.json({
        received: true,
        ignored: true,
        reason: "property_not_found",
      });
    }

    if (property.userId !== userId) {
      console.warn(
        "Stripe webhook ignored: user/property mismatch",
        {
          propertyId,
          propertyUserId: property.userId,
          metadataUserId: userId,
          sessionId: session.id,
        }
      );

      return res.json({
        received: true,
        ignored: true,
        reason: "user_property_mismatch",
      });
    }

    const propertyMode = normalizeMode(property.mode);

    if (propertyMode !== mode) {
      console.warn(
        "Stripe webhook ignored: property mode mismatch",
        {
          propertyId,
          propertyMode,
          metadataMode: mode,
          sessionId: session.id,
        }
      );

      return res.json({
        received: true,
        ignored: true,
        reason: "property_mode_mismatch",
      });
    }

    /*
     * Stripe retries webhook deliveries. If this exact Session
     * has already been completed, acknowledge it without applying
     * the listing package twice.
     */
    if (
      property.stripeCheckoutSessionId === session.id &&
      property.paymentStatus === "COMPLETED"
    ) {
      return res.json({
        received: true,
        alreadyProcessed: true,
        propertyId,
      });
    }

    const propertyIsActivelyFeatured =
      property.isFeatured === true &&
      property.featuredUntil != null &&
      new Date(property.featuredUntil).getTime() > Date.now();

    if (
      flow === "FEATURE_UPGRADE" &&
      (
        property.listingStatus !== "PUBLISHED" ||
        normalizePackage(property.listingPackage) !== "STANDARD" ||
        propertyIsActivelyFeatured
      )
    ) {
      console.warn(
        "Stripe webhook ignored: listing is not eligible for upgrade",
        {
          propertyId,
          sessionId: session.id,
          listingStatus: property.listingStatus,
          listingPackage: property.listingPackage,
          propertyIsActivelyFeatured,
        }
      );

      return res.json({
        received: true,
        ignored: true,
        reason: "upgrade_not_eligible",
      });
    }

    if (
      flow === "LISTING_PACKAGE" &&
      property.stripeCheckoutSessionId &&
      property.stripeCheckoutSessionId !== session.id &&
      property.paymentStatus === "COMPLETED"
    ) {
      console.warn(
        "Stripe webhook ignored: property already has a completed checkout",
        {
          propertyId,
          currentSessionId:
            property.stripeCheckoutSessionId,
          incomingSessionId: session.id,
        }
      );

      return res.json({
        received: true,
        ignored: true,
        reason: "different_checkout_already_completed",
      });
    }

    const now = new Date();
    const listingExpiresAt = addDays(
      now,
      expectedDuration
    );

    const isFeatured =
      selectedPackage === "FEATURED";

    const amountPaidCents =
      typeof session.amount_total === "number"
        ? session.amount_total
        : 0;

    const paymentIntentId = getPaymentIntentId(
      session.payment_intent
    );

    /*
     * Existing published listings stay published when upgraded.
     * New or previously rejected listings enter HAVN moderation
     * after Checkout completes.
     */
    const nextListingStatus =
      flow === "FEATURE_UPGRADE" ||
      property.listingStatus === "PUBLISHED"
        ? "PUBLISHED"
        : "SUBMITTED";

    await prisma.$transaction(async tx => {
      await tx.property.update({
        where: {
          id: propertyId,
        },
        data: {
          listingPackage: selectedPackage,
          paymentStatus: "COMPLETED",

          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: paymentIntentId,

          amountPaidCents,
          paidAt: now,
          listingExpiresAt,
          expiryWarningSentAt: null,
          expiredEmailSentAt: null,

          isFeatured,
          featuredUntil: isFeatured
            ? listingExpiresAt
            : null,

          listingStatus: nextListingStatus,

          submittedAt:
            nextListingStatus === "SUBMITTED"
              ? now
              : undefined,

          rejectedAt:
            nextListingStatus === "SUBMITTED"
              ? null
              : undefined,

          rejectedById:
            nextListingStatus === "SUBMITTED"
              ? null
              : undefined,

          rejectedReason:
            nextListingStatus === "SUBMITTED"
              ? null
              : undefined,
        },
      });

      if (
        flow === "LISTING_PACKAGE" &&
        foundingOfferApplied
      ) {
        await tx.user.updateMany({
          where: {
            id: userId,
            foundingOfferUsedAt: null,
          },
          data: {
            foundingOfferUsedAt: now,
          },
        });
      }
    });

    if (flow === "LISTING_PACKAGE") {
      void (async () => {
        try {
          await sendUserListingEmail({
          to: property.user.email,
          recipientName: property.user.name,
          event: "SUBMITTED",
          listingTitle: property.title,
          slug: property.slug,
          listingId: property.id,
          coverImageUrl:
            Array.isArray(property.photos) && property.photos.length
              ? property.photos[0]
              : null,
          propertyAddress: buildPropertyAddress(property),
          propertyMode: mode,
          listingPackage: selectedPackage,
          durationDays: expectedDuration,
          amountPaidCents,
          paymentReference:
            paymentIntentId || session.id,
          submittedAt: now,
          price: property.price,
          myListingsUrl:
            "https://havn.ie/my-listings.html",
          });
        } catch (emailError) {
          console.warn(
            "Listing submitted email failed (non-fatal):",
            emailError
          );
        }
      })();
    }

    console.log("Stripe listing package completed", {
      propertyId,
      userId,
      sessionId: session.id,
      mode,
      selectedPackage,
      amountPaidCents,
      foundingOfferApplied,
      listingExpiresAt:
        listingExpiresAt.toISOString(),
      isFeatured,
      flow,
      nextListingStatus,
    });

    return res.json({
      received: true,
      completed: true,
      propertyId,
      flow,
      package: selectedPackage,
      mode,
      amountPaidCents,
      foundingOfferApplied,
      listingExpiresAt:
        listingExpiresAt.toISOString(),
      isFeatured,
      listingStatus: nextListingStatus,
    });
  } catch (err: any) {
    console.error(
      "Stripe webhook processing error:",
      {
        message: err?.message,
        type: err?.type,
        code: err?.code,
        stack: err?.stack,
      }
    );

    return res.status(500).json({
      ok: false,
      message: "Webhook processing failed",
    });
  }
});

export default router;