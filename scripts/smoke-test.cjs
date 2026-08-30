// 冒烟测试:在 Node 沙箱里加载 lib/client.js,对纯函数(模板插值 / 配置归一化 /
// 调度匹配 / 时长格式化)做断言。运行:node scripts/smoke-test.cjs
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const clientSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "client.js"), "utf8");

let exports_ = null;
const sandbox = {
	window: {
		__ModuleLoader__: {
			load: (def) => {
				const require = (name) => {
					if (name === "react") {
						return {
							useState: () => null,
							useEffect: () => null,
							useCallback: () => null,
							useRef: () => ({ current: null }),
							createElement: () => null,
						};
					}
					throw new Error("smoke-test 意外 require: " + name);
				};
				exports_ = def.factory(require);
			},
		},
	},
	document: {
		createElement: () => ({ classList: { contains: () => false, toggle: () => {} }, setAttribute: () => {}, appendChild: () => {}, remove: () => {}, style: {}, textContent: "" }),
		documentElement: { dataset: {} },
		addEventListener: () => {},
		querySelectorAll: () => [],
		body: null,
		head: { appendChild: () => {} },
	},
	localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
	navigator: {},
	console,
	setTimeout,
	clearTimeout,
	setInterval,
	clearInterval,
	fetch: async () => ({ ok: false, status: 404 }),
	Element: class Element {},
	MutationObserver: class MutationObserver { observe() {} disconnect() {} },
};
vm.createContext(sandbox);
vm.runInContext(clientSrc, sandbox, { filename: "client.js" });

const T = exports_.__test;
if (!T) {
	console.error("FAIL: 未导出 __test 纯函数");
	process.exit(1);
}

let passed = 0;
let failed = 0;
const ok = (name, cond) => {
	if (cond) {
		passed++;
		console.log("  ✓", name);
	} else {
		failed++;
		console.error("  ✗ FAIL:", name);
	}
};

console.log("== interpolate ==");
ok("基础占位符替换", T.interpolate("正在写代码 {elapsed}", { elapsed: "1分02秒" }) === "正在写代码 1分02秒");
ok("未知占位符原样保留", T.interpolate("a {nope} b", {}) === "a {nope} b");
ok("多个占位符", T.interpolate("{phase}/{phaseLabel} {time}", { phase: "running", phaseLabel: "运行中", time: "12:00:00" }) === "running/运行中 12:00:00");
ok("isDynamicTemplate 命中 elapsed", T.isDynamicTemplate("⏳ {elapsed}") === true);
ok("isDynamicTemplate 忽略 phase", T.isDynamicTemplate("{phase}") === false);

console.log("== formatElapsed ==");
ok("zh 秒", T.formatElapsed(15, "zh") === "15秒");
ok("zh 分秒补零", T.formatElapsed(62, "zh") === "1分02秒");
ok("zh 小时", T.formatElapsed(3661, "zh") === "1小时1分01秒");
ok("en 秒", T.formatElapsed(15, "en") === "15s");
ok("en 分秒补零", T.formatElapsed(62, "en") === "1m 02s");
ok("en 小时", T.formatElapsed(3661, "en") === "1h 1m 1s");
ok("负数钳制为 0", T.formatElapsed(-5, "en") === "0s");

console.log("== parseClock ==");
ok("zh 分秒", T.parseClock("1分02秒") === 62);
ok("en 分秒", T.parseClock("1m 02s") === 62);
ok("纯秒", T.parseClock("15秒") === 15);

console.log("== normalizeGroups / normalizeTable ==");
ok("数组归一化为 thinking", JSON.stringify(T.normalizeGroups(["a", "b"])) === JSON.stringify({ thinking: ["a", "b"], running: [], long: [] }));
ok("分组对象", T.normalizeGroups({ running: ["x"] }).running.length === 1);
ok("纯文案表单组共享", (() => { const t = T.normalizeTable({ thinking: ["a"] }); return t.zh.thinking[0] === "a" && t.en.thinking[0] === "a"; })());
ok("语言表", T.normalizeTable({ zh: { thinking: ["中"] }, en: ["E"] }).en.thinking[0] === "E");

