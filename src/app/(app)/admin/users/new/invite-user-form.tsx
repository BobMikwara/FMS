"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field, Input, Select, Switch } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/layout";
import { useToast } from "@/components/ui/feedback";

interface RoleOption {
  id: string;
  name: string;
  key: string;
}

interface StationOption {
  id: string;
  name: string;
}

export function InviteUserForm({ roles, stations }: { roles: RoleOption[]; stations: StationOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  const defaultRole = useMemo(() => roles.find((role) => role.key === "viewer") ?? roles[0], [roles]);

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    jobTitle: "",
    roleId: "",
    password: "",
    mfaEnabled: false,
    stationIds: [] as string[],
  });

  const roleId = form.roleId || defaultRole?.id || "";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || null,
          jobTitle: form.jobTitle.trim() || null,
          roleId,
          password: form.password,
          mfaEnabled: form.mfaEnabled,
          stationIds: form.stationIds,
        }),
      });
      const payload = await response.json();
      if (payload.ok) {
        setInvitedEmail(form.email.trim());
        setTemporaryPassword(form.password);
        toast.success("User invited", form.email.trim());
        setForm({ ...form, name: "", email: "", phone: "", jobTitle: "", password: "" });
        queryRefresh();
      } else {
        setError(payload.error?.message ?? "Could not create the user.");
      }
    } catch {
      setError("Could not reach the server. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const queryRefresh = () => router.refresh();

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5">
      {error ? <Notice tone="crit" title="Could not create the user">{error}</Notice> : null}

      {invitedEmail ? (
        <Notice tone="ok" title="User invited">
          {invitedEmail} can now sign in. Temporary password:{" "}
          <code className="rounded bg-[var(--surface-3)] px-1.5 py-0.5 text-[0.75rem]">{temporaryPassword}</code> — they
          should change it after their first sign-in.
        </Notice>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="invite-name" required>
          <Input
            id="invite-name"
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Amina Hassan"
          />
        </Field>
        <Field label="Work email" htmlFor="invite-email" required hint="This is the sign-in address.">
          <Input
            id="invite-email"
            type="email"
            required
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            placeholder="amina@puma.co.tz"
          />
        </Field>
        <Field label="Phone" htmlFor="invite-phone">
          <Input
            id="invite-phone"
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
            placeholder="+255 7xx xxx xxx"
          />
        </Field>
        <Field label="Job title" htmlFor="invite-title">
          <Input
            id="invite-title"
            value={form.jobTitle}
            onChange={(event) => setForm({ ...form, jobTitle: event.target.value })}
            placeholder="Station Manager"
          />
        </Field>
        <Field label="Role" htmlFor="invite-role" required hint="Permissions are enforced by the API.">
          <Select
            id="invite-role"
            value={roleId}
            onChange={(event) => setForm({ ...form, roleId: event.target.value })}
            options={roles.map((role) => ({ value: role.id, label: role.name }))}
          />
        </Field>
        <Field
          label="Temporary password"
          htmlFor="invite-password"
          required
          hint="At least 10 characters. Ask them to change it after sign-in."
        >
          <Input
            id="invite-password"
            type="text"
            required
            minLength={10}
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
        </Field>
      </div>

      <div>
        <p className="mb-2 text-[0.8125rem] font-medium text-[var(--ink)]">Station access</p>
        <p className="mb-3 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
          Leave every station unselected to grant access to the whole organization. Managers and operators should be scoped
          to the sites they run.
        </p>
        <div className="grid max-h-52 gap-2 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 sm:grid-cols-2">
          {stations.map((station) => (
            <label key={station.id} className="flex cursor-pointer items-center gap-2.5 text-[0.8125rem] text-[var(--ink)]">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-[var(--line-strong)]"
                checked={form.stationIds.includes(station.id)}
                onChange={() =>
                  setForm((current) => ({
                    ...current,
                    stationIds: current.stationIds.includes(station.id)
                      ? current.stationIds.filter((id) => id !== station.id)
                      : [...current.stationIds, station.id],
                  }))
                }
              />
              <span className="truncate">{station.name}</span>
            </label>
          ))}
        </div>
      </div>

      <Switch
        checked={form.mfaEnabled}
        onChange={(value) => setForm({ ...form, mfaEnabled: value })}
        label="Require multi-factor authentication"
        description="Adds a second factor at sign-in for this user."
      />

      <div className="flex items-center gap-3 border-t border-[var(--line)] pt-5">
        <Button type="submit" loading={busy}>
          Invite user
        </Button>
        <Link href="/admin/users" className="btn btn-ghost btn-sm">
          Cancel
        </Link>
      </div>
    </form>
  );
}
