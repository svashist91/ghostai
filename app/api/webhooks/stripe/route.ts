import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { clerkClient } from "@clerk/nextjs/server";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-11-17.clover",
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(req: Request) {
  try {
    // Get the raw body as text
    const body = await req.text();
    const headersList = await headers();
    const signature = headersList.get("stripe-signature");

    if (!signature) {
      return NextResponse.json(
        { error: "No signature provided" },
        { status: 400 }
      );
    }

    // Verify the webhook signature
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: any) {
      console.error("Webhook signature verification failed:", err.message);
      return NextResponse.json(
        { error: `Webhook Error: ${err.message}` },
        { status: 400 }
      );
    }

    // Handle the event
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // Extract userId from metadata
        const userId = session.metadata?.userId;
        if (!userId) {
          console.error("No userId in checkout session metadata");
          return NextResponse.json(
            { error: "No userId in metadata" },
            { status: 400 }
          );
        }

        // Get subscription and customer IDs
        const subscriptionId = session.subscription as string;
        const customerId = session.customer as string;

        if (!subscriptionId || !customerId) {
          console.error("Missing subscription or customer ID");
          return NextResponse.json(
            { error: "Missing subscription or customer ID" },
            { status: 400 }
          );
        }

        // Update Stripe customer metadata with userId (if not already set)
        try {
          await stripe.customers.update(customerId, {
            metadata: {
              userId: userId,
            },
          });
        } catch (error: any) {
          console.error("Error updating Stripe customer metadata:", error);
          // Continue even if this fails
        }

        // Update Clerk user metadata
        try {
          await clerkClient.users.updateUserMetadata(userId, {
            publicMetadata: {
              isPro: true,
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptionId,
            },
          });

          console.log(`✅ Updated user ${userId} to Pro status`);
        } catch (error: any) {
          console.error("Error updating Clerk user metadata:", error);
          return NextResponse.json(
            { error: "Failed to update user metadata" },
            { status: 500 }
          );
        }

        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        // Find user by stripeCustomerId
        // We'll search through users to find the one with matching customerId
        // In production, you might want to maintain a database mapping
        try {
          // Get the customer to find userId in metadata
          const customer = await stripe.customers.retrieve(customerId);
          
          if (typeof customer === "object" && customer.metadata?.userId) {
            const userId = customer.metadata.userId;

            // Update Clerk user metadata
            await clerkClient.users.updateUserMetadata(userId, {
              publicMetadata: {
                isPro: false,
                // Keep existing stripeCustomerId and stripeSubscriptionId for reference
              },
            });

            console.log(`✅ Updated user ${userId} subscription cancelled`);
          } else {
            // Fallback: search for user with this customerId in publicMetadata
            // This is less efficient but works if customer metadata wasn't set
            console.warn(
              `Could not find userId for customer ${customerId}, subscription may have been cancelled`
            );
          }
        } catch (error: any) {
          console.error("Error handling subscription deletion:", error);
          // Don't fail the webhook - log and continue
        }

        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        // Handle subscription updates (e.g., plan changes, status changes)
        try {
          const customer = await stripe.customers.retrieve(customerId);
          
          if (typeof customer === "object" && customer.metadata?.userId) {
            const userId = customer.metadata.userId;
            const isActive = subscription.status === "active";

            await clerkClient.users.updateUserMetadata(userId, {
              publicMetadata: {
                isPro: isActive,
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscription.id,
              },
            });

            console.log(
              `✅ Updated user ${userId} subscription status: ${subscription.status}`
            );
          }
        } catch (error: any) {
          console.error("Error handling subscription update:", error);
        }

        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error: any) {
    console.error("Webhook error:", error);
    return NextResponse.json(
      { error: error.message || "Webhook handler failed" },
      { status: 500 }
    );
  }
}

