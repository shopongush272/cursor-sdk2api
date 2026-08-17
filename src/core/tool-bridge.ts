import { digestJson } from "../digest.js";
import type { Clock } from "../clock.js";
import type { SdkCustomTool } from "../sdk/port.js";
import type { AnthropicTool } from "../protocols/anthropic/types.js";
import type { Session } from "./session.js";
import { rewriteIsolatedWorkspaceArgs, findIsolatedWorkspaceHits, shouldCorrectScratchPath } from "../cursor-sdk-bridge/intercept.js";
import { scratchPathCorrection } from "../cursor-sdk-bridge/grounding.js";

export function mapClientTools(
  tools: AnthropicTool[],
  session: Session,
  clock: Clock,
  onExecute: (session: Session) => void,
): Record<string, SdkCustomTool> {
  const mapped: Record<string, SdkCustomTool> = {};
  session.customToolNames.clear();
  for (const tool of tools) {
    if (tool.wire === "custom") session.customToolNames.add(tool.name);
    mapped[tool.name] = {
      description: tool.description,
      inputSchema: tool.input_schema,
      async execute(args, context) {
        const isolatedPrefix = session.isolatedWorkspaceDir ?? "";
        const hostUnderScratch = hostRootLivesUnderScratch(session.clientCwd, isolatedPrefix);
        if (!hostUnderScratch) {
          const hits = findIsolatedWorkspaceHits(args, isolatedPrefix);
          if (shouldCorrectScratchPath(hits, session.scratchPathCorrections)) {
            session.scratchPathCorrections += 1;
            return scratchPathCorrection(hits[0] ?? isolatedPrefix, session.clientCwd);
          }
        }
        const rewritten = rewriteIsolatedWorkspaceArgs(args, isolatedPrefix, session.clientCwd);
        const call = session.createPending(tool.name, rewritten, clock, context.toolCallId);
        onExecute(session);
        if (session.pump) session.pump.notifyTool(call);
        else session.earlyCalls.push(call);
        return call.promise;
      },
    };
  }
  return mapped;
}

export function resultDigest(toolUseId: string, content: string, isError: boolean): string {
  return digestJson({ tool_use_id: toolUseId, content, is_error: isError });
}

export function batchDigest(
  results: Array<{ toolUseId: string; content: string; isError: boolean }>,
): string {
  return digestJson(
    [...results]
      .sort((a, b) => a.toolUseId.localeCompare(b.toolUseId))
      .map((result) => ({
        tool_use_id: result.toolUseId,
        digest: resultDigest(result.toolUseId, result.content, result.isError),
      })),
  );
}

function hostRootLivesUnderScratch(hostRoot: string | undefined, isolatedPrefix: string): boolean {
  if (!hostRoot || !isolatedPrefix) return false;
  if (hostRoot === isolatedPrefix) return true;
  const prefix = isolatedPrefix.replace(/[\\/]+$/, "");
  return hostRoot.startsWith(`${prefix}/`) || hostRoot.startsWith(`${prefix}\\`);
}
