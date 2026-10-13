window.__ModuleLoader__.load({
	id: "dsh-reasoning-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const h = react.createElement;

		//#region styles
		const css = ".rb_section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}.rb_head h3{margin:0;font-size:13px;font-weight:600;line-height:20px}.rb_note{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin:0}.rb_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;padding:12px;flex-direction:column;gap:10px;display:flex}.rb_row{align-items:center;gap:10px;display:flex}.rb_name{font-size:13px;font-weight:500;flex:none;width:180px;overflow-wrap:anywhere}.rb_hint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;flex:1}.rb_input{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font:inherit;font-size:12px;border-radius:6px;padding:3px 8px;width:120px;flex:none}.rb_input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}.rb_check{width:15px;height:15px;accent-color:var(--dsw-alias-state-business-primary);flex:none}.rb_status{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}.rb_status[data-error=true]{color:var(--dsw-alias-state-error-primary)}.rb_saved{color:var(--dsw-alias-state-success-primary);font-size:11px;flex:none}.rb_btn{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:0 0;font:inherit;cursor:pointer;border-radius:6px;padding:4px 14px;flex:none}.rb_btn:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary)}.rb_btn:disabled{opacity:.5;cursor:default}.rb_btn[data-danger=true]{border-color:var(--dsw-alias-state-warning-primary);color:var(--dsw-alias-state-warning-primary)}.rb_chip{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:16px;display:inline-block;white-space:nowrap}.rb_chip[data-kind=ok]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}.rb_chip[data-kind=warn]{border-color:var(--dsw-alias-state-warning-primary);color:var(--dsw-alias-state-warning-primary)}.rb_chip[data-kind=off]{opacity:.75}.rb_pre{margin:0;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:16px;white-space:pre-wrap;word-break:break-all;overflow:auto;max-height:220px;color:var(--dsw-alias-label-secondary)}";
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin="dsh-reasoning-bridge"]') === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-reasoning-bridge";
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		const NS = "reasoning-bridge";
		const zh = {
			nav: "Reasoning Bridge",
			title: "Reasoning Bridge（把高成本推理交给网页版 AI）",
			desc: "这些参数控制浏览器 transport 的等待与超时；修改即保存到 ~/.dsh/settings.yaml 的 reasoning-bridge 段，脚本与技能立即读取。",
			statusLoading: "正在读取设置…",
			statusUnavailable: "设置服务暂不可用（仅本机回环页面可编辑）。",
			statusError: "读取设置失败。",
			fieldTarget: "目标站点",
			hintTarget: "推理交接的网页 AI 目标（可选项来自 targets-table：站点与模型身份策略）。",
			btnOpen: "打开目标站点",
			openHint: "在可见窗口里完成人工步骤（登录 / 验证码 / 选模型），完成后点「预检探测」。",
			targetPicker: "选择目标",
			targetPickerHint: "列出所有已支持目标；Arena 等对战站点无法验证具体模型，回执会记为未验证。",
			probeSummary: "预检摘要",
			probeTarget: "目标",
			probeMode: "模式",
			probeLogin: "登录态",
			probeCaptcha: "验证码",
			probeModel: "模型身份",
			stateLoggedIn: "已登录",
			stateLoggedOut: "未登录",
			statePresent: "存在（需人工处理）",
			stateAbsent: "无",
			modelSelectable: "可选可验证",
			modelBattle: "对战双答（不可验证）",
			modelUnknown: "未知",
			fieldComposerWait: "composer 等待 (ms)",
			hintComposerWait: "发送阶段：等待输入框出现的最长时间。",
			fieldSendWait: "发送按钮等待 (ms)",
			hintSendWait: "发送阶段：粘贴后等待可见发送控件的最长时间。",
			fieldUrlWait: "用户回合等待 (ms)",
			hintUrlWait: "发送阶段：点击发送后等待用户回合出现的最长时间。",
			fieldAppearTimeout: "回复出现超时 (ms)",
			hintAppearTimeout: "取回阶段：等待助手消息出现的最长时间。",
			fieldStreamTimeout: "流式完成超时 (ms)",
			hintStreamTimeout: "取回阶段：等待回复流式结束的上限。",
			fieldStability: "稳定窗口 (ms)",
			hintStability: "取回阶段：页面保持不变多久才认为回复完成。",
			fieldCheckRuntime: "检查 Node 运行时",
			hintCheckRuntime: "Node < 22 时拒绝运行 transport 驱动（依赖原生 WebSocket）；仅实验时关闭。",
			linkTitle: "链路状态（本地会话 ↔ 浏览器）",
			chipConsent: "授权",
			chipTarget: "目标",
			chipBrowser: "浏览器",
			browserRunning: "运行中 (9222)",
			browserStopped: "未启动",
			consentNeeds: "待决定",
			consentReady: "已启用",
			consentDisabled: "已禁用",
			consentUnknown: "未知",
			btnDoctor: "体检",
			btnLaunch: "启动浏览器",
			btnProbe: "预检探测",
			btnRevoke: "吊销授权",
			linkHint: "「启用授权」只在会话里发生：对话中让模型加载 reasoning-bridge 技能，它会展示风险披露并问你一次。启动浏览器后在该可见窗口人工登录一次 ChatGPT，预检显示 READY 即链路就绪。",
			probeReady: "预检通过（READY）——链路就绪，可以在会话里派任务了",
			probeBlocked: "预检受阻（见下方详情），按提示人工处理后重试",
			revokeHint: "吊销后自动化停用，插件不再触碰浏览器；重新启用需回到会话重新确认。",
		};
		const en = {
			nav: "Reasoning Bridge",
			title: "Reasoning Bridge (hand high-cost reasoning to a web AI)",
			desc: "These parameters control the browser transport's waits and timeouts; every change is saved to the reasoning-bridge section of ~/.dsh/settings.yaml and read live by the scripts and skill.",
			statusLoading: "Loading settings…",
			statusUnavailable: "Settings service unavailable (editable on loopback pages only).",
			statusError: "Failed to load settings.",
			fieldTarget: "Target site",
			hintTarget: "Web AI target for the reasoning handoff (options come from targets-table: site and model-identity policy).",
			btnOpen: "Open target site",
			openHint: "Complete the human step (sign in / CAPTCHA / model pick) in the visible window, then run the preflight probe.",
			targetPicker: "Choose target",
			targetPickerHint: "Every supported target is listed; battle-style sites (Arena) cannot verify which model answered, so the receipt records an unverified model.",
			probeSummary: "Preflight summary",
			probeTarget: "Target",
			probeMode: "Mode",
			probeLogin: "Login",
			probeCaptcha: "CAPTCHA",
			probeModel: "Model identity",
			stateLoggedIn: "signed in",
			stateLoggedOut: "signed out",
			statePresent: "present (human step needed)",
			stateAbsent: "none",
			modelSelectable: "selectable / verifiable",
			modelBattle: "battle pair (unverifiable)",
			modelUnknown: "unknown",
			fieldComposerWait: "Composer wait (ms)",
			hintComposerWait: "Send phase: longest wait for the chat composer to appear.",
			fieldSendWait: "Send control wait (ms)",
			hintSendWait: "Send phase: longest wait for a visible send control after pasting.",
			fieldUrlWait: "User turn wait (ms)",
			hintUrlWait: "Send phase: longest wait for the user turn to appear after sending.",
			fieldAppearTimeout: "Reply appear timeout (ms)",
			hintAppearTimeout: "Fetch phase: longest wait for the assistant message to appear.",
			fieldStreamTimeout: "Stream finish timeout (ms)",
			hintStreamTimeout: "Fetch phase: upper bound on waiting for the reply to finish streaming.",
			fieldStability: "Stability window (ms)",
			hintStability: "Fetch phase: how long the page must stay unchanged before the reply counts as done.",
			fieldCheckRuntime: "Check Node runtime",
			hintCheckRuntime: "Refuse to run the transport driver on Node < 22 (native WebSocket); disable only for experiments.",
			linkTitle: "Link status (local chat ↔ browser)",
			chipConsent: "Consent",
			chipTarget: "Target",
			chipBrowser: "Browser",
			browserRunning: "running (9222)",
			browserStopped: "not started",
			consentNeeds: "undecided",
			consentReady: "enabled",
			consentDisabled: "disabled",
			consentUnknown: "unknown",
			btnDoctor: "Doctor",
			btnLaunch: "Launch browser",
			btnProbe: "Preflight probe",
			btnRevoke: "Revoke consent",
			linkHint: "\"Enable consent\" only happens in chat: ask the model to load the reasoning-bridge skill; it shows the risk disclosure and asks you once. After launching the browser, log in to ChatGPT once in that visible window; when the probe reports READY the link is ready.",
			probeReady: "Preflight READY — link is ready; assign tasks in chat",
			probeBlocked: "Preflight blocked (see details below); handle it as instructed, then retry",
			revokeHint: "Revoking disables automation; the plugin will not touch the browser. Re-enabling requires confirming again in chat.",
		};

		const NUMBER_FIELDS = [
			["composerWaitMs", "fieldComposerWait", "hintComposerWait", 1000, 60000],
			["sendWaitMs", "fieldSendWait", "hintSendWait", 500, 30000],
			["urlWaitMs", "fieldUrlWait", "hintUrlWait", 3000, 120000],
			["appearTimeoutMs", "fieldAppearTimeout", "hintAppearTimeout", 5000, 120000],
			["streamTimeoutMs", "fieldStreamTimeout", "hintStreamTimeout", 15000, 600000],
			["stabilityMs", "fieldStability", "hintStability", 100, 60000],
		];

		const inject = ["slots", "locale", "connection", "remote", "remote.settings", "sidebarRight"];
		// dsh 0.2.0 移除了客户端 settingsScope 服务；命名空间读写改走 remote.settings
		// （describe 拉全量、update 合并写单键），这里保留旧的 getSnapshot/subscribe/set 契约。
		function createSettingsScope(ctx, ns) {
			let snap = { status: "loading", mode: "host", writable: false, value: {} };
			const listeners = new Set();
			const notify = () => { for (const listener of [...listeners]) listener(); };
			const adopt = (writable, value) => {
				snap = { status: "ready", mode: "host", writable: writable !== false, value: value ?? {} };
			};
			async function refresh() {
				try {
					const doc = await ctx.remote.settings.describe();
					adopt(doc.writable, (doc.namespaces ?? []).find((candidate) => candidate.ns === ns)?.value);
				} catch {
					snap = { ...snap, status: "error" };
				}
				notify();
			}
			async function set(key, value) {
				try {
					const view = await ctx.remote.settings.update(ns, { [key]: value });
					adopt(true, view?.value);
				} catch {
					snap = { ...snap, status: "error" };
				}
				notify();
			}
			refresh();
			return {
				getSnapshot: () => snap,
				subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
				set,
				refresh,
			};
		}
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "reasoning-bridge: dictionaries");
			const t = ctx.locale.bind(NS);
			const scope = createSettingsScope(ctx, NS);

			function NumberRow(field) {
				const [draft, setDraft] = react.useState(null); // null = follow scope value
				const [error, setError] = react.useState(false);
				const value = draft !== null ? draft : (snapValue(field.key) ?? "");
				return h("div", { className: "rb_row", key: field.key },
					h("span", { className: "rb_name" }, t(field.labelKey)),
					h("input", {
						className: "rb_input",
						type: "text",
						inputMode: "numeric",
						value: String(value),
						style: error ? { borderColor: "var(--dsw-alias-state-error-primary)" } : undefined,
						onChange: (e) => { setDraft(e.target.value); setError(false); },
						onBlur: () => {
							const n = Number.parseInt(String(draft).trim(), 10);
							if (Number.isInteger(n) && n >= field.min && n <= field.max) {
								scope.set(field.key, n);
								setDraft(null);
							} else if (draft !== null) {
								setError(true);
							}
						},
						onKeyDown: (e) => { if (e.key === "Enter") e.target.blur(); },
					}),
					h("span", { className: "rb_hint" }, t(field.hintKey)));
			}

			function snapValue(key) {
				const snap = scope.getSnapshot();
				return snap.value === void 0 ? void 0 : snap.value[key];
			}

			function consentChip(status) {
				if (status === "READY") return { kind: "ok", label: t("consentReady") };
				if (status === "NEEDS_AUTOMATION_CONSENT") return { kind: "warn", label: t("consentNeeds") };
				if (status === "AUTOMATION_DISABLED") return { kind: "off", label: t("consentDisabled") };
				return { kind: "off", label: t("consentUnknown") };
			}

			function LinkCard() {
				const [data, setData] = react.useState(null);
				const [busy, setBusy] = react.useState("");
				const [error, setError] = react.useState(null);
				const [result, setResult] = react.useState(null);
				const [armRevoke, setArmRevoke] = react.useState(false);
				const load = react.useCallback(() => {
					fetch("/reasoning-bridge/state", { credentials: "same-origin" })
						.then((r) => r.json())
						.then((j) => { setData(j); setError(null); })
						.catch((e) => setError(String(e.message ?? e)));
				}, []);
				react.useEffect(() => { load(); }, [load]);
				async function post(path, body) {
					setBusy(path); setError(null); setResult(null);
					try {
						const r = await fetch("/reasoning-bridge/" + path, {
							method: "POST",
							credentials: "same-origin",
							headers: { "content-type": "application/json" },
							body: body === undefined ? undefined : JSON.stringify(body),
						});
						const j = await r.json();
						setResult(j);
					} catch (e) {
						setError(String(e.message ?? e));
					} finally {
						setBusy(""); load();
					}
				}
				const consentStatus = data && data.consent ? data.consent.status : null;
				const consent = consentStatus ? consentChip(consentStatus) : { kind: "off", label: t("consentUnknown") };
				const target = data && data.target && typeof data.target.target === "string" ? data.target.target : "—";
				const running = !!(data && data.transport && data.transport.running);
				const probeStatus = result && (result.status ?? (result.preflight && result.preflight.status));
				const loading = busy !== "";
				// Structured probe summary: the fields a human needs to decide the
				// next step (which site, which mode, login, CAPTCHA, model identity)
				// instead of a raw JSON dump.
				const probe = result && typeof result === "object" && "composer_found" in result ? result : null;
				const modelPolicy = probe && typeof probe.model_identity === "string"
					? (probe.model_identity === "battle" ? t("modelBattle") : t("modelSelectable"))
					: t("modelUnknown");
				return h("div", { className: "rb_card" },
					h("div", { className: "rb_row", key: "head" },
						h("span", { className: "rb_name", style: { fontWeight: 600, width: "auto", flex: 1 } }, t("linkTitle"))),
					h("div", { className: "rb_row", key: "chips" },
						h("span", { className: "rb_chip", "data-kind": consent.kind }, t("chipConsent") + ": " + consent.label),
						h("span", { className: "rb_chip" }, t("chipTarget") + ": " + target),
						h("span", { className: "rb_chip", "data-kind": running ? "ok" : "off" }, t("chipBrowser") + ": " + (running ? t("browserRunning") : t("browserStopped")))),
					h("div", { className: "rb_row", key: "btns" },
						h("button", { className: "rb_btn", disabled: loading, onClick: () => post("doctor") }, t("btnDoctor")),
						h("button", { className: "rb_btn", disabled: loading, title: running ? "" : "", onClick: () => post("launch") }, t("btnLaunch")),
						h("button", { className: "rb_btn", disabled: loading, onClick: () => post("open") }, t("btnOpen")),
						h("button", { className: "rb_btn", disabled: loading, onClick: () => post("probe") }, t("btnProbe")),
						h("button", {
							className: "rb_btn", "data-danger": true, disabled: loading,
							onClick: () => {
								if (!armRevoke) { setArmRevoke(true); return; }
								setArmRevoke(false);
								post("consent", { action: "disable" });
							},
						}, armRevoke ? t("btnRevoke") + "?" : t("btnRevoke"))),
					probe !== null && h("div", { className: "rb_row", key: "summary", style: { flexWrap: "wrap" } },
						h("span", { className: "rb_chip" }, t("probeTarget") + ": " + (probe.target ?? "—")),
						probe.mode_label && h("span", { className: "rb_chip" }, t("probeMode") + ": " + probe.mode_label),
						h("span", { className: "rb_chip", "data-kind": probe.logged_out ? "warn" : "ok" },
							t("probeLogin") + ": " + (probe.logged_out ? t("stateLoggedOut") : t("stateLoggedIn"))),
						h("span", { className: "rb_chip", "data-kind": probe.recaptcha_present ? "warn" : "ok" },
							t("probeCaptcha") + ": " + (probe.recaptcha_present ? t("statePresent") : t("stateAbsent"))),
						h("span", { className: "rb_chip" }, t("probeModel") + ": " + modelPolicy)),
					(consentStatus === "NEEDS_AUTOMATION_CONSENT" || consentStatus === "AUTOMATION_DISABLED") &&
						h("p", { className: "rb_note" }, t("linkHint")),
					probe !== null && h("p", { className: "rb_note" }, t("openHint")),
					armRevoke && h("p", { className: "rb_note" }, t("revokeHint")),
					probeStatus === "READY" && h("p", { className: "rb_status" }, t("probeReady")),
					probeStatus !== undefined && probeStatus !== "READY" && probeStatus !== null && h("p", { className: "rb_status", "data-error": true }, t("probeBlocked")),
					error !== null && h("p", { className: "rb_status", "data-error": true }, String(error)),
					result !== null && h("pre", { className: "rb_pre" }, JSON.stringify(result, null, 2)));
			}

			function TargetRow({ writable, value }) {
				// The picker list comes from the plugin's own targets table over
				// /reasoning-bridge/state, so the settings panel can never disagree
				// with what the scripts accept. Until it loads (or if the route is
				// unavailable) the row degrades to a plain text field.
				const [targets, setTargets] = react.useState(null);
				const [openError, setOpenError] = react.useState(null);
				react.useEffect(() => {
					fetch("/reasoning-bridge/state", { credentials: "same-origin" })
						.then((r) => r.json())
						.then((j) => setTargets(Array.isArray(j.targets) ? j.targets : []))
						.catch(() => setTargets([]));
				}, []);
				const current = value ?? "chatgpt";
				const listed = targets !== null && targets.some((entry) => entry.id === current);
				const known = targets !== null && targets.length > 0;
				const openSite = () => {
					setOpenError(null);
					fetch("/reasoning-bridge/open", {
						method: "POST",
						credentials: "same-origin",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ target: current }),
					})
						.then((r) => r.json())
						.then((j) => { if (j && j.ok === false) setOpenError(String(j.why ?? j.error ?? "failed")); })
						.catch((e) => setOpenError(String(e.message ?? e)));
				};
				return h(react.Fragment, null,
					h("div", { className: "rb_row", key: "target" },
						h("span", { className: "rb_name" }, t("fieldTarget")),
						known
							? h("select", {
								className: "rb_input",
								value: listed ? current : "",
								disabled: !writable,
								onChange: (e) => { if (e.target.value) scope.set("target", e.target.value); },
							},
								!listed && h("option", { value: "" }, current + " (?)"),
								targets.map((entry) => h("option", { key: entry.id, value: entry.id },
									entry.id + " — " + entry.site)))
							: h("input", {
								className: "rb_input",
								type: "text",
								defaultValue: current,
								disabled: !writable,
								onBlur: (e) => {
									const v = e.target.value.trim();
									if (v && v !== value) scope.set("target", v);
								},
								onKeyDown: (e) => { if (e.key === "Enter") e.target.blur(); },
							}),
						h("button", { className: "rb_btn", type: "button", onClick: openSite }, t("btnOpen")),
						h("span", { className: "rb_hint" }, t("hintTarget"))),
					openError !== null && h("p", { className: "rb_status", "data-error": true }, openError),
					known && h("p", { className: "rb_note" }, t("targetPickerHint")));
			}

			function Panel() {
				const [snap, setSnap] = react.useState(scope.getSnapshot());
				react.useEffect(() => scope.subscribe(() => setSnap(scope.getSnapshot())), []);
				const value = snap.value ?? {};
				const writable = snap.writable !== false && snap.mode === "host";
				return h("div", { className: "rb_section" },
					h("div", { className: "rb_head" }, h("h3", null, t("title"))),
					h("p", { className: "rb_note" }, t("desc")),
					h(LinkCard),
					snap.status !== "ready" && h("p", { className: "rb_status", "data-error": snap.status === "error" },
						snap.status === "loading" ? t("statusLoading") : t("statusError")),
					!writable && h("p", { className: "rb_status" }, t("statusUnavailable")),
					h("div", { className: "rb_card" },
						h(TargetRow, { writable, value: value.target }),
						NUMBER_FIELDS.map((f) => NumberRow({ key: f[0], labelKey: f[1], hintKey: f[2], min: f[3], max: f[4] })),
						h("div", { className: "rb_row", key: "checkNodeRuntime" },
							h("span", { className: "rb_name" }, t("fieldCheckRuntime")),
							h("input", {
								className: "rb_check",
								type: "checkbox",
								checked: value.checkNodeRuntime !== false,
								disabled: !writable,
								onChange: (e) => scope.set("checkNodeRuntime", e.target.checked),
							}),
							h("span", { className: "rb_hint" }, t("hintCheckRuntime")))));
			}

			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "reasoning-bridge",
				order: 30,
				label: () => t("nav"),
				locale: NS,
				inject: () => ({}),
			}, Panel));

			// ---- Sidebar runs panel (v0.5.0) ----------------------------------
			// Same official two-seat registration the task board uses:
			//   slots.inject("sidebar.panellist") — the icon row in the sidebar,
			//   slots.inject("main")              — the center page itself.
			// Both seats are declared by shell plugins this package does not depend
			// on, so each registration is wrapped in ctx.slots.inject: a shell that
			// never declares them leaves the page simply absent instead of failing
			// boot. Strictly read-only; web replies render as React TEXT children
			// (untrusted data, never HTML — no dangerouslySetInnerHTML anywhere).
			const RUNS_PANEL_ID = "reasoning-bridge-runs";
			const RUNS_ARTIFACT_LABELS = {
				"transcript.json": "状态轨迹",
				"packet.md": "Packet",
				"result.md": "Result",
				"reply.txt": "原始回复",
				"browser-evidence.md": "浏览器证据",
				"receipt.json": "回执",
			};

			function RunsPanelIcon({ size }) {
				return h("svg", {
					"data-dsh-panel-entry": RUNS_PANEL_ID,
					viewBox: "0 0 16 16", width: size, height: size,
					fill: "none", stroke: "currentColor", strokeWidth: "1.3",
					strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
				},
					h("rect", { x: "2", y: "2.5", width: "12", height: "11", rx: "1.5" }),
					h("path", { d: "M5 8h6M5 10.5h4" }),
					h("path", { d: "M2 5.5h12" }));
			}

			function RunsBadge({ run }) {
				const receipt = run.receipt;
				if (!receipt) return h("span", { className: "rb_chip" }, "未回执");
				if (receipt.browser_transport === "failed") return h("span", { className: "rb_chip", "data-kind": "off" }, "传输失败");
				const complete = receipt.tests === "passed" && receipt.browser_transport === "verified"
					&& receipt.local_changes !== "failed" && receipt.local_changes != null;
				return h("span", { className: "rb_chip", "data-kind": complete ? "ok" : "warn" }, complete ? "已完整" : "进行中");
			}

			function RunsViewer() {
				const [runs, setRuns] = react.useState(null);
				const [error, setError] = react.useState(null);
				const [selected, setSelected] = react.useState(null);
				const [artifact, setArtifact] = react.useState(null);
				const load = react.useCallback(() => {
					fetch("/reasoning-bridge/runs", { credentials: "same-origin" })
						.then((r) => r.json())
						.then((j) => { setRuns(Array.isArray(j.runs) ? j.runs : []); setError(null); })
						.catch((e) => setError(String(e.message ?? e)));
				}, []);
				react.useEffect(() => { load(); }, [load]);
				react.useEffect(() => {
					const timer = setInterval(load, 5000);
					return () => clearInterval(timer);
				}, [load]);
				const openArtifact = (packetId, name) => {
					setArtifact({ name, loading: true });
					fetch("/reasoning-bridge/runs/" + encodeURIComponent(packetId) + "/" + encodeURIComponent(name), { credentials: "same-origin" })
						.then((r) => r.json())
						.then((j) => setArtifact(j.ok
							? { name, content: j.content, truncated: !!j.truncated, size: j.size }
							: { name, error: j.error ?? "unreadable" }))
						.catch((e) => setArtifact({ name, error: String(e.message ?? e) }));
				};
				const run = runs !== null ? runs.find((entry) => entry.packet_id === selected) : null;
				if (selected !== null && run !== null) {
					const artifacts = Object.entries(run.artifacts ?? {});
					return h("div", { className: "rb_runs_detail" },
						h("div", { className: "rb_row" },
							h("button", { className: "rb_btn", onClick: () => { setSelected(null); setArtifact(null); } }, "← 返回"),
							h("strong", null, " " + selected),
							h(RunsBadge, { run })),
						artifacts.length === 0 && h("p", { className: "rb_note" }, "该 run 目录下还没有可显示的产物。"),
						artifacts.length > 0 && h("div", { className: "rb_row", style: { flexWrap: "wrap" } },
							artifacts.map(([name, meta]) => h("button", {
								key: name,
								className: "rb_btn" + (artifact && artifact.name === name ? " rb_btn_active" : ""),
								title: (meta.size ?? 0) + " bytes",
								onClick: () => openArtifact(selected, name),
							}, RUNS_ARTIFACT_LABELS[name] ?? name))),
						artifact !== null && artifact.loading === true && h("p", { className: "rb_status" }, "读取中…"),
						artifact !== null && artifact.loading !== true && artifact.error && h("p", { className: "rb_status", "data-error": "true" }, artifact.error),
						artifact !== null && artifact.loading !== true && artifact.content !== undefined && h("pre", { className: "rb_pre" },
							(artifact.truncated ? "（超过 256 KiB，已截断）\n" : "") + artifact.content));
				}
				return h("div", { className: "rb_runs" },
					h("div", { className: "rb_row" },
						h("strong", null, "推理交接运行"),
						h("button", { className: "rb_btn", onClick: load }, "刷新")),
					error !== null && h("p", { className: "rb_status", "data-error": "true" }, String(error)),
					runs === null && h("p", { className: "rb_status" }, "加载中…"),
					runs !== null && runs.length === 0 && h("p", { className: "rb_note" },
						"还没有运行记录。技能每次交接会把 packet / result / 回执写在 ~/.dsh/dsh-reasoning-bridge/runs/<packet_id>/ 下，这里会自动出现。"),
					runs !== null && runs.length > 0 && h("div", { className: "rb_runs_list" },
						runs.map((entry) => h("button", {
							key: entry.packet_id,
							className: "rb_btn rb_run_row",
							onClick: () => { setSelected(entry.packet_id); setArtifact(null); },
						},
							h("span", { className: "rb_run_id" }, entry.packet_id),
							h("span", { className: "rb_hint" },
								(entry.mtime ?? "").replace("T", " ").slice(0, 16) + " · " +
								Object.keys(entry.artifacts ?? {}).length + " 个产物"),
							h(RunsBadge, { run: entry })))));
			}

			// ---- "Open web AI in the right Sidebar Browser" (v0.5.1) ----------
			// Uses the OFFICIAL right-sidebar browser tab: the disabled-by-default
			// @deepseek-ai/dsh-client-ui-sidebar-browser package (Web profile)
			// registers kind "browser" and serves pages in a sandboxed iframe;
			// Desktop hosts it in an Electron <webview>. This plugin only CALLS
			// ctx.sidebarRight.openTab('browser', { params: { url } }) — it does
			// not implement any browser UI itself.
			//
			// STRICT BOUNDARY (README 强制执行 vs. 纪律约定): the browser tab is a
			// DISPLAY surface for the human. It exposes no tools — the agent cannot
			// read the page or send messages through it, so opening it is NOT a
			// handoff. Actual handoffs still run through the skill: consent gate,
			// credential scan, one human-confirmed send, adoption gate, receipt.
			const WEB_AI_SITES = [
				["https://chatgpt.com/", "ChatGPT"],
				["https://arena.ai/", "Arena AI"],
			];
			function openInBrowser(url) {
				// sidebarRight is declared in this plugin's inject list (provided by
				// the always-on ui-sidebar-right shell), so the service is here.
				const sidebarRight = ctx.sidebarRight;
				if (!sidebarRight || typeof sidebarRight.openTab !== "function") {
					alert("侧边栏服务不可用（需要 dsh 的 ui-sidebar-right）。");
					return;
				}
				try {
					sidebarRight.openTab("browser", { params: { url } });
				} catch (error) {
					// kind "browser" is only registered when ui-sidebar-browser is
					// enabled (Web profile默认禁用); reflect that instead of silence.
					alert("侧边栏浏览器不可用：" + (error && error.message ? error.message : error)
						+ "\n\n请在 profile patch 中启用 ui-sidebar-browser（disabled: false）后重启 dsh。");
				}
			}

			function RunsPanel() {
				return h("div", { className: "rb_section", "data-dsh-plugin": "reasoning-bridge" },
					h("div", { className: "rb_row", style: { flexWrap: "wrap" } },
						WEB_AI_SITES.map(([url, label]) => h("button", {
							key: url,
							className: "rb_btn",
							title: "在右侧侧边栏浏览器中打开 " + url + "（仅供人工查看；自动交接仍走技能流程）",
							onClick: () => openInBrowser(url),
						}, "在侧边栏打开 " + label))),
					h(RunsViewer));
			}

			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: RUNS_PANEL_ID,
				order: 45,
				label: () => "推理交接",
			}, RunsPanelIcon));
			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: RUNS_PANEL_ID,
				inject: () => ({}),
			}, RunsPanel));

			// ---- Sidebar runs viewer (v0.5.0) --------------------------------
			// Optional integration with dsh-better-sidebar's ctx.betterSidebar
			// service (it ctx.provide()s it; see its service.d.ts). Scoped inject:
			// when better-sidebar is not installed the plugin simply has no sidebar
			// tab and the settings panel stays the only UI. Strictly read-only:
			// lists runs under ~/.dsh/dsh-reasoning-bridge/runs/ and renders
			// artifacts as PLAIN TEXT via React text children — every byte fetched
			// from the web AI is untrusted data and must never be interpreted as
			// HTML (no dangerouslySetInnerHTML anywhere).
			const RUNS_ARTIFACTS = [
				["transcript.json", "状态轨迹"],
				["packet.md", "Packet"],
				["result.md", "Result"],
				["reply.txt", "原始回复"],
				["browser-evidence.md", "浏览器证据"],
				["receipt.json", "回执"],
			];

			function RunsBadge({ run }) {
				const receipt = run.receipt;
				if (!receipt) return h("span", { className: "rb_chip" }, "未回执");
				if (receipt.browser_transport === "failed") return h("span", { className: "rb_chip", "data-kind": "off" }, "传输失败");
				const complete = receipt.tests === "passed" && receipt.browser_transport === "verified"
					&& receipt.local_changes !== "failed" && receipt.local_changes != null;
				return h("span", { className: "rb_chip", "data-kind": complete ? "ok" : "warn" }, complete ? "已完整" : "进行中");
			}

			function RunsViewer() {
				const [runs, setRuns] = react.useState(null);
				const [error, setError] = react.useState(null);
				const [selected, setSelected] = react.useState(null);
				const [artifact, setArtifact] = react.useState(null);
				const load = react.useCallback(() => {
					fetch("/reasoning-bridge/runs", { credentials: "same-origin" })
						.then((r) => r.json())
						.then((j) => { setRuns(Array.isArray(j.runs) ? j.runs : []); setError(null); })
						.catch((e) => setError(String(e.message ?? e)));
				}, []);
				react.useEffect(() => { load(); }, [load]);
				react.useEffect(() => {
					const timer = setInterval(load, 5000);
					return () => clearInterval(timer);
				}, [load]);
				const openArtifact = (packetId, name) => {
					setArtifact({ name, loading: true });
					fetch("/reasoning-bridge/runs/" + encodeURIComponent(packetId) + "/" + encodeURIComponent(name), { credentials: "same-origin" })
						.then((r) => r.json())
						.then((j) => setArtifact(j.ok
							? { name, content: j.content, truncated: !!j.truncated, size: j.size }
							: { name, error: j.error ?? "unreadable" }))
						.catch((e) => setArtifact({ name, error: String(e.message ?? e) }));
				};
				const run = runs !== null ? runs.find((entry) => entry.packet_id === selected) : null;
				if (selected !== null && run !== null) {
					const artifacts = Object.entries(run.artifacts ?? {});
					return h("div", { className: "rb_runs_detail" },
						h("div", { className: "rb_row" },
							h("button", { className: "rb_btn", onClick: () => { setSelected(null); setArtifact(null); } }, "← 返回"),
							h("strong", null, " " + selected),
							h(RunsBadge, { run })),
						artifacts.length === 0 && h("p", { className: "rb_note" }, "该 run 目录下还没有可显示的产物。"),
						artifacts.length > 0 && h("div", { className: "rb_row", style: { flexWrap: "wrap" } },
							artifacts.map(([name, meta]) => h("button", {
								key: name,
								className: "rb_btn" + (artifact && artifact.name === name ? " rb_btn_active" : ""),
								title: (meta.size ?? 0) + " bytes",
								onClick: () => openArtifact(selected, name),
							}, name))),
						artifact !== null && artifact.loading === true && h("p", { className: "rb_status" }, "读取中…"),
						artifact !== null && artifact.loading !== true && artifact.error && h("p", { className: "rb_status", "data-error": "true" }, artifact.error),
						artifact !== null && artifact.loading !== true && artifact.content !== undefined && h("pre", { className: "rb_pre" },
							(artifact.truncated ? "（超过 256 KiB，已截断）\n" : "") + artifact.content));
				}
				return h("div", { className: "rb_runs" },
					h("div", { className: "rb_row" },
						h("strong", null, "推理交接运行"),
						h("button", { className: "rb_btn", onClick: load }, "刷新")),
					error !== null && h("p", { className: "rb_status", "data-error": "true" }, String(error)),
					runs === null && h("p", { className: "rb_status" }, "加载中…"),
					runs !== null && runs.length === 0 && h("p", { className: "rb_note" },
						"还没有运行记录。技能每次交接会把 packet / result / 回执写在 ~/.dsh/dsh-reasoning-bridge/runs/<packet_id>/ 下，这里会自动出现。"),
					runs !== null && runs.length > 0 && h("div", { className: "rb_runs_list" },
						runs.map((entry) => h("button", {
							key: entry.packet_id,
							className: "rb_btn rb_run_row",
							onClick: () => { setSelected(entry.packet_id); setArtifact(null); },
						},
							h("span", { className: "rb_run_id" }, entry.packet_id),
							h("span", { className: "rb_hint" },
								(entry.mtime ?? "").replace("T", " ").slice(0, 16) + " · " +
								Object.keys(entry.artifacts ?? {}).length + " 个产物"),
							h(RunsBadge, { run: entry })))));
			}

			ctx.effect(() => {
				ctx.inject([...(Array.isArray(inject) ? inject : []), "betterSidebar"], (sctx) => {
					const service = sctx.betterSidebar;
					if (!service || typeof service.registerTab !== "function") return;
					return service.registerTab({
						id: "reasoning-bridge:runs",
						title: () => "推理交接",
						description: () => "只读查看每次推理交接的运行记录：状态轨迹、Packet、网页回复与回执。",
						order: 80,
						single: true,
						component: () => h(RunsViewer),
					});
				});
			}, "reasoning-bridge: sidebar runs tab");
		}
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
