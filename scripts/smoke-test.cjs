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

console.log("== dsh TurnStatus 初始文案解析(中英文标签) ==");
const chatDict = {
	zh: (key) => (key === "chat.deepDiving" ? "深度求索中..." : key),
	en: (key) => (key === "chat.deepDiving" ? "Deep diving..." : key),
};
ok("resolveDiveLabel: zh 字典命中", T.resolveDiveLabel(chatDict.zh, "zh") === "深度求索中...");
ok("resolveDiveLabel: en 字典命中", T.resolveDiveLabel(chatDict.en, "en") === "Deep diving...");
ok("resolveDiveLabel: 字典未注册(返回 key)按 locale 回退", T.resolveDiveLabel((k) => k, "zh") === "深度求索中..." && T.resolveDiveLabel((k) => k, "en") === "Deep diving...");
ok("resolveDiveLabel: 翻译抛错回退", (() => { try { T.resolveDiveLabel(() => { throw new Error("x"); }, "en"); } catch (e) { return false; } return true; })() && T.resolveDiveLabel(() => { throw new Error("x"); }, "zh") === "深度求索中...");
ok("resolveDiveLabel: 模板串(含 {)回退", T.resolveDiveLabel(() => "{seconds}", "en") === "Deep diving...");
ok("resolveDiveLabel: 无翻译函数回退", T.resolveDiveLabel(null, "zh") === "深度求索中...");
ok("matchesDiveText: 当前语言标签命中", T.matchesDiveText("深度求索中...", "深度求索中...") === true && T.matchesDiveText("Deep diving...", "Deep diving...") === true);
ok("matchesDiveText: 语言切换瞬间按已知文案兜底", T.matchesDiveText("Deep diving...", "深度求索中...") === true && T.matchesDiveText("深度求索中...", "Deep diving...") === true);
ok("matchesDiveText: 其他状态区不误伤", T.matchesDiveText("正在载入历史…", "Deep diving...") === false && T.matchesDiveText("", "Deep diving...") === false);

console.log("== normalizeGroups / normalizeTable ==");
ok("数组归一化为 thinking", JSON.stringify(T.normalizeGroups(["a", "b"])) === JSON.stringify({ thinking: ["a", "b"], running: [], long: [] }));
ok("分组对象", T.normalizeGroups({ running: ["x"] }).running.length === 1);
ok("纯文案表单组共享", (() => { const t = T.normalizeTable({ thinking: ["a"] }); return t.zh.thinking[0] === "a" && t.en.thinking[0] === "a"; })());
ok("语言表", T.normalizeTable({ zh: { thinking: ["中"] }, en: ["E"] }).en.thinking[0] === "E");

console.log("== 加权随机 ==");
ok("normalizeEntry: 字符串默认权重 1", JSON.stringify(T.normalizeEntry("a")) === JSON.stringify({ text: "a", weight: 1 }));
ok("normalizeEntry: 加权对象", JSON.stringify(T.normalizeEntry({ text: "b", weight: 3 })) === JSON.stringify({ text: "b", weight: 3 }));
ok("normalizeEntry: 非法权重按 1", T.normalizeEntry({ text: "b", weight: -2 }).weight === 1 && T.normalizeEntry({ text: "b", weight: 0 }).weight === 1 && T.normalizeEntry({ text: "b", weight: "x" }).weight === 1);
ok("normalizeEntry: 超上限权重钳制 1000", T.normalizeEntry({ text: "b", weight: 99999 }).weight === 1000);
ok("normalizeEntry: 缺 text / 非法类型返回 null", T.normalizeEntry({ weight: 3 }) === null && T.normalizeEntry(42) === null && T.normalizeEntry(null) === null && T.normalizeEntry("") === null);
ok("normalizeGroups: 加权条目保留对象、weight 1 回退字符串", (() => {
	const g = T.normalizeGroups(["a", { text: "b", weight: 3 }, { text: "c", weight: 1 }, { text: "", weight: 2 }, 5]);
	return g.thinking.length === 3 && g.thinking[0] === "a" && g.thinking[1].text === "b" && g.thinking[1].weight === 3 && g.thinking[2] === "c";
})());
ok("entryText/entryWeight 统一访问", T.entryText("x") === "x" && T.entryText({ text: "y", weight: 2 }) === "y" && T.entryWeight("x") === 1 && T.entryWeight({ text: "y", weight: 7 }) === 7);
ok("pickWeighted 按权重比例抽取(确定性 rand)", (() => {
	const list = [{ text: "a", weight: 1 }, { text: "b", weight: 9 }];
	return T.pickWeighted(list, null, () => 0.05) === "a" && T.pickWeighted(list, null, () => 0.5) === "b" && T.pickWeighted(list, null, () => 0.99) === "b";
})());
ok("pickWeighted 排除上次文本(权重置 0)", (() => {
	const list = [{ text: "a", weight: 1 }, { text: "b", weight: 9 }];
	return T.pickWeighted(list, "b", () => 0.95) === "a";
})());
ok("pickWeighted 单条/全排除退化为全体", (() => {
	const list = [{ text: "a", weight: 1 }];
	return T.pickWeighted(list, "a", () => 0.9) === "a" && ["a", "b"].includes(T.pickWeighted(["a", "b"], "a", () => 0.9));
})());
ok("uniformPick 排除重复", T.uniformPick(["a", "b", "c"], "a", () => 0) === "b" && T.uniformPick(["a", "b", "c"], "x", () => 0) === "a");
ok("uniformPick 全排除接受任意", T.uniformPick(["a"], "a", () => 0) === "a");
ok("parseWeightedLines 解析 `文本 | 权重`", (() => {
	const lines = T.parseWeightedLines("a\nb | 3\nc | 0\nd | x\n| 5\ne | 2.5\n\nf | 10 | 2");
	return lines.length === 7
		&& lines[0] === "a"
		&& lines[1].text === "b" && lines[1].weight === 3
		&& lines[2] === "c | 0"
		&& lines[3] === "d | x"
		&& lines[4] === "| 5"
		&& lines[5].text === "e" && lines[5].weight === 2.5
		&& lines[6].text === "f | 10" && lines[6].weight === 2;
})());
ok("phraseLines 回写 weight(weight 1 回退纯文本)", T.phraseLines(["a", { text: "b", weight: 3 }, { text: "c", weight: 1 }, null]) === "a\nb | 3\nc");
ok("normalizeConfig: weightedRandom 布尔/非法", T.normalizeConfig({ weightedRandom: true }).weightedRandom === true && T.normalizeConfig({ weightedRandom: "yes" }) === null);

