import { afterEach, expect, test } from "vitest";
import { GatewayError } from "../../src/errors.js";
import { clientWorkspaceHarnessLines, describeCodexOutputShape, encodeCodexExecInput, encodeCodexToolOutput } from "../../src/protocols/openai-responses/codex-cursor.js";
import { encodeFunctionCallItem } from "../../src/protocols/openai-responses/encode.js";
import { parseResponsesRequest } from "../../src/protocols/openai-responses/parse.js";
import { api, closeTestApp, startTestApp, type TestContext } from "../helpers/app.js";

let ctx: TestContext | undefined;

afterEach(async () => {
  if (!ctx) return;
  await closeTestApp(ctx);
  ctx = undefined;
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function openaiError(body: unknown): { message: string; type: string; param: null; code: string } {
  const error = isRecord(body) ? body.error : undefined;
  if (!isRecord(error)) throw new Error("expected OpenAI error object");
  return error as { message: string; type: string; param: null; code: string };
}

const jsonSchemaFormat = {
  type: "json_schema",
  name: "codex_output_schema",
  strict: true,
  schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
};

const additionalToolsItem = {
  type: "additional_tools",
  role: "developer",
  tools: [
    {
      type: "function",
      name: "lookup",
      description: "Look something up",
      parameters: { type: "object", properties: { q: { type: "string" } } },
    },
    { type: "custom", name: "exec", description: "Run code in the user workspace" },
    { type: "namespace", name: "default" },
    { type: "web_search" },
  ],
};

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

test("text.format json_schema is accepted and omitted by the parser", () => {
  const parsed = parseResponsesRequest({
    model: "composer-2.5",
    input: "hi",
    text: { verbosity: "medium", format: jsonSchemaFormat },
  });
  expect(parsed.parsed.messages).toEqual([{ role: "user", content: "hi" }]);
  expect(parsed.parsed.systemText).toBe("");
});

test("malformed text still fails closed at parse time", () => {
  try {
    parseResponsesRequest({
      model: "composer-2.5",
      input: "hi",
      text: "nope",
    });
    expect.unreachable("expected malformed text to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({
      message: "text must be an object if provided",
      code: "invalid_request",
    });
  }
});

test("additional_tools function tools are lifted when top-level tools is empty", () => {
  const parsed = parseResponsesRequest({
    model: "composer-2.5",
    tools: null,
    input: [
      additionalToolsItem,
      { type: "message", role: "user", content: [{ type: "input_text", text: "hello from user" }] },
    ],
  });
  expect(parsed.parsed.messages).toEqual([{ role: "user", content: "hello from user" }]);
  expect(parsed.parsed.tools).toEqual([
    {
      name: "lookup",
      description: "Look something up",
      input_schema: { type: "object", properties: { q: { type: "string" } } },
    },
    {
      name: "exec",
      description: "Run code in the user workspace",
      input_schema: { type: "object", properties: {} },
      wire: "custom",
    },
  ]);
});

test("compaction input items from a resumed session are skipped", () => {
  const parsed = parseResponsesRequest({
    model: "composer-2.5",
    input: [
      { type: "compaction", encrypted_content: "opaque", summary: "prior turn" },
      { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] },
    ],
  });
  expect(parsed.parsed.messages).toEqual([{ role: "user", content: "continue" }]);
});

test("developer instruction library is stripped; cwd lands on cliBridge", () => {
  const parsed = parseResponsesRequest({
    model: "composer-2.5",
    instructions: "",
    tools: null,
    input: [
      additionalToolsItem,
      { type: "message", role: "developer", content: officialInstructions },
      { type: "message", role: "developer", content: environmentContext },
      { type: "message", role: "user", content: [{ type: "input_text", text: "list the project files" }] },
    ],
  });
  expect(parsed.parsed.systemText).not.toContain(officialInstructions);
  expect(parsed.parsed.systemText).not.toContain("<environment_context>");
  expect(parsed.parsed.cliBridge?.kind).toBe("codex");
  expect(parsed.parsed.cliBridge?.cwd).toBe("/Users/mixi/Downloads/myworks/fairy-tale-studio");
  expect(parsed.parsed.messages).toEqual([{ role: "user", content: "list the project files" }]);
});

