"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge, EmptyState, useToast } from "@/components/ui/feedback";
import { ConfirmDialog, Modal } from "@/components/ui/overlay";
import { ExportButton, LoadError, useResourceQuery } from "@/components/domain/resource-query";

interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  jobTitle: string | null;
  status: "active" | "invited" | "suspended";
  roleId: string;
  roleName: string;
  roleKey: string;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  createdAt: string;
  stationNames: string[];
}

interface RoleOption {
  id: string;
  name: string;
  key: string;
}

export function UsersBrowser({
  initialRows,
  roles,
  stations,
  currentUserId,
  canCreate,
  canEdit,
  canDelete,
  canManageOrganizationWideAccess,
}: {
  initialRows: UserRow[];
  roles: RoleOption[];
  stations: { id: string; name: string }[];
  currentUserId: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canManageOrganizationWideAccess: boolean;
}) {
  const query = useResourceQuery<UserRow>({
    endpoint: "/api/users",
    initial: { rows: initialRows, total: initialRows.length, page: 1, pageSize: 20 },
    pageSize: 20,
  });
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invitationSendingId, setInvitationSendingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    jobTitle: "",
    roleId: "",
    status: "active",
    stationIds: [] as string[],
  });
  const toast = useToast();

  const rows = query.rows as UserRow[];
  const target = rows.find((row) => row.id === deleteId) ?? null;
  const selectedRole = roles.find((role) => role.id === form.roleId);
  const organizationWideRole = selectedRole?.key === "admin" || selectedRole?.key === "super_admin" || selectedRole?.key === "owner";
  const canEditTargetAccess = Boolean(
    editTarget && (editTarget.id !== currentUserId || canManageOrganizationWideAccess),
  );

  const openEdit = (user: UserRow) => {
    // Station names come from the server; map them back to ids for the form.
    const ids = stations.filter((station) => user.stationNames.includes(station.name)).map((station) => station.id);
    setEditTarget(user);
    setForm({
      name: user.name,
      phone: user.phone ?? "",
      jobTitle: user.jobTitle ?? "",
      roleId: user.roleId,
      status: user.status,
      stationIds: ids,
    });
  };

  const save = async () => {
    if (!editTarget) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/users/${editTarget.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          jobTitle: form.jobTitle.trim() || null,
          roleId: form.roleId,
          status: form.status,
          stationIds: form.stationIds,
        }),
      });
      const payload = await response.json();
      if (payload.ok) {
        toast.success("User updated", editTarget.email);
        setEditTarget(null);
        query.refresh();
      } else {
        toast.error(payload.error?.message ?? "Could not update the user.");
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/users/${target.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (payload.ok) {
        toast.success("User suspended", target.email);
        setDeleteId(null);
        query.refresh();
      } else {
        toast.error(payload.error?.message ?? "Could not suspend the user.");
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const resendInvitation = async (user: UserRow) => {
    setInvitationSendingId(user.id);
    try {
      const response = await fetch(`/api/users/${user.id}/invite`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        toast.error(payload.error?.message ?? "Could not send the activation link.");
        return;
      }
      toast.success("Activation link sent", user.email);
      query.refresh();
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setInvitationSendingId(null);
    }
  };

  const columns: Column<UserRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: "User",
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate text-[0.8125rem] font-medium text-[var(--ink)]">
              {row.name}
              {row.id === currentUserId ? <span className="ml-2 text-[0.6875rem] text-[var(--ink-3)]">(you)</span> : null}
            </p>
            <p className="mt-0.5 truncate text-[0.75rem] text-[var(--ink-3)]">{row.email}</p>
          </div>
        ),
      },
      {
        key: "role",
        header: "Role",
        cell: (row) => <Badge tone={row.roleKey === "super_admin" ? "info" : "neutral"}>{row.roleName}</Badge>,
      },
      {
        key: "stations",
        header: "Stations",
        hideOnMobile: true,
        cell: (row) =>
          ["admin", "super_admin", "owner"].includes(row.roleKey) ? (
            <span className="text-[0.75rem] text-[var(--ink-3)]">All stations</span>
          ) : row.stationNames.length === 0 ? (
            <span className="text-[0.75rem] text-[var(--ink-3)]">None assigned</span>
          ) : (
            <span className="text-[0.75rem] text-[var(--ink-2)]">{row.stationNames.length} assigned</span>
          ),
      },
      {
        key: "status",
        header: "Status",
        cell: (row) => (
          <Badge tone={row.status === "active" ? "ok" : row.status === "invited" ? "warn" : "crit"}>
            {row.status === "active" ? "Active" : row.status === "invited" ? "Invited" : "Suspended"}
          </Badge>
        ),
      },
      {
        key: "lastLogin",
        header: "Last sign-in",
        hideOnMobile: true,
        cell: (row) =>
          row.lastLoginAt ? (
            <div>
              <p className="text-num text-[0.75rem] text-[var(--ink-2)]">{timeAgo(row.lastLoginAt)}</p>
              {row.lastLoginIp ? (
                <p className="text-num mt-0.5 text-[0.6875rem] text-[var(--ink-3)]">{row.lastLoginIp}</p>
              ) : null}
            </div>
          ) : (
            <span className="text-[0.75rem] text-[var(--ink-3)]">Never</span>
          ),
      },
      {
        key: "actions",
        header: "",
        cell: (row) => canEdit || (canDelete && row.id !== currentUserId) ? (
          <div className="flex items-center justify-end gap-1">
            {canEdit && row.status === "invited" ? (
              <Button
                size="sm"
                variant="ghost"
                loading={invitationSendingId === row.id}
                onClick={() => void resendInvitation(row)}
              >
                Resend invite
              </Button>
            ) : null}
            {canEdit ? (
              <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
                Edit
              </Button>
            ) : null}
            {canDelete && row.id !== currentUserId ? (
              <Button size="sm" variant="ghost" onClick={() => setDeleteId(row.id)}>
                Suspend
              </Button>
            ) : null}
          </div>
        ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canDelete, canEdit, currentUserId],
  );

  return (
    <div className="space-y-4">
      {query.error ? <LoadError message={query.error} onRetry={query.refresh} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter by role"
          className="w-44"
          value={query.filters.roleId ?? ""}
          onChange={(event) => query.setFilter("roleId", event.target.value)}
          options={[{ value: "", label: "All roles" }, ...roles.map((role) => ({ value: role.id, label: role.name }))]}
        />
        <Select
          aria-label="Filter by status"
          className="w-40"
          value={query.filters.status ?? ""}
          onChange={(event) => query.setFilter("status", event.target.value)}
          options={[
            { value: "", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "invited", label: "Invited" },
            { value: "suspended", label: "Suspended" },
          ]}
        />
        <div className="flex-1" />
        <ExportButton
          rows={rows}
          filename="users"
          disabled={query.loading}
          columns={[
            { header: "Name", value: (row) => row.name },
            { header: "Email", value: (row) => row.email },
            { header: "Role", value: (row) => row.roleName },
            { header: "Job title", value: (row) => row.jobTitle ?? "" },
            { header: "Phone", value: (row) => row.phone ?? "" },
            { header: "Status", value: (row) => row.status },
            { header: "Stations", value: (row) => (row.stationNames.length === 0 ? "all" : row.stationNames.join("; ")) },
            { header: "Last sign-in", value: (row) => row.lastLoginAt ?? "" },
          ]}
        />
      </div>

      {rows.length === 0 && !query.loading ? (
        <EmptyState
          icon="users"
          title="No users found"
          description="Invite a colleague to give them access to this organization."
          action={canCreate ? (
            <Link href="/admin/users/new" className="btn btn-primary btn-sm">
              Invite user
            </Link>
          ) : undefined}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={query.loading}
          total={query.total}
          page={query.page}
          pageSize={query.pageSize}
          onPageChange={query.setPage}
          onSearch={query.setSearch}
          searchValue={query.search}
          searchPlaceholder="Search users by name, email or role…"
          emptyTitle="No users found"
          emptyDescription="Invite a colleague to get started."
          emptyAction={canCreate ? (
            <Link href="/admin/users/new" className="btn btn-primary btn-sm">
              Invite user
            </Link>
          ) : undefined}
        />
      )}

      <Modal
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        title="Edit user"
        description={`${editTarget?.email ?? ""} - changes take effect on their next request.`}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={save}>
              Save changes
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="user-name" required>
            <Input id="user-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="Job title" htmlFor="user-title">
            <Input
              id="user-title"
              value={form.jobTitle}
              onChange={(event) => setForm({ ...form, jobTitle: event.target.value })}
            />
          </Field>
          <Field label="Phone" htmlFor="user-phone">
            <Input id="user-phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          </Field>
          <Field label="Role" htmlFor="user-role" required>
            <Select
              id="user-role"
              value={form.roleId}
              disabled={!canEditTargetAccess}
              onChange={(event) => {
                const nextRole = roles.find((role) => role.id === event.target.value);
                setForm({
                  ...form,
                  roleId: event.target.value,
                  stationIds: nextRole && ["admin", "super_admin", "owner"].includes(nextRole.key) ? [] : form.stationIds,
                });
              }}
              options={roles.map((role) => ({ value: role.id, label: role.name }))}
            />
          </Field>
          <Field label="Status" htmlFor="user-status" required>
            <Select
              id="user-status"
              disabled={editTarget?.id === currentUserId}
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value })}
              options={[
                { value: "active", label: "Active" },
                { value: "invited", label: "Invited" },
                { value: "suspended", label: "Suspended" },
              ]}
            />
          </Field>
          <div className="sm:col-span-2">
            <p className="mb-2 text-[0.8125rem] font-medium text-[var(--ink)]">Station access</p>
            {organizationWideRole ? (
              <p className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-[0.75rem] leading-relaxed text-[var(--ink-2)]">
                This administrator role has organization-wide station access. Station assignments do not restrict it.
              </p>
            ) : (
              <>
                <p className="mb-3 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
                  Select at least one station for this account. Non-administrator accounts do not receive organization-wide access.
                  {editTarget?.id === currentUserId ? " You cannot change your own role or station assignments." : ""}
                </p>
                <fieldset
                  disabled={!canEditTargetAccess}
                  className="grid max-h-48 gap-2 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 sm:grid-cols-2"
                >
                  {stations.map((station) => (
                    <label
                      key={station.id}
                      className="flex cursor-pointer items-center gap-2.5 text-[0.8125rem] text-[var(--ink)]"
                    >
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
                </fieldset>
              </>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        onClose={() => setDeleteId(null)}
        onConfirm={remove}
        title="Suspend this user?"
        message={`${target?.email ?? "This user"} will lose access immediately. Their account and audit history will be retained.`}
        confirmLabel="Suspend user"
        loading={busy}
      />
    </div>
  );
}
