/**
 * Rewrite standalone Cursor identity mentions to the model family's client brand.
 * Skip paths, packages, URLs. No brand → leave the text alone.
 *
 * Claude / sonnet / haiku / opus → Claude
 * GPT / Codex / o-series → Codex
 * Gemini → Gemini
 * Grok → Grok
 */
export type ClientBrand = "Claude" | "Codex" | "Gemini" | "Grok" | "Cursor";

const PROTECTED_BEFORE = /[\\/@.]/;
const PROTECTED_AFTER = /^[-/]|^(?:sdk|com)\b/i;

export function rewriteAssistantSurface(text: string, brand?: ClientBrand): string {
  if (!brand || brand === "Cursor" || !text || !text.includes("Cursor")) return text;
  return text.replace(/\bCursor\b/g, (match, offset, full) => {
    const before = full.slice(Math.max(0, offset - 1), offset);
    const after = full.slice(offset + match.length, offset + match.length + 8);
    if (PROTECTED_BEFORE.test(before) || PROTECTED_AFTER.test(after)) return match;
    return brand;
  });
}

export function brandFromModel(model?: string): ClientBrand | undefined {
  if (!model) return undefined;
  const m = model.toLowerCase();
  if (/(?:^|[^a-z])(?:claude|sonnet|haiku|opus)(?:[^a-z]|$)/.test(m) || m.includes("anthropic")) return "Claude";
  if (/\bgpt[-._]|\bgpt\d|\bcodex\b|\bterra\b|\bo[1-9](?:[-._]|$)/.test(m)) return "Codex";
  if (/\bgemini\b|\bgemma\b/.test(m)) return "Gemini";
  if (/\bgrok\b/.test(m)) return "Grok";
  return undefined;
}

export function resolveClientBrand(input: {
  model?: string;
  cliKind?: "claude-code" | "codex";
  protocol?: "messages" | "responses" | "chat";
  looksLikeCodexLite?: boolean;
  hasExecTool?: boolean;
}): ClientBrand | undefined {
  const fromModel = brandFromModel(input.model);
  if (fromModel) return fromModel;
  if (input.cliKind === "claude-code") return "Claude";
  if (input.cliKind === "codex") return "Codex";
  if (input.looksLikeCodexLite || input.hasExecTool) return "Codex";
  if (input.protocol === "messages") return "Claude";
  return undefined;
}