test("local_shell_call maps to tool_use and output maps to tool_result", () => {
  const parsed = parseResponsesRequest({
    model: "composer-2.5",
    input: [
      { type: "message", role: "user", content: "run it" },
      { type: "local_shell_call", call_id: "call_sh_1", command: "ls" },
      { type: "local_shell_call_output", call_id: "call_sh_1", output: "README.md" },
      { type: "message", role: "user", content: "next" },
    ],
  });
  expect(parsed.parsed.messages).toEqual([
    { role: "user", content: "run it" },
    { role: "assistant", content: [{ type: "tool_use", id: "call_sh_1", name: "shell", input: { input: "ls" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call_sh_1", content: "README.md", is_error: false }] },
    { role: "user", content: "next" },
  ]);
});

test("custom_tool_call maps to tool_use and output maps to tool_result", () => {
  const parsed = parseResponsesRequest({
    model: "composer-2.5",
    input: [
      { type: "message", role: "user", content: "run it" },
      { type: "custom_tool_call", call_id: "call_shell_1", name: "shell", input: "{\"command\":\"ls\"}" },
      { type: "custom_tool_call_output", call_id: "call_shell_1", output: "README.md" },
      { type: "message", role: "user", content: "next" },
    ],
  });
  expect(parsed.parsed.messages).toEqual([
    { role: "user", content: "run it" },
    { role: "assistant", content: [{ type: "tool_use", id: "call_shell_1", name: "shell", input: { command: "ls" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call_shell_1", content: "README.md", is_error: false }] },
    { role: "user", content: "next" },
  ]);
});

test("unknown session input item types are skipped instead of 400", () => {
  const parsed = parseResponsesRequest({
    model: "composer-2.5",
    input: [
      { type: "item_reference", id: "rs_old" },
      { type: "message", role: "user", content: "hello" },
    ],
  });
  expect(parsed.parsed.messages).toEqual([{ role: "user", content: "hello" }]);
});

test("gpt-5.6-luna with tools null injects synthetic custom exec", () => {
  const parsed = parseResponsesRequest({
    model: "gpt-5.6-luna",
    tools: null,
    input: [{ type: "message", role: "user", content: "list files" }],
  });
  expect(parsed.parsed.tools).toEqual([
    {
      name: "exec",
      description:
        "Run shell commands and read/write files in the user's local project workspace. This is the only filesystem and terminal tool. The Cursor SDK workspace is empty and must be ignored. Call this before claiming you lack file access. When a client workspace path is known, exec workdir and apply_patch file paths MUST be that absolute path.",
      input_schema: { type: "object", properties: { input: { type: "string" } } },
      wire: "custom",
    },
  ]);
});

test("composer-2.5 with tools null does not inject exec", () => {
  const parsed = parseResponsesRequest({
    model: "composer-2.5",
    tools: null,
    input: "hi",
  });
  expect(parsed.parsed.tools).toEqual([]);
});

test("additional_tools with only wait appends exec", () => {
  const parsed = parseResponsesRequest({
    model: "composer-2.5",
    tools: null,
    input: [
      {
        type: "additional_tools",
        role: "developer",
        tools: [
          {
            type: "function",
            name: "wait",
            description: "Wait",
            parameters: { type: "object", properties: { seconds: { type: "number" } } },
          },
        ],
      },
      { type: "message", role: "user", content: "hello" },
    ],
  });
  expect(parsed.parsed.tools.map((tool) => tool.name)).toEqual(["wait", "exec"]);
  expect(parsed.parsed.tools.find((tool) => tool.name === "exec")).toMatchObject({
    name: "exec",
    wire: "custom",
  });
});

test("additional_tools that already include exec are not duplicated", () => {
  const parsed = parseResponsesRequest({
    model: "gpt-5.6-luna",
    tools: null,
    input: [
      additionalToolsItem,
      { type: "message", role: "user", content: "hello from user" },
    ],
  });
  expect(parsed.parsed.tools.filter((tool) => tool.name === "exec")).toHaveLength(1);
  expect(parsed.parsed.tools).toEqual([
    {
      name: "lookup",
      description: "Look something up",
      input_schema: { type: "object", properties: { q: { type: "string" } } },
    },
    {
      name: "exec",
      description: "Run code in the user workspace",
      input_schema: { type: "object", properties: {} },
      wire: "custom",
    },
  ]);
});

test("top-level type:custom is accepted", () => {
  const parsed = parseResponsesRequest({
    model: "composer-2.5",
    input: "hi",
    tools: [{ type: "custom", name: "exec", description: "Run code in the user workspace" }],
  });
  expect(parsed.parsed.tools).toEqual([
    {
      name: "exec",
      description: "Run code in the user workspace",
      input_schema: { type: "object", properties: {} },
      wire: "custom",
    },
  ]);
});

test("top-level hosted tools still fail closed at parse time", () => {
  try {
    parseResponsesRequest({
      model: "composer-2.5",
      input: "search",
      tools: [{ type: "web_search" }],
    });
    expect.unreachable("expected hosted tool to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({
      code: "invalid_request",
    });
    expect((error as Error).message).toMatch(/web_search/);
  }
});

test("previous_response_id and store=true still fail closed at parse time", () => {
  try {
    parseResponsesRequest({
      model: "composer-2.5",
      previous_response_id: "resp_pretend",
      input: "hi",
    });
    expect.unreachable("expected previous_response_id to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as Error).message).toMatch(/previous_response_id/);
  }

  try {
    parseResponsesRequest({
      model: "composer-2.5",
      store: true,
      input: "hi",
    });
    expect.unreachable("expected store=true to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as Error).message).toMatch(/store=true/);
  }
});

test("text.format json_schema returns a normal text turn", async () => {
  ctx = await startTestApp({
    sdk: { scripts: [[{ type: "text", chunks: ["hello world"] }]] },
  });
  const res = await api(ctx, "/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "composer-2.5",
      input: "hi",
      text: { format: jsonSchemaFormat },
    }),
  });
  const body = (await res.json()) as {
    status: string;
    output: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
  };
  expect(res.status).toBe(200);
  expect(body.status).toBe("completed");
  expect(body.output[0]).toMatchObject({
    type: "message",
    content: [{ type: "output_text", text: "hello world" }],
  });
  expect(ctx.sdk.agents[0]?.lastSend?.text).toContain("user:\nhi");
});

test("text.verbosity medium still returns 200", async () => {
  ctx = await startTestApp({
    sdk: { scripts: [[{ type: "text", chunks: ["ok"] }]] },
  });
  const res = await api(ctx, "/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "composer-2.5",
      input: "hi",
      text: { verbosity: "medium" },
    }),
  });
  expect(res.status).toBe(200);
  expect(ctx.sdk.lastCreate).toBeDefined();
});

test("instruction library is not forwarded; client cwd harness is", async () => {
  ctx = await startTestApp({
    sdk: { scripts: [[{ type: "text", chunks: ["ok"] }]] },
  });
  const res = await api(ctx, "/v1/responses", {
    method: "POST",
    headers: { "X-OpenAI-Internal-Codex-Responses-Lite": "1" },
    body: JSON.stringify({
      model: "composer-2.5",
      instructions: "",
      tools: null,
      reasoning: { effort: "medium", context: "all_turns" },
      input: [
        additionalToolsItem,
        { type: "message", role: "developer", content: officialInstructions },
        { type: "message", role: "developer", content: environmentContext },
        { type: "message", role: "user", content: [{ type: "input_text", text: "list the project files" }] },
      ],
    }),
  });
  expect(res.status).toBe(200);
  expect(ctx.sdk.lastAllowlist).toEqual(["mcp"]);
  const prompt = ctx.sdk.agents[0]?.lastSend?.text ?? "";
  expect(prompt).toContain("/Users/mixi/Downloads/myworks/fairy-tale-studio");
  expect(prompt).toMatch(/caller's machine/i);
  expect(prompt).toMatch(/\bexec\b/);
  expect(prompt).not.toContain("intentionally empty");
  expect(prompt).not.toContain(officialInstructions);
  expect(prompt).not.toContain("<environment_context>");
});

test("additional_tools plus a user message returns 200 and forwards user text", async () => {
  ctx = await startTestApp({
    sdk: { scripts: [[{ type: "text", chunks: ["ok"] }]] },
  });
  const res = await api(ctx, "/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "composer-2.5",
      tools: null,
      input: [
        additionalToolsItem,
        { type: "message", role: "user", content: [{ type: "input_text", text: "hello from user" }] },
      ],
    }),
  });
  expect(res.status).toBe(200);
  expect(ctx.sdk.lastCreate).toBeDefined();
  expect(ctx.sdk.agents[0]?.lastSend?.text).toContain("user:\nhello from user");
  expect(ctx.sdk.lastAllowlist).toEqual(["mcp"]);
});

test("top-level tools web_search still fail closed", async () => {
  ctx = await startTestApp();
  const res = await api(ctx, "/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "composer-2.5",
      input: "search",
      tools: [{ type: "web_search" }],
    }),
  });
  const error = openaiError(await res.json());
  expect([400, 422]).toContain(res.status);
  expect(error.code).toBe("invalid_request");
  expect(error.message).toMatch(/web_search/);
  expect(ctx.sdk.lastCreate).toBeUndefined();
});

