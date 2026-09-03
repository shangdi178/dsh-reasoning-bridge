# DESIGN — 设计溯源

本插件是一次有明确出处的组合式设计，不是闭门造车。三个来源、三种角色：

## 1. [codex-bridge-chatgpt](https://github.com/anightmonarch/codex-bridge-chatgpt)（MIT）— 机制蓝本

职责拆分哲学原样保留：**网页 AI 提方案，本地 Agent 验证、修改、测试**。以下机制自该项目移植并适配 dsh（代码为本项目原创 MIT 实现，字段命名按 dsh 语境调整）：

| 机制 | 原项目 | 本项目 |
| --- | --- | --- |
| Context Packet 契约（标记 + 六章节 + 3K token 上限） | `validate-handoff.mjs` | `validate.mjs`（同构移植，新增 gitlab/slack token 模式） |
| Reasoning Result 契约（七章节 + packet_id 绑定） | 同上 | 同上 |
| 本地采纳门（accepted / rejected / deferred + 本地证据） | references/ + SKILL.md | `references/adoption-gate.md` |
| 运行回执（schema_version 2 + 哈希绑定 + 隐私审查字段） | `codex_model` / `chatgpt_model` | `local_model` / `web_model`，新增 `target` 字段 |
| complete 闸门（全字段 passed + 产物哈希重算） | 同上 | 同上 |
| 版本化风险授权状态机（disclosure_version + 精确确认令牌 + 原子写） | `automation-consent.mjs` | `consent.mjs`（确认令牌与状态路径改为 dsh 约定） |
| Doctor 分层预检（安装层 → 授权层 → 浏览器层） | `doctor.mjs` + references/doctor.md | `doctor.mjs` + `references/doctor.md` |
| 传输纪律：只发一次、不确定即停、可见取回、不碰私有端点 | browser-transport.md | `references/transport.md` + 各目标适配器 |

核心差异是**传输层**：原项目依赖 Codex 桌面 App 的 in-app Browser；dsh 本身内置
CDP 浏览器工具（`browser_launch` 复用日常 Chrome 登录态），登录问题天然缓解，
因此预检简化为 `NEEDS_BROWSER / NEEDS_LOGIN / NEEDS_MODEL_SELECTION / NEEDS_SITE_PERMISSION`，
并把"只许 in-app Browser"改写为"只许 dsh 内置调试实例、只做用户可见等价操作"。

## 2. [ShunCode](https://github.com/ZS520L/shuncode) — 设计理念参照

ShunCode（README-only 理念仓库）对本项目的影响是取向而非代码：

- **桥接复用网页订阅**：不把网页 AI 当复制粘贴对象，而是受控、契约化的协作方；
  ShunCode 用 MCP Bridge 把本地工作区暴露给网页 AI，本项目选择反方向——
  浏览器把 Packet 推给网页 AI、把结论带回本地验证（无需公网隧道，攻击面更小）。
- **权限分层**：Ask / Plan / Code 的分层思想体现在 consent → preflight → adoption
  三道门上：未授权不碰浏览器，未预检不发 Packet，未过采纳门不动仓库。
- **按需上下文**：Packet 只装"会改变决策的信息"，默认摘要、必要时最小摘录，
  与 ShunCode 的上下文经济原则一致。
- **安全边界白纸黑字**：环回/最小化/脱敏/免责声明不弱化，回执可审计但明确
  "哈希只绑定本地产物，不是远端模型证明"。

## 3. dsh 插件体系 — 宿主事实

- 技能注册：`ctx.skills.register(...)`（`@deepseek-ai/dsh-skill` 运行时技能，
  `resourceBase: { kind: 'directory' }` 让 references/scripts 随技能目录解析）
- 提示注入：`ctx.systemPrompt.section(...)`；生命周期：`ctx.effect(fn, label)`
  （与 `dsh-vision` 插件同款用法）
- 打包分发：`dsh.plugin.json` + `dsh plugin --profile web add <dir|tgz|npm>`
- 零依赖、零构建：`lib/` + `skills/` 即产物（`dsh-versions` 先例），全部确定性逻辑
  用 node:test 覆盖

## 何时扩展新目标

新增一个网页 AI 目标 = `scripts/target.mjs` 的 `TARGETS` 表加一行 +
`validate.mjs` 的 `TARGET_IDS` 加一个 id + `references/transport-<id>.md`
按适配器契约写清登录探测 / 模型校验 / 一次性发送 / 可见取回 / 阻断态 / 证据。
Packet、Result、采纳门、回执契约不需要任何改动。