console.log("== 词库包(packs)==");
ok("normalizePacks: 常规条目", (() => {
	const ps = T.normalizePacks([{ id: "a", label: { zh: "甲", en: "A" }, phrases: { zh: { thinking: ["x…"] } } }, { id: "b" }]);
	return ps.length === 2 && ps[0].label.en === "A" && ps[0].phrases.zh.thinking[0] === "x…" && ps[1].id === "b" && ps[1].phrases === undefined;
})());
ok("normalizePacks: 非法/重复 id 跳过", (() => {
	const ps = T.normalizePacks([{ id: "a" }, { id: "a" }, { id: "" }, { id: 7 }, null, "x"]);
	return ps.length === 1 && ps[0].id === "a";
})());
ok("normalizePacks: 非法输入返回 null", T.normalizePacks(null) === null && T.normalizePacks([]) === null && T.normalizePacks([{ id: "" }]) === null);
ok("mergeGroups: 核心优先、同文本跳过包内", (() => {
	const core = { zh: { thinking: ["a…", "b…"], running: ["r…"] } };
	const pack = { zh: { thinking: ["b…", "c…"], long: ["l…"] }, en: { thinking: ["E…"] } };
	const m = T.mergeGroups(core, pack);
	return m.zh.thinking.join("+") === "a…+b…+c…" && m.zh.long[0] === "l…" && m.en.thinking[0] === "E…" && m.zh.running[0] === "r…";
})());
ok("mergeGroups: 全空返回 null", T.mergeGroups(null, null) === null && T.mergeGroups({}, {}) === null);
ok("mergePackChain: enabledPacks 过滤", (() => {
	const core = { zh: { thinking: ["a…"] } };
	const packs = [{ id: "p1", phrases: { zh: { thinking: ["x…"] } } }, { id: "p2", phrases: { zh: { thinking: ["y…"] } } }];
	const all = T.mergePackChain(core, packs, null);
	const only1 = T.mergePackChain(core, packs, ["p1"]);
	const none = T.mergePackChain(core, packs, []);
	return all.zh.thinking.join("+") === "a…+x…+y…" && only1.zh.thinking.join("+") === "a…+x…" && none.zh.thinking.join("+") === "a…";
})());
ok("parseExternal: packs/enabledPacks 归一化", (() => {
	const doc = T.parseExternal({ config: { intervalMs: 5000 }, phrases: { zh: { thinking: ["a…"] } }, packs: [{ id: "c", phrases: { zh: { thinking: ["b…"] } } }], enabledPacks: ["c"] });
	return doc.packs.length === 1 && doc.packs[0].id === "c" && doc.enabledPacks.join() === "c" && doc.phrases.zh.thinking[0] === "a…";
})());
ok("parseExternal: enabledPacks 非法回退 null", T.parseExternal({ enabledPacks: [1, ""] }).enabledPacks === null);

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
ok("数值钳制:intervalMs 0 → 250;可关闭的键保持 0;未知字段丢弃",
	cfg.intervalMs === 250 && cfg.typeSpeedMs === 0 && cfg.liveTickMs === 0 && cfg.title.enabled === true && cfg.bogus === undefined);
ok("数值钳制:上限/负值", (() => {
	const c = T.normalizeConfig({ intervalMs: 99999999, longAfterMs: -100, typeSpeedMs: -5, reloadIntervalMs: 5 });
	return c.intervalMs === 3600000 && c.longAfterMs === 1000 && c.typeSpeedMs === 0 && c.reloadIntervalMs === 1000;
})());
ok("normalizeConfig: fontWeight 数字/关键字/数字字符串", (() => {
	const a = T.normalizeConfig({ fontWeight: 700 });
	const b = T.normalizeConfig({ fontWeight: "bold" });
	const c = T.normalizeConfig({ fontWeight: "600" });
	const d = T.normalizeConfig({ fontWeight: 0 });
	const e = T.normalizeConfig({ fontWeight: "inherit" });
	const f = T.normalizeConfig({ fontWeight: "9999px" });
	return a.fontWeight === 700 && b.fontWeight === "bold" && c.fontWeight === "600" && d === null && e.fontWeight === "inherit" && f === null;
})());

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
/* {pending} 的真实来源是 ctx.uiSession.pendingInteractions(SessionId → 交互),
   不是会话快照 —— dsh 0.1.5 的 SessionSnapshot 已无 pending 字段,这里守住计数语义。 */
ok("pendingCountOf: Map 命中当前会话为 1", T.pendingCountOf(new Map([["s1", { kind: "approval" }]]), "s1") === 1);
ok("pendingCountOf: 别的会话不计", T.pendingCountOf(new Map([["s2", {}]]), "s1") === 0);
ok("pendingCountOf: 空 map / 无会话 id 为 0",
	T.pendingCountOf(new Map(), "s1") === 0 && T.pendingCountOf(new Map([["s1", {}]]), null) === 0);
ok("pendingCountOf: null/undefined 值 = 该会话无交互", (() => {
	const map = new Map([["s1", null], ["s2", undefined]]);
	return T.pendingCountOf(map, "s1") === 0 && T.pendingCountOf(map, "s2") === 0;
})());
ok("pendingCountOf: 纯对象形态同样可用", T.pendingCountOf({ s1: { kind: "question" } }, "s1") === 1);
ok("pendingCountOf: 非 map/对象/抛错一律 0", (() => {
	const throwing = { entries: () => { throw new Error("boom"); } };
	return T.pendingCountOf(null, "s1") === 0 && T.pendingCountOf("s1", "s1") === 0 && T.pendingCountOf(throwing, "s1") === 0;
})());
ok("pendingCountOf: 数字与字符串会话 id 都认", T.pendingCountOf(new Map([[7, {}]]), "7") === 1);
ok("formatPending: 正常/负数/NaN/非数字", (() => {
	return T.formatPending(2) === "2" && T.formatPending(0) === "0" && T.formatPending(-3) === "0"
		&& T.formatPending(NaN) === "0" && T.formatPending("x") === "0" && T.formatPending(2.9) === "2";
})());
const m1 = T.extractModel({ provider: "deepseek", model: "deepseek-chat", reasoningEffort: "high" });
ok("extractModel 正常", m1.provider === "deepseek" && m1.model === "deepseek-chat");
ok("extractModel 非法返回空", T.extractModel(null).model === "" && T.extractModel("x").provider === "");
ok("pickModel 穿透 RpcResult 形态", (() => { const r = T.pickModel({ ok: true, value: { current: { provider: "p", model: "m" } } }); return r.provider === "p" && r.model === "m"; })());
ok("pickModel 直接形态", (() => { const r = T.pickModel({ current: { provider: "p2", model: "m2" } }); return r.model === "m2"; })());
ok("parseColorList 逗号分隔", JSON.stringify(T.parseColorList("#ff5f6d, #00ff88 ,#4da6ff")) === JSON.stringify(["#ff5f6d", "#00ff88", "#4da6ff"]));
ok("parseColorList 空/非法返回 []", T.parseColorList("  ,,  ").length === 0);
ok("parseColorList 中文逗号/换行分隔", T.parseColorList("#fff，#000\n#123") .length === 3);
ok("parseColorList 过滤 CSS 注入/非法色值", (() => {
	// "red" 本身是合法颜色名;注入载荷 "}html{display:none}" 会被丢弃
	const list = T.parseColorList("red;}html{display:none}, #gggggg, #4da6ff");
	return JSON.stringify(list) === JSON.stringify(["red", "#4da6ff"]);
})());
ok("parseColorList 保留合法写法(rgb/颜色名/8 位 hex)", (() => {
	const list = T.parseColorList("rgb(255, 0, 0), rebeccapurple, #ff5f6dcc");
	return list.length === 3;
})());
ok("invalidColorList 列出非法 token(设置页标红用)", (() => {
	return JSON.stringify(T.invalidColorList("#gggggg, #fff, url(//evil)")) === JSON.stringify(["#gggggg", "url(//evil)"]);
})());
ok("isSafeColorToken 拒绝 url()/花括号/超长", T.isSafeColorToken("url(//evil)") === false && T.isSafeColorToken("red;}") === false && T.isSafeColorToken("x".repeat(80)) === false);