console.log("== parseExternal 完整文档 ==");
const doc = T.parseExternal({
	config: { intervalMs: 5000, title: { enabled: true, templates: ["x"] }, gradient: false },
	phrases: { zh: { thinking: ["a"] } },
	presets: [{ id: "work", label: { zh: "工作", en: "Work" }, config: { intervalMs: 3000 }, phrases: { zh: { thinking: ["b"] } } }, { id: "bad" }],
	activePreset: "work",
	schedule: [{ preset: "work", days: ["mon", "fri"], from: "09:00", to: "18:00" }],
});
ok("config 解析", doc.config.intervalMs === 5000 && doc.config.title.enabled === true && doc.config.gradient.enabled === false);
ok("presets 保留 id-only 预设(可作调度空壳)", doc.presets.length === 2 && doc.presets[0].config.intervalMs === 3000 && doc.presets[1].id === "bad");
ok("activePreset", doc.activePreset === "work");
ok("schedule", doc.schedule[0].days.length === 2 && doc.schedule[0].from === "09:00");

console.log("== normalizeSchedule ==");
ok("days 省略 = 每天", T.normalizeSchedule([{ preset: "a" }])[0].days.length === 7);
ok("非法条目跳过", T.normalizeSchedule([{ preset: "a", days: [] }, { preset: "", days: ["mon"] }]) === null);
ok("跨天窗口保留", T.normalizeSchedule([{ preset: "a", days: ["sun"], from: "22:00", to: "06:00" }])[0].from === "22:00");

console.log("== matchSchedule ==");
const sched = T.normalizeSchedule([
	{ preset: "work", days: ["mon", "tue", "wed", "thu", "fri"], from: "09:00", to: "18:00" },
	{ preset: "fun", days: ["sat", "sun"], from: "00:00", to: "23:59" },
	{ preset: "night", days: ["mon"], from: "22:00", to: "06:00" },
]);
// 2026-08-07 是周五
const friday = new Date(2026, 7, 7, 10, 30);
ok("工作日命中 work", T.matchSchedule(sched, friday) === "work");
const fridayEarly = new Date(2026, 7, 7, 8, 0);
ok("窗口外不命中", T.matchSchedule(sched, fridayEarly) === null);
const fridayLate = new Date(2026, 7, 7, 23, 0);
ok("跨天窗口(周一 22:00 之后)命中 night", T.matchSchedule(sched, new Date(2026, 7, 3, 23, 0)) === "night");
ok("无调度返回 null", T.matchSchedule(null, friday) === null);

console.log("== normalizeConfig ==");
const cfg = T.normalizeConfig({ intervalMs: 0, typeSpeedMs: 0, liveTickMs: 0, title: { enabled: true }, bogus: 1 });
ok("非法 intervalMs 丢弃、合法字段保留", cfg.intervalMs === undefined && cfg.typeSpeedMs === 0 && cfg.liveTickMs === 0 && cfg.title.enabled === true && cfg.bogus === undefined);

console.log("== 实时引擎纯函数 ==");
ok("isDynamicTemplate 命中 tps", T.isDynamicTemplate("⚡{tps}") === true);
ok("isDynamicTemplate 命中 model", T.isDynamicTemplate("{model}") === true);
const snap = {
	running: true,
	pending: [{}, {}],
	runningCalls: [{ name: "bash" }, { name: "web_search" }, { name: "" }],
	partial: { blocks: [{ text: "hello " }, { text: "world" }, { kind: "tool", args: "x" }] },
};
const ex = T.extractSnapshot(snap);
ok("extractSnapshot: running/pending/tools/streamChars",
	ex.running === true && ex.pending === 2 && ex.tools.join("+") === "bash+web_search" && ex.streamChars === 11);