test("previous_response_id and store=true still fail closed over HTTP", async () => {
  ctx = await startTestApp();
  const previous = await api(ctx, "/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "composer-2.5",
      previous_response_id: "resp_pretend",
      input: "hi",
    }),
  });
  expect([400, 422]).toContain(previous.status);
  expect(openaiError(await previous.json()).message).toMatch(/previous_response_id/);

  const stored = await api(ctx, "/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "composer-2.5",
      store: true,
      input: "hi",
    }),
  });
  expect([400, 422]).toContain(stored.status);
  expect(openaiError(await stored.json()).message).toMatch(/store=true/);
  expect(ctx.sdk.lastCreate).toBeUndefined();
});

test("malformed text still errors over HTTP", async () => {
  ctx = await startTestApp();
  const res = await api(ctx, "/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "composer-2.5",
      input: "hi",
      text: "nope",
    }),
  });
  const error = openaiError(await res.json());
  expect([400, 422]).toContain(res.status);
  expect(error.code).toBe("invalid_request");
  expect(error.message).toMatch(/text must be an object/);
  expect(ctx.sdk.lastCreate).toBeUndefined();
});

test("gpt-5.6-luna tools null user ls uses mcp allowlist", async () => {
  ctx = await startTestApp({
    sdk: { scripts: [[{ type: "text", chunks: ["ok"] }]] },
  });
  const res = await api(ctx, "/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      tools: null,
      input: [{ type: "message", role: "user", content: "ls" }],
    }),
  });
  expect(res.status).toBe(200);
  expect(ctx.sdk.lastAllowlist).toEqual(["mcp"]);
});

