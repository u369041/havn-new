import { Router } from "express";
import Stripe from "stripe";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth";

const router = Router();

const FEATURED_PRICE_CENTS = 2900;
const FEATURED_DAYS = 30;
const FEATURED_PRODUCT = "featured_listing_30_days";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

router.get("/ping", (_req, res) => {
  res.json({ ok: true, route: "stripe" });
});

/**
 * POST /api/stripe/create-checkout-session
 * Body: { propertyId }
 */
router.post("/create-checkout-session", requireAuth, async (req: any, res) => {
  try {
    const userId = Number(req.user?.userId);
    const propertyId = Number(req.body?.propertyId);

    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ ok: false, message: "Invalid auth session" });
    }

    if (!Number.isFinite(propertyId) || propertyId <= 0) {
      return res.status(400).json({ ok: false, message: "Missing propertyId" });
    }

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
    });

    if (!property) {
      return res.status(404).json({ ok: false, message: "Property not found" });
    }

    if (property.userId !== userId) {
      return res.status(403).json({ ok: false, message: "Not allowed" });
    }

    if (property.listingStatus !== "PUBLISHED") {
      return res.status(400).json({
        ok: false,
        message: "Only published listings can be featured",
      });
    }

    const alreadyFeatured =
      property.isFeatured === true &&
      property.featuredUntil &&
      new Date(property.featuredUntil).getTime() > Date.now();

    if (alreadyFeatured) {
      return res.status(400).json({
        ok: false,
        message: "Property is already featured",
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",

      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: FEATURED_PRICE_CENTS,
            product_data: {
              name: "Featured Listing — 30 Days",
              description: "Promote your HAVN.ie property listing for 30 days.",
            },
          },
        },
      ],

      metadata: {
        propertyId: String(property.id),
        userId: String(userId),
        product: FEATURED_PRODUCT,
      },

      success_url: "https://havn.ie/my-listings.html?featured=success",
      cancel_url: "https://havn.ie/my-listings.html?featured=cancel",
    });

    return res.json({
      ok: true,
      url: session.url,
    });
  } catch (err: any) {
    console.error("Stripe session error:", {
      message: err?.message,
      stack: err?.stack,
    });

    return res.status(500).json({
      ok: false,
      message: "Could not create checkout session",
    });
  }
});

/**
 * STRIPE WEBHOOK
 */
router.post("/webhook", async (req: any, res) => {
  const sig = req.headers["stripe-signature"];

  let event: any;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig as string,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("Stripe webhook signature failed:", err.message);
    return res.status(400).send("Webhook Error");
  }

  try {
    if (event.type !== "checkout.session.completed") {
      return res.json({ received: true, ignored: true });
    }

    const session = event.data.object as any;

    const product = String(session.metadata?.product || "");
    const propertyId = Number(session.metadata?.propertyId);
    const userId = Number(session.metadata?.userId);

    if (product !== FEATURED_PRODUCT) {
      console.warn("Stripe webhook ignored: wrong product", {
        product,
        sessionId: session.id,
      });

      return res.json({ received: true, ignored: true });
    }

    if (session.payment_status !== "paid") {
      console.warn("Stripe webhook ignored: payment not paid", {
        payment_status: session.payment_status,
        sessionId: session.id,
      });

      return res.json({ received: true, ignored: true });
    }

    if (!Number.isFinite(propertyId) || propertyId <= 0) {
      console.warn("Stripe webhook ignored: invalid propertyId", {
        propertyId: session.metadata?.propertyId,
        sessionId: session.id,
      });

      return res.json({ received: true, ignored: true });
    }

    if (!Number.isFinite(userId) || userId <= 0) {
      console.warn("Stripe webhook ignored: invalid userId", {
        userId: session.metadata?.userId,
        sessionId: session.id,
      });

      return res.json({ received: true, ignored: true });
    }

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        id: true,
        userId: true,
        title: true,
        slug: true,
        listingStatus: true,
        isFeatured: true,
        featuredUntil: true,
      },
    });

    if (!property) {
      console.warn("Stripe webhook ignored: property not found", {
        propertyId,
        sessionId: session.id,
      });

      return res.json({ received: true, ignored: true });
    }

    if (property.userId !== userId) {
      console.warn("Stripe webhook ignored: user/property mismatch", {
        propertyId,
        propertyUserId: property.userId,
        metadataUserId: userId,
        sessionId: session.id,
      });

      return res.json({ received: true, ignored: true });
    }

    if (property.listingStatus !== "PUBLISHED") {
      console.warn("Stripe webhook ignored: listing not published", {
        propertyId,
        listingStatus: property.listingStatus,
        sessionId: session.id,
      });

      return res.json({ received: true, ignored: true });
    }

    const featuredUntil = new Date();
    featuredUntil.setDate(featuredUntil.getDate() + FEATURED_DAYS);

    await prisma.property.update({
      where: { id: propertyId },
      data: {
        isFeatured: true,
        featuredUntil,
      },
    });

    console.log("Stripe featured listing activated", {
      propertyId,
      userId,
      sessionId: session.id,
      featuredUntil: featuredUntil.toISOString(),
    });

    return res.json({
      received: true,
      activated: true,
      propertyId,
    });
  } catch (err: any) {
    console.error("Stripe webhook processing error:", {
      message: err?.message,
      stack: err?.stack,
    });

    return res.status(500).json({
      ok: false,
      message: "Webhook processing failed",
    });
  }
});

export default router;