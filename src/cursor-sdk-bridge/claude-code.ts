/**
 * Claude Code CLI system/environment prompts stop at this gateway.
 *
 * Cursor Agent.create already injects its own harness. Forwarding Claude
 * Code's CLI identity + env dump wastes tokens and the model treats that
 * block as injection (it then grounds on the empty SDK cwd).
 *
 * Detect by stable markers only — do not copy official prompt texts.
 * @see Piebald-AI/claude-code-system-prompts v2.1.233
 */
import type { AnthropicContentBlock, AnthropicMessage } from "../protocols/anthropic/types.js";
import type { CursorSdkBridge } from "./types.js";
import { extractClientWorkspace, isAbsoluteClientPath } from "./workspace.js";
import { claudeCodeClientHarnessLines } from "./harness.js";
import { inferPlatform } from "./grounding.js";

export type ClaudeCodeCliBridge = CursorSdkBridge;

const OFFICIAL_IDENTITY = /You are Claude Code, Anthropic's official CLI for Claude/i;

const MARKERS: Array<{ re: RegExp; weight: number }> = [
  { re: OFFICIAL_IDENTITY, weight: 3 },
  { re: /Anthropic's official CLI for Claude/i, weight: 2 },
  { re: /You are an interactive CLI tool that helps users/i, weight: 2 },
  { re: /Here is useful information about the environment you are running in/i, weight: 2 },
  { re: /<env>[\s\S]*Working directory:/i, weight: 2 },
  { re: /Working directory:\s+\S[\s\S]{0,800}?Is directory a git repo:/i, weight: 2 },
  { re: /gitStatus:\s*This is the git status at the start of the conversation/i, weight: 2 },
  { re: /__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__/,
    weight: 2 },
  { re: /\bCLAUDE\.md\b/, weight: 1 },
  { re: /persistent (file-based )?memory/i, weight: 1 },
  { re: /<system-reminder>/i, weight: 1 },
  { re: /<claude_background_info>/i, weight: 1 },
];

const SCORE_THRESHOLD = 3;
const SHORT_SYSTEM = 200;
const SHORT_FIRST = 400;

export function scoreClaudeCodeCliMarkers(text: string): number {
  if (!text) return 0;
  let score = 0;
  for (const marker of MARKERS) {
    if (marker.re.test(text)) score += marker.weight;
  }
  return score;
}

export function looksLikeClaudeCodeCli(systemText: string, firstUserOrDeveloper: string): boolean {
  const corpus = `${systemText}\n${firstUserOrDeveloper}`;
  if (!corpus.trim()) return false;
  const score = scoreClaudeCodeCliMarkers(corpus);
  if (score < SCORE_THRESHOLD) return false;
  if (OFFICIAL_IDENTITY.test(corpus)) return true;
  const systemLen = systemText.trim().length;
  const firstLen = firstUserOrDeveloper.trim().length;
  if (systemLen < SHORT_SYSTEM && firstLen < SHORT_FIRST) return false;
  return true;
}

export function extractClaudeCodeCwd(text: string): string | undefined {
  if (!text) return undefined;
  const fromXml = extractClientWorkspace(text).cwd?.trim();
  if (fromXml && isAbsoluteClientPath(fromXml)) return fromXml;
  const patterns = [
    /Working directory:\s*([^\n\r<]+)/i,
    /(?:^|\n)\s*CWD:\s*([^\n\r<]+)/i,
    /(?:^|\n)\s*cwd:\s*([^\n\r<]+)/,
  ];
  for (const re of patterns) {
    const match = re.exec(text);
    const value = match?.[1]?.trim();
    if (value && isAbsoluteClientPath(value)) return value;
  }
  return undefined;
}


export function extractClaudeCodePlatform(text: string): string | undefined {
  if (!text) return undefined;
  const match = /(?:^|\n)\s*Platform:\s*([^\n\r<]+)/i.exec(text);
  const value = match?.[1]?.trim();
  return value || undefined;
}

export function stripClaudeCodeCliPreamble(text: string): string {
  if (!text) return "";
  let out = text;
  out = out.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "");
  out = out.replace(/<env>[\s\S]*?<\/env>/gi, "");
  out = out.replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, "");
  out = out.replace(/<claude_background_info>[\s\S]*?<\/claude_background_info>/gi, "");
  out = out.replace(/Here is useful information about the environment you are running in:\s*/gi, "");
  out = out.replace(/You are Claude Code, Anthropic's official CLI for Claude\.?\s*/gi, "");
  out = out.replace(/You are an interactive CLI tool that helps users[^\n]*\n?/gi, "");
  out = out.replace(/You are powered by the model named[^\n]*\n?/gi, "");
  out = out.replace(/The exact model ID is[^\n]*\n?/gi, "");
  out = out.replace(/Anthropic knowledge cutoff[^\n]*\n?/gi, "");
  out = out.replace(
    /gitStatus:\s*This is the git status at the start of the conversation[\s\S]*?(?=\n{2,}\S|$)/i,
    "",
  );
  out = out.replace(
    /^(?:Working directory|Is directory a git repo|Platform|OS Version|Today's date|Model|Shell|CWD|cwd)\s*:[^\n]*\n?/gim,
    "",
  );
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export function firstUserText(messages: AnthropicMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  if (!first) return "";
  return textBlocks(first.content).join("\n");
}

export function applyClaudeCodeCliBridge(
  systemText: string,
  messages: AnthropicMessage[],
): CursorSdkBridge | undefined {
  const first = firstUserText(messages);
  if (!looksLikeClaudeCodeCli(systemText, first)) return undefined;
  const corpus = `${systemText}\n${first}`;
  const cwd = extractClaudeCodeCwd(corpus);
  const platform = extractClaudeCodePlatform(corpus) ?? inferPlatform(cwd);
  stripFirstUserCliPreamble(messages);
  return {
    kind: "claude-code",
    ...(cwd ? { cwd } : {}),
    ...(platform ? { platform } : {}),
  };
}

export { claudeCodeClientHarnessLines };

function stripFirstUserCliPreamble(messages: AnthropicMessage[]): void {
  const first = messages.find((message) => message.role === "user");
  if (!first) return;
  if (typeof first.content === "string") {
    first.content = stripClaudeCodeCliPreamble(first.content);
    return;
  }
  const next: AnthropicContentBlock[] = [];
  for (const block of first.content) {
    if (block.type !== "text") {
      next.push(block);
      continue;
    }
    const text = stripClaudeCodeCliPreamble(block.text);
    if (text) next.push({ type: "text", text });
  }
  first.content = next.length > 0 ? next : "";
}

function textBlocks(content: string | AnthropicContentBlock[]): string[] {
  if (typeof content === "string") return content ? [content] : [];
  return content.filter((block): block is Extract<AnthropicContentBlock, { type: "text" }> => block.type === "text").map((block) => block.text);
}
