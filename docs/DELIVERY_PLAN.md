# cursor-sdk2api 公开路线图

## 1. Alignment Snapshot

本路线图说明如何通过一个独立、MIT 许可、可直接部署的 HTTP 网关，把官方 `@cursor/sdk` Harness 转换为 Anthropic 和 OpenAI 兼容 API。

### Building

- 公开仓库：`Sunnyender-org/cursor-sdk2api`。
- 官方 `@cursor/sdk` 是唯一 Cursor 执行引擎。
- 独立网关，可直接供 Claude Code、OpenCode、Codex、SDK 和其他 HTTP 客户端使用。
- Anthropic Messages-first，随后增加 OpenAI Chat Completions 和 Responses。
- 原生 streaming、thinking、images、single/parallel tools、tool continuation、replay、usage 与 cache 字段。
- SDK Agent 生命周期、Store、resume、取消、超时、会话排空和清晰的进程重启语义。
- Docker-first 发布，并为 new-api 提供外部网关集成面。
- 可选的同进程 BF Labs Operator Console，用于健康检查、模型/账号读取、连接配置与协议测试。

### Not Building

- 不实现用户充值、计费、分组、跨供应商渠道调度或多租户管理后台；仅保留 Cursor 凭据池与统一网关 Key。
- 不逆向 Cursor 私有 H2、ConnectRPC、浏览器 Cookie 或 IDE OAuth 会话。
- 不把 Node.js 或 `@cursor/sdk` 内嵌进 new-api 主进程。
- 不默认开放 Cursor 的 shell、read、edit、task、web 或项目 settings。

## 2. Product Definition

### 2.1 Positioning

> `cursor-sdk2api` turns the official Cursor SDK harness into Anthropic- and OpenAI-compatible APIs with native streaming, thinking, parallel tools, continuation, replay, model discovery, and explicit session semantics.

它不是 Cursor 私有接口反代，也不是通用多供应商网关。它是一个窄而深的 Cursor SDK protocol gateway，类似 CPA 的独立部署形态，但执行层完全依赖官方 SDK。

### 2.2 Target Users

1. 想通过 Claude Code 使用 Cursor 模型和 Harness 的开发者。
2. 想通过 OpenAI/Anthropic SDK、curl 或自动化系统调用 Cursor 模型的团队。
3. 希望把 Cursor 作为 provider 接入 new-api、one-api 或内部网关的运维者。
4. 需要自托管、BYOK、模型发现和稳定工具续轮的基础设施维护者。

### 2.3 User Jobs

- 用一把统一网关 Key 启动服务，导入一个或多个 Cursor API Key，并看到账号池的实时模型目录。
- 将 Claude Code 的 base URL 指向网关，完成多轮和工具任务。
- 让多个客户端以标准 Messages、Chat 或 Responses 协议使用同一套 Cursor 模型。
- 部署在 Docker 中，查看 health、能力位和无敏感信息的运行指标。
- 将网关作为 new-api 的外部 Cursor SDK 渠道，而不是在 new-api 内运行 Node SDK。

### 2.4 Success Metrics

- v0.1 六模型/协议核心矩阵无空成功：所有终止响应必须有文本、结构化工具调用或显式错误。
- single 和 parallel tool continuation 的结果 ID、顺序、错误和 replay 均有 deterministic contract test。
- 网关自身事件转发开销 p95 不超过 100 ms；该指标不含上游模型推理时间。
- 第一条 SDK text/thinking delta 到客户端对应 SSE delta 的转发延迟 p95 不超过 100 ms。
- 默认日志和测试 artifact 中 API Key、Bearer Token、Cookie、工具原始参数和工具原始结果泄漏数为 0。
- 发布镜像能在干净 Linux Docker 环境独立启动，不依赖其他项目的文件、数据库或网络。

## 4. Product Principles

1. **Official SDK only**：协议、模型、工具与 Agent 生命周期只通过公开 SDK。
2. **API semantics first**：客户端工具由客户端执行；默认不让 Cursor Harness 额外操作文件或 shell。
3. **Fail closed**：无内容终止、未知 tool ID、身份变化、会话丢失和 usage 不确定都不能伪装成功。
4. **One live run, one owner**：同一个工具会话在任一时刻只有一个 worker 拥有 SDK Run。
5. **No duplicate side effects**：重试和 replay 必须按 request/tool result digest 幂等。
6. **Evidence before claims**：fixture 只证明转换逻辑；真实模型兼容必须由使用专用测试凭据的 live matrix 证明。
7. **Small core, optional scale**：单实例是默认产品；多实例能力通过明确接口增量加入。

## 5. Runtime Profiles

### 5.1 API Compatibility Profile — v0.1 Default

适用于 `/v1/messages`、后续 `/v1/chat/completions` 和 `/v1/responses`。

- SDK 是唯一推理执行器。
- 请求 `tools[]` 动态映射为 `local.customTools`。
- SDK tool surface 限制为 MCP/customTools。
- 默认禁用 `shell`、`read`、`edit`、`task`、`webSearch`、`webFetch`。
- `settingSources: ["project"]` when host grounding is present (isolated workspace AGENTS.md only); otherwise `[]`. user/team/mdm stay off.
- 使用空 workspace；不把调用者仓库、环境变量或文件系统隐式传给 Cursor。
- Claude Code/OpenCode/Codex 是外层 Agent；Cursor Harness 负责模型推理和工具选择。
