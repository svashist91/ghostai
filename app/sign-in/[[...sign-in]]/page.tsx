import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-[#FAF8F7] flex items-center justify-center font-sans">
      <SignIn />
    </div>
  );
}

