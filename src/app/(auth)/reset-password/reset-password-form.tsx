"use client";

import { useState } from "react";
import Link from "next/link";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/layout";
import { Icon } from "@/components/layout/icons";

export function ResetPasswordForm({ token, mode }: { token: string; mode: "activate" | "reset" }) {
  const activating = mode === "activate";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const errors: { password?: string; confirm?: string } = {};
    if (password.length < 10) errors.password = "Use at least 10 characters.";
    if (password !== confirm) errors.confirm = "Passwords do not match.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setError(payload?.error?.message ?? "We couldn't reset your password. Please request a new link.");
        return;
      }
      setDone(true);
      window.setTimeout(() => {
        window.location.href = activating ? "/login?activated=success" : "/login?reset=success";
      }, 1200);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-5 py-10">
      <div className="w-full max-w-[26rem]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand)] text-[var(--brand-ink)]">
            <Icon name="fuel" className="h-4 w-4" />
          </span>
          <span className="text-[0.9375rem] font-semibold text-[var(--ink)]">SmartFuel</span>
        </div>

        <h1 className="mt-6 text-[1.5rem] font-semibold tracking-[-0.025em] text-[var(--ink)]">
          {activating ? "Activate your account" : "Choose a new password"}
        </h1>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
          {activating
            ? "Set a password of at least 10 characters to activate your SmartFuel account. This one-time link expires after 24 hours."
            : "Your new password must be at least 10 characters long."}
        </p>

        {done ? (
          <div className="mt-6">
            <Notice tone="ok" title={activating ? "Account activated" : "Password updated"}>
              Redirecting you to the sign-in screen…
            </Notice>
          </div>
        ) : !token ? (
          <div className="mt-6 space-y-4">
            <Notice tone="crit" title="Reset link is incomplete">
              This link is missing its security token. Please request a new password reset link.
            </Notice>
            <Link href="/forgot-password" className="btn btn-primary w-full">
              Request a new link
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            {error ? (
              <Notice tone="crit" title="Reset failed">
                {error}
              </Notice>
            ) : null}
            <Field
              label="New password"
              htmlFor="password"
              required
              error={fieldErrors.password}
              hint="At least 10 characters. Mix letters, numbers and symbols."
            >
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                invalid={Boolean(fieldErrors.password)}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field label="Confirm new password" htmlFor="confirm" required error={fieldErrors.confirm}>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                invalid={Boolean(fieldErrors.confirm)}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </Field>
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
              {activating ? "Activate account" : "Update password"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
