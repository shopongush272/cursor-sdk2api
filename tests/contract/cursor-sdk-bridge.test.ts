import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  applyClaudeCodeCliBridge,
  applyCodexBridge,
  bridgeHarnessLines,
  looksLikeClaudeCodeCli,
  looksLikeCodexInstructionLibrary,
  rewriteIsolatedWorkspaceArgs,
  rewriteIsolatedWorkspaceValue,
  agentsMdContent,
  inferPlatform,
  findIsolatedWorkspaceHits,
  shouldCorrectScratchPath,
  writeWorkspaceGrounding,
  rewriteAssistantSurface,
  resolveClientBrand,
} from "../../src/cursor-sdk-bridge/index.js";
import { parseMessagesRequest } from "../../src/protocols/anthropic/parse.js";
import { afterEach } from "vitest";
import { api, closeTestApp, startTestApp, type TestContext } from "../helpers/app.js";

const WIN_CWD = "D:\\AI\\Xclis\\grok-bot";

function claudeCodeCliSystem(): string {
  return [
    "You are Claude Code, Anthropic's official CLI for Claude.",
    "",
    "You are an interactive CLI tool that helps users with software engineering tasks.",
    "Project instructions may appear in CLAUDE.md. You also have persistent memory.",
    "",
    "Here is useful information about the environment you are running in:",
    "<env>",
    `Working directory: ${WIN_CWD}`,
    "Is directory a git repo: Yes",
    "Platform: win32",
    "</env>",
  ].join("\n");
}

const officialInstructions = [
  "You are Codex, a coding agent that helps with software engineering tasks.",
  "Follow the instruction library: inspect the workspace before editing, prefer small diffs, and do not invent files.",
].join("\n");

const environmentContext = [
  "<environment_context>",
  "  <cwd>/Users/mixi/Downloads/myworks/fairy-tale-studio</cwd>",
  "  <shell>zsh</shell>",
  "  <workspace_roots><root>/Users/mixi/Downloads/myworks/fairy-tale-studio</root></workspace_roots>",
  "  <permission_profile type=\"managed\"><file_system type=\"restricted\" /></permission_profile>",
  "</environment_context>",
].join("\n");

test("Claude Code detect/strip still works via bridge exports", () => {
  const messages = [{ role: "user" as const, content: "audit this directory" }];
  const bridge = applyClaudeCodeCliBridge(claudeCodeCliSystem(), messages);
  expect(bridge).toEqual({ kind: "claude-code", cwd: WIN_CWD, platform: "win32" });
  expect(messages).toEqual([{ role: "user", content: "audit this directory" }]);
});

test("short use Claude Code mention is not stripped", () => {
  expect(looksLikeClaudeCodeCli("", "Please use Claude Code to review this.")).toBe(false);
  const parsed = parseMessagesRequest({
    model: "composer-2.5",
    system: "Be concise.",
    messages: [{ role: "user", content: "Please use Claude Code and CLAUDE.md." }],
  });
  expect(parsed.cliBridge).toBeUndefined();
  expect(parsed.systemText).toBe("Be concise.");
});

test("Codex instruction library detect + strip", () => {
  const assembled = `${officialInstructions}\n${environmentContext}`;
  expect(looksLikeCodexInstructionLibrary(assembled)).toBe(true);
  const bridge = applyCodexBridge(assembled, { model: "gpt-5.6-terra", input: [] });
  expect(bridge?.kind).toBe("codex");
  expect(bridge?.cwd).toBe("/Users/mixi/Downloads/myworks/fairy-tale-studio");
  expect(bridge?.roots).toEqual(["/Users/mixi/Downloads/myworks/fairy-tale-studio"]);
});

test("short developer note without markers is not stripped", () => {
  const note = "Be careful with the public API.";
  expect(looksLikeCodexInstructionLibrary(note)).toBe(false);
  expect(applyCodexBridge(note, { model: "gpt-5.6-terra", input: [] })).toBeUndefined();
  expect(applyCodexBridge(note)).toBeUndefined();
});