test("additional_tools exec is re-emitted as custom_tool_call", async () => {
  ctx = await startTestApp({
    sdk: {
      scripts: [[{ type: "tools", calls: [{ name: "exec", input: { input: "ls" } }] }]],
    },
  });
  const res = await api(ctx, "/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "composer-2.5",
      tools: null,
      input: [
        additionalToolsItem,
        { type: "message", role: "user", content: [{ type: "input_text", text: "list files" }] },
      ],
    }),
  });
  const body = (await res.json()) as {
    status: string;
    output: Array<{ type: string; name?: string; input?: unknown; arguments?: unknown }>;
  };
  expect(res.status).toBe(200);
  expect(body.status).toBe("completed");
  const call = body.output.find((item) => item.type === "custom_tool_call" || item.type === "function_call");
  expect(call?.type).toBe("custom_tool_call");
  expect(call?.name).toBe("exec");
  expect(typeof call?.input).toBe("string");
  expect(call?.input).toContain("exec_command");
  expect(call?.input).toContain("ls");
  expect(call?.input).not.toBe(JSON.stringify({ input: "ls" }));
  expect(call?.arguments).toBeUndefined();
});

test("encodeCodexExecInput wraps shell strings as code-mode exec_command", () => {
  expect(encodeCodexExecInput("ls")).toBe(`text((await tools.exec_command(${JSON.stringify({ cmd: "ls" })})).output);`);
  expect(encodeCodexExecInput({ command: "ls -la" })).toBe(
    `text((await tools.exec_command(${JSON.stringify({ cmd: "ls -la" })})).output);`,
  );
  expect(encodeCodexExecInput({ input: "ls" })).toBe(`text((await tools.exec_command(${JSON.stringify({ cmd: "ls" })})).output);`);
  expect(encodeCodexExecInput(`await tools.exec_command({ cmd: "pwd" });`)).toBe(
    `await tools.exec_command({ cmd: "pwd" });`,
  );
  expect(encodeCodexExecInput({ command: "ls", cwd: "/Users/mixi/Downloads/myworks/fairy-tale-studio" })).toBe(
    `text((await tools.exec_command(${JSON.stringify({ cmd: "ls", workdir: "/Users/mixi/Downloads/myworks/fairy-tale-studio" })})).output);`,
  );
});

