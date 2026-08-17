/**
 * Codex Responses Lite ↔ Cursor SDK conversion helpers.
 *
 * Official openai/codex `client.rs` `build_responses_request` (when
 * `use_responses_lite`) sends top-level `tools: null`, empty `instructions`,
 * then prefixes `input` with `{ type: "additional_tools", role: "developer",
 * tools: [...] }` and, when `prompt.base_instructions.text` is non-empty, a
 * developer message carrying the official instruction library. Environment
 * and permissions stay on the Codex client as XML from
 * `environment_context.rs`.
 *
 * cwd/sandbox/approval are not hosted on this gateway. Instruction-library
 * and raw environment_context XML stop at cursor-sdk-bridge; only client
 * cwd/roots are injected. Protocol conversion (exec wrap, apply_patch,
 * history mapping) stays here.
 */

import { isAbsoluteClientPath, joinClientPath } from "../../cursor-sdk-bridge/workspace.js";

export type { ClientWorkspace } from "../../cursor-sdk-bridge/types.js";
export { extractClientWorkspace, collectClientWorkspace, isAbsoluteClientPath, joinClientPath } from "../../cursor-sdk-bridge/workspace.js";
export { clientWorkspaceHarnessLines } from "../../cursor-sdk-bridge/harness.js";

const HISTORY_CALL_TYPES = new Set([
  "apply_patch_call",
  "custom_tool_call",
  "function_call",
  "local_shell_call",
  "shell_call",
]);

const HISTORY_OUTPUT_TYPES = new Set([
  "apply_patch_call_output",
  "custom_tool_call_output",
  "function_call_output",
  "local_shell_call_output",
  "shell_call_output",
]);

export function isCodexHistoryCall(type: string): boolean {
  return HISTORY_CALL_TYPES.has(type);
}

export function isCodexHistoryOutput(type: string): boolean {
  return HISTORY_OUTPUT_TYPES.has(type);
}

export function mapCodexHistoryCall(raw: Record<string, unknown>): Record<string, unknown> {
  const type = typeof raw.type === "string" ? raw.type : "";
  const defaultName =
    type === "apply_patch_call" ? "apply_patch" : type === "local_shell_call" || type === "shell_call" ? "shell" : undefined;
  const name = firstNonEmptyString(raw.name, defaultName);
  const input = firstDefined(raw.input, raw.command, raw.patch, raw.arguments, actionInput(raw));
  return {
    ...raw,
    ...(name ? { name } : {}),
    ...(input !== undefined ? { input } : {}),
  };
}

export function mapCodexHistoryOutput(raw: Record<string, unknown>): Record<string, unknown> {
  // Content-item arrays stay arrays so stringifyResponsesToolOutput can
  // fail closed on images/files. Structured objects are flattened to text.
  if (Array.isArray(raw.output)) {
    return { ...raw, output: raw.output };
  }
  return {
    ...raw,
    output: encodeCodexToolOutput(toolOutputPayload(raw)),
  };
}

/**
 * Visible text for a Codex/Cursor exec result. Official
 * `custom_tool_call_output.output` is a FunctionCallOutputPayload: a plain
 * string, a content-item array, or (from code-mode / Cursor hosts) an object
 * `{ output, exit_code, wall_time_seconds }` / `{ stdout, stderr }`.
 * Code-mode often sends a two-item array: a "Script completed" header plus a
 * JSON string of that exec result. Unwrap nested JSON `output` so the model
 * sees the listing, not only the header.
 */
export function encodeCodexToolOutput(value: unknown): string {
  return collectOutputText(value).join("\n");
}

export interface CodexOutputShape {
  output_kind: "string" | "json_string" | "content_items" | "object" | "empty" | "other";
  output_keys: string[];
  item_types: string[];
  tool_result_chars: number;
  text_empty: boolean;
}