ok("extractSnapshot: 非法快照返回 null", T.extractSnapshot(null) === null);
ok("extractSnapshot: 空工具过滤", T.extractSnapshot({ runningCalls: [{ name: "x" }, {}] }).tools.length === 1);
const m1 = T.extractModel({ provider: "deepseek", model: "deepseek-chat", reasoningEffort: "high" });
ok("extractModel 正常", m1.provider === "deepseek" && m1.model === "deepseek-chat");
ok("extractModel 非法返回空", T.extractModel(null).model === "" && T.extractModel("x").provider === "");
ok("pickModel 穿透 RpcResult 形态", (() => { const r = T.pickModel({ ok: true, value: { current: { provider: "p", model: "m" } } }); return r.provider === "p" && r.model === "m"; })());
ok("pickModel 直接形态", (() => { const r = T.pickModel({ current: { provider: "p2", model: "m2" } }); return r.model === "m2"; })());
const pillCfg = T.normalizeConfig({ pill: { enabled: true, template: "x", position: "left-top", opacity: 0.5 } });
ok("normalizeConfig: pill 字段", pillCfg.pill.enabled === true && pillCfg.pill.position === "left-top" && pillCfg.pill.opacity === 0.5);
ok("normalizeConfig: 全非法 pill 丢弃整块", T.normalizeConfig({ pill: { position: "center" } }) === null);
ok("parseColorList 逗号分隔", JSON.stringify(T.parseColorList("#ff5f6d, #00ff88 ,#4da6ff")) === JSON.stringify(["#ff5f6d", "#00ff88", "#4da6ff"]));
ok("parseColorList 空/非法返回 []", T.parseColorList("  ,,  ").length === 0);
ok("parseColorList 中文逗号/换行分隔", T.parseColorList("#fff，#000\n#123") .length === 3);

console.log("== danmaku ==");
const dmCfg = T.normalizeConfig({ danmaku: { enabled: true, intervalMs: 5000, speedMs: 8000, fontSizeMin: 14, fontSizeMax: 30, rainbow: true, colors: ["#ff5f6d", "#00ff88"], color: "#fff", opacity: 0.4, maxCount: 6, zIndex: -1, scope: "all", marginTop: 8, marginBottom: 200 } });
ok("normalizeConfig: danmaku 字段", dmCfg.danmaku.enabled === true && dmCfg.danmaku.fontSizeMax === 30 && dmCfg.danmaku.zIndex === -1 && dmCfg.danmaku.scope === "all" && dmCfg.danmaku.maxCount === 6);
ok("normalizeConfig: danmaku 非法值丢弃", (() => {
	const d = T.normalizeConfig({ danmaku: { enabled: "yes", opacity: 2, maxCount: 0, scope: "bad", zIndex: 0.5, marginTop: -3, intervalMs: 1000 } });
	return d.danmaku && d.danmaku.enabled === undefined && d.danmaku.opacity === undefined && d.danmaku.maxCount === undefined && d.danmaku.scope === undefined && d.danmaku.zIndex === undefined && d.danmaku.marginTop === undefined && d.danmaku.intervalMs === 1000;
})());
ok("normalizeConfig: danmaku 布尔简写", T.normalizeConfig({ danmaku: false }).danmaku.enabled === false);
ok("normalizeConfig: 全非法 danmaku 丢弃整块", T.normalizeConfig({ danmaku: { scope: "bad" } }) === null);
ok("danmakuPool all 去重合并", T.danmakuPool({ thinking: ["a", "b"], running: ["c"] }, "running", "all").join("+") === "a+b+c");
ok("danmakuPool phase 用当前阶段", T.danmakuPool({ thinking: ["a", "b"], running: ["c"] }, "running", "phase").join("+") === "c");
ok("danmakuPool phase 缺组回退", T.danmakuPool({ thinking: ["a"], running: [] }, "long", "phase").join("+") === "a");
ok("danmakuPool 空输入返回 []", T.danmakuPool(null, "running", "all").length === 0 && T.danmakuPool({}, "running", "all").length === 0);
ok("danmakuFontSpan 修正 min>max 并钳制", (() => { const s = T.danmakuFontSpan(40, 12); return s.min === 12 && s.max === 40; })());
ok("danmakuFontSpan 默认值", (() => { const s = T.danmakuFontSpan(undefined, undefined); return s.min === 14 && s.max === 30; })());
ok("randInt 区间内", (() => { let okAll = true; for (let i = 0; i < 50; i++) { const v = T.randInt(5, 7); if (v < 5 || v > 7) { okAll = false; break; } } return okAll; })());

console.log("== phrase-bot 词库投稿机器人 ==");
const bot = require("./phrase-bot.cjs");

