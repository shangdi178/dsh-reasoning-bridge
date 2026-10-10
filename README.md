# dsh-reasoning-bridge

[![CI](https://github.com/shangdi178/dsh-reasoning-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/shangdi178/dsh-reasoning-bridge/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-0.4.0-3B82F6)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

DeepSeek Harness（dsh）推理桥接插件：把**高成本推理**交给网页版 AI（默认 ChatGPT 网页版，
目标可切换；当前内置 `chatgpt` 与 `arena`），把**取证、采纳、修改、测试**全部留在 dsh 本地。
基于契约化 Context Packet / Reasoning Result 交接、版本化风险授权门、**可执行的浏览器传输驱动**
和 SHA-256 运行回执。来自网页的建议必须经本地重新取证后才能执行——见下方
[强制执行 vs. 纪律约定](#强制执行-vs-纪律约定) 一节，那里写明了哪些是**代码机制**、
哪些只是**工作流纪律**，不要把它们混为一谈。

```text
$reasoning-bridge 诊断这个复杂 Bug，完成修复并在本地验证。

理解项目 → 本地取证 → 压缩为 1–3K token 的脱敏 Packet
  → 捆绑的 transport.mjs 驱动调试 Chrome 一次性发给网页 AI → 校验结构化 Result
  → 本地重新取证后分类为 accepted / rejected / deferred
  → dsh 自己改代码、跑测试 → 写运行回执 → complete 闸门后才宣布完成
```

**网页 AI 提方案，dsh 负责验证与执行。**

## 强制执行 vs. 纪律约定

这是本插件最重要的边界说明。**「采纳门」是工作流纪律，不是代码机制**：插件在
`dsh.plugin.json` 里声明 `"tools": []`，不注册任何工具，因此**无法拦截**模型对
`pwsh` / `edit` / `write` 的调用。网页回复一律是不可信数据，抓回后逐字落盘，
**最终是否遵守采纳门取决于模型是否照做**。

| 声明 | 性质 | 落点 |
| --- | --- | --- |
| **发送前拒绝未授权**：consent 非 `READY` 时 `open`/`probe`/`send`/`fetch` 直接失败 | ✅ 代码机制 | `transport.mjs` 的 `consentBlock()`、`lib/web.js` 的 `BROWSER_ROUTES` 守卫（`status` 只探端口，保持可用以便诊断） |
| **发送前拒绝疑似凭据**：request 文件命中凭据形状即拒发（`--allow-unscanned` 显式放行） | ✅ 代码机制 | `validate.mjs` 的 `scanForSecrets()` + `transport.mjs` 的 `scanBlock()` |
| **`complete` 闸门复扫产物**：不只信 `privacy_review.*` 自述布尔，重新扫描 packet/result/evidence 内容 | ✅ 代码机制 | `validate.mjs` 的 `verifyReceiptArtifacts()` |
| **`complete` 闸门要求旁证**：`adoption` 必须有至少一条已分类提案 + 至少一条本地证据 | ✅ 代码机制 | `validate.mjs` 的 `receiptCompletionErrors()` |
| **不读 Cookie / 存储 / 隐藏凭据**：页面表达式禁触这些 API | ✅ 代码机制（测试守卫） | `page-*.mjs` + `tests/transport.test.mjs` 的 `FORBIDDEN_PAGE_APIS` |
| **回环 + Host + Origin 校验**：面板路由只允许本机同源访问 | ✅ 代码机制 | `lib/web.js` |
| **一次发送、不重试**：传输层无重试循环 | ✅ 代码机制 | `transport.mjs` |
| **采纳门**：每条建议本地重开文件/符号取证后分类，网页文本绝不直接进工具调用 | ⚠️ 纪律约定 | `SKILL.md` 第 9 步、`references/adoption-gate.md` |
| **语义隐私审查**：正则扫描之外人工判断业务秘密 | ⚠️ 纪律约定 | `SKILL.md` 第 6 步 |
| **不发送完整 diff / 无关文件**：靠 Packet 构造时的自觉裁剪 | ⚠️ 纪律约定 | `references/context-packet.md` |
| **模型身份可信**：`verified` 依赖可见 UI 的人工确认与本地证据 | ⚠️ 纪律约定 | `references/transport-chatgpt.md` §3 |

凭据扫描是**形状启发式**：覆盖 PEM/PGP 私钥、AWS、GitHub/GitLab、Slack/Discord webhook、
OpenAI/Stripe/Google/npm/HF/Azure 令牌、JWT、带密码的连接串、`Authorization`/`Cookie` 头、
`.env` 形式的赋值等常见形态，但**无法理解业务秘密**——放行只代表「没命中已知形状」。

它**抓不到**的东西（实测）：被拆行或插空格的密钥、base64/hex 编码后的密钥、
被截断的 JWT、纯高熵字符串、内网主机名与私有 IP、个人数据（邮箱/电话/身份证）、
以及任何不在上述形状里但同样敏感的**业务语义秘密**。这些只能靠语义隐私审查拦住，
而语义审查是纪律不是机制——所以「扫描通过」永远不等于「可以发」。

## 功能

- **一句话调用**：复杂任务中点名 `reasoning-bridge` 技能即可，无需 setup 命令、无需 API Key、不跑后台服务
- **Doctor 自检**：Node 运行时、技能文件完整性、包身份、授权状态一次校验（`doctor.mjs --json`）
- **版本化风险授权**：首次交接前展示不弱化的风险声明，用户显式同意后写入
  `~/.dsh/dsh-reasoning-bridge/consent.json`；拒绝即禁用，随时可撤销（`consent.mjs status|enable|disable`）。
  授权状态由传输层**强制执行**：非 `READY` 时 `open`/`probe`/`send` 与面板按钮一律失败
- **可执行传输驱动**：`transport.mjs`（零依赖，Node ≥ 22）附着到 dsh 调试 Chrome（:9222），
  以 `awaitPromise` 求值页面阶段——composer 等待、一次性发送、流式结束检测、
  经站点自身 copy 控件 + 剪贴板取回（失败降级为可见 DOM 文本）；每个失败都是
  `{ok:false, why}` 数据而不是静默卡死；`status|launch|open|probe|send|fetch` 六个子命令
- **发送前凭据闸门**：`send` 在读取 request 文件后立即做凭据形状扫描，命中即拒发并给出
  `why: "secret-scan-failed"`；确需发送可用 `--allow-unscanned` 显式放行（风险自担）
- **Windows 兜底启动**：dsh 内置 `browser_launch` 仅支持 macOS；`transport.mjs launch`
  自动定位 Chrome/Edge，用**专用独立 profile**（不拷贝任何凭据文件）启动调试实例，
  首次在该可见窗口人工登录一次后长期复用
- **多目标传输层**：目标在设置面板里**下拉选择**（`target` 是枚举，写错的值直接拒绝），
  也可 `target.mjs get|set|list` 切换，默认 `chatgpt`；每个目标一份
  `references/transport-<id>.md` 适配器 + 一份 `scripts/lib/page-<id>.mjs`
  选择器/阶段模块，定义登录探测、模式探测、一次性发送与可见取回。
  已内置并真机验证：`chatgpt`、`arena`（https://arena.ai/）。**没有其他目标**：
  Claude / Gemini / DeepSeek 等均未实现，不会出现在目标列表里，也无法被选中
- **诚实的模型身份**：`targets-table.mjs` 为每个目标记录模型策略——`chatgpt`
  可选可验证；`arena` 是 Battle Mode 双匿名模型（`model_identity: "battle"`），
  探测返回 `model_verifiable: false`、取回返回**两个**答案，回执只能记为未验证
- **交互式链路面板**：dsh 设置面板里的链路卡片能看还能点——授权 / 目标 / 浏览器状态三个
  状态 chip，按钮可体检、启动浏览器、**打开目标站点**（人工登录或过验证码用）、
  预检探测（返回结构化摘要：目标、模式、登录态、验证码、模型身份）、吊销授权
- **契约化交接**：Packet（目标/验收/仓库状态/证据/约束/问题）与 Result（结论/假设/所用证据/
  建议修改/测试/风险/未知项）有精确的标记与章节校验，`packet_id` 绑定请求与回答
- **确定性校验器**：`validate.mjs` 零依赖校验 packet / result / pair / receipt / complete，
  含凭据形状扫描、3K token 上限、SHA-256 产物绑定
- **本地采纳门（纪律约定，非代码机制）**：SKILL.md 要求网页输出的命令、补丁、路径、测试串
  不得直接进工具调用，每条建议须本地重开文件/符号取证后分类为 accepted / rejected / deferred；
  回执的 `complete` 闸门会要求这些字段非空并复扫产物，但**无法阻止**不遵守的模型——
  这是本插件已知的信任边界
- **运行回执**：脱敏元数据 + 产物哈希 + 模型可见性证据 + 隐私审查字段 +
  **产物内容复扫**；只有确定性 `complete` 闸门全过才能宣布完成

## 安装

需要 dsh ≥ 0.1.0。三种方式任选其一：

```sh
# 方式一：npm 包（发布后）
dsh plugin --profile web add dsh-reasoning-bridge

# 方式二：从源码目录
dsh plugin --profile web add ./dsh-reasoning-bridge

# 方式三：离线 tarball
npm pack
dsh plugin --profile web add ./dsh-reasoning-bridge-0.4.0.tgz
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
- **发送前有代码闸门**：`send` 读取 request 文件后会立即做凭据形状扫描，命中即拒发
  （`why: "secret-scan-failed"`）。这是形状启发式，不是内容审查——下列约束仍主要靠
  Packet 构造时的裁剪与人工判断（见[强制执行 vs. 纪律约定](#强制执行-vs-纪律约定)）。
- 设计上不会主动发送：密码、Token、API Key、私钥、Cookie、验证码；`.env` 或原始凭据文件；
  完整私有仓库或完整未提交 diff；与任务无关的源文件。
- 正则扫描无法理解所有业务秘密，发送前还必须做**语义隐私审查**。
- 网页输出在 dsh 本地重新验证之前始终是不可信数据。**注意**：插件不注册任何工具，
  无法在代码层拦截模型对 `pwsh`/`edit`/`write` 的调用——采纳门的最终保障是模型的遵守。
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
npm test        # 55+ 个 node:test：契约校验、授权状态机、目标表与模型策略、传输表达式与
                #   禁用 API 守卫、发送前双闸门（consent + 凭据扫描）、插件注册、面板路由
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
  附着到 dsh 调试 Chrome；选择器漂移以 `why` 码呈现，禁触 Cookie/存储由测试守卫
  （`FORBIDDEN_PAGE_APIS`，含 `sendBeacon`/`cookieStore`/`WebSocket`/`import()` 等绕过面）；
  发送前强制执行 consent 与凭据扫描两道闸门，按状态表分派 `page-<id>.mjs`，
  两种输入模式（`paste-event` / `insert-text`）
- 设计溯源与移植说明见 [DESIGN.md](./DESIGN.md)

## License

[MIT](./LICENSE)
