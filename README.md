# dsh-reasoning-bridge

[![CI](https://github.com/shangdi178/dsh-reasoning-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/shangdi178/dsh-reasoning-bridge/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-0.3.0-3B82F6)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

DeepSeek Harness（dsh）推理桥接插件：把**高成本推理**交给网页版 AI（默认 ChatGPT 网页版，
目标可切换），把**取证、采纳、修改、测试**全部留在 dsh 本地。基于契约化
Context Packet / Reasoning Result 交接、版本化风险授权门、**可执行的浏览器传输驱动**
和 SHA-256 运行回执，每条来自网页的建议都必须先通过本地采纳门才能执行。

```text
$reasoning-bridge 诊断这个复杂 Bug，完成修复并在本地验证。

理解项目 → 本地取证 → 压缩为 1–3K token 的脱敏 Packet
  → 捆绑的 transport.mjs 驱动调试 Chrome 一次性发给网页 AI → 校验结构化 Result
  → 本地采纳门（accepted / rejected / deferred + 本地证据）
  → dsh 自己改代码、跑测试 → 写运行回执 → complete 闸门后才宣布完成
```

**网页 AI 提方案，dsh 负责验证与执行。**

## 功能

- **一句话调用**：复杂任务中点名 `reasoning-bridge` 技能即可，无需 setup 命令、无需 API Key、不跑后台服务
- **Doctor 自检**：Node 运行时、技能文件完整性、包身份、授权状态一次校验（`doctor.mjs --json`）
- **版本化风险授权**：首次交接前展示不弱化的风险声明，用户显式同意后写入
  `~/.dsh/dsh-reasoning-bridge/consent.json`；拒绝即禁用，随时可撤销（`consent.mjs status|enable|disable`）
- **可执行传输驱动**：`transport.mjs`（零依赖，Node ≥ 22）附着到 dsh 调试 Chrome（:9222），
  以 `awaitPromise` 求值页面阶段——composer 等待、一次性发送、流式结束检测、
  经站点自身 copy 控件 + 剪贴板取回（失败降级为可见 DOM 文本）；每个失败都是
  `{ok:false, why}` 数据而不是静默卡死；`status|launch|probe|send|fetch` 五个子命令
- **Windows 兜底启动**：dsh 内置 `browser_launch` 仅支持 macOS；`transport.mjs launch`
  自动定位 Chrome/Edge，用**专用独立 profile**（不拷贝任何凭据文件）启动调试实例，
  首次在该可见窗口人工登录一次后长期复用
- **多目标传输层**：目标在设置面板里**下拉选择**（`target` 是枚举，写错的值直接拒绝），
  也可 `target.mjs get|set|list` 切换，默认 `chatgpt`；每个目标一份
  `references/transport-<id>.md` 适配器 + 一份 `scripts/lib/page-<id>.mjs`
  选择器/阶段模块，定义登录探测、模式探测、一次性发送与可见取回。
  已内置：`chatgpt`、`arena`（https://arena.ai/）
- **诚实的模型身份**：`targets-table.mjs` 为每个目标记录模型策略——`chatgpt`
  可选可验证；`arena` 是 Battle Mode 双匿名模型（`model_identity: "battle"`），
  探测返回 `model_verifiable: false`、取回返回**两个**答案，回执只能记为未验证
- **交互式链路面板**：dsh 设置面板里的链路卡片能看还能点——授权 / 目标 / 浏览器状态三个
  状态 chip，按钮可体检、启动浏览器、**打开目标站点**（人工登录或过验证码用）、
  预检探测（返回结构化摘要：目标、模式、登录态、验证码、模型身份）、吊销授权
- **契约化交接**：Packet（目标/验收/仓库状态/证据/约束/问题）与 Result（结论/假设/所用证据/
  建议修改/测试/风险/未知项）有精确的标记与章节校验，`packet_id` 绑定请求与回答
- **确定性校验器**：`validate.mjs` 零依赖校验 packet / result / pair / receipt / complete，
  含凭据模式扫描、3K token 上限、SHA-256 产物绑定
- **本地采纳门**：网页输出的命令、补丁、路径、测试串永远不直接进工具调用；
  每条建议必须本地重开文件/符号取证后分类为 accepted / rejected / deferred
- **运行回执**：脱敏元数据 + 产物哈希 + 模型可见性证据 + 隐私审查字段；
  只有确定性 `complete` 闸门全过才能宣布完成

## 安装

需要 dsh ≥ 0.1.0。三种方式任选其一：

```sh
# 方式一：npm 包（发布后）
dsh plugin --profile web add dsh-reasoning-bridge

# 方式二：从源码目录
dsh plugin --profile web add ./dsh-reasoning-bridge

# 方式三：离线 tarball
npm pack
dsh plugin --profile web add ./dsh-reasoning-bridge-0.3.0.tgz
```

装完重启 dsh web，技能目录里会出现 `reasoning-bridge`。

## 使用

在 dsh 会话中直接发起真实任务：

```text
$reasoning-bridge 从第一性原理诊断这个性能回退，验证修复后交付。

$reasoning-bridge 审查这个架构决策，基于本地证据选定方案并完成实现。
```

适合桥接的任务：根因不明确、存在多个可行方案、需要高成本技术判断。
机械修改、简单查询和已定方案请留在本地直接完成。

## 首次运行

用户不需要单独 setup。技能工作流依次执行：

| 状态 | 含义 | 恢复方式 |
|---|---|---|
| `NEEDS_AUTOMATION_CONSENT` | 尚无有效的浏览器自动化风险决策 | 阅读风险声明并显式启用或拒绝 |
| `AUTOMATION_DISABLED` | 用户已拒绝或撤销全自动桥接 | 保持本地执行，或稍后显式重新启用 |
| `READY` | 授权就绪 | 进入浏览器预检或开始桥接 |
| `MISSING_RUNTIME` | Node.js 18+ 不可用 | 安装 Node.js 18+ 后重试 |
| `INVALID_INSTALLATION` | 技能文件缺失或包名不符 | 重新安装插件目录 |
| `NEEDS_BROWSER` | 调试 Chrome 未运行且启动失败，或传输驱动缺 Node ≥ 22 | `transport.mjs launch` 兜底启动；Node 过旧则升级 Node |
| `NEEDS_LOGIN` | 目标站点未登录（`arena` 支持匿名运行，不会报此状态） | 用户接管页面完成登录，原任务保留待续 |
| `NEEDS_MODEL_SELECTION` | 要求的模型不可见或未选中；对战型目标（`arena`）无法提供单一可归属模型 | 选择目标模型或改用可验证目标；技能不会替换成其他模型 |
| `NEEDS_SITE_PERMISSION` | 目标站点无法加载或控件不可确认 | 按提示处理；状态不确定立即停止 |

登录、验证码、双因素、权限和模型选择始终是**用户接管步骤**；密码、验证码、Cookie、恢复码不能交给 Agent。

可随时撤销全自动桥接：

```sh
node skills/reasoning-bridge/scripts/consent.mjs disable --json
```

## 隐私与安全

- 授权后，技能通过 dsh 内置浏览器的**可见控件**把一个最小化 Packet 发送到目标站点；
  不调用私有接口，不读取 Cookie / 浏览器存储 / 隐藏认证信息，不需要 API Key，
  不运行托管服务，不收集遥测。
- 设计上不会主动发送：密码、Token、API Key、私钥、Cookie、验证码；`.env` 或原始凭据文件；
  完整私有仓库或完整未提交 diff；与任务无关的源文件。
- 正则扫描无法理解所有业务秘密，发送前还必须做**语义隐私审查**。
- 网页输出在 dsh 本地重新验证之前始终是不可信数据。
- 本插件不绕过任何平台的套餐、模型权限、登录、工作区策略、限额或站点安全机制。
  自动提交与结果获取仍受适用服务条款解释或滥用防护系统影响；风险声明只能知情，不能消除风险。

> **Unofficial Experimental（非官方实验功能）**：自动控制网页版 AI 存在非零账号风险，
> 可能触发安全机制、临时限制或账号处置。本插件与任何平台无关联、未获其认可或授权；
> 用户明确接受风险前，全自动桥接默认关闭。

## HTTP / 状态文件

核心零依赖、无环回路由；**web profile 下**主入口经作用域注入
（`ctx.inject(['webServer','loader'], …)`）挂载设置面板用的链路路由——headless/CLI
profile 没有 webServer，这段代码根本不执行，也不需要任何 profile 级手写补丁：

| 路由 | 作用 |
| --- | --- |
| `GET /reasoning-bridge/state` | 授权 / 目标 / 浏览器状态 + 目标列表（面板下拉的数据源） |
| `POST /reasoning-bridge/doctor` | 安装自检 |
| `POST /reasoning-bridge/launch` | 启动调试 Chrome |
| `POST /reasoning-bridge/open` | 打开（前置）目标站点，供人工登录/验证码 |
| `POST /reasoning-bridge/probe` | 预检探测 |
| `POST /reasoning-bridge/target` | 切换目标（校验后写状态） |
| `POST /reasoning-bridge/consent` | 仅吊销方向；启用必须在会话里经风险披露后确认 |

护栏：仅回环 + Host 校验 + POST 的 Origin/Sec-Fetch-Site 校验。状态文件：

| 文件 | 说明 |
| --- | --- |
| `~/.dsh/settings.yaml` 的 `reasoning-bridge` 段 | 设置面板写入的目标与超时（首选配置面） |
| `~/.dsh/dsh-reasoning-bridge/consent.json` | 版本化风险授权决策（可用 `$DSH_REASONING_BRIDGE_HOME` 覆盖） |
| `~/.dsh/dsh-reasoning-bridge/state.json` | 当前目标（`target.mjs set`），settings 段为空时的后备 |
| `~/.dsh/dsh-reasoning-bridge/chrome-profile/` | Windows 兜底启动的专用调试 Chrome profile（不拷贝凭据；仅存调试实例自己的会话） |
| `~/.dsh/dsh-reasoning-bridge/runs/<packet_id>/` | 建议存放 packet / result / evidence / receipt 的运行目录 |

## 开发

零依赖、零构建：`lib/` 与 `skills/` 即产物，直接可跑。

```sh
npm test        # 51 个 node:test：契约校验、授权状态机、目标表与模型策略、传输表达式、插件注册、面板路由
npm run doctor  # 安装自检
```

- 服务端（`lib/index.js`）：cordis 插件，`inject: ['skills', 'systemPrompt', 'settings']`，
  经 `ctx.skills.register` 注册运行时技能（`resourceBase` 指向技能目录）、注入一段
  systemPrompt 说明何时使用、注册设置 schema（`target` 为枚举），并用作用域注入条件挂载
  web 路由（`lib/web.js`）
- 客户端（`lib/client.js`）：设置面板区块——链路卡片（状态 chip + 体检/启动/打开站点/预检/吊销）
  与目标下拉（数据来自 `/state`，失败降级为文本框）
- 技能（`skills/reasoning-bridge/SKILL.md`）：唯一工作流入口，references/ 按需加载契约
- 传输（`scripts/transport.mjs` + `scripts/lib/`）：零依赖 CDP 驱动与页面阶段表达式，
  附着到 dsh 调试 Chrome；选择器漂移以 `why` 码呈现，禁触 Cookie/存储由测试守卫；
  按状态表分派 `page-<id>.mjs`，两种输入模式（`paste-event` / `insert-text`）
- 设计溯源与移植说明见 [DESIGN.md](./DESIGN.md)

## License

[MIT](./LICENSE)