// 表单解析:下拉是数组、textarea 多行、注释行忽略
const sub1 = bot.parseSubmission(
	{ lang: ["zh (中文)"], phase: ["running (运行中)"], phrases: "写代码中...\n\n# 注释行\n正在摸鱼", name: "小测", rules: ["x"] },
	""
);
ok("解析表单", sub1.error === undefined && sub1.langs.join() === "zh" && sub1.phases.join() === "running" && sub1.phrases.length === 2 && sub1.phrases[0] === "写代码中..." && sub1.confirmed === true);
ok("语种/分组组合展开", (() => { const s = bot.parseSubmission({ lang: ["zh + en (两种都要)"], phase: ["全部三阶段"], phrases: "a", rules: ["x"] }, ""); return s.langs.length === 2 && s.phases.length === 3; })());
ok("body 回退解析(表单字段缺失时)", (() => {
	const body = "### 语种\n- [x] zh (中文)\n\n### 分组\n- [x] long (长时间任务)\n\n### 文案(每行一条)\n深潜中…\n\n### 提交须知\n- [x] 我已自查";
	const s = bot.parseSubmission({}, body);
	return s.langs[0] === "zh" && s.phases[0] === "long" && s.phrases[0] === "深潜中…" && s.confirmed === true;
})());
// 真实 Issue 正文形态(表单渲染结果):下拉为纯文本行、文案在 ```text 代码围栏内、未填项为 _No response_
ok("body 解析:代码围栏/纯文本行/_No response_(真实 #8 形态)", (() => {
	const body = "### 语种\n\nzh (中文)\n\n### 分组\n\nthinking (刚开始)\n\n### 文案(每行一条)\n\n```text\n正在issues区投稿新词库...\n```\n\n### 署名(可选)\n\n_No response_\n\n### 提交须知\n\n- [x] 我已自查:语句通顺、不含广告/链接/HTML、不与现有词库重复\n- [x] 我同意:投稿经维护者合并后进入默认词库并随 npm 发版分发";
	const s = bot.parseSubmission({}, body);
	return s.error === undefined && s.langs[0] === "zh" && s.phases[0] === "thinking" && s.phrases.length === 1 && s.phrases[0] === "正在issues区投稿新词库..." && s.name === "" && s.confirmed === true;
})());
ok("body 解析:三组都不合则报 error(普通 Issue 不会被当投稿)", bot.parseSubmission({}, "### 我的bug\n\ndsh web 启动闪退").error !== undefined);
ok("缺文案不报解析 error(由校验拒绝)", bot.parseSubmission({ lang: ["zh"], phase: ["thinking"], rules: ["x"] }, "").phrases.length === 0);

const bank = { phrases: { zh: { thinking: ["已有…"], running: [] }, en: { thinking: ["Keep going…"] } } };
const subOK = bot.parseSubmission({ lang: ["zh"], phase: ["thinking"], phrases: "已有…\n\n新的文案...", rules: ["x"] }, "");
const v = bot.validateSubmission(subOK, bank);
ok("查重跳过 + 新增 + 省略号归一", v.ok === true && v.items.length === 1 && v.skipped === 1 && v.items[0].text === "新的文案…");
ok("未勾选提交须知拒绝", bot.validateSubmission(bot.parseSubmission({ lang: ["zh"], phase: ["thinking"], phrases: "a" }, ""), bank).ok === false);
ok("HTML/链接拒绝", (() => {
	const s1 = bot.parseSubmission({ lang: ["zh"], phase: ["thinking"], phrases: "<script>alert(1)</script>", rules: ["x"] }, "");
	const s2 = bot.parseSubmission({ lang: ["zh"], phase: ["thinking"], phrases: "请看 https://x.com 广告", rules: ["x"] }, "");
	return bot.validateSubmission(s1, bank).ok === false && bot.validateSubmission(s2, bank).ok === false;
})());
ok("超长/超量拒绝", (() => {
	const s1 = bot.parseSubmission({ lang: ["zh"], phase: ["thinking"], phrases: "长".repeat(201), rules: ["x"] }, "");
	const s2 = bot.parseSubmission({ lang: ["zh"], phase: ["thinking"], phrases: Array.from({ length: 61 }, (_x, i) => `第${i}条…`).join("\n"), rules: ["x"] }, "");
	return bot.validateSubmission(s1, bank).ok === false && bot.validateSubmission(s2, bank).ok === false;
})());

