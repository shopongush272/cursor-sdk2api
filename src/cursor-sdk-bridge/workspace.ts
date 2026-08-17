import type { ClientWorkspace } from "./types.js";

export function extractClientWorkspace(text: string): ClientWorkspace {
  if (!text) return { roots: [] };
  const cwd = firstTag(text, "cwd");
  const rootsBlock = firstTagInner(text, "workspace_roots");
  const roots = allTags(rootsBlock ?? text, "root");
  return cwd ? { cwd, roots } : { roots };
}

export function collectClientWorkspace(texts: string[]): ClientWorkspace {
  let cwd: string | undefined;
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    const extracted = extractClientWorkspace(text);
    if (!cwd && extracted.cwd) cwd = extracted.cwd;
    for (const root of extracted.roots) {
      if (seen.has(root)) continue;
      seen.add(root);
      roots.push(root);
    }
  }
  return cwd ? { cwd, roots } : { roots };
}

export function isAbsoluteClientPath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

export function joinClientPath(cwd: string, rel: string): string {
  const path = rel.trim();
  if (!cwd || !path || isAbsoluteClientPath(path)) return path || rel;
  const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  return `${cwd.replace(/[\\/]+$/, "")}${sep}${path.replace(/^[\\/]+/, "")}`;
}

function firstTag(text: string, name: string): string | undefined {
  const value = firstTagInner(text, name)?.trim();
  return value || undefined;
}

function firstTagInner(text: string, name: string): string | undefined {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i").exec(text);
  return match?.[1];
}

function allTags(text: string, name: string): string[] {
  const values: string[] = [];
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const value = match[1]?.trim();
    if (value) values.push(value);
  }
  return values;
}
