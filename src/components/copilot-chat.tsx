"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { askCopilotAction } from "@/server/actions/intelligence";
import type { CopilotAnswer, ChatHistoryItem } from "@/server/ai/copilot";
import { ErrorText } from "./ui";

export const SUGGESTIONS = [
  "What needs my attention today?",
  "What should we reorder?",
  "Which orders cannot currently be fulfilled?",
  "Which customers owe us money?",
  "Where is margin declining?",
];

interface Msg {
  role: "user" | "assistant";
  text: string;
  answer?: CopilotAnswer;
}

/** Minimal safe renderer: **bold**, [label](/link), line breaks and "- " bullets. */
export function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: string) => {
    if (bullets.length > 0) {
      blocks.push(
        <ul key={key} className="list-disc space-y-1 pl-5">
          {bullets.map((b, i) => (
            <li key={i}>{inline(b, `b${i}`)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      bullets.push(trimmed.slice(2));
    } else {
      flush(`u${i}`);
      if (trimmed) blocks.push(<p key={`p${i}`}>{inline(line, `t${i}`)}</p>);
    }
  });
  flush("end");
  return <div className="space-y-2 text-sm leading-relaxed">{blocks}</div>;
}

function inline(text: string, key: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={`${key}-${n++}`}>{token.slice(2, -2)}</strong>);
    } else {
      const label = token.slice(1, token.indexOf("]"));
      const href = token.slice(token.indexOf("(") + 1, -1);
      if (href.startsWith("/")) {
        parts.push(
          <Link key={`${key}-${n++}`} href={href} className="font-medium text-indigo-700 hover:underline">
            {label}
          </Link>,
        );
      } else {
        parts.push(token);
      }
    }
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function CopilotChat({ canUseAI, agents }: {
  canUseAI: boolean;
  agents: { code: string; name: string; blurb: string }[];
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentCode, setAgentCode] = useState("GENERAL");
  const boxRef = useRef<HTMLDivElement>(null);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || pending) return;
    setError(null);
    const history: ChatHistoryItem[] = messages.map((m) => ({ role: m.role, content: m.text.slice(0, 2000) }));
    setMessages((ms) => [...ms, { role: "user", text: q }]);
    setInput("");
    setPending(true);
    try {
      const r = await askCopilotAction(q, history.slice(-6), agentCode);
      if (!r.ok || !r.answer) {
        setError(r.error ?? "The copilot did not answer.");
      } else {
        setMessages((ms) => [...ms, { role: "assistant", text: r.answer!.text, answer: r.answer }]);
      }
    } catch {
      setError("The copilot did not answer. Please try again.");
    } finally {
      setPending(false);
      setTimeout(() => boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: "smooth" }), 50);
    }
  };

  return (
    <div>
      {agents.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Specialist agent">
          {agents.map((a) => (
            <button
              key={a.code}
              type="button"
              onClick={() => setAgentCode(a.code)}
              title={a.blurb}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                agentCode === a.code
                  ? "bg-indigo-700 text-white"
                  : "border border-slate-300 bg-white text-slate-600 hover:border-indigo-400"
              }`}
            >
              {a.name}
            </button>
          ))}
        </div>
      )}
      {messages.length === 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm hover:border-indigo-400 hover:text-indigo-700"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div ref={boxRef} className="max-h-[55vh] space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {messages.length === 0 && (
          <p className="text-sm text-slate-500">
            Ask about stock, orders, customers, suppliers or money. Answers come from live ERP data —
            {canUseAI ? " composed by AI with linked evidence." : " composed by built-in rules with linked evidence (set OPENAI_API_KEY for AI answers)."}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            <div className={`max-w-3xl rounded-xl px-4 py-3 ${m.role === "user" ? "bg-indigo-700 text-white" : "bg-slate-50 ring-1 ring-inset ring-slate-200"}`}>
              {m.role === "user" ? (
                <p className="text-sm">{m.text}</p>
              ) : (
                <>
                  <RichText text={m.text} />
                  {m.answer && (
                    <p className="mt-2 border-t border-slate-200 pt-1 text-xs text-slate-400">
                      {m.answer.mode === "ai" ? "AI answer" : "Rule-based answer"}
                      {m.answer.toolsUsed.length > 0 && ` · sources: ${m.answer.toolsUsed.join(", ")}`}
                      {m.answer.tokens > 0 && ` · ${m.answer.tokens} tokens`}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        {pending && <p className="text-sm text-slate-400">Thinking…</p>}
      </div>
      {error && <div className="mt-2"><ErrorText message={error} /></div>}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the operation…"
          maxLength={1000}
          className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="rounded-xl bg-indigo-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