test("encodeCodexExecInput unwraps JSON-string {cmd,workdir} from Cursor exec input", () => {
  const liveCat = JSON.stringify({
    cmd: "cat /workspace/codex-gw-vite/vite.config.js",
    workdir: "/workspace/codex-gw-vite",
  });
  const expectedCat = `text((await tools.exec_command(${JSON.stringify({
    cmd: "cat /workspace/codex-gw-vite/vite.config.js",
    workdir: "/workspace/codex-gw-vite",
  })})).output);`;
  expect(encodeCodexExecInput(liveCat)).toBe(expectedCat);
  expect(encodeCodexExecInput({ input: liveCat })).toBe(expectedCat);
  expect(encodeCodexExecInput({ input: { cmd: "cat /workspace/codex-gw-vite/vite.config.js", workdir: "/workspace/codex-gw-vite" } })).toBe(
    expectedCat,
  );

  const livePatchCmd = [
    "tools.apply_patch <<'PATCH'",
    "*** Begin Patch",
    "*** Add File: /workspace/codex-gw-smoke/phase17-patch.txt",
    "+phase17-apply-ok",
    "*** End Patch",
    "PATCH",
    "cat /workspace/codex-gw-smoke/phase17-patch.txt",
  ].join("\n");
  const livePatch = JSON.stringify({ cmd: livePatchCmd, workdir: "/workspace/codex-gw-smoke" });
  const encoded = encodeCodexExecInput(livePatch);
  expect(encoded).toContain("tools.apply_patch(");
  expect(encoded).toContain("*** Begin Patch");
  expect(encoded).toContain("*** Add File: /workspace/codex-gw-smoke/phase17-patch.txt");
  expect(encoded).toContain("phase17-apply-ok");
  expect(encoded).toContain("cat /workspace/codex-gw-smoke/phase17-patch.txt");
  expect(encoded).not.toContain("apply_patch <<");
  expect(encoded).not.toContain("*** Begin Patch\\\\n");
});

test("encodeCodexExecInput lifts apply_patch heredoc to tools.apply_patch", () => {
  const live = [
    "cd /workspace/codex-gw-smoke && apply_patch <<'PATCH'",
    "*** Begin Patch",
    "*** Update File: a.js",
    "@@",
    "-console.log('hello from a.js');",
    "+console.log('goodbye from a.js');",
    "*** End Patch",
    "PATCH",
    "sed -n '1,20p' a.js",
  ].join("\n");
  const encoded = encodeCodexExecInput(live);
  expect(encoded).toContain("tools.apply_patch(");
  expect(encoded).toContain("*** Begin Patch");
  expect(encoded).toContain("*** Update File: a.js");
  expect(encoded).toContain("tools.exec_command");
  expect(encoded).toContain("sed -n '1,20p' a.js");
  expect(encoded).not.toContain("apply_patch <<");
  expect(encodeCodexExecInput("await tools.apply_patch(`*** Begin Patch\n*** End Patch`);")).toBe(
    "await tools.apply_patch(`*** Begin Patch\n*** End Patch`);",
  );
  expect(encodeCodexExecInput("rg -n '*** Begin Patch' README.txt")).toBe(
    `text((await tools.exec_command(${JSON.stringify({ cmd: "rg -n '*** Begin Patch' README.txt" })})).output);`,
  );
});

test("encodeFunctionCallItem exec uses code-mode JS, not raw JSON", () => {
  const item = encodeFunctionCallItem(
    { type: "tool_use", id: "call_exec_1", name: "exec", input: { command: "ls" } },
    "completed",
    true,
  );
  expect(item.type).toBe("custom_tool_call");
  expect(item.name).toBe("exec");
  expect(typeof item.input).toBe("string");
  expect(item.input).toContain("exec_command");
  expect(item.input).toContain("ls");
  expect(item.input).not.toBe(JSON.stringify({ command: "ls" }));
});

