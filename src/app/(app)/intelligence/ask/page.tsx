import Link from "next/link";
import { requirePermission } from "@/server/auth/permissions";
import { hasLLM } from "@/server/ai/provider";
import { AGENTS } from "@/server/ai/agents";
import { PageHeader, Card } from "@/components/ui";
import { CopilotChat } from "@/components/copilot-chat";

export const dynamic = "force-dynamic";

export default async function AskPage() {
  await requirePermission("intelligence.view");
  const canUseAI = hasLLM();

  return (
    <>
      <PageHeader
        title="Ask AI"
        subtitle={
          canUseAI
            ? "Answers composed by AI from live ERP data, with linked evidence."
            : "Rule-based mode — set OPENAI_API_KEY for AI-composed answers."
        }
        actions={
          <Link
            href="/intelligence"
            className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
          >
            ← Back to command centre
          </Link>
        }
      />
      <Card>
        <CopilotChat
          canUseAI={canUseAI}
          agents={AGENTS.map((a) => ({ code: a.code, name: a.name, blurb: a.blurb }))}
        />
      </Card>
    </>
  );
}