console.log("== danmaku ==");
const dmCfg = T.normalizeConfig({ danmaku: { enabled: true, intervalMs: 5000, speedMs: 8000, fontSizeMin: 14, fontSizeMax: 30, rainbow: true, colors: ["#ff5f6d", "#00ff88"], color: "#fff", opacity: 0.4, maxCount: 6, zIndex: -1, scope: "all", marginTop: 8, marginBottom: 200 } });
ok("normalizeConfig: danmaku 字段", dmCfg.danmaku.enabled === true && dmCfg.danmaku.fontSizeMax === 30 && dmCfg.danmaku.zIndex === -1 && dmCfg.danmaku.scope === "all" && dmCfg.danmaku.maxCount === 6);
ok("normalizeConfig: danmaku 数值钳制 / 非法类型丢弃", (() => {
	const d = T.normalizeConfig({ danmaku: { enabled: "yes", opacity: 2, maxCount: 0, scope: "bad", zIndex: 0.5, marginTop: -3, intervalMs: 1000 } });
	return d.danmaku && d.danmaku.enabled === undefined && d.danmaku.opacity === 1 && d.danmaku.maxCount === 1 && d.danmaku.scope === undefined && d.danmaku.zIndex === 1 && d.danmaku.marginTop === undefined && d.danmaku.intervalMs === 1000;
})());
ok("normalizeConfig: 弹幕同屏上限钳到 60、颜色过滤非法值", (() => {
	const d = T.normalizeConfig({ danmaku: { enabled: true, maxCount: 9999, colors: ["#fff", "red;}html{display:none}"] } });
	return d.danmaku.maxCount === 60 && JSON.stringify(d.danmaku.colors) === JSON.stringify(["#fff"]);
})());
ok("normalizeConfig: danmaku 布尔简写", T.normalizeConfig({ danmaku: false }).danmaku.enabled === false);
ok("normalizeConfig: 全非法 danmaku 丢弃整块", T.normalizeConfig({ danmaku: { scope: "bad" } }) === null);
ok("danmakuPool all 去重合并", T.danmakuPool({ thinking: ["a", "b"], running: ["c"] }, "running", "all").join("+") === "a+b+c");
ok("danmakuPool 加权条目按文本去重并保留权重", (() => {
	const pool = T.danmakuPool({ thinking: ["a", { text: "b", weight: 3 }], running: ["b"] }, "running", "all");
	return pool.map((e) => T.entryText(e)).join("+") === "a+b" && pool[1].weight === 3;
})());
ok("danmakuPool phase 用当前阶段", T.danmakuPool({ thinking: ["a", "b"], running: ["c"] }, "running", "phase").join("+") === "c");
ok("danmakuPool phase 缺组回退", T.danmakuPool({ thinking: ["a"], running: [] }, "long", "phase").join("+") === "a");
ok("danmakuPool 空输入返回 []", T.danmakuPool(null, "running", "all").length === 0 && T.danmakuPool({}, "running", "all").length === 0);
ok("danmakuFontSpan 修正 min>max 并钳制", (() => { const s = T.danmakuFontSpan(40, 12); return s.min === 12 && s.max === 40; })());
ok("danmakuFontSpan 默认值", (() => { const s = T.danmakuFontSpan(undefined, undefined); return s.min === 14 && s.max === 30; })());
ok("danmakuMountPlan 正层级走 body 固定层", (() => { const p = T.danmakuMountPlan(3, false); return p.mode === "fixed" && p.z === "3"; })());
ok("danmakuMountPlan 负层级 + 有框架 → 框架内 z-index:-1", (() => { const p = T.danmakuMountPlan(-1, true); return p.mode === "frame" && p.z === "-1"; })());
ok("danmakuMountPlan 负层级 + 无框架 → 可见兜底(不用 -1)", (() => { const p = T.danmakuMountPlan(-1, false); return p.mode === "fixed" && p.z === "1"; })());
ok("danmakuMountPlan 非整数层级按默认 -1 处理", (() => { const p = T.danmakuMountPlan(undefined, true); return p.mode === "frame" && p.z === "-1"; })());
ok("danmakuMountPlan 0 层级合法(浮于界面之上)", (() => { const p = T.danmakuMountPlan(0, true); return p.mode === "fixed" && p.z === "0"; })());
ok("danmakuNeedsRemount 未挂载 → 重建", T.danmakuNeedsRemount({ layer: null, connected: false, parent: null, z: null }, { parent: "F", z: "-1" }) === true);
ok("danmakuNeedsRemount 目标一致 → 复用", T.danmakuNeedsRemount({ layer: "L", connected: true, parent: "F", z: "-1" }, { parent: "F", z: "-1" }) === false);
ok("danmakuNeedsRemount body 兜底 → 拿到框架后重建(本次失效的根因)", T.danmakuNeedsRemount({ layer: "L", connected: true, parent: "BODY", z: "1" }, { parent: "F", z: "-1" }) === true);
ok("danmakuNeedsRemount 层被外壳移除 → 重建", T.danmakuNeedsRemount({ layer: "L", connected: false, parent: "F", z: "-1" }, { parent: "F", z: "-1" }) === true);
ok("danmakuNeedsRemount 层级变化 → 重建", T.danmakuNeedsRemount({ layer: "L", connected: true, parent: "BODY", z: "-1" }, { parent: "BODY", z: "4" }) === true);
ok("isOpaqueBackgroundColor: rgb/rgba 不透明", T.isOpaqueBackgroundColor("rgb(21, 21, 23)") === true && T.isOpaqueBackgroundColor("rgba(0, 0, 0, 0.5)") === true);
ok("isOpaqueBackgroundColor: transparent / alpha=0 / 空值 → 透明", T.isOpaqueBackgroundColor("rgba(0, 0, 0, 0)") === false && T.isOpaqueBackgroundColor("transparent") === false && T.isOpaqueBackgroundColor("") === false && T.isOpaqueBackgroundColor(undefined) === false);
ok("isOpaqueBackgroundColor: 新语法按不透明处理", T.isOpaqueBackgroundColor("color(srgb 0.1 0.1 0.1)") === true);
ok("danmakuPanelFits: 会话面板(铺满会话列)合格", T.danmakuPanelFits({ width: 1160, height: 800 }, { width: 1160, height: 800 }) === true);
ok("danmakuPanelFits: 代码块/气泡这类小面积不合格", T.danmakuPanelFits({ width: 680, height: 240 }, { width: 1160, height: 800 }) === false);
ok("danmakuPanelFits: 参照框为零面积时拒绝", T.danmakuPanelFits({ width: 100, height: 100 }, { width: 0, height: 0 }) === false);
ok("randInt 区间内", (() => { let okAll = true; for (let i = 0; i < 50; i++) { const v = T.randInt(5, 7); if (v < 5 || v > 7) { okAll = false; break; } } return okAll; })());

