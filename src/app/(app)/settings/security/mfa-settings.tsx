"use client";

import { useState } from "react";
import { Copy, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/layout";
import { useToast } from "@/components/ui/feedback";

interface Enrollment {
  secret: string;
  authenticatorUri: string;
  expiresAt: string;
}

async function postJson<T>(path: string, body: Record<string, string>): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error?.message ?? "The security change could not be completed.");
  }
  return payload.data as T;
}

export function MfaSettings({ initialEnabled, initialRecoveryCodesRemaining }: {
  initialEnabled: boolean;
  initialRecoveryCodesRemaining: number;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [recoveryCodesRemaining, setRecoveryCodesRemaining] = useState(initialRecoveryCodesRemaining);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [enrollmentPassword, setEnrollmentPassword] = useState("");
  const [enrollmentCode, setEnrollmentCode] = useState("");
  const [rotatePassword, setRotatePassword] = useState("");
  const [rotateCode, setRotateCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const beginEnrollment = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await postJson<Enrollment>("/api/auth/mfa/enrollment", { password: enrollmentPassword });
      setEnrollment(result);
      setEnrollmentPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not begin MFA setup.");
    } finally {
      setBusy(false);
    }
  };

  const confirmEnrollment = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await postJson<{ enabled: boolean; recoveryCodes: string[] }>(
        "/api/auth/mfa/enrollment/confirm",
        { code: enrollmentCode },
      );
      setEnabled(true);
      setRecoveryCodes(result.recoveryCodes);
      setRecoveryCodesRemaining(result.recoveryCodes.length);
      setEnrollment(null);
      setEnrollmentCode("");
      toast.success("Authenticator MFA enabled", "Save the recovery codes before leaving this page.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The authenticator code could not be verified.");
    } finally {
      setBusy(false);
    }
  };

  const runProtectedAction = async (
    event: React.FormEvent,
    action: "disable" | "rotate",
    password: string,
    code: string,
  ) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (action === "disable") {
        await postJson<{ enabled: false }>("/api/auth/mfa/disable", {
          password,
          code,
        });
        setEnabled(false);
        setRecoveryCodesRemaining(0);
        setRecoveryCodes(null);
        setDisablePassword("");
        setDisableCode("");
        toast.success("Authenticator MFA disabled", "Other signed-in sessions have been revoked.");
      } else {
        const result = await postJson<{ recoveryCodes: string[] }>("/api/auth/mfa/recovery-codes", {
          password,
          code,
        });
        setRecoveryCodes(result.recoveryCodes);
        setRecoveryCodesRemaining(result.recoveryCodes.length);
        setRotatePassword("");
        setRotateCode("");
        toast.success("Recovery codes replaced", "Save the new codes and destroy any older copies.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The security change could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const copyRecoveryCodes = async () => {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      toast.success("Recovery codes copied", "Store them somewhere private and accessible if you lose your device.");
    } catch {
      setError("Clipboard access was blocked. Select and copy the codes manually.");
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      {error ? <Notice tone="crit" title="Security change not completed">{error}</Notice> : null}

      {recoveryCodes ? (
        <Notice tone="warn" title="Save your recovery codes now">
          <p>Each code can be used once if you lose access to your authenticator. These codes are shown only after generation and cannot be retrieved later.</p>
          <div className="mt-3 grid gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 font-mono text-[0.8125rem] sm:grid-cols-2">
            {recoveryCodes.map((code) => <code key={code}>{code}</code>)}
          </div>
          <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={copyRecoveryCodes}>
            <Copy size={14} /> Copy codes
          </button>
        </Notice>
      ) : null}

      <section className="card p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--surface-3)] text-[var(--ink-2)]">
            <ShieldCheck size={17} />
          </span>
          <div>
            <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">Authenticator sign-in</h2>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              Require a time-based one-time password from an authenticator app after the account password. Password and MFA changes revoke existing sessions.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className={`badge ${enabled ? "badge-ok" : "badge-neutral"}`}>{enabled ? "Enabled" : "Not enabled"}</span>
          {enabled ? <span className="text-[0.75rem] text-[var(--ink-2)]">{recoveryCodesRemaining} recovery codes remaining</span> : null}
        </div>

        {!enabled && !enrollment ? (
          <form onSubmit={beginEnrollment} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="Current password" htmlFor="mfa-enroll-password" hint="Confirm your identity before creating an authenticator key.">
              <Input id="mfa-enroll-password" type="password" autoComplete="current-password" value={enrollmentPassword} onChange={(event) => setEnrollmentPassword(event.target.value)} required />
            </Field>
            <Button type="submit" loading={busy}>Set up authenticator</Button>
          </form>
        ) : null}

        {!enabled && enrollment ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
              <h3 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Add this account to your authenticator app</h3>
              <p className="mt-1 text-[0.75rem] leading-relaxed text-[var(--ink-2)]">
                Enter the secret below manually in an authenticator app. The setup expires {new Date(enrollment.expiresAt).toLocaleString()}.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="select-all break-all rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 font-mono text-[0.875rem] tracking-wider text-[var(--ink)]">{enrollment.secret}</code>
                <a className="btn btn-ghost btn-sm" href={enrollment.authenticatorUri}>
                  <KeyRound size={14} /> Open authenticator
                </a>
              </div>
              <p className="mt-2 break-all text-[0.6875rem] text-[var(--ink-3)]">Use a time-based code with a 30-second interval. Do not share the setup key.</p>
            </div>
            <form onSubmit={confirmEnrollment} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field label="Six-digit authenticator code" htmlFor="mfa-enroll-code">
                <Input id="mfa-enroll-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={enrollmentCode} onChange={(event) => setEnrollmentCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required />
              </Field>
              <Button type="submit" loading={busy}>Verify and enable MFA</Button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setEnrollment(null); setEnrollmentCode(""); }}>Cancel setup</button>
            </form>
          </div>
        ) : null}

        {enabled ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <form onSubmit={(event) => runProtectedAction(event, "rotate", rotatePassword, rotateCode)} className="rounded-xl border border-[var(--line)] p-4">
              <h3 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Replace recovery codes</h3>
              <p className="mt-1 text-[0.75rem] leading-relaxed text-[var(--ink-2)]">This invalidates all previous recovery codes. Verify with your password and a current authenticator or recovery code.</p>
              <div className="mt-3 space-y-3">
                <Field label="Current password" htmlFor="mfa-rotate-password"><Input id="mfa-rotate-password" type="password" autoComplete="current-password" value={rotatePassword} onChange={(event) => setRotatePassword(event.target.value)} required /></Field>
                <Field label="Authenticator or recovery code" htmlFor="mfa-rotate-code"><Input id="mfa-rotate-code" autoComplete="one-time-code" value={rotateCode} onChange={(event) => setRotateCode(event.target.value)} required /></Field>
                <Button type="submit" variant="secondary" loading={busy}>Generate new recovery codes</Button>
              </div>
            </form>
            <form onSubmit={(event) => runProtectedAction(event, "disable", disablePassword, disableCode)} className="rounded-xl border border-[var(--line)] p-4">
              <h3 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Turn off MFA</h3>
              <p className="mt-1 text-[0.75rem] leading-relaxed text-[var(--ink-2)]">This removes the authenticator requirement and revokes other active sessions.</p>
              <div className="mt-3 space-y-3">
                <Field label="Current password" htmlFor="mfa-disable-password"><Input id="mfa-disable-password" type="password" autoComplete="current-password" value={disablePassword} onChange={(event) => setDisablePassword(event.target.value)} required /></Field>
                <Field label="Authenticator or recovery code" htmlFor="mfa-disable-code"><Input id="mfa-disable-code" autoComplete="one-time-code" value={disableCode} onChange={(event) => setDisableCode(event.target.value)} required /></Field>
                <Button type="submit" variant="danger" loading={busy}>Disable MFA</Button>
              </div>
            </form>
          </div>
        ) : null}
      </section>
    </div>
  );
}
