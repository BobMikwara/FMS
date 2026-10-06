"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Field, Input, Checkbox } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/layout";
import { Icon } from "@/components/layout/icons";
import { ShieldCheck } from "lucide-react";

const DEMO_ACCOUNTS = [
  { email: "george@puma.co.tz", label: "George Mushi", role: "Super Admin" },
  { email: "sarah@puma.co.tz", label: "Sarah Kimaro", role: "Administrator" },
  { email: "daniel@puma.co.tz", label: "Daniel Mollel", role: "Manager" },
  { email: "asha@puma.co.tz", label: "Asha Laizer", role: "Operator" },
  { email: "neema@puma.co.tz", label: "Neema Shirima", role: "Viewer" },
];

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [verifyingMfa, setVerifyingMfa] = useState(false);

  const resetSuccess = searchParams.get("reset") === "success";
  const nextPath = searchParams.get("next") ?? "/";

  useEffect(() => {
    if (!resetSuccess) return;
    const timer = window.setTimeout(() => router.replace("/login"), 6000);
    return () => window.clearTimeout(timer);
  }, [resetSuccess, router]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const errors: { email?: string; password?: string } = {};
    if (!email.trim()) errors.email = "Enter your work email address.";
    if (!password) errors.password = "Enter your password.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setError(payload?.error?.message ?? "Sign in failed. Please try again.");
        return;
      }
      if (payload.data?.mfaRequired && payload.data?.challengeToken) {
        setMfaChallenge(String(payload.data.challengeToken));
        setPassword("");
        setMfaCode("");
        setError(null);
        return;
      }
      router.push(payload.data?.redirectTo ?? nextPath);
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const verifyMfa = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mfaChallenge || !mfaCode.trim()) return;
    setError(null);
    setVerifyingMfa(true);
    try {
      const response = await fetch("/api/auth/mfa/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeToken: mfaChallenge, code: mfaCode.trim() }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setError(payload?.error?.message ?? "The verification code was not accepted.");
        return;
      }
      router.push(payload.data?.redirectTo ?? nextPath);
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setVerifyingMfa(false);
    }
  };

  const useDemoAccount = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword("FuelWatch2026!");
    setFieldErrors({});
    setError(null);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-[var(--canvas-alt)] p-10 lg:flex xl:p-14">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.55]"
          style={{
            background:
              "radial-gradient(60rem 40rem at 12% 8%, var(--brand-soft), transparent 60%), radial-gradient(50rem 30rem at 90% 90%, var(--info-soft), transparent 55%)",
          }}
          aria-hidden="true"
        />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand)] text-[var(--brand-ink)]">
              <Icon name="fuel" className="h-4 w-4" />
            </span>
            <span className="text-[0.9375rem] font-semibold tracking-[-0.02em] text-[var(--ink)]">SmartFuel</span>
          </div>
          <h1 className="mt-14 max-w-lg text-[2.5rem] font-semibold leading-[1.08] tracking-[-0.035em] text-[var(--ink)] xl:text-[3rem]">
            Every litre, every tank, every station - visible in real time.
          </h1>
          <p className="mt-5 max-w-md text-[0.9375rem] leading-relaxed text-[var(--ink-2)]">
            SmartFuel turns raw fuel-probe and GPS telemetry into clear operational answers: how much fuel you have, what
            changed, and whether anything abnormal is happening.
          </p>
        </div>

        <dl className="relative mt-12 grid max-w-lg grid-cols-2 gap-x-8 gap-y-6">
          {[
            { label: "Tanks monitored", value: "48" },
            { label: "Stations online", value: "12 / 15" },
            { label: "Readings processed", value: "59k+" },
            { label: "Alert rules active", value: "20" },
          ].map((stat) => (
            <div key={stat.label}>
              <dt className="text-[0.6875rem] font-medium uppercase tracking-wider text-[var(--ink-3)]">{stat.label}</dt>
              <dd className="mt-1 text-num text-2xl font-semibold tracking-[-0.03em] text-[var(--ink)]">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex items-center justify-center bg-[var(--canvas)] px-5 py-10 sm:px-8">
        <div className="w-full max-w-[26rem]">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand)] text-[var(--brand-ink)]">
                <Icon name="fuel" className="h-4 w-4" />
              </span>
              <span className="text-[0.9375rem] font-semibold text-[var(--ink)]">SmartFuel</span>
            </div>
          </div>

          <h2 className="text-[1.5rem] font-semibold tracking-[-0.025em] text-[var(--ink)]">Sign in</h2>
          <p className="mt-1.5 text-[0.8125rem] text-[var(--ink-2)]">
            Welcome back. Enter your credentials to access your fuel network.
          </p>

          {resetSuccess ? (
            <div className="mt-5">
              <Notice tone="ok" title="Password updated">
                Your password has been reset. You can now sign in with your new password.
              </Notice>
            </div>
          ) : null}

          {error ? (
            <div className="mt-5">
              <Notice tone="crit" title="Sign in failed">
                {error}
              </Notice>
            </div>
          ) : null}

          {mfaChallenge ? (
            <div className="mt-6 space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--surface-3)] text-[var(--ink-2)]">
                  <ShieldCheck size={17} />
                </span>
                <div>
                  <h3 className="text-[0.875rem] font-semibold text-[var(--ink)]">Verify it is you</h3>
                  <p className="mt-1 text-[0.75rem] leading-relaxed text-[var(--ink-2)]">
                    Enter a current authenticator code or one unused recovery code to finish signing in.
                  </p>
                </div>
              </div>
              <form onSubmit={verifyMfa} className="space-y-4">
                <Field label="Authenticator or recovery code" htmlFor="mfa-code" hint="Authenticator codes have six digits. Recovery codes look like XXXXX-XXXXX.">
                  <Input
                    id="mfa-code"
                    autoComplete="one-time-code"
                    autoFocus
                    value={mfaCode}
                    onChange={(event) => setMfaCode(event.target.value.slice(0, 20))}
                    required
                  />
                </Field>
                <Button type="submit" variant="primary" size="lg" className="w-full" loading={verifyingMfa}>
                  Verify and sign in
                </Button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm w-full"
                  disabled={verifyingMfa}
                  onClick={() => { setMfaChallenge(null); setMfaCode(""); setError(null); }}
                >
                  Back to password sign-in
                </button>
              </form>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
              <Field label="Work email" htmlFor="email" required error={fieldErrors.email}>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@company.co.tz"
                  value={email}
                  invalid={Boolean(fieldErrors.email)}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </Field>

              <Field label="Password" htmlFor="password" required error={fieldErrors.password}>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  value={password}
                  invalid={Boolean(fieldErrors.password)}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </Field>

              <div className="flex items-center justify-between gap-3">
                <Checkbox
                  label={<span className="text-[0.8125rem]">Keep me signed in</span>}
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                <Link href="/forgot-password" className="text-[0.8125rem] font-medium text-[var(--brand)] hover:underline">
                  Forgot password?
                </Link>
              </div>

              <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
                Sign in
              </Button>
            </form>
          )}

          {!mfaChallenge ? (
            <div className="mt-8 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[0.75rem] font-semibold text-[var(--ink)]">Demo accounts</p>
              <span className="badge badge-info">Seed data</span>
            </div>
            <p className="mt-1 text-[0.6875rem] leading-relaxed text-[var(--ink-2)]">
              Password for every demo account is <code className="font-mono text-[var(--ink)]">FuelWatch2026!</code>. Select a
              role to see permission enforcement in action.
            </p>
            <ul className="mt-2.5 space-y-1">
              {DEMO_ACCOUNTS.map((account) => (
                <li key={account.email}>
                  <button
                    type="button"
                    onClick={() => useDemoAccount(account.email)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface-3)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[0.75rem] font-medium text-[var(--ink)]">{account.label}</span>
                      <span className="block truncate text-[0.625rem] text-[var(--ink-3)]">{account.email}</span>
                    </span>
                    <span className="badge badge-neutral flex-none">{account.role}</span>
                  </button>
                </li>
              ))}
              </ul>
            </div>
          ) : null}

          <p className="mt-6 text-center text-[0.6875rem] text-[var(--ink-3)]">
            Protected by role-based access control · All actions are audit-logged
          </p>
        </div>
      </section>
    </div>
  );
}
