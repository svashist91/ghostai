"use client";
import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { FiCreditCard, FiCheck } from "react-icons/fi";

// Check subscription status from Clerk publicMetadata
function getSubscriptionStatus(user: any): boolean {
  if (!user) return false;
  return user.publicMetadata?.isPro === true;
}

// Pricing Cards Component (View A - Not Subscribed)
function PricingCards({ onCheckout }: { onCheckout: () => void }) {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-[#231C16] mb-4">Choose Your Plan</h1>
        <p className="text-[#a98053] text-lg">Select the perfect plan for your needs</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Free Plan */}
        <div className="bg-white rounded-2xl border-2 border-[#EBE6DC] p-8 shadow-sm">
          <div className="mb-6">
            <h3 className="text-2xl font-bold text-[#231C16] mb-2">Free</h3>
            <div className="flex items-baseline">
              <span className="text-4xl font-bold text-[#231C16]">$0</span>
              <span className="text-[#a98053] ml-2">/mo</span>
            </div>
          </div>
          <ul className="space-y-4 mb-8">
            <li className="flex items-center text-[#231C16]">
              <FiCheck className="w-5 h-5 text-[#bb601f] mr-3" />
              <span>Limited Access</span>
            </li>
            <li className="flex items-center text-[#231C16]">
              <FiCheck className="w-5 h-5 text-[#bb601f] mr-3" />
              <span>Standard Support</span>
            </li>
          </ul>
          <button
            disabled
            className="w-full py-3 rounded-full bg-[#f5f5f5] text-[#a98053] font-bold border border-[#EBE6DC] cursor-not-allowed"
          >
            Current Plan
          </button>
        </div>

        {/* Pro Plan */}
        <div className="bg-gradient-to-br from-[#ffe4c1] to-[#FBE8D8] rounded-2xl border-2 border-[#d47e21] p-8 shadow-lg relative">
          <div className="absolute top-4 right-4 bg-[#d47e21] text-white text-xs font-bold px-3 py-1 rounded-full">
            POPULAR
          </div>
          <div className="mb-6">
            <h3 className="text-2xl font-bold text-[#231C16] mb-2">Pro</h3>
            <div className="flex items-baseline">
              <span className="text-4xl font-bold text-[#231C16]">$20</span>
              <span className="text-[#a98053] ml-2">/mo</span>
            </div>
          </div>
          <ul className="space-y-4 mb-8">
            <li className="flex items-center text-[#231C16]">
              <FiCheck className="w-5 h-5 text-[#bb601f] mr-3" />
              <span>Unlimited AI</span>
            </li>
            <li className="flex items-center text-[#231C16]">
              <FiCheck className="w-5 h-5 text-[#bb601f] mr-3" />
              <span>Natural Voice</span>
            </li>
            <li className="flex items-center text-[#231C16]">
              <FiCheck className="w-5 h-5 text-[#bb601f] mr-3" />
              <span>History Storage</span>
            </li>
          </ul>
          <button
            onClick={onCheckout}
            className="w-full py-3 rounded-full bg-gradient-to-r from-[#fcab59] to-[#e97d2b] text-white font-bold shadow-lg hover:from-[#e19655] transition"
          >
            Upgrade to Pro
          </button>
        </div>
      </div>
    </div>
  );
}

// Subscription Dashboard Component (View B - Already Subscribed)
function SubscriptionDashboard({ onPortal }: { onPortal: () => void }) {
  // Mock data - in production, fetch from your database
  const nextBillingDate = new Date();
  nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

  const features = [
    "Unlimited AI Conversations",
    "Natural Voice Responses",
    "Unlimited History Storage",
    "Priority Support",
    "Advanced Features",
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-[#231C16] mb-4">My Subscription</h1>
        <p className="text-[#a98053] text-lg">Manage your Ghost AI subscription</p>
      </div>

      <div className="bg-white rounded-2xl border-2 border-[#EBE6DC] p-8 shadow-lg">
        {/* Plan Info */}
        <div className="mb-8 pb-8 border-b border-[#EBE6DC]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-2xl font-bold text-[#231C16] mb-1">Ghost AI Pro</h3>
              <p className="text-[#a98053]">$20/month</p>
            </div>
            <div className="bg-[#d4edda] text-[#155724] px-4 py-2 rounded-full text-sm font-bold">
              Active
            </div>
          </div>
          <div className="text-sm text-[#a98053]">
            <p>Next billing date: {nextBillingDate.toLocaleDateString("en-US", { 
              month: "long", 
              day: "numeric", 
              year: "numeric" 
            })}</p>
          </div>
        </div>

        {/* Features List */}
        <div className="mb-8">
          <h4 className="text-lg font-bold text-[#231C16] mb-4">Active Features</h4>
          <ul className="space-y-3">
            {features.map((feature, idx) => (
              <li key={idx} className="flex items-center text-[#231C16]">
                <FiCheck className="w-5 h-5 text-[#bb601f] mr-3 flex-shrink-0" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Action Button */}
        <button
          onClick={onPortal}
          className="w-full py-3 rounded-full bg-gradient-to-r from-[#fcab59] to-[#e97d2b] text-white font-bold shadow-lg hover:from-[#e19655] transition flex items-center justify-center gap-2"
        >
          <FiCreditCard className="w-5 h-5" />
          Manage Subscription
        </button>
      </div>
    </div>
  );
}

export default function PricingPage() {
  const { user, isLoaded } = useUser();
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);

  // Check subscription status from Clerk metadata
  useEffect(() => {
    if (isLoaded) {
      const subscribed = getSubscriptionStatus(user);
      setIsSubscribed(subscribed);
    }
  }, [user, isLoaded]);

  // Handle checkout
  const handleCheckout = async () => {
    if (!user) {
      alert("Please sign in to upgrade");
      return;
    }

    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Show the actual error message from the API
        const errorMessage = data.error || "Failed to create checkout session";
        console.error("Checkout error:", data);
        alert(`Error: ${errorMessage}${data.details ? ` (${data.details})` : ""}`);
        return;
      }

      const { url } = data;
      if (url) {
        window.location.href = url;
      } else {
        alert("No checkout URL received. Please try again.");
      }
    } catch (error: any) {
      console.error("Error initiating checkout:", error);
      alert(`Failed to start checkout: ${error.message || "Please try again."}`);
    }
  };

  // Handle portal
  const handlePortal = async () => {
    if (!user) {
      alert("Please sign in");
      return;
    }

    try {
      const response = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });

      if (!response.ok) {
        throw new Error("Failed to create portal session");
      }

      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      console.error("Error opening portal:", error);
      alert("Failed to open subscription portal. Please try again.");
    }
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#FAF8F7] flex items-center justify-center">
        <div className="text-[#231C16] text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF8F7] font-sans">
      {isSubscribed ? (
        <SubscriptionDashboard onPortal={handlePortal} />
      ) : (
        <PricingCards onCheckout={handleCheckout} />
      )}
    </div>
  );
}

