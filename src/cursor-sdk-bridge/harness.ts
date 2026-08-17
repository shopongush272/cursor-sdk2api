import type { BridgeKind, ClientWorkspace } from "./types.js";
import { groundingPromptHead } from "./grounding.js";

export function clientWorkspaceHarnessLines(ws: ClientWorkspace): string[] {
  return groundingPromptHead({ cwd: ws.cwd, roots: ws.roots, platform: ws.platform });
}

export function claudeCodeClientHarnessLines(cwd?: string): string[] {
  return groundingPromptHead({ cwd, roots: [] }, "claude-code");
}

export function bridgeHarnessLines(opts: {
  kind?: BridgeKind;
  workspace: ClientWorkspace;
  clientToolNames: string[];
}): string[] {
  return groundingPromptHead(
    { cwd: opts.workspace.cwd, roots: opts.workspace.roots, platform: opts.workspace.platform },
    opts.kind,
  );
}
