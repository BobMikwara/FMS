"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/feedback";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] unhandled error", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-5">
      <div className="card w-full max-w-lg">
        <ErrorState
          title="Something went wrong"
          message="An unexpected error occurred while rendering this screen. Your data is safe. You can retry, or head back to the dashboard and continue monitoring your network."
          onRetry={reset}
          retryLabel="Try again"
        >
          <a href="/" className="btn btn-secondary btn-sm">
            Back to dashboard
          </a>
        </ErrorState>
        {error.digest ? (
          <p className="border-t border-[var(--line)] px-5 py-2.5 text-center text-[0.625rem] text-[var(--ink-3)]">
            Reference: {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}
