import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { latestBrief, recentAIActivity } from "@/server/ai/brief";
import { hasLLM } from "@/server/ai/provider";
import { PageHeader, Card, StatusPill, EmptyState } from "@/components/ui";
import { InlineAction } from "@/components/client";
import { generateBriefAction, triageFindingAction, executeRecommendationAction } from "@/server/actions/intelligence";

export const dynamic = "force-dynamic";

export default async function IntelligencePage() {
  const session = await requirePermission("intelligence.view");
  const canManage = hasPermission(session, "intelligence.manage");
  const [data, activity] = await Promise.all([
    latestBrief(session.orgId),
    recentAIActivity(session.orgId, 15),
  ]);
  const aiOn = hasLLM();

  return (
    <>
      <PageHeader
        title="AI command centre"
        subtitle={aiOn ? "Briefs and answers composed by AI from live ERP data." : "Rule-based mode — set OPENAI_API_KEY for AI-composed briefs and answers."}
        actions={
          <>
            <Link href="/intelligence/ask" className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800">Ask AI →</Link>
            {canManage && <InlineAction action={generateBriefAction} title="Compose a fresh brief now">Generate brief</InlineAction>}
          </>
        }
      />

      {!data ? (
        <EmptyState
          title="No brief yet."
          hint={canManage ? "Generate the first daily brief to see findings here." : "Ask a manager to generate the daily brief."}
        />
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">{data.brief.title}</h2>
              <span className="text-xs text-slate-400">{data.brief.createdAt.toLocaleString("en-IE")}</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">{data.brief.reason}</p>
          </Card>

          {data.brief.status === "OPEN" && data.findings.filter((f) => f.status === "OPEN").length > 0 ? (
            <div className="mt-4 space-y-2">
              {data.findings.filter((f) => f.status === "OPEN").map((f) => (
                <Card key={f.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <StatusPill value={f.kind} />
                      <p className="font-medium">{f.title}</p>
                    </div>
                    {canManage && (
                      <div className="flex gap-2">
                        <InlineAction action={triageFindingAction} args={[f.id, "ACCEPTED"]} title="Mark accepted">Accept</InlineAction>
                        <InlineAction action={triageFindingAction} args={[f.id, "DISMISSED"]} title="Dismiss">Dismiss</InlineAction>
                      </div>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{f.reason}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    {f.actionLink && (
                      <Link href={f.actionLink} className="text-sm font-medium text-indigo-700 hover:underline">Open →</Link>
                    )}
                    {canManage && (f.evidence as { proposedAction?: { tool: string } } | null)?.proposedAction && (
                      <InlineAction action={executeRecommendationAction} args={[f.id]} title="Raise the requirement now">Raise requirement</InlineAction>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="mt-4"><p className="text-sm text-slate-500">All findings triaged. Generate a fresh brief for the latest picture.</p></Card>
          )}

          {data.findings.filter((f) => f.status !== "OPEN").length > 0 && (
            <Card className="mt-4">
              <h2 className="mb-2 font-semibold">Triaged</h2>
              <ul className="space-y-1 text-sm text-slate-500">
                {data.findings.filter((f) => f.status !== "OPEN").map((f) => (
                  <li key={f.id}>[{f.status}] {f.title}</li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <Card className="mt-4">
        <h2 className="mb-3 font-semibold">AI activity (observability)</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-slate-500">No AI actions logged yet. Ask a question or generate a brief.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {activity.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-2 text-slate-600">
                <span className="font-mono text-xs">{a.tool}</span>
                <StatusPill value={a.status} />
                <span className="text-xs text-slate-400">
                  {a.createdAt.toLocaleString("en-IE")} · {(a.result as { tokens?: number } | null)?.tokens ?? 0} tokens
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-400">
          Copilot is read-only (Level A). Drafts and approvals arrive with Phase 10 orchestration. Every AI answer is logged above.
        </p>
      </Card>
    </>
  );
}