test("harness includes authoritative cwd", () => {
  const cwd = "/Users/mixi/Downloads/myworks/fairy-tale-studio";
  const lines = bridgeHarnessLines({
    kind: "codex",
    workspace: { cwd, roots: [cwd] },
    clientToolNames: ["exec"],
  }).join("\n");
  expect(lines).toContain(cwd);
  expect(lines).toMatch(/caller's machine/i);
  expect(lines).not.toContain("intentionally empty");
  expect(lines).not.toContain("HARNESS TOOL CONTEXT");
  expect(lines).not.toContain("SDK cwd is not the project");
});

test("intercept rewrites isolated prefix to client cwd", () => {
  const isolated = "/tmp/cursor-sdk2api/inst_test/empty-workspace";
  const client = "/Users/mixi/Downloads/myworks/fairy-tale-studio";
  expect(rewriteIsolatedWorkspaceValue(`${isolated}/src/a.ts`, isolated, client)).toBe(
    `${client}/src/a.ts`,
  );
  expect(
    rewriteIsolatedWorkspaceArgs({ path: `${isolated}/readme.md`, nested: { cwd: isolated } }, isolated, client),
  ).toEqual({ path: `${client}/readme.md`, nested: { cwd: client } });
});

test("intercept leaves unrelated paths alone", () => {
  const isolated = "/tmp/cursor-sdk2api/inst_test/empty-workspace";
  const client = "/Users/mixi/Downloads/myworks/fairy-tale-studio";
  expect(rewriteIsolatedWorkspaceValue("/Users/mixi/other/project/a.ts", isolated, client)).toBe(
    "/Users/mixi/other/project/a.ts",
  );
  expect(rewriteIsolatedWorkspaceArgs({ path: "/var/log/app.log" }, isolated, client)).toEqual({
    path: "/var/log/app.log",
  });
});

test("agentsMdContent names host root and caller machine", () => {
  const cwd = "D:\\AI\\Xclis\\grok-bot";
  const text = agentsMdContent({ cwd, roots: [cwd], platform: "win32" });
  expect(text).toContain("gateway scratch workspace");
  expect(text).toContain(cwd);
  expect(text).toContain("Host platform: win32");
  expect(text).toMatch(/caller's machine/);
  expect(text).not.toContain("HARNESS TOOL CONTEXT");
  expect(text).not.toContain("intentionally empty");
  expect(text).not.toContain("SDK cwd is not the project");
});

test("inferPlatform from cwd", () => {
  expect(inferPlatform("D:\\AI\\Xclis\\grok-bot")).toBe("win32");
  expect(inferPlatform("C:/temp/project")).toBe("win32");
  expect(inferPlatform("\\\\server\\share")).toBe("win32");
  expect(inferPlatform("/Users/mixi/Downloads/myworks/fairy-tale-studio")).toBe("darwin");
  expect(inferPlatform("/tmp/cursor-sdk2api/empty-workspace")).toBeUndefined();
  expect(inferPlatform(undefined)).toBeUndefined();
});

test("findIsolatedWorkspaceHits and shouldCorrectScratchPath", () => {
  const isolated = "/tmp/cursor-sdk2api/inst_test/empty-workspace";
  expect(findIsolatedWorkspaceHits({ path: `${isolated}/src/a.ts` }, isolated)).toEqual([`${isolated}/src/a.ts`]);
  expect(findIsolatedWorkspaceHits({ path: "/var/empty-workspace/foo" }, isolated)).toEqual(["/var/empty-workspace/foo"]);
  expect(findIsolatedWorkspaceHits({ path: "/Users/mixi/project/a.ts" }, isolated)).toEqual([]);
  expect(shouldCorrectScratchPath(["hit"], 0)).toBe(true);
  expect(shouldCorrectScratchPath(["hit"], 2)).toBe(true);
  expect(shouldCorrectScratchPath(["hit"], 3)).toBe(false);
  expect(shouldCorrectScratchPath([], 0)).toBe(false);
});

test("writeWorkspaceGrounding is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-sdk2api-grounding-"));
  try {
    const g = { cwd: "/Users/mixi/Downloads/myworks/fairy-tale-studio", roots: [] as string[] };
    writeWorkspaceGrounding(dir, g);
    const path = join(dir, "AGENTS.md");
    const first = readFileSync(path, "utf8");
    expect(first).toContain("Host project root: /Users/mixi/Downloads/myworks/fairy-tale-studio");
    writeWorkspaceGrounding(dir, g);
    expect(readFileSync(path, "utf8")).toBe(first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rewrites identity claims to the model family brand, leaves paths alone", () => {
  expect(rewriteAssistantSurface("我是 Claude Sonnet 5，目前在 Cursor 中作为编码助手运行。", "Claude")).toBe(
    "我是 Claude Sonnet 5，目前在 Claude 中作为编码助手运行。",
  );
  expect(rewriteAssistantSurface("我是 GPT-5.6 Terra，目前作为 Cursor 中的编码助手运行。", "Codex")).toBe(
    "我是 GPT-5.6 Terra，目前作为 Codex 中的编码助手运行。",
  );
  expect(rewriteAssistantSurface("I am running in Cursor as a coding assistant.", "Gemini")).toBe(
    "I am running in Gemini as a coding assistant.",
  );
  expect(rewriteAssistantSurface("I am running in Cursor as a coding assistant.", "Grok")).toBe(
    "I am running in Grok as a coding assistant.",
  );
  expect(rewriteAssistantSurface("I am running in Cursor as a coding assistant.")).toBe(
    "I am running in Cursor as a coding assistant.",
  );
  expect(
    rewriteAssistantSurface(
      "I'm Claude Haiku 4.5, made by Anthropic. I'm a coding assistant here in Cursor to help you with software engineering tasks on your host project at D:\\AI\\Xclis\\grok-bot.",
      "Claude",
    ),
  ).toBe(
    "I'm Claude Haiku 4.5, made by Anthropic. I'm a coding assistant here in Claude to help you with software engineering tasks on your host project at D:\\AI\\Xclis\\grok-bot.",
  );
  expect(rewriteAssistantSurface("See /tmp/cursor-sdk2api/empty-workspace and @cursor/sdk.", "Claude")).toBe(
    "See /tmp/cursor-sdk2api/empty-workspace and @cursor/sdk.",
  );
});

test("resolves client brand from model family", () => {
  expect(resolveClientBrand({ model: "claude-sonnet-4" })).toBe("Claude");
  expect(resolveClientBrand({ model: "sonnet" })).toBe("Claude");
  expect(resolveClientBrand({ model: "gpt-5.6-terra" })).toBe("Codex");
  expect(resolveClientBrand({ model: "o3-mini" })).toBe("Codex");
  expect(resolveClientBrand({ model: "gemini-2.5-pro" })).toBe("Gemini");
  expect(resolveClientBrand({ model: "grok-4" })).toBe("Grok");
  expect(resolveClientBrand({ model: "composer-2.5", protocol: "messages" })).toBe("Claude");
  expect(resolveClientBrand({ model: "composer-2.5", protocol: "responses" })).toBeUndefined();
  expect(resolveClientBrand({ model: "composer-2.5", looksLikeCodexLite: true })).toBe("Codex");
});

let httpCtx: TestContext | undefined;
afterEach(async () => {
  if (!httpCtx) return;
  await closeTestApp(httpCtx);
  httpCtx = undefined;
});

test("identity claim is rewritten on /v1/responses", async () => {
  httpCtx = await startTestApp({
    sdk: { scripts: [[{ type: "text", chunks: ["我是 GPT-5.6 Terra，目前作为 Cursor 中的编码助手运行。"] }]] },
  });
  const res = await api(httpCtx, "/v1/responses", {
    method: "POST",
    body: JSON.stringify({ model: "gpt-5.6-terra", input: "你是什么模型？" }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { output: Array<{ content?: Array<{ text?: string }> }> };
  const text = body.output.flatMap((item) => item.content ?? []).map((part) => part.text ?? "").join("");
  expect(text).toContain("作为 Codex 中的编码助手运行");
  expect(text).not.toContain("作为 Cursor 中的编码助手");
  expect(text).not.toContain("作为 Claude 中的编码助手");
});

test("identity claim is rewritten on /v1/messages", async () => {
  httpCtx = await startTestApp({
    sdk: { scripts: [[{ type: "text", chunks: ["我是 Claude Sonnet 5，目前在 Cursor 中作为编码助手运行。"] }]] },
  });
  const res = await api(httpCtx, "/v1/messages", {
    method: "POST",
    body: JSON.stringify({
      model: "composer-2.5",
      max_tokens: 32,
      messages: [{ role: "user", content: "你是什么模型？" }],
    }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { content: Array<{ type?: string; text?: string }> };
  const text = body.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
  expect(text).toContain("在 Claude 中作为编码助手运行");
  expect(text).not.toContain("在 Cursor 中作为编码助手");
});
