import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { getCurrentUser } from "@/server/auth/session";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");
  return (
    // `useSearchParams` inside the form requires a suspense boundary during prerender.
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)]">
      <div className="skeleton h-64 w-full max-w-md rounded-2xl" aria-label="Loading sign in" />
    </div>
  );
}
