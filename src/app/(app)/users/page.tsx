import { requirePermission } from "@/server/auth/permissions";
import { listUsers, listRoles } from "@/server/services/admin";
import { PageHeader, Card, Table, Td, StatusPill } from "@/components/ui";
import { ConfirmAction } from "@/components/client";
import { UserForm } from "@/components/entity-forms";
import { UserRoleSelect } from "@/components/role-editor";
import { createUserAction, setUserActiveAction } from "@/server/actions/admin";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await requirePermission("users.manage");
  const [users, roles] = await Promise.all([listUsers(session.orgId), listRoles(session.orgId)]);
  const roleOptions = roles.map((r) => ({ id: r.id, name: r.name }));

  return (
    <>
      <PageHeader title="Users" subtitle="Accounts, roles and access. You cannot deactivate yourself or change your own role." />
      <Card>
        <Table headers={["Name", "Email", "Role", "Last login", "Status", ""]}>
          {users.map((u) => (
            <tr key={u.id} className={u.id === session.id ? "bg-indigo-50/50" : undefined}>
              <Td className="font-medium">{u.name}{u.id === session.id && <span className="ml-2 text-xs text-indigo-700">(you)</span>}</Td>
              <Td>{u.email}</Td>
              <Td>{u.id === session.id ? u.role.name : <UserRoleSelect userId={u.id} roleId={u.roleId} roles={roleOptions} />}</Td>
              <Td>{u.lastLoginAt ? u.lastLoginAt.toLocaleString("en-IE") : "—"}</Td>
              <Td><StatusPill value={u.isActive ? "ACTIVE" : "SUSPENDED"} /></Td>
              <Td>
                {u.id !== session.id && (
                  <ConfirmAction
                    action={setUserActiveAction} args={[u.id, !u.isActive]}
                    confirmText={u.isActive ? `Deactivate ${u.name}?` : `Reactivate ${u.name}?`}
                  >
                    {u.isActive ? "Deactivate" : "Reactivate"}
                  </ConfirmAction>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card className="mt-4">
        <h2 className="mb-3 font-semibold">New user</h2>
        <UserForm action={createUserAction} roles={roleOptions} />
      </Card>
    </>
  );
}
