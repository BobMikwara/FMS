import { Suspense } from "react";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    // `useSearchParams` in the child requires a suspense boundary during prerender.
    <Suspense fallback={<ResetFallback />}>
      <ResetPasswordForm token={readToken()} />
    </Suspense>
  );
}

/** Reads the reset token from the query string on the client. */
function readToken(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("token") ?? "";
}

function ResetFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-5 py-10">
      <div className="w-full max-w-[26rem] space-y-5">
        <div className="skeleton h-9 w-32 rounded-xl" />
        <div className="skeleton h-8 w-64 rounded-lg" />
        <div className="skeleton h-24 w-full rounded-xl" />
      </div>
    </div>
  );
}
