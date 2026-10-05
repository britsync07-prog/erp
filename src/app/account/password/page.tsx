import { requireSession } from "@/server/auth/permissions";
import { changePasswordAction, logout } from "@/server/actions/auth";
import { PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { Card, PageHeader } from "@/components/ui";
import { ChangePasswordForm } from "@/components/account-forms";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const session = await requireSession();
  const forced = session.mustChangePassword === true;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <p className="mb-6 text-center text-2xl font-bold tracking-tight">
          Doner<span className="text-indigo-700">ERP</span>
        </p>
        <Card>
          <PageHeader
            title={forced ? "Set your password" : "Change your password"}
            subtitle={
              forced
                ? "Your account was created with a temporary password. Choose your own before continuing."
                : "Choose a new password that you do not use anywhere else."
            }
          />
          {forced && (
            <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
              You cannot use the rest of the app until you set a new password.
            </p>
          )}
          <ChangePasswordForm action={changePasswordAction} />
          <p className="mt-4 text-xs text-slate-400">
            Minimum {PASSWORD_MIN_LENGTH} characters, using at least three of: lowercase,
            uppercase, number, symbol.
          </p>
          {forced && (
            <form action={logout} className="mt-4 border-t border-slate-200 pt-4">
              <button type="submit" className="text-sm text-slate-500 hover:underline">
                Sign out instead
              </button>
            </form>
          )}
        </Card>
      </div>
    </main>
  );
}