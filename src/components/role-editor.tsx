"use client";

import { useState, useTransition } from "react";
import { PERMISSIONS } from "@/domain/constants";
import { updateRolePermissionsAction } from "@/server/actions/admin";
import { ErrorText } from "./ui";

/** Inline permission matrix editor for one role. */
export function RoleEditor({ roleId, initial, isSystem }: { roleId: string; initial: string[]; isSystem: boolean }) {
  const [selected, setSelected] = useState<string[]>(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify([...selected].sort()) !== JSON.stringify([...initial].sort());

  return (
    <div>
      <div className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
        {PERMISSIONS.map((p) => (
          <label key={p} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
            <input
              type="checkbox"
              checked={selected.includes(p)}
              onChange={(e) => {
                setSaved(false);
                setSelected((s) => (e.target.checked ? [...s, p] : s.filter((x) => x !== p)));
              }}
              className="h-4 w-4"
            />
            <span className="font-mono text-xs">{p}</span>
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={() => {
            setError(null);
            start(async () => {
              const r = await updateRolePermissionsAction(roleId, selected);
              if (r.ok) setSaved(true);
              else setError(r.error ?? "Save failed.");
            });
          }}
          className="rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save permissions"}
        </button>
        {saved && !dirty && <span className="text-sm text-emerald-700">Saved.</span>}
        {isSystem && <span className="text-xs text-slate-400">System role — code is fixed, permissions editable.</span>}
      </div>
      {error && <div className="mt-2"><ErrorText message={error} /></div>}
    </div>
  );
}

/** Per-row role assignment on the users page. */
export function UserRoleSelect({ userId, roleId, roles }: {
  userId: string;
  roleId: string;
  roles: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <select
        defaultValue={roleId}
        disabled={pending}
        onChange={(e) => {
          setError(null);
          const next = e.target.value;
          start(async () => {
            const { setUserRoleAction } = await import("@/server/actions/admin");
            const r = await setUserRoleAction(userId, next);
            if (!r.ok) {
              setError(r.error ?? "Failed.");
              e.target.value = roleId;
            }
          });
        }}
        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
      >
        {roles.map((r) => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