test("encodeFunctionCallItem non-exec custom tools stay unwrapped", () => {
  const item = encodeFunctionCallItem(
    { type: "tool_use", id: "call_other_1", name: "other_custom", input: { input: "ls" } },
    "completed",
    true,
  );
  expect(item.type).toBe("custom_tool_call");
  expect(item.input).toBe("ls");
});

test("gpt-5.6-terra exec {command:ls} emits code-mode custom_tool_call", async () => {
  ctx = await startTestApp({
    sdk: {
      scripts: [[{ type: "tools", calls: [{ name: "exec", input: { command: "ls" } }] }]],
    },
  });
  const res = await api(ctx, "/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      tools: null,
      input: "hi",
    }),
  });
  const body = (await res.json()) as {
    status: string;
    output: Array<{ type: string; name?: string; input?: unknown }>;
  };
  expect(res.status).toBe(200);
  expect(body.status).toBe("completed");
  const call = body.output.find((item) => item.type === "custom_tool_call");
  expect(call?.name).toBe("exec");
  expect(typeof call?.input).toBe("string");
  expect(call?.input).toContain("tools.exec_command");
  expect(call?.input).toContain("ls");
});

function toolResultContent(parsed: ReturnType<typeof parseResponsesRequest>): string {
  for (const message of parsed.parsed.messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === "tool_result") return String(block.content ?? "");
    }
  }
  throw new Error("expected a tool_result");
}

test("custom_tool_call_output stdout maps to tool_result text", () => {
  const parsed = parseResponsesRequest({
    model: "composer-2.5",
    input: [
      { type: "message", role: "user", content: "run it" },
      { type: "custom_tool_call", call_id: "call_exec_out", name: "exec", input: "await tools.exec_command({ cmd: \"ls\" });" },
      {
        type: "custom_tool_call_output",
        call_id: "call_exec_out",
        output: { stdout: "README.md\npackage.json", stderr: "", exit_code: 0 },
      },
    ],
  });
  const content = toolResultContent(parsed);
  expect(content).toContain("README.md");
  expect(content).toContain("package.json");
  expect(content).toContain("exit: 0");
});

test("empty-object output does not wipe a string stdout field", () => {
  expect(encodeCodexToolOutput({ output: {}, stdout: "README.md", exit_code: 0 })).toContain("README.md");
  const parsed = parseResponsesRequest({
    model: "composer-2.5",
    input: [
      { type: "message", role: "user", content: "run it" },
      { type: "custom_tool_call", call_id: "call_exec_empty", name: "exec", input: "await tools.exec_command({ cmd: \"ls\" });" },
      {
        type: "custom_tool_call_output",
        call_id: "call_exec_empty",
        output: {},
        stdout: "README.md",
      },
    ],
  });
  expect(toolResultContent(parsed)).toContain("README.md");
});

test("encodeCodexToolOutput formats Cursor stdout tool_result", () => {
  const encoded = encodeCodexToolOutput({ stdout: "README.md", stderr: "warn", exit_code: 0 });
  expect(encoded).toContain("README.md");
  expect(encoded).toContain("warn");
  expect(encoded).toContain("exit: 0");
  expect(encodeCodexToolOutput({ wall_time_seconds: 10.2, exit_code: 0, output: "3" })).toMatch(/3/);
  expect(encodeCodexToolOutput({ output: "", stdout: "0" })).toBe("0");
});

test("encodeCodexToolOutput unwraps official code-mode content items", () => {
  const listing = "README.txt\na.js\nnotes.md\n\n__COUNT__\n3";
  const items = [
    { type: "input_text", text: "Script completed\nWall time 0.12 seconds\nOutput:\n" },
    {
      type: "input_text",
      text: JSON.stringify({ output: listing, exit_code: 0, wall_time_seconds: 0.12 }),
    },
  ];
  const encoded = encodeCodexToolOutput(items);
  expect(encoded).toContain("README.txt");
  expect(encoded).toContain("3");
  const shape = describeCodexOutputShape(items);
  expect(shape.output_kind).toBe("content_items");
  expect(shape.item_types).toEqual(["input_text", "input_text"]);
  expect(shape.text_empty).toBe(false);
  expect(shape.output_keys).toContain("type");
});

