import { Router } from "express";
import Stripe from "stripe";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth";

const router = Router();

router.get("/ping", (_req, res) => {
  res.json({ ok: true, route: "stripe" });
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/**
 * POST /api/stripe/create-checkout-session
 * Body: { propertyId }
 */
router.post("/create-checkout-session", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.userId;
    const { propertyId } = req.body;

    const property = await prisma.property.findUnique({
      where: { id: Number(propertyId) },
    });

    if (!property || property.userId !== userId) {
      return res.status(403).json({ ok: false, message: "Not allowed" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Feature Listing (30 days)",
            },
            unit_amount: 1999, // €19.99
          },
          quantity: 1,
        },
      ],
      success_url: `https://havn.ie/my-listings.html?featured=success`,
      cancel_url: `https://havn.ie/my-listings.html?featured=cancel`,
      metadata: {
        propertyId: String(property.id),
      },
    });

    res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error("Stripe session error:", err);
    res.status(500).json({ ok: false });
  }
});

/**
 * STRIPE WEBHOOK
 */
router.post("/webhook", async (req: any, res) => {
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig!,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("Webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error`);
  }

  if (event.type === "checkout.session.completed") {
    const session: any = event.data.object;

    const propertyId = Number(session.metadata.propertyId);

    await prisma.property.update({
      where: { id: propertyId },
      data: {
        isFeatured: true,
        featuredUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }

  res.json({ received: true });
});

export default router;