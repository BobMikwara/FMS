"use client";

import { useState } from "react";
import Link from "next/link";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/layout";
import { Icon } from "@/components/layout/icons";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) {
      setState("error");
      setMessage("Enter the email address on your SmartFuel account.");
      return;
    }
    setState("sending");
    setMessage(null);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setState("error");
        setMessage(payload?.error?.message ?? "We couldn't process that request. Please try again.");
        return;
      }
      setState("sent");
      setMessage(
        "If an account exists for that address, a password reset link is on its way. The link is valid for one hour and can only be used once.",
      );
      // In this demo environment no mail server is connected, so surface the link directly.
      if (payload.data?.resetUrl) setResetLink(payload.data.resetUrl);
    } catch {
      setState("error");
      setMessage("We couldn't reach the server. Check your connection and try again.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-5 py-10">
      <div className="w-full max-w-[26rem]">
        <Link href="/login" className="mb-8 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-[var(--ink-2)] hover:text-[var(--ink)]">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="m10 3-5 5 5 5" />
          </svg>
          Back to sign in
        </Link>

        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand)] text-[var(--brand-ink)]">
            <Icon name="fuel" className="h-4 w-4" />
          </span>
          <span className="text-[0.9375rem] font-semibold text-[var(--ink)]">SmartFuel</span>
        </div>

        <h1 className="mt-6 text-[1.5rem] font-semibold tracking-[-0.025em] text-[var(--ink)]">Reset your password</h1>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
          Enter the email address you use for SmartFuel and we'll send you a secure link to choose a new password.
        </p>

        {state === "sent" ? (
          <div className="mt-6 space-y-4">
            <Notice tone="ok" title="Check your inbox">
              {message}
            </Notice>
            {resetLink ? (
              <div className="card card-pad">
                <p className="text-[0.75rem] font-semibold text-[var(--ink)]">Demo environment</p>
                <p className="mt-1 text-[0.75rem] leading-relaxed text-[var(--ink-2)]">
                  No mail server is connected in this environment, so the reset link is shown here directly:
                </p>
                <Link
                  href={resetLink}
                  className="mt-2 block break-all rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2 font-mono text-[0.6875rem] text-[var(--brand)] hover:bg-[var(--surface-3)]"
                >
                  {resetLink}
                </Link>
              </div>
            ) : null}
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            {state === "error" && message ? (
              <Notice tone="crit" title="Request failed">
                {message}
              </Notice>
            ) : null}
            <Field label="Work email" htmlFor="email" required>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="you@company.co.tz"
                value={email}
                invalid={state === "error"}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={state === "sending"}>
              Send reset link
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
