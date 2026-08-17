import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface HostGrounding {
  cwd?: string;
  roots: string[];
  platform?: string;
}

export function inferPlatform(cwd?: string): string | undefined {
  if (!cwd) return undefined;
  if (/^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith("\\\\") || cwd.startsWith("\\")) return "win32";
  if (cwd.startsWith("/Users/") || cwd.includes("/Users/")) return "darwin";
  return undefined;
}

export function agentsMdContent(g: HostGrounding): string {
  const lines = [
    "This directory is a gateway scratch workspace.",
    "File, shell, and edit tools execute on the caller's machine, not here.",
  ];
  if (g.cwd) lines.push(`Host project root: ${g.cwd}`);
  if (g.platform) lines.push(`Host platform: ${g.platform}`);
  if (g.roots.length > 0) lines.push(`Host workspace roots: ${g.roots.join(", ")}`);
  lines.push("Use absolute host paths. Do not prefix tool arguments with this scratch directory.");
  lines.push("Cursor built-in filesystem and shell tools are unavailable; use the client tools.");
  return `${lines.join("\n")}\n`;
}

export function groundingPromptHead(g: HostGrounding, kind?: "claude-code" | "codex"): string[] {
  const tools =
    kind === "claude-code"
      ? "File, shell, and edit tools (Read, Bash, Edit, Write, Glob, Grep) execute on the caller's machine."
      : kind === "codex"
        ? "File, shell, and edit tools (exec, apply_patch) execute on the caller's machine."
        : "File, shell, and edit tools execute on the caller's machine.";
  const lines = [
    tools,
    "Use absolute host paths. Do not prefix tool arguments with this scratch directory.",
  ];
  if (g.cwd) lines.push(`Host project root: ${g.cwd}`);
  if (g.platform) lines.push(`Host platform: ${g.platform}`);
  if (g.roots.length > 0) lines.push(`Host workspace roots: ${g.roots.join(", ")}`);
  lines.push("Cursor built-in filesystem and shell tools are unavailable; use the client tools.");
  return lines;
}

export function groundingPromptTail(g: HostGrounding): string[] {
  const lines = ["Tools execute on the caller's machine."];
  if (g.cwd) lines.push(`If you need a project path, use this absolute host path: ${g.cwd}`);
  return lines;
}

export function scratchPathCorrection(offending: string, hostRoot?: string): string {
  const retry = hostRoot
    ? `Retry this tool with the host project path: ${hostRoot}.`
    : "Retry this tool with an absolute host project path.";
  return `The argument ${offending} points at a gateway scratch workspace. ${retry} Do not prefix tool arguments with the scratch directory.`;
}

export function writeWorkspaceGrounding(workspaceDir: string, g: HostGrounding): void {
  mkdirSync(workspaceDir, { recursive: true });
  const path = join(workspaceDir, "AGENTS.md");
  const content = agentsMdContent(g);
  try {
    if (readFileSync(path, "utf8") === content) return;
  } catch {
    // missing or unreadable
  }
  writeFileSync(path, content, { mode: 0o600 });
}
