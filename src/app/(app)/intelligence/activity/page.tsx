import Link from "next/link";
import { requirePermission } from "@/server/auth/permissions";
import { recentAIActivity } from "@/server/ai/brief";
import { PageHeader, Card, Table, Td, StatusPill, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

type ActivityResult = {
  summary?: string;
  mode?: string;
  tokens?: number;
};

export default async function ActivityPage() {
  const session = await requirePermission("intelligence.view");
  const items = await recentAIActivity(session.orgId, 50);

  return (
    <>
      <PageHeader
        title="AI activity"
        subtitle="Ledger of every AI answer, brief, proposal and execution — tool, level, status and cost."
        actions={
          <>
            <Link
              href="/approvals"
              className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
            >
              Approvals inbox →
            </Link>
            <Link
              href="/intelligence"
              className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
            >
              ← Back to command centre
            </Link>
          </>
        }
      />
      {items.length === 0 ? (
        <EmptyState
          title="No AI actions logged yet."
          hint="Ask a question or generate a brief to see entries here."
        />
      ) : (
        <Card>
          <Table headers={["When", "Tool", "Level", "Status", "Detail"]}>
            {items.map((a) => {
              const r = (a.result ?? null) as ActivityResult | null;
              return (
                <tr key={a.id}>
                  <Td className="whitespace-nowrap text-xs text-slate-500">
                    {a.createdAt.toLocaleString("en-IE")}
                  </Td>
                  <Td className="font-mono text-xs">{a.tool}</Td>
                  <Td className="font-mono text-xs text-slate-500">{a.level}</Td>
                  <Td>
                    <StatusPill value={a.status} />
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {r?.summary ?? r?.mode ?? "—"}
                    {typeof r?.tokens === "number" && r.tokens > 0 && ` · ${r.tokens} tokens`}
                    {a.status === "PENDING_APPROVAL" && (
                      <>
                        {" · "}
                        <Link
                          href="/approvals"
                          className="font-medium text-indigo-700 hover:underline"
                        >
                          Decide in inbox →
                        </Link>
                      </>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
          <p className="mt-3 text-xs text-slate-400">
            Level B entries executed immediately (drafts, notifications). Level C entries wait for a
            human in the approvals inbox — nothing runs until approved.
          </p>
        </Card>
      )}
    </>
  );
}