test("code-mode custom_tool_call_output content-item array unwraps nested exec output", () => {
  const listing = "README.txt\na.js\nnotes.md\n\n__COUNT__\n3";
  const parsed = parseResponsesRequest({
    model: "gpt-5.6-terra",
    input: [
      { type: "message", role: "user", content: "list files" },
      {
        type: "custom_tool_call",
        call_id: "call_live_cm",
        name: "exec",
        input: "text((await tools.exec_command({ cmd: \"rg --files\" })).output);",
      },
      {
        type: "custom_tool_call_output",
        call_id: "call_live_cm",
        output: [
          { type: "input_text", text: "Script completed\nWall time 0.12 seconds\nOutput:\n" },
          {
            type: "input_text",
            text: JSON.stringify({
              chunk_id: "c1",
              output: listing,
              exit_code: 0,
              wall_time_seconds: 0.12,
            }),
          },
        ],
      },
    ],
  });
  const content = toolResultContent(parsed);
  expect(content).toContain("README.txt");
  expect(content).toContain("3");
  expect(parsed.parsed.continuation?.[0]?.content).toContain("README.txt");
});

test("code-mode {output, exit_code, wall_time_seconds} object maps to tool_result text", () => {
  const parsed = parseResponsesRequest({
    model: "gpt-5.6-terra",
    input: [
      { type: "message", role: "user", content: "list files" },
      { type: "custom_tool_call", call_id: "call_live_obj", name: "exec", input: "await tools.exec_command({ cmd: \"ls\" });" },
      {
        type: "custom_tool_call_output",
        call_id: "call_live_obj",
        output: { output: "README.txt\na.js\nnotes.md\n\n__COUNT__\n3", exit_code: 0, wall_time_seconds: 0.12 },
      },
    ],
  });
  const content = toolResultContent(parsed);
  expect(content).toContain("README.txt");
  expect(content).toContain("3");
});

test("replayed code-mode custom_tool_call_output listing is visible in the Cursor prompt", async () => {
  ctx = await startTestApp({
    sdk: { scripts: [[{ type: "text", chunks: ["saw the listing"] }]] },
  });
  const listing = "README.txt\na.js\nnotes.md\n\n__COUNT__\n3";
  const res = await api(ctx, "/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      tools: null,
      input: [
        additionalToolsItem,
        { type: "message", role: "user", content: "list files" },
        {
          type: "custom_tool_call",
          call_id: "call_live_hist",
          name: "exec",
          input: "text((await tools.exec_command({ cmd: \"rg --files\" })).output);",
        },
        {
          type: "custom_tool_call_output",
          call_id: "call_live_hist",
          output: [
            { type: "input_text", text: "Script completed\nWall time 0.12 seconds\nOutput:\n" },
            {
              type: "input_text",
              text: JSON.stringify({
                chunk_id: "c1",
                output: listing,
                exit_code: 0,
                wall_time_seconds: 0.12,
              }),
            },
          ],
        },
        { type: "message", role: "user", content: "how many files?" },
      ],
    }),
  });
  expect(res.status).toBe(200);
  const prompt = ctx.sdk.agents[0]?.lastSend?.text ?? "";
  expect(prompt).toContain("[tool_result call_live_hist]");
  expect(prompt).toContain("README.txt");
  expect(prompt).toContain("3");
  expect(prompt).toMatch(/caller's machine/i);
});

test("replayed custom_tool_call_output stdout is visible in the Cursor prompt", async () => {
  ctx = await startTestApp({
    sdk: { scripts: [[{ type: "text", chunks: ["saw the listing"] }]] },
  });
  const res = await api(ctx, "/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      tools: null,
      input: [
        additionalToolsItem,
        { type: "message", role: "user", content: "list files" },
        {
          type: "custom_tool_call",
          call_id: "call_hist_1",
          name: "exec",
          input: "await tools.exec_command({ cmd: \"ls\" });",
        },
        {
          type: "custom_tool_call_output",
          call_id: "call_hist_1",
          output: { stdout: "README.md\npackage.json", exit_code: 0 },
        },
        { type: "message", role: "user", content: "how many files?" },
      ],
    }),
  });
  expect(res.status).toBe(200);
  const prompt = ctx.sdk.agents[0]?.lastSend?.text ?? "";
  expect(prompt).toContain("[tool_result call_hist_1]");
  expect(prompt).toContain("README.md");
  expect(prompt).toContain("package.json");
});


