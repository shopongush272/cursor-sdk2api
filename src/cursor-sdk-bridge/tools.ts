export const AMBIENT_DISALLOWED_TOOLS = ["shell", "read", "edit", "task", "webSearch", "webFetch"] as const;

export function apiProfileToolAllowlist(clientToolNames: string[]): string[] {
  return clientToolNames.length > 0 ? ["mcp"] : [];
}
