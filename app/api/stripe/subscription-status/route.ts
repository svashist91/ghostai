import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";

export async function GET(req: Request) {
  try {
    // Get authenticated user from Clerk
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ isSubscribed: false }, { status: 200 });
    }

    const { searchParams } = new URL(req.url);
    const queryUserId = searchParams.get("userId");

    // Verify the userId matches the authenticated user
    if (queryUserId !== userId) {
      return NextResponse.json({ isSubscribed: false }, { status: 200 });
    }

    // Get subscription status from Clerk user metadata
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const isSubscribed = user.publicMetadata?.isPro === true;

    return NextResponse.json({ isSubscribed }, { status: 200 });
  } catch (error: any) {
    console.error("Error checking subscription status:", error);
    // Return false on error to allow access
    return NextResponse.json({ isSubscribed: false }, { status: 200 });
  }
}

