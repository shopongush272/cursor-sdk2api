# Changelog

## Unreleased

- Outbound assistant/thinking text rewrites standalone Cursor identity mentions to the model family's client: Claude/sonnet/haiku/opus → Claude, GPT/Codex/o-series → Codex, Gemini → Gemini, Grok → Grok. Ambiguous composer models follow the incoming CLI (Claude Code / Codex Lite). No brand → leave Cursor. Paths, @cursor/sdk, and cursor-sdk2api are left alone.

- CCR-style host grounding: write AGENTS.md into the isolated SDK workspace, put host facts at the prompt head and tail, and correct scratch-path tool args (first 3 per session). Soft harness so Sonnet does not treat the client cwd as injection.

- New `src/cursor-sdk-bridge` module (CCR-style bridge mode): Claude Code and Codex Lite client harness/instruction-library prompts stop at the gateway; only client cwd/roots are injected. Cursor built-ins stay denied. Isolated-workspace tool args are rewritten to the client cwd. Future prompt/tool optimizations live in this module.

- Anthropic `/v1/messages` now strips Claude Code CLI system/environment preambles before they reach the Cursor Agent prompt. When client tools are present, a short caller-workspace harness is injected (cwd taken from the stripped env) instead of forwarding the CLI identity novel.

- Codex exec wrap now unwraps Cursor `exec` input when it is a JSON string (or `{input: ...}` wrapper) of `{cmd, workdir}`. Live 0.147 calls were wrapping that JSON as the shell command, so `cat`/`apply_patch` never ran and heredoc newlines stayed escaped.

- Codex exec wrap now injects `<environment_context>` cwd as official `exec_command.workdir` and rewrites relative `apply_patch` file headers to that absolute path (0.147 `tools.apply_patch` is patch-string only; no invented workdir arg). Harness says apply_patch/exec MUST use the client absolute path and never edit the empty SDK cwd.

- Codex exec wrap now lifts a shell `apply_patch` heredoc (`*** Begin Patch` ... `*** End Patch`) to nested `tools.apply_patch`, instead of running a missing `apply_patch` binary via `exec_command`.
- Codex code-mode `custom_tool_call_output` now unwraps the official content-item array (header + JSON `{output, exit_code, wall_time_seconds}`) and `{stdout,stderr}` so follow-up prompts include the listing. Wrapped exec emits `text((await tools.exec_command(...)).output)` so the model-facing result is not header-only. Harness still warns that the SDK cwd is not the project, but a successful exec/tool_result listing is authoritative.
- Codex `custom_tool_call_output` now extracts stdout/stderr/exit (empty `output` objects no longer wipe a string stdout) and history replay keeps that text in the Cursor prompt.
- Cursor exec args are converted to Codex code-mode JS (`await tools.exec_command({ cmd })`).
- Codex Lite requests that arrive without a client `exec` tool now get a synthetic custom `exec` so Cursor can call it and the gateway can emit `custom_tool_call` for the Codex client. Catalog is logged (names/types only).
- Codex Lite developer instruction library + `<environment_context>` (cwd/workspace_roots/permissions) are stripped at the gateway; only client cwd/roots are injected via the short harness. History shell/apply_patch/custom calls convert both ways; hosted tools still fail closed. SDK empty cwd is labeled non-authoritative.
- Responses lifts Codex Lite `additional_tools` `type:custom` (e.g. exec) as client tools and re-emits them as `custom_tool_call` so the outer agent runs them in the caller workspace. Hosted tools still fail closed.
- Responses now accepts Codex/sub2api `text.format` (including `json_schema`), maps `custom_tool_call` / `custom_tool_call_output` onto function tools, and skips other session-only input items (`additional_tools`, `compaction`, unknown types) so resumed Codex sessions no longer 400. Hosted tools in top-level `tools`, `previous_response_id`, and `store=true` still fail closed.

- Anthropic `/v1/messages` now accepts sub2api-style `system`/`developer` (folded into `system`) and `tool`/`function` (mapped to user `tool_result`) roles so those clients no longer 422.
- `/v1/account` now reads current-period spending, remaining included usage, model-family percentages, plan metadata, and limits through Cursor Dashboard using the same User API Key, without Cookie or Team Admin credentials. Missing usage remains a partial response rather than a fabricated zero quota.
- Added authenticated `/v1/messages/count_tokens` as an explicitly marked local estimate for Claude Code context management; it never starts an SDK run or participates in billing.