const applied = bot.applyToBank(bank, [
	{ lang: "zh", phase: "thinking", text: "已有…" },
	{ lang: "zh", phase: "running", text: "新…" },
	{ lang: "en", phase: "long", text: "Deep dive…" },
]);
ok("applyToBank 写组/建组/跳过重复", applied.added === 2 && applied.doc.phrases.zh.thinking.join("|") === "已有…" && applied.doc.phrases.zh.running[0] === "新…" && applied.doc.phrases.en.long[0] === "Deep dive…");
ok("applyToBank 不动原对象", bank.phrases.zh.running.length === 0);
ok("buildSnippet 结构", (() => { const d = JSON.parse(bot.buildSnippet([{ lang: "zh", phase: "thinking", text: "a…" }])); return d.phrases.zh.thinking[0] === "a…"; })());
ok("renderPreview 每条文案一行、分组列填充(不错位)", (() => {
	const lines = bot.renderPreview([{ lang: "zh", phase: "thinking", text: "a…" }, { lang: "en", phase: "long", text: "b…" }]);
	return lines.split("\n").length === 4 && lines.includes("| zh · thinking | a… |") && lines.includes("| en · long | b… |");
})());

(async () => {
	console.log("== node half: validateConfigDocument ==");
	const { pathToFileURL } = require("url");
	const node = await import(pathToFileURL(path.join(__dirname, "..", "lib", "index.js")).href);
	const v = node.validateConfigDocument;
	const accepts = (doc) => {
		try {
			v(doc);
			return true;
		} catch (e) {
			return false;
		}
	};
	ok("合法完整文档(含 presets/schedule)", accepts({
		config: { intervalMs: 100 },
		phrases: { zh: { thinking: ["a"] } },
		presets: [{ id: "work", label: "工作", config: { intervalMs: 300 }, phrases: { zh: { thinking: ["b"] } } }],
		activePreset: "work",
		schedule: [{ preset: "work", days: ["mon", "fri"], from: "09:00", to: "18:00" }],
	}));
	ok("拒绝非法 schedule(空 preset)", !accepts({ schedule: [{ preset: "", days: ["mon"] }] }));
	ok("拒绝非法 schedule(未知星期)", !accepts({ schedule: [{ preset: "a", days: ["monday"] }] }));
	ok("拒绝非法 presets(缺 id)", !accepts({ presets: [{ label: "x" }] }));
	ok("拒绝非法 phrases(数字)", !accepts({ phrases: { zh: { thinking: [1] } } }));
	ok("兼容旧格式纯文案表", accepts({ phrases: { zh: ["a", "b"], en: ["c"] } }));
	ok("接受 danmaku 配置", accepts({ config: { danmaku: { enabled: true, zIndex: -1, scope: "all" } } }));
	ok("mergeDocuments: settings 层覆盖文件层", (() => {
		const m = node.mergeDocuments({ config: { gradient: { enabled: true } }, phrases: { zh: ["a"] } }, { config: { gradient: { enabled: false } }, presets: [{ id: "x" }] });
		return m.config.gradient.enabled === false && m.presets[0].id === "x" && m.phrases.zh[0] === "a";
	})());
	ok("mergeDocuments: 无 settings 返回文件层", node.mergeDocuments({ a: 1 }, null).a === 1);
	ok("mergeDocuments: settings 全量覆盖", (() => { const m = node.mergeDocuments({ a: 1, b: 2 }, { b: 3, c: 4 }); return m.a === 1 && m.b === 3 && m.c === 4; })());

	// 默认配置数据完整性:短语省略号统一,config 关键字段不被污染
	console.log("== 默认配置数据完整性 ==");
	const exampleDoc = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.example.json"), "utf8"));
	const { validateConfigDocumentData } = require("./unify-ellipsis.cjs");
	const dataIssues = validateConfigDocumentData(exampleDoc);
	ok("config.example.json: 短语全部 … 结尾且 config 未被污染", dataIssues.length === 0);
	if (dataIssues.length > 0) console.error("  issues:", dataIssues.slice(0, 5).join("; "));
	ok("渐变颜色无污染", exampleDoc.config.gradient.colors.every((c) => !c.includes("\u2026")));
	ok("弹幕颜色/单色无污染", exampleDoc.config.danmaku.colors.every((c) => !c.includes("\u2026")) && !exampleDoc.config.danmaku.color.includes("\u2026"));
	ok("弹幕默认层级为 -1(界面后面)", exampleDoc.config.danmaku.zIndex === -1);
	ok("Pill 模板/位置无污染", !exampleDoc.config.pill.template.includes("\u2026") && exampleDoc.config.pill.position === "right-bottom");
	ok("标题模板保留有意省略号", exampleDoc.config.title.templates.some((t) => t.includes("\u2026")));

	console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
	process.exit(failed === 0 ? 0 : 1);
})();
