// Specialised intelligence agents (§23). Agents are FOCUSED VIEWS over the same
// governed tool layer — same data, same permissions, same audit — differing
// only in tool focus and specialist instructions. No agent gets private data
// access or write powers beyond the shared registry levels.

export interface AgentDef {
  code: string;
  name: string;
  blurb: string;
  /** Read-tool names in focus; "*" means all visible tools. */
  tools: string[];
  prompt: string;
}

export const AGENTS: AgentDef[] = [
  {
    code: "GENERAL",
    name: "Operations copilot",
    blurb: "Balanced view across stock, orders, money and suppliers.",
    tools: ["*"],
    prompt: "Give a balanced operational answer. Prefer the most urgent issue first.",
  },
  {
    code: "INVENTORY",
    name: "Inventory intelligence",
    blurb: "Stock health, shortages and replenishment.",
    tools: ["stock_risks", "product_demand", "operations_attention"],
    prompt: "You are the inventory specialist. Focus on stock health, shortage causes and replenishment quantities. Always state units.",
  },
  {
    code: "PROCUREMENT",
    name: "Procurement intelligence",
    blurb: "What to buy, from whom, and supplier reliability.",
    tools: ["stock_risks", "supplier_performance", "operations_attention"],
    prompt: "You are the procurement specialist. Explain every quantity (safety stock, demand, MOQ) and name the preferred supplier when known.",
  },
  {
    code: "SALES",
    name: "Customer intelligence",
    blurb: "Customer activity, demand and who owes money.",
    tools: ["customer_highlights", "product_demand", "receivables_snapshot"],
    prompt: "You are the customer specialist. Focus on buying patterns, growing/declining accounts and payment risk.",
  },
  {
    code: "FINANCE",
    name: "Finance intelligence",
    blurb: "Cash, receivables and margins.",
    tools: ["receivables_snapshot", "margin_snapshot", "customer_highlights"],
    prompt: "You are the finance specialist. Speak in EUR, call out overdue balances and margin erosion with exact figures.",
  },
  {
    code: "MANAGEMENT",
    name: "Management intelligence",
    blurb: "Executive synthesis across every signal.",
    tools: ["*"],
    prompt: "You are the management adviser. Synthesize across stock, orders, cash and suppliers into at most 5 executive points with € impact where known.",
  },
];

export function agentFor(code?: string): AgentDef {
  return AGENTS.find((a) => a.code === (code ?? "").toUpperCase()) ?? AGENTS[0];
}
