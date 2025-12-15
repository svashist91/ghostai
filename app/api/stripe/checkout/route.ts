import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import Stripe from "stripe";

// Check for Stripe secret key
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  console.error("STRIPE_SECRET_KEY is not set in environment variables");
}

const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, {
      apiVersion: "2025-11-17.clover",
    })
  : null;

export async function POST(req: Request) {
  try {
    // Check if Stripe is configured
    if (!stripe) {
      console.error("Stripe is not configured. Missing STRIPE_SECRET_KEY.");
      return NextResponse.json(
        { error: "Stripe is not configured. Please contact support." },
        { status: 500 }
      );
    }

    // Get authenticated user from Clerk
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { userId: bodyUserId } = body;

    // Verify the userId matches the authenticated user
    if (bodyUserId !== userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user already has a Stripe customer ID
    let existingCustomerId: string | undefined;
    try {
      const client = await clerkClient();
      const user = await client.users.getUser(userId);
      existingCustomerId = user.publicMetadata?.stripeCustomerId as string | undefined;
    } catch (error: any) {
      console.error("Error fetching user from Clerk:", error);
      // Continue without existing customer ID
    }

    // Get the base URL for redirect URLs
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    // Create Stripe Checkout Session
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Ghost AI Pro",
              description: "Unlimited AI, Natural Voice, History Storage",
            },
            unit_amount: 2000, // $20.00 in cents
            recurring: {
              interval: "month",
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId: userId,
      },
      success_url: `${baseUrl}/pricing?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/pricing`,
    };

    // Use existing customer if available to prevent duplicates
    if (existingCustomerId) {
      sessionConfig.customer = existingCustomerId;
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error("Stripe checkout error:", error);
    
    // Provide more detailed error information
    let errorMessage = "Failed to create checkout session";
    if (error.type === "StripeInvalidRequestError") {
      errorMessage = `Stripe error: ${error.message}`;
    } else if (error.message) {
      errorMessage = error.message;
    }

    return NextResponse.json(
      { error: errorMessage, details: error.type || "Unknown error" },
      { status: 500 }
    );
  }
}

