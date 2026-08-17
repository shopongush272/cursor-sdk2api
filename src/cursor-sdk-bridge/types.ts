export type BridgeKind = "claude-code" | "codex";

export interface ClientWorkspace {
  cwd?: string;
  roots: string[];
  platform?: string;
}

export interface CursorSdkBridge {
  kind: BridgeKind;
  cwd?: string;
  roots?: string[];
  platform?: string;
}
