import { afterEach, expect, test } from "vitest";
import { parseMessagesRequest, renderPrompt } from "../../src/protocols/anthropic/parse.js";
import { looksLikeClaudeCodeCli } from "../../src/protocols/anthropic/claude-code-cli.js";
import { api, closeTestApp, startTestApp, type TestContext } from "../helpers/app.js";

let ctx: TestContext;

afterEach(async () => {
  if (ctx) await closeTestApp(ctx);
});

const USER_ASK = "读取本目录并给我一份审计报告。";
const WIN_CWD = "D:\\AI\\Xclis\\grok-bot";

/** Marker-only fixture — not a copy of official Claude Code prompt texts. */
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
    "OS Version: Windows 11 [10.0.26100]",
    "Today's date: 2026-08-17",
    "</env>",
    "",
    "gitStatus: This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.",
    "Current branch: main",
    "?? README.md",
    "?? src/index.ts",
  ].join("\n");
}

function claudeCodeTools() {
  return ["Read", "Bash", "Edit", "Glob", "Grep"].map((name) => ({
    name,
    description: `${name} on the caller machine`,
    input_schema: { type: "object", properties: { path: { type: "string" } } },
  }));
}

function assertCliNovelAbsent(prompt: string): void {
  expect(prompt).not.toContain("You are Claude Code, Anthropic's official CLI");
  expect(prompt).not.toContain("Here is useful information about the environment");
  expect(prompt).not.toContain("Is directory a git repo");
  expect(prompt).not.toContain("gitStatus:");
  expect(prompt).not.toMatch(/open the project in Cursor IDE/i);
}

test("short user mention of Claude Code is not treated as CLI preamble", () => {
  expect(looksLikeClaudeCodeCli("", "Please use Claude Code to review this.")).toBe(false);
  const parsed = parseMessagesRequest({
    model: "composer-2.5",
    system: "Be concise.",
    messages: [{ role: "user", content: "Please use Claude Code and CLAUDE.md." }],
  });
  expect(parsed.cliBridge).toBeUndefined();
  expect(parsed.systemText).toBe("Be concise.");
  expect(parsed.messages).toEqual([{ role: "user", content: "Please use Claude Code and CLAUDE.md." }]);
});

test("Claude Code CLI system+env is stripped; user ask and client-workspace harness remain", () => {
  const parsed = parseMessagesRequest({
    model: "composer-2.5",
    system: claudeCodeCliSystem(),
    messages: [{ role: "user", content: USER_ASK }],
    tools: claudeCodeTools(),
  });
  expect(parsed.cliBridge).toEqual({ kind: "claude-code", cwd: WIN_CWD, platform: "win32" });
  expect(parsed.systemText).toBe("");
  expect(parsed.messages).toEqual([{ role: "user", content: USER_ASK }]);

  const prompt = renderPrompt(parsed).text;
  assertCliNovelAbsent(prompt);
  expect(prompt).toContain(USER_ASK);
  expect(prompt).toContain(WIN_CWD);
  expect(prompt).toMatch(/caller's machine/i);
  expect(prompt).toContain("Read, Bash, Edit, Write, Glob, Grep");
  expect(prompt).not.toContain("HARNESS TOOL CONTEXT");
  expect(prompt).not.toContain("SDK cwd is not the project");
  expect(prompt.indexOf(WIN_CWD)).toBeGreaterThanOrEqual(0);
  expect(prompt.indexOf(WIN_CWD, prompt.indexOf(WIN_CWD) + 1)).toBeGreaterThan(prompt.indexOf(WIN_CWD));
});

test("env dump in the first user blob is stripped; later turns stay", () => {
  const firstUser = [
    "Here is useful information about the environment you are running in:",
    "<env>",
    `Working directory: ${WIN_CWD}`,
    "Is directory a git repo: Yes",
    "Platform: win32",
    "</env>",
    "",
    USER_ASK,
  ].join("\n");
  const parsed = parseMessagesRequest({
    model: "composer-2.5",
    system: "You are Claude Code, Anthropic's official CLI for Claude.\nYou are an interactive CLI tool that helps users.\nSee CLAUDE.md and persistent memory.",
    messages: [
      { role: "user", content: firstUser },
      { role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "Glob", input: { pattern: "*" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "README.md" }] },
    ],
    tools: claudeCodeTools(),
  });
  expect(parsed.cliBridge?.cwd).toBe(WIN_CWD);
  expect(parsed.systemText).toBe("");
  expect(parsed.messages[0]).toEqual({ role: "user", content: USER_ASK });
  expect(parsed.messages[1]).toEqual({
    role: "assistant",
    content: [{ type: "tool_use", id: "tu_1", name: "Glob", input: { pattern: "*" } }],
  });
  expect(parsed.messages[2]).toEqual({
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "tu_1", content: "README.md", is_error: false }],
  });
  const prompt = renderPrompt(parsed).text;
  assertCliNovelAbsent(prompt);
  expect(prompt).toContain(USER_ASK);
  expect(prompt).toContain("[tool_use Glob tu_1]");
  // Trailing tool_result is a continuation and is not replayed into the prompt text.
});

test("/v1/messages Claude Code CLI fixture does not forward the identity dump", async () => {
  ctx = await startTestApp({
    sdk: { scripts: [[{ type: "text", chunks: ["ok"] }]] },
  });
  const res = await api(ctx, "/v1/messages", {
    method: "POST",
    body: JSON.stringify({
      model: "composer-2.5",
      max_tokens: 32,
      system: claudeCodeCliSystem(),
      messages: [{ role: "user", content: USER_ASK }],
      tools: claudeCodeTools(),
    }),
  });
  expect(res.status).toBe(200);
  const prompt = ctx.sdk.agents[0]?.lastSend?.text ?? "";
  assertCliNovelAbsent(prompt);
  expect(prompt).toContain(USER_ASK);
  expect(prompt).toContain(WIN_CWD);
  expect(prompt).toMatch(/caller's machine/i);
  expect(prompt).not.toContain("HARNESS TOOL CONTEXT");
  expect(prompt).not.toContain("SDK cwd is not the project");
  expect(prompt).not.toMatch(/open the project in Cursor IDE/i);
});
