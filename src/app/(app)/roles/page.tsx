import { requirePermission } from "@/server/auth/permissions";
import { listRoles } from "@/server/services/admin";
import { PageHeader, Card, StatusPill } from "@/components/ui";
import { ConfirmAction } from "@/components/client";
import { RoleForm } from "@/components/entity-forms";
import { RoleEditor } from "@/components/role-editor";
import { createRoleAction, deleteRoleAction } from "@/server/actions/admin";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const session = await requirePermission("roles.manage");
  const roles = await listRoles(session.orgId);

  return (
    <>
      <PageHeader title="Roles" subtitle="Configurable permission sets. System roles keep their code; permissions stay editable." />
      <div className="space-y-4">
        {roles.map((r) => (
          <Card key={r.id}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">{r.name}</h2>
                <span className="font-mono text-xs text-slate-400">{r.code}</span>
                {r.isSystem && <StatusPill value="SYSTEM" />}
                <span className="text-xs text-slate-400">{r._count.users} user{r._count.users === 1 ? "" : "s"}</span>
              </div>
              {!r.isSystem && (
                <ConfirmAction action={deleteRoleAction} args={[r.id]} confirmText={`Delete role "${r.name}"?`} danger>Delete role</ConfirmAction>
              )}
            </div>
            <RoleEditor roleId={r.id} initial={(r.permissions as string[]) ?? []} isSystem={r.isSystem} />
          </Card>
        ))}
        <Card>
          <h2 className="mb-3 font-semibold">New custom role</h2>
          <RoleForm action={createRoleAction} />
        </Card>
      </div>
    </>
  );
}
