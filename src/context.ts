import { estimateTokens, type AgentSession } from "@earendil-works/pi-coding-agent";

const approximate = (text: string): number => Math.ceil(text.length / 4);
const amount = (tokens: number): string => tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;

/** A compaction-aware estimate of what Pi will send, not provider billing accounting. */
export function formatContext(session: AgentSession): string {
  const usage = session.getContextUsage();
  const projection = session.sessionManager.buildSessionProjection();
  const sections = new Map<string, string>();
  let freeform = "";
  let conversation = 0;
  let summaries = 0;
  for (const message of projection.messages) {
    if (message.role === "compactionSummary") {
      summaries += estimateTokens(message);
    } else if (message.role !== "system") {
      conversation += estimateTokens(message);
    } else {
      if (typeof message.content === "string") freeform += message.content;
      for (const [key, value] of Object.entries(message.sections ?? {})) {
        if (value === null) sections.delete(key);
        else sections.set(key, value);
      }
    }
  }
  const hasSnapshot = sections.size > 0 || freeform.length > 0;
  const rules = approximate((sections.get("rules") ?? "") + (sections.get("project_context") ?? ""));
  const skills = approximate(sections.get("skills") ?? "");
  const prompt = hasSnapshot
    ? freeform + [...sections.entries()].filter(([key]) => !["rules", "project_context", "skills"].includes(key)).map(([, text]) => text).join("")
    : session.systemPrompt;
  const active = new Set(session.getActiveToolNames());
  const tools = session.getAllTools().filter((tool) => active.has(tool.name));
  const toolTokens = (builtin: boolean): number => tools
    .filter((tool) => (tool.sourceInfo.source === "builtin") === builtin)
    .reduce((total, tool) => {
      try { return total + approximate(JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters })); }
      catch { return total + approximate(`${tool.name} ${tool.description}`); }
    }, 0);
  const compactions = session.sessionManager.getBranch().filter((entry) => entry.type === "compaction").length;
  const total = !usage ? "unknown (no model)" : usage.tokens === null
    ? `unknown until the next model response / ${amount(usage.contextWindow)}`
    : `${amount(usage.tokens)} / ${amount(usage.contextWindow)} (${usage.percent?.toFixed(1)}%)`;
  return [
    `Pi context: ${total}`,
    `System prompt: ~${amount(approximate(prompt))}`,
    `Project rules: ~${amount(rules)}`,
    `Skills (descriptions): ~${amount(skills)}`,
    `Built-in tools: ~${amount(toolTokens(true))}`,
    `Extension tools: ~${amount(toolTokens(false))}`,
    `Compaction summary: ~${amount(summaries)} (${compactions} compaction${compactions === 1 ? "" : "s"} on this branch)`,
    `Conversation: ~${amount(conversation)}`,
    "Category counts are estimates and may not add up to Pi's total. Older summaries replaced by compaction are not counted again.",
  ].join("\n");
}
