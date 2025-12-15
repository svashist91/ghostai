import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-[#FAF8F7] flex items-center justify-center font-sans">
      <SignUp />
    </div>
  );
}