/** Keys/types only — never log bodies or secrets. */
export function describeCodexOutputShape(value: unknown): CodexOutputShape {
  const extracted = encodeCodexToolOutput(value);
  const base = {
    output_keys: [] as string[],
    item_types: [] as string[],
    tool_result_chars: extracted.length,
    text_empty: extracted.trim().length === 0,
  };
  if (value == null || value === "") return { ...base, output_kind: "empty" };
  if (typeof value === "string") {
    const parsed = tryParseJsonObject(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ...base, output_kind: "json_string", output_keys: Object.keys(parsed).slice(0, 16) };
    }
    if (Array.isArray(parsed)) {
      return { ...base, output_kind: "json_string", item_types: parsed.slice(0, 8).map(itemType) };
    }
    return { ...base, output_kind: "string" };
  }
  if (Array.isArray(value)) {
    const first = value[0];
    return {
      ...base,
      output_kind: "content_items",
      output_keys: first && typeof first === "object" && !Array.isArray(first) ? Object.keys(first).slice(0, 12) : [],
      item_types: value.slice(0, 8).map(itemType),
    };
  }
  if (typeof value === "object") {
    return { ...base, output_kind: "object", output_keys: Object.keys(value as object).slice(0, 16) };
  }
  return { ...base, output_kind: "other" };
}

function itemType(item: unknown): string {
  if (item && typeof item === "object" && !Array.isArray(item) && typeof (item as { type?: unknown }).type === "string") {
    return (item as { type: string }).type;
  }
  return typeof item;
}

function toolOutputPayload(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    output: raw.output,
    result: raw.result,
    content: raw.content,
    body: raw.body,
    stdout: raw.stdout,
    stderr: raw.stderr,
    text: raw.text,
    exit_code: raw.exit_code ?? raw.exitCode,
  };
}

function tryParseJsonObject(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const candidates: string[] = [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) candidates.push(trimmed);
  const nl = trimmed.lastIndexOf("\n{");
  if (nl >= 0) candidates.push(trimmed.slice(nl + 1).trim());
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

function collectOutputText(value: unknown, depth = 0): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (typeof value === "string") {
    if (!value.trim()) return [];
    if (depth < 3) {
      const parsed = tryParseJsonObject(value);
      if (parsed && typeof parsed === "object") {
        const nested = collectOutputText(parsed, depth + 1);
        if (nested.length > 0) return nested;
      }
    }
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const rec = item as Record<string, unknown>;
        if (typeof rec.text === "string" && rec.text) return collectOutputText(rec.text, depth + 1);
      }
      return collectOutputText(item, depth + 1);
    });
  }
  if (typeof value !== "object") return [];
  const rec = value as Record<string, unknown>;
  const texts: string[] = [];
  const preferred = ["stdout", "output", "content", "body", "result", "text"];
  for (const key of preferred) {
    const extracted = scalarOutputText(rec[key], depth);
    if (extracted !== undefined) {
      texts.push(extracted);
      break;
    }
  }
  if (texts.length === 0) {
    for (const key of preferred) {
      const nestedVal = rec[key];
      if (nestedVal && typeof nestedVal === "object") {
        const nested = collectOutputText(nestedVal, depth + 1);
        if (nested.length > 0) {
          texts.push(...nested);
          break;
        }
      }
    }
  }
  const stderr = scalarOutputText(rec.stderr, depth);
  if (stderr !== undefined) texts.push(stderr.startsWith("stderr") ? stderr : `stderr:\n${stderr}`);
  const exit = rec.exit_code ?? rec.exitCode;
  if (typeof exit === "number" || (typeof exit === "string" && exit.trim())) {
    texts.push(`exit: ${exit}`);
  }
  return texts;
}

function scalarOutputText(value: unknown, depth: number): string | undefined {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (depth < 3) {
    const parsed = tryParseJsonObject(value);
    if (parsed && typeof parsed === "object") {
      const nested = collectOutputText(parsed, depth + 1);
      if (nested.length > 0) return nested.join("\n");
    }
  }
  return value;
}

