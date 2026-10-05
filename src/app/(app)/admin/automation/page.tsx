import Link from "next/link";
import { requirePermission } from "@/server/auth/permissions";
import { listRules, DEFAULT_RULES } from "@/server/ai/automation";
import { runMonitorAction, setRuleEnabledAction } from "@/server/actions/intelligence";
import { PageHeader, Card, Table, Td, StatusPill, EmptyState } from "@/components/ui";
import { InlineAction } from "@/components/client";

export const dynamic = "force-dynamic";

export default async function AutomationPage() {
  const session = await requirePermission("intelligence.manage");
  const rules = await listRules(session.orgId);
  const enabledCount = rules.filter((r) => r.isEnabled).length;

  return (
    <>
      <PageHeader
        title="Automation"
        subtitle={`${enabledCount} of ${rules.length} monitors enabled. Every run is deduplicated and written to the audit log.`}
        actions={
          <>
            <InlineAction action={runMonitorAction} title="Evaluate all enabled monitors now">
              Run monitors now
            </InlineAction>
            <Link
              href="/intelligence/activity"
              className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
            >
              ← Back to intelligence
            </Link>
          </>
        }
      />
      {rules.length === 0 ? (
        <EmptyState
          title="No automation rules yet."
          hint="Default monitors are seeded automatically on first visit."
        />
      ) : (
        <Card>
          <Table headers={["Rule", "Trigger", "Action", "Status", ""]}>
            {rules.map((r) => (
              <tr key={r.id}>
                <Td className="font-medium">{r.name}</Td>
                <Td className="font-mono text-xs text-slate-500">{r.trigger}</Td>
                <Td className="font-mono text-xs text-slate-500">{r.action}</Td>
                <Td>
                  <StatusPill value={r.isEnabled ? "ACTIVE" : "SUSPENDED"} />
                </Td>
                <Td>
                  <InlineAction
                    action={setRuleEnabledAction} args={[r.id, !r.isEnabled]}
                    title={r.isEnabled ? "Pause this monitor" : "Resume this monitor"}
                  >
                    {r.isEnabled ? "Disable" : "Enable"}
                  </InlineAction>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <Card className="mt-4">
        <h2 className="mb-2 font-semibold">Seeded monitors</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          {DEFAULT_RULES.map((r) => (
            <li key={r.trigger}>
              <span className="font-mono text-xs">{r.trigger}</span> →{" "}
              <span className="font-mono text-xs">{r.action}</span> — {r.name}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-400">
          Low stock opens a (deduplicated) purchase requirement; overdue invoices, late purchase
          orders and stale waiting orders post one digest notification per 20-hour window to the
          Finance, Procurement and Sales roles. Schedule repeats via the cron monitor
          (CRON_SECRET, see docs/AI.md) or use “Run monitors now”.
        </p>
      </Card>
    </>
  );
}
