import { joinClientPath } from "./workspace.js";

export function rewriteIsolatedWorkspaceValue(value: string, isolatedPrefix: string, clientCwd?: string): string {
  if (!value || !isolatedPrefix || !clientCwd) return value;
  if (value.includes(isolatedPrefix)) {
    return splicePrefix(value, isolatedPrefix, clientCwd);
  }
  const marker = "/empty-workspace/";
  if (value.includes(marker)) {
    const idx = value.indexOf(marker);
    const pathStart = findPathStart(value, idx);
    const prefix = value.slice(pathStart, idx + marker.length - 1);
    return value.slice(0, pathStart) + splicePrefix(value.slice(pathStart), prefix, clientCwd);
  }
  return value;
}

export function rewriteIsolatedWorkspaceArgs(args: unknown, isolatedPrefix: string, clientCwd?: string): unknown {
  if (typeof args === "string") return rewriteIsolatedWorkspaceValue(args, isolatedPrefix, clientCwd);
  if (Array.isArray(args)) {
    return args.map((item) => rewriteIsolatedWorkspaceArgs(item, isolatedPrefix, clientCwd));
  }
  if (args && typeof args === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
      out[key] = rewriteIsolatedWorkspaceArgs(value, isolatedPrefix, clientCwd);
    }
    return out;
  }
  return args;
}

function splicePrefix(value: string, prefix: string, clientCwd: string): string {
  const idx = value.indexOf(prefix);
  if (idx < 0) return value;
  const remainder = value.slice(idx + prefix.length).replace(/^[\\/]+/, "");
  const replaced = remainder ? joinClientPath(clientCwd, remainder) : clientCwd;
  return `${value.slice(0, idx)}${replaced}`;
}

function findPathStart(value: string, at: number): number {
  for (let i = at; i >= 0; i--) {
    const ch = value[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === '"' || ch === "'") return i + 1;
  }
  return 0;
}

export function findIsolatedWorkspaceHits(args: unknown, isolatedPrefix: string): string[] {
  const hits: string[] = [];
  walk(args);
  return hits;

  function walk(value: unknown): void {
    if (typeof value === "string") {
      if ((isolatedPrefix && value.includes(isolatedPrefix)) || value.includes("/empty-workspace/")) {
        hits.push(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const nested of Object.values(value as Record<string, unknown>)) walk(nested);
    }
  }
}

export function shouldCorrectScratchPath(hits: string[], correctionsSoFar: number, max = 3): boolean {
  return hits.length > 0 && correctionsSoFar < max;
}
