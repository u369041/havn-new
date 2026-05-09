import { Router } from "express";
import Stripe from "stripe";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth";

const router = Router();

router.get("/ping", (_req, res) => {
  res.json({ ok: true, route: "stripe" });
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const FEATURED_PRICE_CENTS = 2900;
const FEATURED_DAYS = 30;

/**
 * POST /api/stripe/create-checkout-session
 * Body: { propertyId }
 */
router.post(
  "/create-checkout-session",
  requireAuth,
  async (req: any, res) => {
    try {
      const userId = req.user.userId;
      const { propertyId } = req.body;

      if (!propertyId) {
        return res.status(400).json({
          ok: false,
          message: "Missing propertyId",
        });
      }

      const property = await prisma.property.findUnique({
        where: {
          id: Number(propertyId),
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

      const alreadyFeatured =
        property.isFeatured &&
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
                description:
                  "Promote your HAVN.ie property listing for 30 days.",
              },
            },
          },
        ],

        metadata: {
          propertyId: String(property.id),
          userId: String(userId),
          product: "featured_listing_30_days",
        },

        success_url:
          "https://havn.ie/my-listings.html?featured=success",

        cancel_url:
          "https://havn.ie/my-listings.html?featured=cancel",
      });

      return res.json({
        ok: true,
        url: session.url,
      });
    } catch (err) {
      console.error("Stripe session error:", err);

      return res.status(500).json({
        ok: false,
        message: "Could not create checkout session",
      });
    }
  }
);

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
    console.error("Webhook signature failed:", err.message);

    return res.status(400).send("Webhook Error");
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as any;
     

      const propertyId = Number(
        session.metadata?.propertyId
      );

      if (
        Number.isFinite(propertyId) &&
        propertyId > 0
      ) {
        const featuredUntil = new Date();

        featuredUntil.setDate(
          featuredUntil.getDate() + FEATURED_DAYS
        );

        await prisma.property.update({
          where: {
            id: propertyId,
          },

          data: {
            isFeatured: true,
            featuredUntil,
          },
        });

        console.log(
          "Featured listing activated:",
          propertyId
        );
      }
    }

    return res.json({
      received: true,
    });
  } catch (err) {
    console.error("Stripe webhook processing error:", err);

    return res.status(500).json({
      ok: false,
    });
  }
});

export default router;