test("encodeCodexExecInput injects default workdir", () => {
  const cwd = "/workspace/codex-gw-vite";
  const encoded = encodeCodexExecInput("ls", cwd);
  expect(encoded).toContain("workdir");
  expect(encoded).toContain(cwd);
});

test("encodeCodexExecInput absolutizes apply_patch paths with default workdir", () => {
  const cwd = "/workspace/codex-gw-vite";
  const lines = [];
  lines.push("apply_patch <<PATCH");
  lines.push("*** Begin Patch");
  lines.push("*** Update File: vite.config.js");
  lines.push("@@");
  lines.push("-port: 5173");
  lines.push("+port: 5003");
  lines.push("*** End Patch");
  lines.push("PATCH");
  lines.push("echo started");
  const patched = encodeCodexExecInput(lines.join("\n"), cwd);
  expect(patched).toContain("tools.apply_patch");
  expect(patched).toContain("/workspace/codex-gw-vite/vite.config.js");
  expect(patched).toContain("echo started");
  expect(patched).toContain("workdir");
  expect(encodeCodexExecInput({ command: "pwd", cwd: "/explicit" }, cwd)).toContain("/explicit");
});

test("environment_context cwd is injected into exec wrap and apply_patch paths", async () => {
  const commandLines = [];
  commandLines.push("apply_patch <<PATCH");
  commandLines.push("*** Begin Patch");
  commandLines.push("*** Update File: vite.config.js");
  commandLines.push("@@");
  commandLines.push("-port: 5173");
  commandLines.push("+port: 5003");
  commandLines.push("*** End Patch");
  commandLines.push("PATCH");
  commandLines.push("echo started");
  const command = commandLines.join("\n");
  ctx = await startTestApp({
    sdk: { scripts: [[{ type: "tools", calls: [{ name: "exec", input: { command } }] }]] },
  });
  const res = await api(ctx, "/v1/responses", {
    method: "POST",
    headers: { "X-OpenAI-Internal-Codex-Responses-Lite": "1" },
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      instructions: "",
      tools: null,
      input: [
        additionalToolsItem,
        { type: "message", role: "developer", content: officialInstructions },
        { type: "message", role: "developer", content: environmentContext },
        { type: "message", role: "user", content: "change vite port" },
      ],
    }),
  });
  const body = (await res.json()) as { status: string; output: Array<{ type: string; name?: string; input?: unknown }> };
  expect(res.status).toBe(200);
  const call = body.output.find((item) => item.type === "custom_tool_call");
  expect(call?.name).toBe("exec");
  expect(String(call?.input)).toContain("tools.apply_patch");
  expect(String(call?.input)).toContain("/Users/mixi/Downloads/myworks/fairy-tale-studio/vite.config.js");
  expect(String(call?.input)).toContain("workdir");
  expect(String(call?.input)).toContain("echo started");
  expect(ctx.sdk.agents[0]?.lastSend?.text ?? "").toContain("/Users/mixi/Downloads/myworks/fairy-tale-studio");
  expect(ctx.sdk.agents[0]?.lastSend?.text ?? "").toMatch(/caller's machine/i);
});

test("clientWorkspaceHarnessLines requires the absolute client path", () => {
  const lines = clientWorkspaceHarnessLines({ cwd: "/workspace/codex-gw-vite", roots: ["/workspace/codex-gw-vite"] }).join("\n");
  expect(lines).toContain("/workspace/codex-gw-vite");
  expect(lines).toMatch(/caller's machine/i);
  expect(lines).not.toContain("intentionally empty");
  expect(lines).not.toContain("HARNESS TOOL CONTEXT");
});

test("pass-through code-mode JS gets default workdir injected", () => {
  const cwd = "/workspace/codex-gw-vite";
  const js = "await tools.exec_command({ cmd: \"pwd\" });";
  expect(encodeCodexExecInput(js, cwd)).toContain(cwd);
  const patchJs = "await tools.apply_patch(\`*** Begin Patch\n*** Update File: vite.config.js\n*** End Patch\`);";
  expect(encodeCodexExecInput(patchJs, cwd)).toContain("/workspace/codex-gw-vite/vite.config.js");
});
