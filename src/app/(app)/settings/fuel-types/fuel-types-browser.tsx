"use client";

import { useState } from "react";
import { Plus, Fuel as FuelIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Switch } from "@/components/ui/form";
import { Badge, useToast } from "@/components/ui/feedback";
import { ConfirmDialog, Modal } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";

interface FuelTypeRow {
  id: string;
  systemName: string;
  displayName: string;
  color: string;
  density: number | null;
  isActive: boolean;
  createdAt: string;
  tankCount: number;
}

const SWATCHES = [
  "#0f766e",
  "#1d4ed8",
  "#b45309",
  "#7c3aed",
  "#be123c",
  "#0369a1",
  "#4d7c0f",
  "#a21caf",
  "#0e7490",
  "#c2410c",
];

export function FuelTypesBrowser({ initialRows }: { initialRows: FuelTypeRow[] }) {
  const [rows, setRows] = useState<FuelTypeRow[]>(initialRows);
  const [editing, setEditing] = useState<FuelTypeRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const [form, setForm] = useState({
    displayName: "",
    systemName: "",
    color: SWATCHES[0],
    density: "",
    isActive: true,
  });

  const openEdit = (row: FuelTypeRow) => {
    setEditing(row);
    setForm({
      displayName: row.displayName,
      systemName: row.systemName,
      color: row.color,
      density: row.density == null ? "" : String(row.density),
      isActive: row.isActive,
    });
  };

  const openNew = () => {
    setCreating(true);
    setForm({ displayName: "", systemName: "", color: SWATCHES[0], density: "", isActive: true });
  };

  const close = () => {
    setEditing(null);
    setCreating(false);
  };

  const save = async () => {
    setBusy(true);
    try {
      const isNew = creating;
      const body = {
        displayName: form.displayName.trim(),
        systemName: form.systemName.trim(),
        color: form.color,
        density: form.density.trim() === "" ? null : Number(form.density),
        isActive: form.isActive,
      };
      const response = await fetch(isNew ? "/api/fuel-types" : `/api/fuel-types/${editing?.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (payload.ok) {
        toast.success(isNew ? "Fuel type added" : "Fuel type updated", payload.data.displayName);
        if (isNew) {
          setRows((current) => [...current, { ...payload.data, tankCount: 0 }]);
        } else {
          setRows((current) =>
            current.map((row) =>
              row.id === payload.data.id
                ? {
                    ...row,
                    ...payload.data,
                    tankCount: row.tankCount,
                  }
                : row,
            ),
          );
        }
        close();
      } else {
        toast.error(payload.error?.message ?? "Could not save the fuel type.");
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const row = rows.find((entry) => entry.id === deleteId);
    if (!row) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/fuel-types/${row.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (payload.ok) {
        setRows((current) => current.filter((entry) => entry.id !== row.id));
        toast.success("Fuel type deleted", row.displayName);
        setDeleteId(null);
      } else {
        toast.error(payload.error?.message ?? "Could not delete the fuel type.");
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const target = rows.find((row) => row.id === deleteId) ?? null;
  const open = Boolean(editing) || creating;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-[var(--ink-2)]">
          {rows.filter((row) => row.isActive).length} of {rows.length} active.
        </p>
        <Button size="sm" onClick={openNew}>
          Add fuel type
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="card p-8 text-center">
          <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[var(--surface-3)] text-[var(--ink-3)]">
            <FuelIcon size={18} />
          </span>
          <p className="mt-3 text-[0.875rem] font-medium text-[var(--ink)]">No fuel types have been added yet</p>
          <p className="mx-auto mt-2 max-w-md text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            Add the products you store so tanks can be labelled and probe height can be converted into volume using the
            right density.
          </p>
          <div className="mt-4">
            <Button size="sm" onClick={openNew}>
              Add fuel type
            </Button>
          </div>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <li key={row.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-[var(--line-strong)]"
                    style={{ background: row.color }}
                  />
                  <div className="min-w-0">
                    <h3 className="truncate text-[0.875rem] font-semibold text-[var(--ink)]">{row.displayName}</h3>
                    <p className="mt-0.5 truncate text-[0.75rem] text-[var(--ink-3)]">
                      <code>{row.systemName}</code>
                      {row.density != null ? ` · ${row.density} kg/L` : " · density not set"}
                    </p>
                  </div>
                </div>
                <Badge tone={row.isActive ? "ok" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</Badge>
              </div>

              <p className="mt-3 text-[0.75rem] text-[var(--ink-2)]">
                {row.tankCount === 0
                  ? "Not used by any tank"
                  : `Used by ${row.tankCount} tank${row.tankCount === 1 ? "" : "s"}`}
              </p>

              <div className="mt-3 flex items-center gap-1 border-t border-[var(--line)] pt-3">
                <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleteId(row.id)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={open}
        onClose={close}
        title={creating ? "Add fuel type" : "Edit fuel type"}
        description="Density converts probe height into volume - use the value from your supplier's certificate of analysis."
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button loading={busy} onClick={save}>
              {creating ? "Add fuel type" : "Save changes"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name" htmlFor="fuel-name" required>
            <Input
              id="fuel-name"
              required
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
              placeholder="Automotive Gas Oil"
            />
          </Field>
          <Field label="System key" htmlFor="fuel-key" required hint="Lowercase letters, numbers and underscores.">
            <Input
              id="fuel-key"
              required
              value={form.systemName}
              onChange={(event) => setForm({ ...form, systemName: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
              placeholder="diesel"
            />
          </Field>
          <Field label="Density (kg/L)" htmlFor="fuel-density" hint="Optional. Leave blank if unknown.">
            <Input
              id="fuel-density"
              type="number"
              step="0.0001"
              min="0.5"
              max="1.2"
              value={form.density}
              onChange={(event) => setForm({ ...form, density: event.target.value })}
              placeholder="0.832"
            />
          </Field>
          <div>
            <p className="mb-2 text-[0.8125rem] font-medium text-[var(--ink)]">Colour</p>
            <div className="flex flex-wrap gap-2">
              {SWATCHES.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Use colour ${color}`}
                  onClick={() => setForm({ ...form, color })}
                  className={cn(
                    "h-7 w-7 rounded-full ring-1 ring-[var(--line-strong)] transition-transform",
                    form.color === color ? "scale-110 ring-2 ring-[var(--accent)]" : "",
                  )}
                  style={{ background: color }}
                />
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <Switch
              checked={form.isActive}
              onChange={(value) => setForm({ ...form, isActive: value })}
              label="Available for new tanks"
              description="Inactive fuel types stay on existing tanks but cannot be selected for new ones."
            />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        onClose={() => setDeleteId(null)}
        onConfirm={remove}
        title="Delete this fuel type?"
        message={`${target?.displayName ?? "This fuel type"} will be removed. Tanks using it must be reassigned first.`}
        confirmLabel="Delete fuel type"
        loading={busy}
      />
    </div>
  );
}