console.log("== 弹幕类型(顶部 / 底部) ==");
ok("danmakuModeToken: scroll/top/bottom 与 bilibili 数字别名 1/4/5", T.danmakuModeToken("TOP") === "top" && T.danmakuModeToken("scroll") === "scroll" && T.danmakuModeToken(5) === "top" && T.danmakuModeToken(4) === "bottom" && T.danmakuModeToken(1) === "scroll" && T.danmakuModeToken("5") === "top");
ok("danmakuModeToken: 未知值 → null;normalizeDanmakuMode 回落 scroll(历史配置兼容)", T.danmakuModeToken("side") === null && T.danmakuModeToken(9) === null && T.normalizeDanmakuMode(undefined) === "scroll" && T.normalizeDanmakuMode("side") === "scroll" && T.normalizeDanmakuMode("bottom") === "bottom");
ok("DANMAKU_FIXED_DEFAULTS: 集中常量(白字 / 四向描边 / 边距 / 间距 / 时长 / 同屏上限 / 超限策略)", (() => {
	const f = T.DANMAKU_FIXED_DEFAULTS;
	return f.color === "#ffffff" && /rgba\(0,0,0/.test(f.shadow) && f.fontSize === 25 && f.marginTop === 16 && f.marginBottom === 160 && f.gap === 4 && f.durationMs === 4500 && f.maxCount === 3 && f.overflow === "drop";
})());
ok("pickDanmakuMode: 默认 滚动2:顶部1:底部1 按权重抽取", (() => {
	const types = { scroll: { weight: 2 }, top: { weight: 1 }, bottom: { weight: 1 } };
	const at = (r) => T.pickDanmakuMode(types, () => r);
	return at(0) === "scroll" && at(0.49) === "scroll" && at(0.5) === "top" && at(0.74) === "top" && at(0.75) === "bottom" && at(0.99) === "bottom";
})());
ok("pickDanmakuMode: enabled:false 不参与;三种全关 → null(这一拍不发)", (() => {
	const only = T.pickDanmakuMode({ scroll: { enabled: false }, top: { enabled: false }, bottom: { weight: 1 } }, () => 0.99);
	const none = T.pickDanmakuMode({ scroll: { enabled: false }, top: { enabled: false }, bottom: { enabled: false } }, () => 0.5);
	return only === "bottom" && none === null;
})());
ok("pickDanmakuMode: 缺 weight 按 1;权重全为 0 回落 scroll", T.pickDanmakuMode({ scroll: { enabled: false }, top: {} }, () => 0) === "top" && T.pickDanmakuMode({ scroll: { weight: 0 }, top: { weight: 0 }, bottom: { weight: 0 } }, () => 0.5) === "scroll");
ok("danmakuFreeLane: 取最小空闲车道,中间腾出来的车道会被复用", T.danmakuFreeLane([], 3) === 0 && T.danmakuFreeLane([0], 3) === 1 && T.danmakuFreeLane([0, 2], 3) === 1 && T.danmakuFreeLane([1, 2], 3) === 0);
ok("danmakuFreeLane: 车道占满返回 -1(这一拍不发);越界/非法车道号忽略,上限至少 1", T.danmakuFreeLane([0, 1, 2], 3) === -1 && T.danmakuFreeLane([0, 1, 2, 9, -1], 3) === -1 && T.danmakuFreeLane(null, 0) === 0 && T.danmakuFreeLane([0], 1) === -1);
ok("danmakuScrollBand: 关掉 reserve / 固定类型全关 → 旧行为整段", (() => {
	const fixed = { fontSize: 20, gap: 6, maxCount: 3, marginTop: 10, marginBottom: 20 };
	const off = T.danmakuScrollBand({ top: {}, bottom: {} }, fixed, false, 16, 160, 800, 22);
	const none = T.danmakuScrollBand({ top: { enabled: false }, bottom: { enabled: false } }, fixed, true, 16, 160, 800, 22);
	return off.start === 16 && off.end === 640 && none.start === 16 && none.end === 640;
})());
ok("danmakuScrollBand: 挖掉顶部 / 底部弹幕占用的竖直带", (() => {
	// rowH = round(20×1.35) = 27,bandH = 3×27 + 2×6 = 93
	const band = T.danmakuScrollBand({ top: {}, bottom: {} }, { fontSize: 20, gap: 6, maxCount: 3, marginTop: 10, marginBottom: 20 }, true, 16, 160, 800, 22);
	// 顶部:max(16, 10+93+6) = 109;底部:min(800-160, 800-(20+93)-6) = 640
	return band.start === 109 && band.end === 640;
})());
ok("danmakuScrollBand: 窗口太矮、区间被挤没 → 退回整段(滚动弹幕不会消失)", (() => {
	const band = T.danmakuScrollBand({ top: {}, bottom: {} }, { fontSize: 20, gap: 6, maxCount: 3, marginTop: 10, marginBottom: 20 }, true, 16, 160, 200, 22);
	return band.start === 16 && band.end === 40;
})());
ok("danmakuLaneOffset: 车道号 × (行高 + 间距),间距非法按 0", T.danmakuLaneOffset(0, 27, 6) === 0 && T.danmakuLaneOffset(1, 27, 6) === 33 && T.danmakuLaneOffset(2, 27, 6) === 66 && T.danmakuLaneOffset(2, 27, -1) === 54 && T.danmakuLaneOffset(undefined, 27, 6) === 0);
ok("danmakuStackFits: 堆到区域另一头就不再放", T.danmakuStackFits(100, 30, 200) === true && T.danmakuStackFits(180, 30, 200) === false && T.danmakuStackFits(NaN, 30, 200) === false);
ok("isSafeShadow: 放行合法 text-shadow,挡注入 / url()", T.isSafeShadow("1px 0 1px rgba(0,0,0,.85)") === true && T.isSafeShadow("red;}html{display:none") === false && T.isSafeShadow("url(//evil)") === false && T.isSafeShadow("") === false);
ok("normalizeConfig: mode / types / fixed 解析 + 范围钳制", (() => {
	const d = T.normalizeConfig({ danmaku: { mode: "TOP", types: { scroll: { weight: 999 }, top: false, bottom: { enabled: true, weight: 1 } }, fixed: { fontSize: 999, marginTop: -5, gap: 4, durationMs: 4500, maxCount: 2, color: "#fff", shadow: "1px 0 1px #000", overflow: "drop" } } });
	return d.danmaku.mode === "top" && d.danmaku.types.scroll.weight === 100 && d.danmaku.types.top.enabled === false && d.danmaku.types.bottom.weight === 1 &&
		d.danmaku.fixed.fontSize === 200 && d.danmaku.fixed.marginTop === 0 && d.danmaku.fixed.gap === 4 && d.danmaku.fixed.durationMs === 4500 && d.danmaku.fixed.maxCount === 2 &&
		d.danmaku.fixed.color === "#fff" && d.danmaku.fixed.shadow === "1px 0 1px #000" && d.danmaku.fixed.overflow === "drop";
})());
ok("normalizeConfig: fixed.zIndex 取整 + 钳制,默认 10(浮在聊天内容之上)", (() => {
	const hi = T.normalizeConfig({ danmaku: { fixed: { zIndex: 99999 } } });
	const lo = T.normalizeConfig({ danmaku: { fixed: { zIndex: -99999 } } });
	const frac = T.normalizeConfig({ danmaku: { fixed: { zIndex: 10.6 } } });
	return hi.danmaku.fixed.zIndex === 10000 && lo.danmaku.fixed.zIndex === -1000 && frac.danmaku.fixed.zIndex === 11 &&
		T.DANMAKU_FIXED_DEFAULTS.zIndex === 10 && T.DANMAKU_FIXED_LIMITS.zIndex[0] === -1000;
})());
ok("normalizeConfig: 非法 mode / 非法 fixed 值不写进配置", (() => {
	const d = T.normalizeConfig({ danmaku: { enabled: true, mode: "side", fixed: { shadow: "url(//evil)", color: "red;}" } } });
	return d.danmaku.enabled === true && d.danmaku.mode === undefined && d.danmaku.fixed === undefined;
})());
ok("向后兼容: 老配置(无 mode/types/fixed)归一化后形状不变", (() => {
	const d = T.normalizeConfig({ danmaku: { enabled: true, intervalMs: 2500 } });
	return d.danmaku.enabled === true && d.danmaku.intervalMs === 2500 && d.danmaku.mode === undefined && d.danmaku.types === undefined && d.danmaku.fixed === undefined;
})());

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
const communityPack = (doc) => doc.packs.find((p) => p.id === "community");
ok("applyToBank 写入「社区投稿」包(跳过核心已存在/建组)", (() => {
	const pk = communityPack(applied.doc);
	return applied.added === 2
		&& pk.phrases.zh.thinking === undefined
		&& pk.phrases.zh.running[0] === "新…"
		&& pk.phrases.en.long[0] === "Deep dive…"
		&& pk.label.zh === "社区投稿";
})());
ok("applyToBank 不动默认词库本体", bank.phrases.zh.running.length === 0 && bank.packs === undefined);
ok("applyToBank 重复提交复用同一包", (() => {
	const again = bot.applyToBank(applied.doc, [{ lang: "zh", phase: "thinking", text: "已有…" }, { lang: "zh", phase: "running", text: "再新…" }]);
	const pk = communityPack(again.doc);
	return again.added === 1 && pk.phrases.zh.running.length === 2 && pk.phrases.zh.thinking === undefined && again.doc.packs.length === 1;
})());
ok("buildSnippet 结构(社区投稿包形态)", (() => { const d = JSON.parse(bot.buildSnippet([{ lang: "zh", phase: "thinking", text: "a…" }])); return d.packs[0].id === "community" && d.packs[0].phrases.zh.thinking[0] === "a…"; })());
ok("查重覆盖词库包(包内已有文案会被跳过)", (() => {
	const bank2 = { phrases: {}, packs: [{ id: "community", phrases: { zh: { thinking: ["包内已有…"] } } }] };
	const s = bot.parseSubmission({ lang: ["zh"], phase: ["thinking"], phrases: "包内已有…", rules: ["x"] }, "");
	const r = bot.validateSubmission(s, bank2);
	return r.ok === false && r.skipped === 1 && r.errors.some((e) => e.includes("所有文案都已存在"));
})());
ok("投稿目标词库包:表单值解析/缺省回退", (() => {
	const a = bot.parseSubmission({ lang: ["zh"], phase: ["running"], phrases: "a", rules: ["x"], pack: "tech-toolchain (工具链日常)" }, "");
	const b = bot.parseSubmission({ lang: ["zh"], phase: ["running"], phrases: "a", rules: ["x"] }, "");
	const c = bot.parseSubmission({ lang: ["zh"], phase: ["running"], phrases: "a", rules: ["x"], pack: "???" }, "");
	return a.pack === "tech-toolchain" && b.pack === "community" && c.pack === "community";
})());
ok("投稿目标词库包:正文「目标词库包」段解析", (() => {
	const s = bot.parseSubmission({}, "### 语种\n\nzh (中文)\n\n### 分组\n\nrunning (运行中)\n\n### 目标词库包\n\nmath-cosmos (数学与宇宙)\n\n### 文案(每行一条)\n\n```text\n测试…\n```\n\n### 提交须知\n\n- [x] 我已自查");
	return s.pack === "math-cosmos" && s.phrases[0] === "测试…";
})());
ok("applyToBank 写入指定默认包(目标存在/不存在回退)", (() => {
	const bank3 = { phrases: {}, packs: [{ id: "tech-toolchain", phrases: { zh: { running: ["已有包内…"] } } }] };
	const r1 = bot.applyToBank(bank3, [{ lang: "zh", phase: "running", text: "新包…" }], "tech-toolchain");
	const r2 = bot.applyToBank(bank3, [{ lang: "zh", phase: "running", text: "回退…" }], "no-such-pack");
	const r3 = bot.applyToBank(bank3, [{ lang: "zh", phase: "running", text: "默认…" }]);
	return r1.doc.packs[0].phrases.zh.running.join("|") === "已有包内…|新包…"
		&& r1.doc.packs.length === 1
		&& r2.doc.packs.some((p) => p.id === "no-such-pack")
		&& r3.doc.packs.some((p) => p.id === "community" && !p.phrases.zh.running.some((e) => typeof e === "string" && e.includes("不属于")))
		&& r3.added === 1;
})());
ok("buildSnippet 支持指定包", (() => {
	const d = JSON.parse(bot.buildSnippet([{ lang: "zh", phase: "thinking", text: "a…" }], "ai-drama", { zh: "AI 圈恩怨", en: "AI drama" }));
	return d.packs[0].id === "ai-drama" && d.packs[0].label.zh === "AI 圈恩怨" && d.packs[0].phrases.zh.thinking[0] === "a…";
})());
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
ok("接受加权文案条目", accepts({ phrases: { zh: { thinking: ["a", { text: "b", weight: 3 }] } } }));
ok("接受加权条目缺 weight(默认 1)", accepts({ phrases: { zh: { thinking: [{ text: "b" }] } } }));
ok("拒绝非法加权条目(weight 为字符串)", !accepts({ phrases: { zh: { thinking: [{ text: "a", weight: "3" }] } } }));
ok("拒绝非法加权条目(weight<=0)", !accepts({ phrases: { zh: { thinking: [{ text: "a", weight: 0 }] } } }));
ok("拒绝非法加权条目(缺 text)", !accepts({ phrases: { zh: { thinking: [{ weight: 3 }] } } }));
ok("接受词库包文档", accepts({ phrases: { zh: { thinking: ["a"] } }, packs: [{ id: "community", label: { zh: "社区投稿" }, phrases: { zh: { thinking: ["b"] } } }], enabledPacks: ["community"] }));
ok("拒绝重复包 id", !accepts({ packs: [{ id: "x" }, { id: "x" }] }));
ok("拒绝非法包(缺 id / phrases 数字)", !accepts({ packs: [{ phrases: {} }] }) && !accepts({ packs: [{ id: "x", phrases: { zh: [1] } }] }));
ok("拒绝非法 enabledPacks", !accepts({ enabledPacks: [1] }) && !accepts({ enabledPacks: "x" }) && !accepts({ enabledPacks: [""] }));
	ok("兼容旧格式纯文案表", accepts({ phrases: { zh: ["a", "b"], en: ["c"] } }));
	ok("接受 danmaku 配置", accepts({ config: { danmaku: { enabled: true, zIndex: -1, scope: "all" } } }));
	ok("mergeDocuments: settings 层覆盖文件层", (() => {
		const m = node.mergeDocuments({ config: { gradient: { enabled: true } }, phrases: { zh: ["a"] } }, { config: { gradient: { enabled: false } }, presets: [{ id: "x" }] });
		return m.config.gradient.enabled === false && m.presets[0].id === "x" && m.phrases.zh[0] === "a";
	})());
	ok("mergeDocuments: 无 settings 返回文件层", node.mergeDocuments({ a: 1 }, null).a === 1);
	ok("mergeDocuments: settings 全量覆盖", (() => { const m = node.mergeDocuments({ a: 1, b: 2 }, { b: 3, c: 4 }); return m.a === 1 && m.b === 3 && m.c === 4; })());
	// 命名空间解析:新版 dsh-settings 只导出 {SettingsConflictError, SettingsProvider, redactSecrets},
	// 旧代码直接调 settingsNamespace() 会抛错并被静默吞掉 —— 用户配置整条链路失效
	ok("resolveSettingsNamespace: 新版(无 settingsNamespace)回退到名字", node.resolveSettingsNamespace({ SettingsProvider: function () {} }, "status-rotator") === "status-rotator");
	ok("resolveSettingsNamespace: 旧版有 helper 时用它的返回值", node.resolveSettingsNamespace({ settingsNamespace: (n) => "ns:" + n }, "status-rotator") === "ns:status-rotator");
	ok("resolveSettingsNamespace: helper 抛错/返回空 → 回退", node.resolveSettingsNamespace({ settingsNamespace: () => { throw new Error("boom"); } }, "status-rotator") === "status-rotator" && node.resolveSettingsNamespace({ settingsNamespace: () => "" }, "status-rotator") === "status-rotator");

	// 路由注册/卸载:早返回丢掉 disposer 会让插件重载时 duplicate route 抛错
	console.log("== 路由注册与卸载 ==");
	const registeredRoutes = new Map();
	const fakeServer = {
		register: (route) => {
			registeredRoutes.set(route.path, route);
			return () => registeredRoutes.delete(route.path);
		}
	};
	let routeCleanup = null;
	node.apply({
		get: (name) => (name === "webServer" ? fakeServer : null),
		effect: (cb) => { const cleanup = cb(); if (typeof cleanup === "function") routeCleanup = cleanup; return () => {}; }
	});
	ok("apply 注册了 config.json 路由", registeredRoutes.has("/plugins/dsh-status-rotator/config.json"));
	ok("effect 返回了清理函数", typeof routeCleanup === "function");
	if (typeof routeCleanup === "function") routeCleanup();
	ok("卸载后路由被真正移除(disposer 不泄漏)", registeredRoutes.size === 0, "剩余=" + [...registeredRoutes.keys()].join(","));

	// 配置写接口的栅栏与内容归一化(阻断级:任意网页可 POST 改写本地配置)
	console.log("== 配置安全栅栏 ==");
	ok("写请求:text/plain(跨站简单请求)被拒", !node.isTrustedWrite({ headers: { "content-type": "text/plain", "sec-fetch-site": "cross-site" } }));
	ok("写请求:application/json + same-origin 放行", node.isTrustedWrite({ headers: { "content-type": "application/json; charset=utf-8", "sec-fetch-site": "same-origin", origin: "http://127.0.0.1:48888", host: "127.0.0.1:48888" } }));
	ok("写请求:无 Origin/无 sec-fetch-site(命令行)放行", node.isTrustedWrite({ headers: { "content-type": "application/json" } }));
	ok("写请求:Origin 与 Host 不同源被拒", !node.isTrustedWrite({ headers: { "content-type": "application/json", origin: "http://evil.example", host: "127.0.0.1:48888" } }));
	ok("写请求:sec-fetch-site=cross-site 被拒", !node.isTrustedWrite({ headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" } }));
	ok("读请求:cross-site 被拒、同源放行", !node.isTrustedRead({ headers: { "sec-fetch-site": "cross-site" } }) && node.isTrustedRead({ headers: { "sec-fetch-site": "same-origin" } }) && node.isTrustedRead({ headers: {} }));
	ok("sanitizeConfigDocument: 颜色白名单挡住 CSS 注入", (() => {
		const out = node.sanitizeConfigDocument({ config: { gradient: { colors: ["red;}html{display:none}.x{color:red", "#fff"] } } });
		return JSON.stringify(out.config.gradient.colors) === JSON.stringify(["#fff"]);
	})());
	ok("sanitizeConfigDocument: 数值钳制(intervalMs/danmaku.maxCount)", (() => {
		const out = node.sanitizeConfigDocument({ config: { intervalMs: 1, danmaku: { intervalMs: 1, maxCount: 99999, zIndex: -2147483648 } } });
		return out.config.intervalMs === 250 && out.config.danmaku.intervalMs === 200 && out.config.danmaku.maxCount === 60 && out.config.danmaku.zIndex === -1000;
	})());
	const exampleDoc = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.example.json"), "utf8"));

	// 外部词库热重载:进程运行期检测文件变更并重载;内置词库始终是兜底
	console.log("== 外部词库热重载(bank)==");
	const os = require("os");
	const bankDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-status-rotator-bank-"));
	const bankFile = path.join(bankDir, "phrases.json");
	const prevBankEnv = process.env.DSH_STATUS_ROTATOR_BANK;
	process.env.DSH_STATUS_ROTATOR_BANK = bankFile;
	try {
		ok("默认路径遵循 $DSH_HOME/status-rotator/phrases.json", (() => {
			const prevHome = process.env.DSH_HOME;
			delete process.env.DSH_STATUS_ROTATOR_BANK;
			process.env.DSH_HOME = path.join(bankDir, "dsh-home");
			const p = node.externalBankPath();
			if (prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome;
			process.env.DSH_STATUS_ROTATOR_BANK = bankFile;
			return p === path.join(bankDir, "dsh-home", "status-rotator", "phrases.json");
		})());
		ok("文件不存在 → null(内置词库兜底)", (await node.externalBankDocument()) === null && node.externalBankStatus().loaded === false);
		fs.writeFileSync(bankFile, JSON.stringify({ config: { intervalMs: 1 }, packs: [{ id: "deepseek", phrases: { zh: { thinking: ["热重载A…"] } } }] }));
		const firstBank = await node.externalBankDocument();
		ok("读取外部词库的 packs / phrases", firstBank.packs.length === 1 && firstBank.packs[0].phrases.zh.thinking[0] === "热重载A…");
		ok("词库文件不接管 config(只认 packs / phrases)", firstBank.config === undefined);
		ok("状态:已加载 + reloads=1", node.externalBankStatus().loaded === true && node.externalBankStatus().reloads === 1);
		ok("内容未变时不重复加载(reloads 不变)", (await node.externalBankDocument()) !== null && node.externalBankStatus().reloads === 1);
		fs.writeFileSync(bankFile, JSON.stringify({ packs: [{ id: "deepseek", phrases: { zh: { thinking: ["热重载B…"] } } }] }));
		const secondBank = await node.externalBankDocument();
		ok("文件变更被检测到并重载", secondBank.packs[0].phrases.zh.thinking[0] === "热重载B…" && node.externalBankStatus().reloads === 2);
		fs.writeFileSync(bankFile, "{ 坏掉的 JSON");
		ok("损坏文件保留上一次成功值并记录 error", (await node.externalBankDocument()).packs[0].phrases.zh.thinking[0] === "热重载B…" && typeof node.externalBankStatus().error === "string");
		ok("生效文档:词库文件覆盖设置层的同名包,未声明的包原样保留", (() => {
			const merged = node.mergeLayers(exampleDoc, null, { packs: [{ id: "deepseek", phrases: { zh: { thinking: ["设置层…"] } } }] }, secondBank);
			const deepseek = merged.packs.find((p) => p.id === "deepseek");
			const coding = merged.packs.find((p) => p.id === "coding");
			const codingBuiltIn = exampleDoc.packs.find((p) => p.id === "coding");
			return deepseek.phrases.zh.thinking.length === 1 && deepseek.phrases.zh.thinking[0] === "热重载B…"
				&& coding.phrases.zh.thinking.length === codingBuiltIn.phrases.zh.thinking.length;
		})());
		fs.rmSync(bankFile, { force: true });
		ok("文件删除后回落到内置词库", (await node.externalBankDocument()) === null && node.externalBankStatus().loaded === false);
	} finally {
		if (prevBankEnv === undefined) delete process.env.DSH_STATUS_ROTATOR_BANK; else process.env.DSH_STATUS_ROTATOR_BANK = prevBankEnv;
		fs.rmSync(bankDir, { recursive: true, force: true });
	}

	// 设置命名空间只存「差异」:整份词库留在 config.example.json,不再灌进 settings.yaml
	console.log("== 设置差异存储(delta)==");
	ok("deltaOf: 完全一致 → 空差异", JSON.stringify(node.deltaOf({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })) === "{}");
	ok("deltaOf: 只留改动过的标量键", (() => {
		const d = node.deltaOf({ intervalMs: 10000, debug: false }, { intervalMs: 9999, debug: false });
		return JSON.stringify(d) === JSON.stringify({ intervalMs: 9999 }) && !("debug" in d);
	})());
	ok("deltaOf: 词库包不动就不进差异(整份词库不落盘)", (() => {
		const packs = [{ id: "p", phrases: { zh: { thinking: ["a\u2026"] } } }];
		const d = node.deltaOf({ config: { intervalMs: 10000 }, packs }, { config: { intervalMs: 10000 }, packs: JSON.parse(JSON.stringify(packs)) });
		return JSON.stringify(d) === "{}";
	})());
	ok("deltaOf: 数组整体替换(删掉一条也记下来)", (() => {
		const d = node.deltaOf({ packs: [{ id: "p", phrases: { zh: { thinking: ["a", "b"] } } }] }, { packs: [{ id: "p", phrases: { zh: { thinking: ["a"] } } }] });
		return d.packs.length === 1 && d.packs[0].phrases.zh.thinking.length === 1;
	})());
	ok("deltaOf: 对象数组按 id 逐条求差异(只动过的那个包进差异)", (() => {
		const bundled = { packs: [{ id: "a", phrases: { zh: { thinking: ["x\u2026"] } } }, { id: "b", phrases: { zh: { thinking: ["y\u2026"] } } }] };
		const doc = JSON.parse(JSON.stringify(bundled));
		doc.packs[1].phrases.zh.thinking.push("y2\u2026");
		const d = node.deltaOf(bundled, doc);
		return d.packs.length === 1 && d.packs[0].id === "b" && d.packs[0].phrases.zh.thinking.length === 2;
	})());
	ok("deltaOf: 删掉一个包写成墓碑(不写就会被 base 顶回来)", (() => {
		const bundled = { packs: [{ id: "a", label: "A" }, { id: "b", label: "B" }] };
		const d = node.deltaOf(bundled, { packs: [{ id: "a", label: "A" }] });
		return d.packs.length === 1 && d.packs[0].id === "b" && d.packs[0][node.ARRAY_DELETED_KEY] === true;
	})());
	ok("mergeLayers: 墓碑真删、keyed 合并保持 base 顺序、新条目排最后", (() => {
		const bundled = { packs: [{ id: "a" }, { id: "b" }, { id: "c" }] };
		const m = node.mergeLayers(bundled, { packs: [{ id: "b", label: "B2" }, { id: "z" }] }, { packs: [{ id: "a", [node.ARRAY_DELETED_KEY]: true }] });
		return m.packs.map((p) => p.id).join(",") === "b,c,z" && m.packs[0].label === "B2";
	})());
	ok("mergeLayers(bundled, deltaOf(bundled, doc)):带删除也等价于 doc", (() => {
		const bundled = { packs: [{ id: "a", phrases: { zh: { thinking: ["x\u2026"] } } }, { id: "b", phrases: { zh: { thinking: ["y\u2026"] } } }], enabledPacks: ["a", "b"] };
		const doc = { packs: [{ id: "a", phrases: { zh: { thinking: ["x2\u2026"] } } }], enabledPacks: ["a"] };
		return node.deepEqualJson(node.mergeLayers(bundled, node.deltaOf(bundled, doc)), doc);
	})());
	ok("deltaOf: 没有唯一 id 的数组仍整体替换(enabledPacks / schedule)", (() => {
		const d = node.deltaOf({ enabledPacks: ["a", "b"], schedule: [{ preset: "p" }] }, { enabledPacks: ["a"], schedule: [{ preset: "p" }, { preset: "q" }] });
		return d.enabledPacks.length === 1 && d.schedule.length === 2;
	})());
	ok("mergeLayers: base 没有该数组时,墓碑不能漏进生效文档", (() => {
		const m = node.mergeLayers({}, { presets: [{ id: "a" }, { id: "b", [node.ARRAY_DELETED_KEY]: true }] });
		return m.presets.length === 1 && m.presets[0].id === "a" && !JSON.stringify(m).includes(node.ARRAY_DELETED_KEY);
	})());
	// 遗留整库收敛:随包词库自己会变(加词条 / 调排版),老库不能整份照写回去,
	// 否则「只存差异」在真实升级路径上就是空转(0.19.1 的真机实测)。
	console.log("== 遗留整库收敛(pruneShippedBloat)==");
	ok("pruneShippedBloat: 旧版随包词库(少一条 + 排版不同)→ 差异被剔空", (() => {
		const bundled = { packs: [{ id: "p", phrases: { zh: { thinking: ["正在 路由 A 写代码\u2026", "正在摸鱼\u2026"] } } }] };
		const legacy = { packs: [{ id: "p", phrases: { zh: { thinking: ["正在路由A写代码\u2026"] } } }] };
		return Object.keys(node.pruneShippedBloat(bundled, node.deltaOf(bundled, legacy))).length === 0;
	})());
	ok("pruneShippedBloat: 用户自己写的词条一条不丢", (() => {
		const bundled = { packs: [{ id: "p", phrases: { zh: { thinking: ["随包一条\u2026"] } } }] };
		const legacy = { packs: [{ id: "p", phrases: { zh: { thinking: ["随包一条\u2026", "我自己加的\u2026"] } } }] };
		const pruned = node.pruneShippedBloat(bundled, node.deltaOf(bundled, legacy));
		const served = node.mergeLayers(bundled, pruned);
		return pruned.packs.length === 1 && served.packs[0].phrases.zh.thinking.includes("我自己加的\u2026");
	})());
	ok("pruneShippedBloat: 顶层遗留单体词库只留随包没有的条目", (() => {
		const bundled = { packs: [{ id: "p", phrases: { zh: { thinking: ["随包A\u2026"] } } }], phrases: {} };
		const legacy = { phrases: { zh: { thinking: ["随包A\u2026", "遗留独有\u2026"] } } };
		const pruned = node.pruneShippedBloat(bundled, node.deltaOf(bundled, legacy));
		return JSON.stringify(pruned.phrases) === JSON.stringify({ zh: { thinking: ["遗留独有\u2026"] } });
	})());
	ok("pruneShippedBloat: 只剩空壳的包直接删掉,不留 packs 键", (() => {
		const bundled = { packs: [{ id: "p", phrases: { zh: { running: ["随包\u2026"] } } }] };
		const legacy = { packs: [{ id: "p", phrases: { zh: { running: ["随包\u2026"], thinking: [], long: [] } } }] };
		return !("packs" in node.pruneShippedBloat(bundled, node.deltaOf(bundled, legacy)));
	})());
	ok("pruneShippedBloat: 用户自建的包(随包没有的 id)整条保留", (() => {
		const bundled = { packs: [{ id: "p", phrases: { zh: { running: ["随包\u2026"] } } }] };
		const legacy = { packs: [{ id: "p", phrases: { zh: { running: ["随包\u2026"] } } }, { id: "mine", phrases: { zh: { running: ["自建\u2026"] } } }] };
		const pruned = node.pruneShippedBloat(bundled, node.deltaOf(bundled, legacy));
		return pruned.packs.length === 1 && pruned.packs[0].id === "mine";
	})());
	ok("真实升级路径:老库少一条 + 用户调过开关 → 收敛成小差异且不丢词库", (() => {
		const bundled = exampleDoc;
		const legacy = JSON.parse(JSON.stringify(bundled)); // 老安装:整份词库写进了设置存储
		legacy.packs[1].phrases.zh.thinking.pop();          // 老库比随包少一条(随包后来加过词条)
		legacy.config.intervalMs = 9999;                    // 用户改过的开关
		legacy.enabledPacks = legacy.enabledPacks.slice(0, 4);
		const next = { ...node.pruneShippedBloat(bundled, node.deltaOf(bundled, legacy)), [node.SETTINGS_VERSION_KEY]: 2 };
		const served = node.contentTypeOf(node.mergeLayers(bundled, null, next));
		const countPhrases = (v) => Array.isArray(v) ? v.length : (v && typeof v === "object" ? Object.values(v).reduce((sum, x) => sum + countPhrases(x), 0) : 0);
		return JSON.stringify(next).length < 400
			&& !("packs" in next) && !("phrases" in next)
			&& next.config.intervalMs === 9999
			&& served.packs.length === 12
			&& served.packs.reduce((n, pack) => n + countPhrases(pack.phrases), 0) === 1077
			&& served.config.intervalMs === 9999
			&& !(node.SETTINGS_VERSION_KEY in served);
	})());
	ok("mergeLayers(bundled, deltaOf(bundled, doc)) 等价于 doc", (() => {
		const bundled = exampleDoc;
		const doc = JSON.parse(JSON.stringify(bundled));
		doc.config.intervalMs = 9999;
		doc.packs[1].phrases.zh.thinking.push("新增一条\u2026");
		doc.enabledPacks = doc.enabledPacks.slice(0, 3);
		const merged = node.mergeLayers(bundled, node.deltaOf(bundled, doc));
		return node.deepEqualJson(merged, doc) && merged.packs.length === bundled.packs.length;
	})());
	ok("mergeLayers: 对象递归、数组整体替换", (() => {
		const m = node.mergeLayers({ config: { a: 1, b: 2 }, phrases: { zh: ["x"] } }, { config: { b: 3 }, phrases: { zh: ["y"] } });
		return m.config.a === 1 && m.config.b === 3 && m.phrases.zh[0] === "y";
	})());
	ok("mergeDocuments 保持顶层覆盖语义", (() => {
		const m = node.mergeDocuments({ config: { a: 1 } }, { config: { b: 2 } });
		return m.config.a === undefined && m.config.b === 2;
	})());
	ok("contentTypeOf: 内部标记键不发给浏览器", (() => {
		const out = node.contentTypeOf({ config: { intervalMs: 1 }, [node.SETTINGS_VERSION_KEY]: 1 });
		return out.config.intervalMs === 1 && !(node.SETTINGS_VERSION_KEY in out);
	})());
	// 生效文档 = 内置默认(完整词库)+ 文件层 + 用户差异,所以「只存差异」不会丢词库。
	// (装载后 settings.yaml 的真实体积对比见 CHANGELOG 里的复现数据。)
	{
		const userDelta = node.deltaOf(exampleDoc, node.mergeLayers(exampleDoc, { config: { intervalMs: 9999 } }));
		const served = node.contentTypeOf(node.mergeLayers(exampleDoc, null, node.mergeLayers(exampleDoc, userDelta)));
		const countPhrases = (v) => Array.isArray(v) ? v.length : (v && typeof v === "object" ? Object.values(v).reduce((sum, x) => sum + countPhrases(x), 0) : 0);
		ok("生效文档仍带完整词库(12 包 1077 条)", served.packs.length === 12 && served.packs.reduce((n, pack) => n + countPhrases(pack.phrases), 0) === 1077);
		ok("生效文档合并了用户差异(intervalMs=9999)", served.config.intervalMs === 9999);
		ok("生效文档保留用户没改的内置默认键", served.config.typeSpeedMs === exampleDoc.config.typeSpeedMs && served.config.gradient.colors.length === exampleDoc.config.gradient.colors.length);
		ok("生效文档不泄漏内部标记键", !(node.SETTINGS_VERSION_KEY in served));
		ok("原样提交 config.example.json 的差异里没有词库", Object.keys(node.deltaOf(exampleDoc, exampleDoc)).length === 0);
	}
	ok("sanitizeConfigDocument: 预设内 config 同样处理", (() => {
		const out = node.sanitizeConfigDocument({ presets: [{ id: "p", config: { intervalMs: 0, gradient: { colors: ["ok"] } } }] });
		return out.presets[0].config.intervalMs === 250 && out.presets[0].config.gradient.colors.length === 0;
	})());
	ok("sanitizeConfigDocument: 可关闭键保留 0", (() => {
		const out = node.sanitizeConfigDocument({ config: { reloadIntervalMs: 0, liveTickMs: 0, typeSpeedMs: 0 } });
		return out.config.reloadIntervalMs === 0 && out.config.liveTickMs === 0 && out.config.typeSpeedMs === 0;
	})());
	ok("sanitizeConfigDocument: 弹幕类型 / 顶部底部样式归一化", (() => {
		const out = node.sanitizeConfigDocument({ config: { danmaku: { mode: "TOP", types: { scroll: { weight: 999 }, top: false, bottom: { enabled: true, weight: -3 } }, fixed: { fontSize: 999, marginTop: -5, gap: 4, durationMs: 4500, maxCount: 2, color: "#fff", shadow: "red;}x{y:1" } } } });
		const d = out.config.danmaku;
		return d.mode === "top" && d.types.scroll.weight === 100 && d.types.top.enabled === false && d.types.bottom.weight === 0 &&
			d.fixed.fontSize === 200 && d.fixed.marginTop === 0 && d.fixed.maxCount === 2 && d.fixed.color === "#fff" && d.fixed.shadow === undefined;
	})());
	ok("sanitizeConfigDocument: 弹幕 fixed.zIndex 同样钳制并取整", (() => {
		const out = node.sanitizeConfigDocument({ config: { danmaku: { fixed: { zIndex: 99999 } } } });
		const frac = node.sanitizeConfigDocument({ config: { danmaku: { fixed: { zIndex: -7.6 } } } });
		return out.config.danmaku.fixed.zIndex === 10000 && frac.config.danmaku.fixed.zIndex === -8;
	})());
	ok("sanitizeConfigDocument: 非法弹幕类型 / 样式被剔除,老配置不受影响", (() => {
		const bad = node.sanitizeConfigDocument({ config: { danmaku: { enabled: true, mode: "side", types: "x", fixed: { shadow: "url(//evil)" } } } });
		const old = node.sanitizeConfigDocument({ config: { danmaku: { enabled: true, intervalMs: 2500 } } });
		return bad.config.danmaku.mode === undefined && bad.config.danmaku.types === undefined && bad.config.danmaku.fixed === undefined &&
			old.config.danmaku.enabled === true && old.config.danmaku.intervalMs === 2500;
	})());

	// 默认配置数据完整性:短语省略号统一,config 关键字段不被污染
	console.log("== 默认配置数据完整性 ==");
	const { validateConfigDocumentData } = require("./unify-ellipsis.cjs");
	const dataIssues = validateConfigDocumentData(exampleDoc);
	ok("config.example.json: 短语全部 … 结尾且 config 未被污染", dataIssues.length === 0);
	if (dataIssues.length > 0) console.error("  issues:", dataIssues.slice(0, 5).join("; "));
	ok("渐变颜色无污染", exampleDoc.config.gradient.colors.every((c) => !c.includes("\u2026")));
	ok("弹幕颜色/单色无污染", exampleDoc.config.danmaku.colors.every((c) => !c.includes("\u2026")) && !exampleDoc.config.danmaku.color.includes("\u2026"));
	ok("弹幕默认层级为 -1(界面后面)", exampleDoc.config.danmaku.zIndex === -1);
	ok("标题模板保留有意省略号", exampleDoc.config.title.templates.some((t) => t.includes("\u2026")));

	console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
	process.exit(failed === 0 ? 0 : 1);
})();