function actionInput(raw: Record<string, unknown>): unknown {
  if (!raw.action || typeof raw.action !== "object" || Array.isArray(raw.action)) return undefined;
  const action = raw.action as Record<string, unknown>;
  return firstDefined(action.command, action.commands, action.input, action.patch, action.arguments);
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function firstDefined(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

export function looksLikeCodeModeJs(text: string): boolean {
  return /(?:^|\n)\s*\/\/\s*@exec:|tools\.exec_command\s*\(|await\s+tools\./.test(text);
}

function unwrapExecRecord(input: unknown, defaultWorkdir?: string): { cmd?: string; workdir?: string } {
  let current: unknown = input;
  let workdir = defaultWorkdir;
  for (let depth = 0; depth < 4; depth++) {
    if (typeof current === "string") {
      const trimmed = current.trim();
      if (!trimmed) return { workdir };
      if (looksLikeCodeModeJs(trimmed)) return { cmd: trimmed, workdir };
      const parsed = tryParseJsonObject(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        current = parsed;
        continue;
      }
      return { cmd: trimmed, workdir };
    }
    if (current && typeof current === "object" && !Array.isArray(current)) {
      const rec = current as Record<string, unknown>;
      workdir = firstNonEmptyString(rec.workdir, rec.cwd, rec.working_directory, workdir);
      const nested = rec.cmd ?? rec.command ?? rec.input;
      if (nested && typeof nested === "object") {
        current = nested;
        continue;
      }
      const cmd = firstNonEmptyString(rec.cmd, rec.command, rec.input);
      if (cmd) {
        current = cmd;
        continue;
      }
      return { workdir };
    }
    return { workdir };
  }
  return { workdir };
}

export function encodeCodexExecInput(input: unknown, defaultWorkdir?: string): string {
  if (input === null || input === undefined) return "";
  const unwrapped = unwrapExecRecord(input, defaultWorkdir);
  const cmd = unwrapped.cmd;
  const workdir = unwrapped.workdir;
  if (!cmd) {
    return wrapExecCommand(typeof input === "string" ? input : JSON.stringify(input), defaultWorkdir);
  }
  if (looksLikeCodeModeJs(cmd)) return applyDefaultWorkdirToCodeModeJs(cmd, workdir);
  return wrapExecCommand(cmd, workdir);
}

function extractApplyPatchEnvelope(cmd: string): { patch: string; leftover?: string } | undefined {
  const beginIdx = cmd.indexOf("*** Begin Patch");
  if (beginIdx < 0) return undefined;
  const endMarker = "*** End Patch";
  const endIdx = cmd.indexOf(endMarker, beginIdx);
  if (endIdx < 0) return undefined;
  const prefix = cmd.slice(0, beginIdx);
  const mostlyPatch = cmd.trimStart().startsWith("*** Begin Patch");
  if (!mostlyPatch && !/\bapply_patch\b/.test(prefix)) return undefined;
  const patch = cmd.slice(beginIdx, endIdx + endMarker.length).replace(/[ \t]+$/g, "");
  let after = cmd.slice(endIdx + endMarker.length).replace(/^\r?\n/, "");
  after = after.replace(/^[A-Za-z_][A-Za-z0-9_]*\r?\n/, "");
  const leftover = after.trim();
  return leftover ? { patch, leftover } : { patch };
}

function wrapExecCommand(cmd: string, workdir?: string): string {
  // Official exec_command schema uses `cmd` + optional `workdir` (not `cwd`).
  // Code-mode only surfaces `text()` / `notify()` to the model; a bare
  // `await tools.exec_command(...)` still runs (CLI shows stdout) but the
  // follow-up custom_tool_call_output is header-only.
  // Cursor often emits apply_patch as a shell heredoc; that binary is not on
  // PATH. Official 0.147 code-mode is `tools.apply_patch(patchString)` — no
  // workdir argument (openai/codex#20879 / #25958). Relative patch paths
  // resolve against the Codex process cwd, so rewrite them to the client
  // workspace when environment_context cwd is known.
  const extracted = extractApplyPatchEnvelope(cmd);
  if (extracted) {
    const patch = absolutizePatchPaths(extracted.patch, workdir);
    const parts = [`text(await tools.apply_patch(${JSON.stringify(patch)}));`];
    if (extracted.leftover) {
      const args = workdir ? { cmd: extracted.leftover, workdir } : { cmd: extracted.leftover };
      parts.push(`text((await tools.exec_command(${JSON.stringify(args)})).output);`);
    }
    return parts.join("\n");
  }
  const args = workdir ? { cmd, workdir } : { cmd };
  return `text((await tools.exec_command(${JSON.stringify(args)})).output);`;
}

const PATCH_PATH_HEADER = /^(\*\*\* (?:Update File|Add File|Delete File|Move to): )(.+)$/;

export function absolutizePatchPaths(patch: string, cwd?: string): string {
  if (!cwd) return patch;
  return patch
    .split("\n")
    .map((line) => {
      const match = PATCH_PATH_HEADER.exec(line);
      const prefix = match?.[1];
      const rel = match?.[2];
      if (!prefix || !rel) return line;
      return `${prefix}${joinClientPath(cwd, rel)}`;
    })
    .join("\n");
}

function jsStringLiteralValue(lit: string): string | undefined {
  if (lit.length < 2) return undefined;
  const quote = lit[0];
  const end = lit[lit.length - 1];
  if (quote !== end) return undefined;
  if (quote === "`") {
    if (lit.includes("${")) return undefined;
    return lit.slice(1, -1).replace(/\\([\\`])/g, "$1");
  }
  if (quote !== '"' && quote !== "'") return undefined;
  try {
    return JSON.parse(quote === '"' ? lit : `"${lit.slice(1, -1).replace(/\\"/g, '"').replace(/"/g, '\\"')}"`) as string;
  } catch {
    return lit.slice(1, -1);
  }
}

function applyDefaultWorkdirToCodeModeJs(js: string, workdir?: string): string {
  if (!workdir) return js;
  let out = js.replace(/tools\.exec_command\(\s*(\{(?:[^{}]|\{[^{}]*\})*\})\s*\)/g, (full, objSrc: string) => {
    if (/\bworkdir\s*:/.test(objSrc)) return full;
    const injected = objSrc.replace(/^\{\s*/, `{ workdir: ${JSON.stringify(workdir)}, `);
    return `tools.exec_command(${injected})`;
  });
  out = out.replace(
    /tools\.apply_patch\(\s*(`[\s\S]*?`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)/g,
    (full, lit: string) => {
      const raw = jsStringLiteralValue(lit);
      if (raw == null) return full;
      const abs = absolutizePatchPaths(raw, workdir);
      if (abs === raw) return full;
      return `tools.apply_patch(${JSON.stringify(abs)})`;
    },
  );
  return out;
}

export const CODEX_EXEC_TOOL = {
  name: "exec",
  description:
    "Run shell commands and read/write files in the user's local project workspace. This is the only filesystem and terminal tool. The Cursor SDK workspace is empty and must be ignored. Call this before claiming you lack file access. When a client workspace path is known, exec workdir and apply_patch file paths MUST be that absolute path.",
  input_schema: { type: "object", properties: { input: { type: "string" } } },
  wire: "custom" as const,
};

export function looksLikeCodexLite(raw: Record<string, unknown>): boolean {
  const model = typeof raw.model === "string" ? raw.model : "";
  if (/gpt-5\.6|codex/i.test(model)) return true;
  if (!Array.isArray(raw.input)) return false;
  return raw.input.some((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "additional_tools");
}

export function ensureCodexExecTool<T extends { name: string; wire?: string }>(tools: T[], raw: Record<string, unknown>): T[] {
  if (!looksLikeCodexLite(raw)) return tools;
  if (tools.some((tool) => tool.name === "exec" || tool.wire === "custom")) return tools;
  return [...tools, CODEX_EXEC_TOOL as unknown as T];
}