- Operator Console now uses BF Labs UI tokens, Button/Tabs/Notice/Reveal motion (entry, hover lift, orange progress pulse) with reduced-motion support. Console density is preserved; marketing-card invert is not used.
- Console motion follow-through: overview CountUp, copy toast plus button flash, and a sliding rail indicator that follows the current page.
- Failed requests now log the concrete `invalid_request` reason (redacted) next to `error_type`.
- Operator Console and README pin client-to-endpoint recipes: Claude Code → Messages, Grok Build → Responses, OpenAI SDK → Chat. Console documents that outer-agent file tools stay local.
- Responses `include` is accepted and not expanded so Grok Build's Responses backend can connect. `previous_response_id`, `store=true`, conversation, and hosted tools still fail closed.
- Responses usage always includes `input_tokens_details` and `output_tokens_details` so strict clients (Grok Build) can deserialize the object.
- Responses now accepts Grok's named-function/required tool choice, preserves full-history tool continuation, reports SDK reasoning usage, and keeps client-side tool paths anchored to the caller workspace instead of the internal SDK cwd.
- Pending tool turns can recover after a gateway crash through persisted Agent lineage + `Agent.resume` + `local.force=true`; exact identity/catalog/result-batch checks and duplicate-same singleflight remain fail closed on conflict.
- `/v1/chat/completions` protocol adapter over the existing Anthropic `ParsedMessages` run engine. Contract-tested text, OpenAI SSE, function tools, continuation, replay, deferred and cache-aware usage, images, and OpenAI error shapes.
- `/v1/responses` protocol adapter over the same run engine. Contract-tested non-stream text, Responses SSE lifecycle, reasoning, base64 `input_image`, function tools, same-turn parallel calls, `function_call_output` continuation by `call_id`, duplicate-same replay, deferred/final cache-aware usage, `reasoning_effort` / `cursor_model_params`, and Responses-shaped errors. `previous_response_id`, `store=true`, background, conversation, include expansions, and hosted built-in tools fail closed. Operator Console includes a Responses playground tab.
- Optional BF Labs Operator Console at `/console/`, bundled as static Vite assets and served by the existing Node process. It includes health, model/account reads, Messages/Chat/Responses playground, connection snippets, English/Chinese, and light/dark modes. Keys remain in page memory only.

## 0.1.0

- Standard HTTP(S) `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` support for both official SDK data planes. Proxied Agent runs switch to HTTP/1.1 through `proxy-agent`; catalog/account fetches use Undici's environment dispatcher; direct runs retain HTTP/2. SOCKS/PAC fails closed. Health exposes only the boolean plus Agent/fetch transport modes.
- Claude tool-batch debounce raised from 100ms to 1500ms after live callback timing showed same-turn callbacks up to 1189ms apart. Sonnet 4.6 and Fable 5 then passed the full 18-case proxied matrix, including parallel tools, cache reads/writes, completed resume, and Fable Claude Code shape.
- Review fixes: empty-turn only after `run.wait()`, strict SSE block order, per-boundary delta replay, native `isError` tool results, bounded expired tool IDs with periodic sweep, follow-up toolIndex reset.
- Streaming uses official `SendOptions.onDelta` (`text-delta` / `thinking-delta`); `run.stream()` stays single-consumer for tool/status/terminal.
- Completed Agent lineage on credential-partitioned official `JsonlLocalAgentStore` directories (`STATE_DIR/sdk-store/<fingerprint>`) plus owner-only lineage metadata. Health reports `agent_resume=true`, `pending_tool_restart_resume=false`, `store_backend=jsonl`. Duplicate-same after restart is `session_lost` (digest only).
- Active-run limits apply to create, completed follow-up, and persisted resume. Drain still accepts awaiting `tool_result`.

- Repository bootstrap and MIT license.
- `/health`, `/v1/models`, `/v1/account`, `/v1/messages`.
- Anthropic non-stream and SSE text.
- In-process session broker for single, parallel, and multi-round client tools.
- Honest models/account degradation and final-only usage confirmation.
