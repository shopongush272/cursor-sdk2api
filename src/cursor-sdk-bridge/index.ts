export type { BridgeKind, ClientWorkspace, CursorSdkBridge } from "./types.js";
export type { HostGrounding } from "./grounding.js";
export {
  extractClientWorkspace,
  collectClientWorkspace,
  isAbsoluteClientPath,
  joinClientPath,
} from "./workspace.js";
export {
  looksLikeClaudeCodeCli,
  applyClaudeCodeCliBridge,
  claudeCodeClientHarnessLines,
  scoreClaudeCodeCliMarkers,
  extractClaudeCodeCwd,
  stripClaudeCodeCliPreamble,
  firstUserText,
} from "./claude-code.js";
export type { ClaudeCodeCliBridge } from "./claude-code.js";
export { applyCodexBridge, looksLikeCodexInstructionLibrary } from "./codex.js";
export { clientWorkspaceHarnessLines, bridgeHarnessLines } from "./harness.js";
export {
  inferPlatform,
  agentsMdContent,
  groundingPromptHead,
  groundingPromptTail,
  scratchPathCorrection,
  writeWorkspaceGrounding,
} from "./grounding.js";
export { AMBIENT_DISALLOWED_TOOLS, apiProfileToolAllowlist } from "./tools.js";
export {
  rewriteIsolatedWorkspaceValue,
  rewriteIsolatedWorkspaceArgs,
  findIsolatedWorkspaceHits,
  shouldCorrectScratchPath,
} from "./intercept.js";
export { rewriteAssistantSurface, resolveClientBrand, brandFromModel } from "./identity.js";
export type { ClientBrand } from "./identity.js";
