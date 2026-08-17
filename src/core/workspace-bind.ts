import type { ParsedMessages } from "../protocols/anthropic/types.js";
import { collectPromptWorkspaceTexts } from "../protocols/anthropic/parse.js";
import { collectClientWorkspace } from "../protocols/openai-responses/codex-cursor.js";
import { inferPlatform } from "../cursor-sdk-bridge/grounding.js";
import type { Session } from "./session.js";

export function bindClientWorkspace(session: Session, parsed: ParsedMessages, isolatedWorkspaceDir: string): void {
  session.isolatedWorkspaceDir = isolatedWorkspaceDir;
  if (parsed.clientBrand) session.clientBrand = parsed.clientBrand;
  const collected = collectClientWorkspace(collectPromptWorkspaceTexts(parsed));
  const cwd = collected.cwd ?? parsed.cliBridge?.cwd;
  if (cwd) session.clientCwd = cwd;
  const roots = collected.roots.length > 0 ? collected.roots : (parsed.cliBridge?.roots ?? []);
  if (roots.length > 0) session.clientRoots = roots;
  const platform = parsed.cliBridge?.platform ?? inferPlatform(cwd);
  if (platform) session.clientPlatform = platform;
}

export function sessionGrounding(session: Session): { cwd?: string; roots: string[]; platform?: string } {
  return {
    cwd: session.clientCwd,
    roots: session.clientRoots ?? [],
    platform: session.clientPlatform,
  };
}
