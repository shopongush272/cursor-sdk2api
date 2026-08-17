import { looksLikeCodexLite } from "../protocols/openai-responses/codex-cursor.js";
import type { CursorSdkBridge } from "./types.js";
import { extractClientWorkspace } from "./workspace.js";
import { inferPlatform } from "./grounding.js";

const MARKERS: Array<{ re: RegExp; weight: number }> = [
  { re: /You are Codex, a coding agent/i, weight: 3 },
  { re: /instruction library/i, weight: 2 },
  { re: /<environment_context>[\s\S]*<cwd>/i, weight: 2 },
  { re: /<workspace_roots>/i, weight: 1 },
  { re: /<permission_profile/i, weight: 1 },
];

const SCORE_THRESHOLD = 3;

export function looksLikeCodexInstructionLibrary(text: string): boolean {
  if (!text) return false;
  let score = 0;
  for (const marker of MARKERS) {
    if (marker.re.test(text)) score += marker.weight;
  }
  return score >= SCORE_THRESHOLD;
}

export function applyCodexBridge(systemText: string, raw?: Record<string, unknown>): CursorSdkBridge | undefined {
  if (!systemText.trim()) return undefined;
  const library = looksLikeCodexInstructionLibrary(systemText);
  const liteMarkers =
    /<environment_context>/i.test(systemText) ||
    /instruction library/i.test(systemText) ||
    /You are Codex, a coding agent/i.test(systemText);
  const lite = Boolean(raw && looksLikeCodexLite(raw) && liteMarkers);
  if (!library && !lite) return undefined;
  const workspace = extractClientWorkspace(systemText);
  const bridge: CursorSdkBridge = { kind: "codex" };
  if (workspace.cwd) bridge.cwd = workspace.cwd;
  if (workspace.roots.length > 0) bridge.roots = workspace.roots;
  const platform = inferPlatform(workspace.cwd);
  if (platform) bridge.platform = platform;
  return bridge;
}
