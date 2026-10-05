"use client";

import Link from "next/link";
import type { ActionResult } from "@/server/platform";
import { Field, inputCls, ErrorText, SavedNote } from "./ui";
import { SubmitButton, useFormAction } from "./client";

type Act = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

export function ChangePasswordForm({ action }: { action: Act }) {
  const { state, formAction, saved } = useFormAction(action);
  return (
    <form action={formAction} className="space-y-4">
      <Field label="Current password">
        <input name="currentPassword" type="password" required autoComplete="current-password" className={inputCls} />
      </Field>
      <Field label="New password">
        <input name="newPassword" type="password" required minLength={12} autoComplete="new-password" className={inputCls} />
      </Field>
      <Field label="Confirm new password">
        <input name="confirmPassword" type="password" required minLength={12} autoComplete="new-password" className={inputCls} />
      </Field>
      <ErrorText message={state.error} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton label="Save password" pendingLabel="Saving…" />
        <SavedNote show={saved} />
        {saved && (
          <Link href="/" className="text-sm font-medium text-indigo-700 hover:underline">
            Continue to the app →
          </Link>
        )}
      </div>
    </form>
  );
}