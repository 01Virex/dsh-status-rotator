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

console.log("== dsh 0.1.7 运行中标签(时长并进文本)解析 ==");
// 0.1.7 起宿主把时长写进同一段文本:en "Deep diving for 12s" / zh "深度求索中，用时12秒"
const chatDict017 = {
	zh: (key, params) => {
		if (key === "chat.deepDiving") return "深度求索中";
		if (key === "message.turnProcess.deepDivingFor") return String(params && params.duration !== undefined ? "深度求索中，用时" + params.duration : key);
		return key;
	},
	en: (key, params) => {
		if (key === "chat.deepDiving") return "Deep diving...";
		if (key === "message.turnProcess.deepDivingFor") return String(params && params.duration !== undefined ? "Deep diving for " + params.duration : key);
		return key;
	},
};
ok("resolveDiveDurationPrefix: en 模板前缀({duration} 传空串)",
	T.resolveDiveDurationPrefix(chatDict017.en, "en") === "Deep diving for ");
ok("resolveDiveDurationPrefix: zh 模板前缀",
	T.resolveDiveDurationPrefix(chatDict017.zh, "zh") === "深度求索中，用时");
ok("resolveDiveDurationPrefix: 字典未注册(返回 key)按 locale 回退",
	T.resolveDiveDurationPrefix((k) => k, "zh") === "深度求索中，用时" && T.resolveDiveDurationPrefix((k) => k, "en") === "Deep diving for ");
ok("resolveDiveDurationPrefix: 模板仍有占位符时回退",
	T.resolveDiveDurationPrefix(() => "{duration}", "en") === "Deep diving for ");
ok("resolveDiveDurationPrefix: 无翻译函数回退",
	T.resolveDiveDurationPrefix(null, "zh") === "深度求索中，用时");
const prefixEn = T.resolveDiveDurationPrefix(chatDict017.en, "en");
const prefixZh = T.resolveDiveDurationPrefix(chatDict017.zh, "zh");
const labelZh017 = T.resolveDiveLabel(chatDict017.zh, "zh");
ok("matchDiveLabel: en 运行中标签取出时长",
	T.matchDiveLabel("Deep diving for 12s", "Deep diving...", prefixEn) === "12s");
ok("matchDiveLabel: zh 运行中标签取出时长",
	T.matchDiveLabel("深度求索中，用时1分02秒", labelZh017, prefixZh) === "1分02秒");
ok("matchDiveLabel: 旧宿主初始文案命中、时长为空(时长在时钟子元素里)",
	T.matchDiveLabel("Deep diving...", "Deep diving...", prefixEn) === "" && T.matchDiveLabel("深度求索中...15秒", "深度求索中...", prefixZh) === "");
ok("matchDiveLabel: 语言切换瞬间按已知前缀兜底",
	T.matchDiveLabel("Deep diving for 3s", "深度求索中", prefixZh) === "3s" && T.matchDiveLabel("深度求索中，用时3秒", "Deep diving...", prefixEn) === "3秒");
ok("matchDiveLabel: 回合结束文案不算运行中",
	T.matchDiveLabel("Worked", "Deep diving...", prefixEn) === null
	&& T.matchDiveLabel("Took 12s", "Deep diving...", prefixEn) === null
	&& T.matchDiveLabel("Failed", "Deep diving...", prefixEn) === null
	&& T.matchDiveLabel("Stopped", "Deep diving...", prefixEn) === null
	&& T.matchDiveLabel("已完成分析", "深度求索中", prefixZh) === null);
ok("matchDiveLabel: 空文本不被误判",
	T.matchDiveLabel("", "Deep diving...", prefixEn) === null);
ok("matchDiveLabel: 时长文本可被 parseClock 解析(phase / {elapsed} 依赖)",
	T.parseClock(T.matchDiveLabel("Deep diving for 1m 02s", "Deep diving...", prefixEn)) === 62
	&& T.parseClock(T.matchDiveLabel("深度求索中，用时20秒", labelZh017, prefixZh)) === 20);

console.log("== 观测通道:结构化重试事件(参考 deepseek-harness discussion #3669)==");
/** 客户端事件窗口的条目形状:{ type: "event", event: { type, seq, time, data } } */
const ev = (type, data) => ({ type: "event", event: { type, seq: 1, time: 1, data: data || {} } });
const RETRY_EVENT = ev("llm/retry", {
	retryId: "r1", turn: 1, step: 2, provider: "deepseek-official", mode: "normal",
	policyKey: "k", retry: 3, maxRetries: 5, delayMs: 2500,
	failure: { code: "sampling_error", message: "connect ECONNREFUSED https://api.internal.example/v1" },
});
ok("retryStateFromEntries: llm/retry → 次数 / 上限 / provider / code",
	(() => { const s = T.retryStateFromEntries([RETRY_EVENT], null);
		return s && s.retry === 3 && s.max === 5 && s.provider === "deepseek-official" && s.code === "sampling_error" && s.started === false; })());
ok("retryStateFromEntries: 失败报文里的 message 绝不外带(凭据 / URL 不外泄)",
	(() => { const s = T.retryStateFromEntries([RETRY_EVENT], null);
		return !!s && !Object.prototype.hasOwnProperty.call(s, "message") && JSON.stringify(s).indexOf("api.internal.example") === -1; })());
ok("retryStateFromEntries: llm/retry-started 标记这次重试已开始跑",
	(() => { const s = T.retryStateFromEntries([RETRY_EVENT, ev("llm/retry-started", { retryId: "r1", retry: 3 })], null);
		return s && s.started === true && s.retry === 3; })());
ok("retryStateFromEntries: 别的重试链的 started 不乱入",
	(() => { const s = T.retryStateFromEntries([RETRY_EVENT, ev("llm/retry-started", { retryId: "other", retry: 9 })], null);
		return s && s.started === false; })());
ok("retryStateFromEntries: step/start 清空(回合翻篇)",
	T.retryStateFromEntries([RETRY_EVENT, ev("step/start", { turn: 1, step: 3 })], null) === null);
ok("retryStateFromEntries: turn/end 与 assistant/message 清空",
	T.retryStateFromEntries([RETRY_EVENT, ev("turn/end", {})], null) === null
	&& T.retryStateFromEntries([RETRY_EVENT, ev("assistant/message", {})], null) === null);
ok("retryStateFromEntries: 没有信号 / 脏数据 → null(显式降级,绝不猜)",
	T.retryStateFromEntries([], null) === null
	&& T.retryStateFromEntries(null, null) === null
	&& T.retryStateFromEntries([{ type: "transient", event: { type: "assistant/live-chunk" } }], null) === null
	&& T.retryStateFromEntries([ev("llm/retry", { retry: 0 })], null) === null
	&& T.retryStateFromEntries([ev("llm/retry", { retry: "3" })], null) === null);
ok("safeObservationToken: 只放行短 token,URL / 路径 / 长文本一律丢弃",
	T.safeObservationToken("sampling_error") === "sampling_error"
	&& T.safeObservationToken("http://x/y") === "" && T.safeObservationToken("/home/u/.credentials") === ""
	&& T.safeObservationToken("x".repeat(40)) === "" && T.safeObservationToken(undefined) === "");
ok("retryBadgeText: 模板渲染 + max 缺失时收拾孤立斜杠",
	T.retryBadgeText({ retry: 3, max: 5, provider: "p", code: "c", delayMs: 2500 }, "⟳ {retry}/{max}") === "⟳ 3/5"
	&& T.retryBadgeText({ retry: 2, max: null }, "⟳ {retry}/{max}") === "⟳ 2"
	&& T.retryBadgeText({ retry: 4, max: 5, provider: "deepseek", code: "timeout", delayMs: 2500 }, "{provider}:{code} {delay}s") === "deepseek:timeout 2.5s");
ok("retryBadgeText: 无重试 / 空模板 → 空串(不占位)",
	T.retryBadgeText(null, "⟳ {retry}/{max}") === "" && T.retryBadgeText({ retry: 1 }, "") === ""
	&& T.retryBadgeText({ retry: 1 }, null) === "");

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

// 标签页标题的所有权:只有「插件自己写过」的标题才交还,没持有过就一个字都不碰。
// 旧行为(读回来的值 != 启动快照就写回去)会顶掉宿主写的会话标题,并和
// oh-my-dsh 的品牌名替换互相重写(它的 setter 会把 `… — DeepSeek Harness` 换成
// `… — Oh My DSH`,于是我们读回来的值永远不等于写进去的值)。真浏览器回归见
// scripts/title-coexistence-test.html(用 OMD 的真实代码跑)。
console.log("== 标签页标题所有权 ==");
ok("titleWritePlan: 没持有过 → 一个字都不写(别人的标题不归我们管)", (() => {
	const p = T.titleWritePlan(false, null, "会话标题 — DeepSeek Harness");
	return p.owned === false && p.write === null;
})());
ok("titleWritePlan: 持有过 → 交还一次(写回最近一次别人写的标题)", (() => {
	const p = T.titleWritePlan(true, null, "会话标题 — Oh My DSH");
	return p.owned === false && p.write === "会话标题 — Oh My DSH";
})());
ok("titleWritePlan: 要写自己的文案 → 写,并保持持有", (() => {
	const p = T.titleWritePlan(false, "⏳ 思考 3s", "宿主标题");
	return p.owned === true && p.write === "⏳ 思考 3s";
})());
ok("titleWritePlan: 交还目标为空 → 只放弃持有,不写", (() => {
	const p = T.titleWritePlan(true, null, "");
	return p.owned === false && p.write === null;
})());
ok("titleWritePlan: 已持有 + 这一拍没有内容 → 交还(不是继续盖着)", (() => {
	const p = T.titleWritePlan(true, null, "会话标题");
	return p.owned === false && p.write === "会话标题";
})());
ok("normalizeConfig: title 完整字段保留(模板 / 空闲 / 间隔)", (() => {
	const c = T.normalizeConfig({ title: { enabled: true, templates: ["a {elapsed}", "b"], idleTemplate: "💤 dsh 空闲", intervalMs: 5000 } });
	return c.title.enabled === true && c.title.templates.length === 2 && c.title.templates[0] === "a {elapsed}"
		&& c.title.idleTemplate === "💤 dsh 空闲" && c.title.intervalMs === 5000;
})());
ok("normalizeConfig: title 简写 true / false", (() => {
	return T.normalizeConfig({ title: false }).title.enabled === false && T.normalizeConfig({ title: true }).title.enabled === true;
})());
ok("normalizeConfig: title 非法字段逐项剔除,不牵连合法项", (() => {
	const c = T.normalizeConfig({ intervalMs: 5000, title: { enabled: true, templates: ["ok", 5], idleTemplate: 7, intervalMs: -1 } });
	return c.intervalMs === 5000 && c.title.enabled === true
		&& c.title.templates === undefined && c.title.idleTemplate === undefined && c.title.intervalMs === undefined;
})());
ok("normalizeConfig: 整块 title 非法 → 不产出 title(其余键照常)", (() => {
	const c = T.normalizeConfig({ intervalMs: 5000, title: { enabled: "yes" } });
	return c.intervalMs === 5000 && c.title === undefined;
})());

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

console.log("== 炫彩渐变:白天 / 黑夜两套配色 ==");
ok("normalizeGradientMode: auto / day / night 保留", T.normalizeGradientMode("auto") === "auto" && T.normalizeGradientMode("day") === "day" && T.normalizeGradientMode("night") === "night");
ok("normalizeGradientMode: 非法 / 缺省回落 auto", T.normalizeGradientMode("dark") === "auto" && T.normalizeGradientMode(undefined) === "auto" && T.normalizeGradientMode(null) === "auto");
ok("resolveGradientColors: auto 跟随宿主深浅色", (() => {
	const g = { mode: "auto", colors: ["#111111", "#222222"], dayColors: ["#aaaaaa", "#bbbbbb"] };
	return T.resolveGradientColors(g, true)[0] === "#111111" && T.resolveGradientColors(g, false)[0] === "#aaaaaa";
})());
ok("resolveGradientColors: day / night 强制压过主题", (() => {
	const day = { mode: "day", colors: ["#111111", "#222222"], dayColors: ["#aaaaaa", "#bbbbbb"] };
	const night = { mode: "night", colors: ["#111111", "#222222"], dayColors: ["#aaaaaa", "#bbbbbb"] };
	return T.resolveGradientColors(day, true)[0] === "#aaaaaa" && T.resolveGradientColors(night, false)[0] === "#111111";
})());
ok("resolveGradientColors: 未配的色板回退另一套,配了但不足 2 色不回退(不接管文字)", (() => {
	const absent = { mode: "night", dayColors: ["#aaaaaa", "#bbbbbb"] };
	const tooFew = { mode: "night", colors: ["#111111"], dayColors: ["#aaaaaa", "#bbbbbb"] };
	return T.resolveGradientColors(absent, true)[0] === "#aaaaaa" && T.resolveGradientColors(tooFew, true).length === 0;
})());
ok("resolveGradientColors: 老配置只有 colors 时两套主题都沿用它(行为不变)", (() => {
	const g = { colors: ["#111111", "#222222"] };
	return JSON.stringify(T.resolveGradientColors(g, false)) === JSON.stringify(["#111111", "#222222"])
		&& JSON.stringify(T.resolveGradientColors(g, true)) === JSON.stringify(["#111111", "#222222"]);
})());
ok("resolveGradientColors: 过滤非法颜色 / 两套都不可用返回空", (() => {
	const filtered = T.resolveGradientColors({ mode: "night", colors: ["red;}x{y:1", "#fff", "#000"], dayColors: ["#aaa"] }, true);
	const single = T.resolveGradientColors({ mode: "auto", colors: ["#fff"], dayColors: ["#000"] }, true);
	const empty = T.resolveGradientColors({ mode: "auto", colors: [], dayColors: [] }, false);
	return JSON.stringify(filtered) === JSON.stringify(["#fff", "#000"]) && single.length === 0 && empty.length === 0;
})());
ok("normalizeConfig: gradient 接受 mode / dayColors", (() => {
	const out = T.normalizeConfig({ gradient: { mode: "night", colors: ["#111", "#222"], dayColors: ["#333", "#444"] } });
	return out.gradient.mode === "night" && out.gradient.dayColors.length === 2 && out.gradient.colors.length === 2;
})());
ok("normalizeConfig: 非法 mode / 单色 dayColors 被丢弃,老配置不受影响", (() => {
	const bad = T.normalizeConfig({ gradient: { enabled: true, mode: "dark", dayColors: ["#333"] } });
	const old = T.normalizeConfig({ gradient: { enabled: true, colors: ["#111", "#222"] } });
	return bad.gradient.mode === undefined && bad.gradient.dayColors === undefined && old.gradient.enabled === true && old.gradient.mode === undefined;
})());

console.log("== 炫彩渐变:流动方向(issue #41)==");
ok("normalizeGradientDirection: rtl / ltr 保留", T.normalizeGradientDirection("rtl") === "rtl" && T.normalizeGradientDirection("ltr") === "ltr");
ok("normalizeGradientDirection: 非法 / 缺省回落 rtl(不改变既有观感)", T.normalizeGradientDirection("left") === "rtl" && T.normalizeGradientDirection(undefined) === "rtl" && T.normalizeGradientDirection(null) === "rtl");
ok("gradientAnimationDirection: ltr → reverse,其余 normal", T.gradientAnimationDirection("ltr") === "reverse" && T.gradientAnimationDirection("rtl") === "normal" && T.gradientAnimationDirection("x") === "normal");
ok("gradientTextCss: rtl 走默认方向,ltr 倒放同一段循环", (() => {
	const rtl = T.gradientTextCss(["#111111", "#222222"], 4, "rtl");
	const ltr = T.gradientTextCss(["#111111", "#222222"], 4, "ltr");
	return rtl.indexOf("animation-direction: normal") >= 0
		&& ltr.indexOf("animation-direction: reverse") >= 0
		&& rtl.indexOf("linear-gradient(90deg, #111111, #222222, #111111)") >= 0
		&& ltr.indexOf("linear-gradient(90deg, #111111, #222222, #111111)") >= 0
		&& rtl.indexOf("dsh-status-rotator-flow 4s linear infinite") >= 0
		&& rtl.indexOf("@keyframes dsh-status-rotator-flow { to { background-position: 200% 0; } }") >= 0;
})());
ok("gradientTextCss: 非法色值被过滤,不污染 CSS", (() => {
	const css = T.gradientTextCss(["#111111", "red;}x{y:1", "#222222"], 2, "ltr");
	return css.indexOf("#111111") >= 0 && css.indexOf("#222222") >= 0 && css.indexOf("red;}") < 0;
})());
ok("normalizeConfig: gradient 接受 direction", T.normalizeConfig({ gradient: { direction: "ltr" } }).gradient.direction === "ltr");
ok("normalizeConfig: 非法 direction 被丢弃,老配置不受影响", (() => {
	const bad = T.normalizeConfig({ gradient: { enabled: true, direction: "up" } });
	const old = T.normalizeConfig({ gradient: { enabled: true, colors: ["#111", "#222"] } });
	return bad.gradient.direction === undefined && old.gradient.direction === undefined && old.gradient.enabled === true;
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
console.log("== 宿主全屏遮罩(issue #60)==");
const maskVp = { width: 1280, height: 800 };
ok("hasBackdropFilter: blur() 系列算「有」,none / 空值算「没有」",
	T.hasBackdropFilter("blur(2px)") === true && T.hasBackdropFilter("blur(2px) saturate(1.2)") === true
	&& T.hasBackdropFilter("none") === false && T.hasBackdropFilter("NONE") === false
	&& T.hasBackdropFilter("") === false && T.hasBackdropFilter(undefined) === false && T.hasBackdropFilter(null) === false);
ok("danmakuMaskOverlayHit: dsh 设置弹窗遮罩(inset:0 + blur(2px))命中",
	T.danmakuMaskOverlayHit({ left: 0, top: 0, right: 1280, bottom: 800 }, maskVp, "blur(2px)") === true);
ok("danmakuMaskOverlayHit: 视口取整差 1px 也命中(容差)",
	T.danmakuMaskOverlayHit({ left: 0.5, top: 1, right: 1279.5, bottom: 799 }, maskVp, "blur(2px)") === true);
ok("danmakuMaskOverlayHit: 铺满视口但没有模糊 → 不算(不会引起这个闪烁)",
	T.danmakuMaskOverlayHit({ left: 0, top: 0, right: 1280, bottom: 800 }, maskVp, "none") === false);
ok("danmakuMaskOverlayHit: 菜单 / 卡片这类小面积模糊 → 不算",
	T.danmakuMaskOverlayHit({ left: 900, top: 300, right: 1180, bottom: 620 }, maskVp, "blur(12px)") === false);
ok("danmakuMaskOverlayHit: 顶部留空 80px 的引导遮罩 → 不算(没盖住弹幕层)",
	T.danmakuMaskOverlayHit({ left: 0, top: 80, right: 1280, bottom: 800 }, maskVp, "blur(2px)") === false);
ok("danmakuMaskOverlayHit: rect / 视口缺失或零面积 → 不算",
	T.danmakuMaskOverlayHit(undefined, maskVp, "blur(2px)") === false
	&& T.danmakuMaskOverlayHit({ left: 0, top: 0, right: 1280, bottom: 800 }, undefined, "blur(2px)") === false
	&& T.danmakuMaskOverlayHit({ left: 0, top: 0, right: 1280, bottom: 800 }, { width: 0, height: 0 }, "blur(2px)") === false);
ok("danmakuMaskOverlayHit: 坐标 NaN 的 rect → 不算(不是崩溃)",
	T.danmakuMaskOverlayHit({ left: NaN, top: 0, right: NaN, bottom: 800 }, maskVp, "blur(2px)") === false);
ok("normalizeConfig: danmaku.pauseBehindMask 布尔透传、非布尔丢弃",
	T.normalizeConfig({ danmaku: { enabled: true, pauseBehindMask: false } }).danmaku.pauseBehindMask === false
	&& T.normalizeConfig({ danmaku: { enabled: true, pauseBehindMask: "yes" } }).danmaku.pauseBehindMask === undefined);
ok("默认配置: 遮罩期间暂停弹幕默认开启", T.DEFAULT_CONFIG.danmaku.pauseBehindMask === true);
ok("开关常量: 变更合并探针延迟在合理区间(50ms ~ 1s)", T.DANMAKU_MASK_PROBE_MS >= 50 && T.DANMAKU_MASK_PROBE_MS <= 1000);
console.log("== 状态行文案来源(labelSource,0.1.6 观感)==");
ok("normalizeLabelSource: phrases / host 透传,非法值回落 phrases", (() => {
	return T.normalizeLabelSource("phrases") === "phrases" && T.normalizeLabelSource("host") === "host" &&
		T.normalizeLabelSource("Host") === "phrases" && T.normalizeLabelSource(undefined) === "phrases" &&
		T.normalizeLabelSource(null) === "phrases" && T.normalizeLabelSource(1) === "phrases";
})());
ok("labelPlanFor: 默认模式 + 有短语 → 轮换(两代宿主都一样)",
	T.labelPlanFor("phrases", true, true) === "phrases" && T.labelPlanFor("phrases", true, false) === "phrases");
ok("labelPlanFor: 短语库为空 → 插件自己的线回落宿主原文(修好空状态行),旧宿主不碰",
	T.labelPlanFor("phrases", false, true) === "host" && T.labelPlanFor("phrases", false, false) === "keep");
ok("labelPlanFor: host 模式(纯 0.1.6)→ 自己的线写宿主原文,旧宿主 TurnStatus 本来就是原文,不碰",
	T.labelPlanFor("host", true, true) === "host" && T.labelPlanFor("host", true, false) === "keep" &&
		T.labelPlanFor("host", false, true) === "host" && T.labelPlanFor("host", false, false) === "keep");
ok("默认配置: labelSource 默认 phrases(不改变既有行为)", T.DEFAULT_CONFIG.labelSource === "phrases");
ok("normalizeConfig: labelSource 白名单透传、非法丢弃", (() => {
	const ok2 = T.normalizeConfig({ labelSource: "host" });
	const bad = T.normalizeConfig({ labelSource: "HOST", intervalMs: 5000 });
	const none = T.normalizeConfig({ intervalMs: 5000 });
	// 整块只有非法 labelSource 时按「无有效字段」处理(与其他非法字段一致)
	return ok2.labelSource === "host" && bad.labelSource === undefined && none.labelSource === undefined &&
		T.normalizeConfig({ labelSource: "HOST" }) === null;
})());
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
ok("分号过滤器:; / ； / ﹔ / ; 四种写法都拒绝", (() => {
	const cases = ["正在试图打开飞行模式；…", "用 ASCII; 分号…", "小号﹔分号…", "希腊问号\u037e分号…"];
	return cases.every((t) => {
		const sub = bot.parseSubmission({ lang: ["zh"], phase: ["thinking"], phrases: t, rules: ["x"] }, "");
		const r = bot.validateSubmission(sub, bank);
		return r.ok === false && r.errors.some((e) => e.includes("含分号"));
	});
})());
ok("分号过滤器:中文冒号 / 逗号 / 顿号 / 破折号不受影响", (() => {
	const sub = bot.parseSubmission({ lang: ["zh"], phase: ["thinking"], phrases: "说明:这里是冒号，逗号、顿号——都不该被挡…", rules: ["x"] }, "");
	return bot.validateSubmission(sub, bank).ok === true;
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
	// 这条用例不联网:关掉自动更新(默认会去拉上游词库)
	const prevApplyUrl = process.env.DSH_STATUS_ROTATOR_BANK_URL;
	process.env.DSH_STATUS_ROTATOR_BANK_URL = "off";
	node.apply({
		get: (name) => (name === "webServer" ? fakeServer : null),
		effect: (cb) => { const cleanup = cb(); if (typeof cleanup === "function") routeCleanup = cleanup; return () => {}; }
	});
	ok("apply 注册了 config.json 路由", registeredRoutes.has("/plugins/dsh-status-rotator/config.json"));
	ok("effect 返回了清理函数", typeof routeCleanup === "function");
	if (typeof routeCleanup === "function") routeCleanup();
	ok("卸载后路由被真正移除(disposer 不泄漏)", registeredRoutes.size === 0, "剩余=" + [...registeredRoutes.keys()].join(","));
	if (prevApplyUrl === undefined) delete process.env.DSH_STATUS_ROTATOR_BANK_URL; else process.env.DSH_STATUS_ROTATOR_BANK_URL = prevApplyUrl;

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
	ok("sanitizeConfigDocument: 渐变 mode / dayColors 走同一套白名单", (() => {
		const okDoc = node.sanitizeConfigDocument({ config: { gradient: { mode: "day", colors: ["#111111", "#222222"], dayColors: ["#333333", "#444444"] } } });
		const badDoc = node.sanitizeConfigDocument({ config: { gradient: { mode: "dark", dayColors: ["#333333", "red;}html{display:none}"] } } });
		return okDoc.config.gradient.mode === "day" && okDoc.config.gradient.dayColors.length === 2 &&
			badDoc.config.gradient.mode === undefined && JSON.stringify(badDoc.config.gradient.dayColors) === JSON.stringify(["#333333"]);
	})());
	ok("sanitizeConfigDocument: 渐变 direction 白名单", (() => {
		const keep = node.sanitizeConfigDocument({ config: { gradient: { direction: "ltr" } } });
		const drop = node.sanitizeConfigDocument({ config: { gradient: { direction: "left" } } });
		return keep.config.gradient.direction === "ltr" && drop.config.gradient.direction === undefined;
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

	// 词库自动更新:后台拉上游 → 变更才写盘并立即生效;任何失败都保留上一次成功词库
	console.log("== 词库自动更新(remote bank)==");
	const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-status-rotator-remote-"));
	const remoteBankFile = path.join(remoteDir, "phrases.json");
	const prevRemoteBank = process.env.DSH_STATUS_ROTATOR_BANK;
	const prevRemoteUrl = process.env.DSH_STATUS_ROTATOR_BANK_URL;
	const prevRemoteInterval = process.env.DSH_STATUS_ROTATOR_BANK_INTERVAL_MS;
	const realFetch = globalThis.fetch;
	try {
		process.env.DSH_STATUS_ROTATOR_BANK = remoteBankFile;
		delete process.env.DSH_STATUS_ROTATOR_BANK_URL;
		delete process.env.DSH_STATUS_ROTATOR_BANK_INTERVAL_MS;
		ok("默认上游 = 仓库 main 的 config.example.json(https)", typeof node.remoteBankUrl() === "string" && node.remoteBankUrl().startsWith("https://") && node.remoteBankUrl().includes("config.example.json"));
		ok("默认间隔 6 小时", node.remoteBankIntervalMs() === 6 * 60 * 60 * 1000);
		process.env.DSH_STATUS_ROTATOR_BANK_URL = "off";
		ok("URL=off 关闭自动更新", node.remoteBankUrl() === null && node.remoteBankStatus().enabled === false);
		process.env.DSH_STATUS_ROTATOR_BANK_URL = "https://example.com/bank.json";
		ok("上游地址可覆盖", node.remoteBankUrl() === "https://example.com/bank.json");
		process.env.DSH_STATUS_ROTATOR_BANK_INTERVAL_MS = "0";
		ok("间隔 0 关闭自动更新", node.remoteBankIntervalMs() === 0 && node.remoteBankStatus().enabled === false);
		process.env.DSH_STATUS_ROTATOR_BANK_INTERVAL_MS = "1500";
		ok("间隔可覆盖", node.remoteBankIntervalMs() === 1500 && node.remoteBankStatus().enabled === true);
		ok("自动更新缓存与本地词库同目录", node.remoteBankPath() === path.join(remoteDir, "bank.remote.json"));
		ok("词库层只留 packs / phrases", (() => {
			const doc = node.phraseOnlyDocument({ config: { intervalMs: 1 }, enabledPacks: ["a"], packs: [{ id: "a" }], phrases: { zh: ["x"] } });
			return doc.config === undefined && doc.enabledPacks === undefined && doc.packs.length === 1 && doc.phrases.zh[0] === "x";
		})());
		const stubFetch = (body, status) => {
			globalThis.fetch = async () => ({ ok: (status || 200) >= 200 && (status || 200) < 300, status: status || 200, text: async () => body });
		};
		stubFetch(JSON.stringify({ config: { intervalMs: 1 }, packs: [{ id: "deepseek", phrases: { zh: { thinking: ["上游 A…"] } } }] }));
		const firstRefresh = await node.refreshRemoteBank();
		const cachedA = await node.remoteBankDocument();
		ok("拉取上游 → 写盘 + 立即生效", firstRefresh.ok === true && firstRefresh.updated === true && cachedA.packs[0].phrases.zh.thinking[0] === "上游 A…" && node.remoteBankStatus().updates === 1);
		ok("上游的 config 键不落盘(只留 packs / phrases)", cachedA.config === undefined);
		await node.refreshRemoteBank();
		ok("内容没变不重复写盘", node.remoteBankStatus().updates === 1);
		stubFetch(JSON.stringify({ packs: [{ id: "deepseek", phrases: { zh: { thinking: ["上游 B…"] } } }] }));
		await node.refreshRemoteBank();
		ok("上游变更 → 立即更新(updates=2)", node.remoteBankStatus().updates === 2 && (await node.remoteBankDocument()).packs[0].phrases.zh.thinking[0] === "上游 B…");
		globalThis.fetch = async () => { throw new Error("offline"); };
		await node.refreshRemoteBank();
		ok("网络失败保留上一次成功词库", node.remoteBankStatus().lastError === "offline" && (await node.remoteBankDocument()).packs[0].phrases.zh.thinking[0] === "上游 B…");
		stubFetch("not json");
		await node.refreshRemoteBank();
		ok("上游不是 JSON → 记录错误且不覆盖缓存", typeof node.remoteBankStatus().lastError === "string" && (await node.remoteBankDocument()).packs[0].phrases.zh.thinking[0] === "上游 B…");
		stubFetch("{}");
		await node.refreshRemoteBank();
		ok("上游空词库 → 记录错误", node.remoteBankStatus().lastError === "上游词库为空");
		stubFetch("boom", 500);
		await node.refreshRemoteBank();
		ok("上游 HTTP 500 → 记录错误", node.remoteBankStatus().lastError === "HTTP 500");
		ok("分层:自动更新在 config.json 之上、设置与本地词库之下", (() => {
			const bundled = { packs: [{ id: "p", phrases: { zh: { thinking: ["随包…"] } } }] };
			const fileDoc = { packs: [{ id: "p", phrases: { zh: { thinking: ["config.json…"] } } }] };
			const remote = { packs: [{ id: "p", phrases: { zh: { thinking: ["上游…"] } } }] };
			const userDoc = { packs: [{ id: "p", phrases: { zh: { thinking: ["设置…"] } } }] };
			const bank = { packs: [{ id: "p", phrases: { zh: { thinking: ["本地…"] } } }] };
			const pick = (doc) => doc.packs[0].phrases.zh.thinking[0];
			return pick(node.mergeLayers(bundled, fileDoc, remote, userDoc, bank)) === "本地…"
				&& pick(node.mergeLayers(bundled, fileDoc, remote, userDoc, null)) === "设置…"
				&& pick(node.mergeLayers(bundled, fileDoc, remote, null, null)) === "上游…"
				&& pick(node.mergeLayers(bundled, fileDoc, null, null, null)) === "config.json…";
		})());
		ok("保存差异不把自动更新词条算成用户改动", (() => {
			const remote = { packs: [{ id: "deepseek", phrases: { zh: { thinking: ["上游新词…"] } } }] };
			const baseline = node.mergeLayers(exampleDoc, null, remote);
			const served = node.mergeLayers(baseline, null, { config: { intervalMs: 9999 } });
			return JSON.stringify(node.deltaOf(baseline, served)) === JSON.stringify({ config: { intervalMs: 9999 } });
		})());
	} finally {
		globalThis.fetch = realFetch;
		if (prevRemoteBank === undefined) delete process.env.DSH_STATUS_ROTATOR_BANK; else process.env.DSH_STATUS_ROTATOR_BANK = prevRemoteBank;
		if (prevRemoteUrl === undefined) delete process.env.DSH_STATUS_ROTATOR_BANK_URL; else process.env.DSH_STATUS_ROTATOR_BANK_URL = prevRemoteUrl;
		if (prevRemoteInterval === undefined) delete process.env.DSH_STATUS_ROTATOR_BANK_INTERVAL_MS; else process.env.DSH_STATUS_ROTATOR_BANK_INTERVAL_MS = prevRemoteInterval;
		fs.rmSync(remoteDir, { recursive: true, force: true });
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
			&& served.packs.length === bundled.packs.length
			&& served.packs.reduce((n, pack) => n + countPhrases(pack.phrases), 0) === bundled.packs.reduce((n, pack) => n + countPhrases(pack.phrases), 0)
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
		// 期望值从随包 config.example.json 现算:词库增删(投稿 / star 刷新 / 手改)不会再让断言过期
		ok("生效文档仍带完整词库(与随包一致)", served.packs.length === exampleDoc.packs.length && served.packs.reduce((n, pack) => n + countPhrases(pack.phrases), 0) === exampleDoc.packs.reduce((n, pack) => n + countPhrases(pack.phrases), 0));
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
	ok("sanitizeConfigDocument: 弹幕 pauseBehindMask 布尔保留、非布尔剔除(issue #60)", (() => {
		const off = node.sanitizeConfigDocument({ config: { danmaku: { enabled: true, pauseBehindMask: false } } });
		const on = node.sanitizeConfigDocument({ config: { danmaku: { enabled: true, pauseBehindMask: true } } });
		const bad = node.sanitizeConfigDocument({ config: { danmaku: { enabled: true, pauseBehindMask: "yes" } } });
		return off.config.danmaku.pauseBehindMask === false && on.config.danmaku.pauseBehindMask === true &&
			bad.config.danmaku.pauseBehindMask === undefined;
	})());
	ok("sanitizeConfigDocument: labelSource 白名单(host 保留 / 非法剔除)", (() => {
		const host = node.sanitizeConfigDocument({ config: { labelSource: "host" } });
		const phrases = node.sanitizeConfigDocument({ config: { labelSource: "phrases" } });
		const bad = node.sanitizeConfigDocument({ config: { labelSource: "HOST" } });
		const badType = node.sanitizeConfigDocument({ config: { labelSource: 7 } });
		return host.config.labelSource === "host" && phrases.config.labelSource === "phrases" &&
			bad.config.labelSource === undefined && badType.config.labelSource === undefined;
	})());
	ok("sanitizeConfig: 预设内的 labelSource 同样过白名单", (() => {
		const doc = node.sanitizeConfigDocument({ presets: [{ id: "p1", config: { labelSource: "host" } }, { id: "p2", config: { labelSource: "nope" } }] });
		return doc.presets[0].config.labelSource === "host" && doc.presets[1].config.labelSource === undefined;
	})());

	// 默认配置数据完整性:短语省略号统一,config 关键字段不被污染
	// 词库计数同步器:展示计数与断言都不再靠人肉跟随 config.example.json
	console.log("== 词库计数同步(sync-bank-counts)==");
	const sync = require("./sync-bank-counts.cjs");
	ok("bankStats: 内部自洽(zh+en=总数,启用+关闭=总数,逐包求和=总数)", (() => {
		const s = sync.bankStats(exampleDoc);
		const perTotal = Object.values(s.per).reduce((n, p) => n + p.total, 0);
		return s.total === s.zh + s.en && s.on + s.off === s.total && perTotal === s.total && s.packs === exampleDoc.packs.length;
	})());
	ok("bankStats: 加一条后总数 / 中文 / 默认启用各 +1", (() => {
		const before = sync.bankStats(exampleDoc);
		const doc = JSON.parse(JSON.stringify(exampleDoc));
		const target = doc.packs.find((p) => p && p.phrases && p.phrases.zh && Array.isArray(p.phrases.zh.thinking));
		target.phrases.zh.thinking.push("正在测试计数同步…");
		const after = sync.bankStats(doc);
		return after.total === before.total + 1 && after.zh === before.zh + 1 && after.on === before.on + 1;
	})());
	ok("syncTexts: 四处计数按词库现算改写,且二次调用幂等", (() => {
		const doc = JSON.parse(JSON.stringify(exampleDoc));
		const target = doc.packs.find((p) => p && p.phrases && p.phrases.zh && Array.isArray(p.phrases.zh.thinking));
		target.phrases.zh.thinking.push("正在测试计数同步…");
		const s = sync.bankStats(doc);
		const files = {
			readme: "> **1077 phrases, 12 theme packs**\n| **total** | **565** | **512** | **1077** | 890 on / 187 off |\n| `deepseek` DeepSeek 专场 | 1 | 2 | 3 | on |\n",
			readmeZh: "> **1077 条梗、12 个主题词库包**\n| **合计** | **565** | **512** | **1077** | 开 890 / 关 187 |\n| `deepseek` DeepSeek 专场 | 1 | 2 | 3 | 开 |\n",
			pkg: '{ "description": "into a 1077-phrase meme machine: x" }',
			index: " * 完整词库(12 个包 1077 条)→"
		};
		const out1 = sync.syncTexts(files, doc);
		const out2 = sync.syncTexts({ ...files, ...out1 }, doc);
		return Object.keys(out1).length === 4
			&& out1.readme.includes("**" + s.total + " phrases, " + s.packs + " theme packs")
			&& out1.readme.includes("| **total** | **" + s.zh + "** | **" + s.en + "** | **" + s.total + "** | " + s.on + " on / " + s.off + " off |")
			&& out1.readme.includes("| `deepseek` DeepSeek 专场 | " + s.per.deepseek.zh + " | " + s.per.deepseek.en + " | " + s.per.deepseek.total + " | on |")
			&& out1.readmeZh.includes("**" + s.total + " 条梗、" + s.packs + " 个主题词库包")
			&& out1.readmeZh.includes("| **合计** | **" + s.zh + "** | **" + s.en + "** | **" + s.total + "** | 开 " + s.on + " / 关 " + s.off + " |")
			&& out1.pkg.includes(s.total + "-phrase meme machine")
			&& out1.index.includes("完整词库(" + s.packs + " 个包 " + s.total + " 条)")
			&& Object.keys(out2).length === 0;
	})());
	ok("syncTexts: 描述性表格(Phrase Packs)不被误改", (() => {
		const files = { readme: "| `star-ask` 求 star | pure star-ask phrases, e.g. x |\n", readmeZh: "| `star-ask` 求 star | 纯求 star 文案 |\n" };
		return Object.keys(sync.syncTexts(files, exampleDoc)).length === 0;
	})());
	// issue #51:保存会把整份文档镜像进 config.json,而镜像是下次保存的基准层之一 ——
	// 只存「本次差异」会让第二次保存把上次的设置顶掉,升级清掉镜像后就重置了。
	console.log("== 设置差异累积(issue #51)==");
	ok("settingsDeltaFor: 二次保存不丢上一次的设置(镜像在基准层里)", (() => {
		const bundled = exampleDoc;
		const doc1 = JSON.parse(JSON.stringify(bundled));
		doc1.config.danmaku.enabled = false;
		const first = node.settingsDeltaFor(bundled, null, null, null, {}, doc1);
		const doc2 = JSON.parse(JSON.stringify(doc1));           // 镜像 = 上次保存的整份文档
		doc2.config.intervalMs = 12345;
		const second = node.settingsDeltaFor(bundled, doc1, null, null, first, doc2);
		const served = node.mergeLayers(bundled, null, null, second, null);   // 升级后 config.json 已不在
		return served.config.danmaku.enabled === false && served.config.intervalMs === 12345;
	})());
	ok("settingsDeltaFor: 改回来的值以最新一次保存为准", (() => {
		const bundled = exampleDoc;
		const off = JSON.parse(JSON.stringify(bundled));
		off.config.danmaku.enabled = false;
		const first = node.settingsDeltaFor(bundled, null, null, null, {}, off);
		const on = JSON.parse(JSON.stringify(off));
		on.config.danmaku.enabled = true;
		const second = node.settingsDeltaFor(bundled, off, null, null, first, on);
		return node.mergeLayers(bundled, null, null, second, null).config.danmaku.enabled === true;
	})());
	ok("settingsDeltaFor: 自动更新词条仍不进设置(只留用户差异)", (() => {
		const bundled = exampleDoc;
		const remote = { packs: [{ id: "community", phrases: { zh: { thinking: ["上游来的…"] } } }] };
		const doc = node.mergeLayers(bundled, null, remote, null, null);
		const stored = node.settingsDeltaFor(bundled, null, remote, null, {}, doc);
		return JSON.stringify(stored).indexOf("上游来的") < 0;
	})());
	// issue #92:外部词库送来的内容不算「用户改动」(基准里含外部词库层)
	ok("settingsDeltaFor: 外部词库内容不进设置(基准含外部词库层)", (() => {
		const bundled = exampleDoc;
		const pack = bundled.packs[0];
		const phase = Object.keys(pack.phrases.zh).find((k) => Array.isArray(pack.phrases.zh[k]) && pack.phrases.zh[k].length);
		const bank = { packs: [{ id: pack.id, phrases: { zh: { [phase]: ["外部词库塞进来的一句…"] } } }] };
		const doc = node.mergeLayers(bundled, null, null, null, null, bank);
		const stored = node.settingsDeltaFor(bundled, null, null, bank, {}, doc);
		return JSON.stringify(stored).indexOf("外部词库塞进来的一句") < 0
			&& JSON.stringify(node.mergeLayers(bundled, null, null, null, stored, bank)).indexOf("外部词库塞进来的一句") >= 0;
	})());
	ok("settingsDeltaFor: 用户自己改的词条仍然进设置(没有连带压掉真改动)", (() => {
		const bundled = exampleDoc;
		const pack = bundled.packs[0];
		const phase = Object.keys(pack.phrases.zh).find((k) => Array.isArray(pack.phrases.zh[k]) && pack.phrases.zh[k].length);
		const bank = { packs: [{ id: pack.id, phrases: { zh: { [phase]: ["外部词库塞进来的一句…"] } } }] };
		const doc = node.mergeLayers(bundled, null, null, null, null, bank);
		doc.packs.find((p) => p.id === pack.id).phrases.zh[phase] = ["用户自己在设置页写的…"];
		const stored = node.settingsDeltaFor(bundled, null, null, bank, {}, doc);
		return JSON.stringify(stored).indexOf("用户自己在设置页写的") >= 0;
	})());
	// 用户配置存储:issue #51 的正解 —— 持久层必须落在 $DSH_HOME 下,
	// 因为包目录(旧 config.json 的落点)在升级时会被整体替换掉
	console.log("== 用户配置存储(issue #51:升级保留的持久层)==");
	const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-status-rotator-store-"));
	const storeFile = path.join(storeDir, "config.json");
	const prevStoreEnv = process.env.DSH_STATUS_ROTATOR_CONFIG;
	const prevStoreHome = process.env.DSH_HOME;
	process.env.DSH_STATUS_ROTATOR_CONFIG = storeFile;
	try {
		ok("默认路径 = $DSH_HOME/status-rotator/config.json(与词库同目录,不在包目录里)", (() => {
			delete process.env.DSH_STATUS_ROTATOR_CONFIG;
			process.env.DSH_HOME = path.join(storeDir, "dsh-home");
			const p = node.userConfigPath();
			process.env.DSH_STATUS_ROTATOR_CONFIG = storeFile;
			if (prevStoreHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevStoreHome;
			return p === path.join(storeDir, "dsh-home", "status-rotator", "config.json");
		})());
		ok("存储路径可被 DSH_STATUS_ROTATOR_CONFIG 覆盖", node.userConfigPath() === storeFile);
		ok("存储不存在 → null(按「没有用户配置」处理)", (await node.readUserConfigDocument()) === null && node.userConfigStatus().loaded === false);
		await node.writeUserConfigDocument({ config: { danmaku: { enabled: false } }, [node.SETTINGS_VERSION_KEY]: 2, [node.MIRROR_HASH_KEY]: "abc" });
		const stored = await node.readUserConfigDocument();
		ok("写盘后可读回(原子写 + 目录不存在时自建)", stored !== null && stored.config.danmaku.enabled === false && node.userConfigStatus().loaded === true);
		ok("落盘内容带内部标记键(收敛标记 + 镜像指纹)", stored[node.SETTINGS_VERSION_KEY] === 2 && stored[node.MIRROR_HASH_KEY] === "abc");
		ok("userConfigBody: 内部标记键不参与合并", (() => {
			const body = node.userConfigBody(stored);
			return body.config.danmaku.enabled === false && body[node.SETTINGS_VERSION_KEY] === undefined && body[node.MIRROR_HASH_KEY] === undefined;
		})());
		ok("contentTypeOf 把两个内部键都剔掉(不泄漏进生效文档)", (() => {
			const out = node.contentTypeOf({ config: { intervalMs: 1 }, [node.SETTINGS_VERSION_KEY]: 2, [node.MIRROR_HASH_KEY]: "abc" });
			return out.config.intervalMs === 1 && Object.keys(out).length === 1;
		})());
		ok("userConfigDeltaFor: 提交完整文档 → 只留与内置默认的差异", (() => {
			const doc = JSON.parse(JSON.stringify(exampleDoc));
			doc.config.danmaku.enabled = false;
			doc.config.intervalMs = 4321;
			const delta = node.userConfigDeltaFor(exampleDoc, doc);
			return delta.config.danmaku.enabled === false && delta.config.intervalMs === 4321
				&& delta.packs === undefined && delta.phrases === undefined
				&& JSON.stringify(delta).length < 512;
		})());
		ok("userConfigDeltaFor: 原样提交默认文档 → 差异为空(改回默认值不会被旧值焊死)", (() => {
			const doc = JSON.parse(JSON.stringify(exampleDoc));
			return Object.keys(node.userConfigDeltaFor(exampleDoc, doc)).length === 0;
		})());
		ok("userConfigDeltaFor: 自动更新来的词条不算用户改动", (() => {
			const remote = { packs: [{ id: "community", phrases: { zh: { thinking: ["上游来的…"] } } }] };
			const baseline = node.mergeLayers(exampleDoc, remote);
			const doc = node.mergeLayers(baseline, { config: { intervalMs: 9999 } });
			return JSON.stringify(node.userConfigDeltaFor(baseline, doc)).indexOf("上游来的") < 0;
		})());
		ok("absorbableFileDelta: Release 包里那份 config.json(= config.example.json 拷贝)不产生任何差异", (() => {
			const remote = { packs: [{ id: "community", phrases: { zh: { thinking: ["上游新增…"] } } }] };
			const baseline = node.mergeLayers(exampleDoc, remote);
			const delta = node.absorbableFileDelta(exampleDoc, baseline, JSON.parse(JSON.stringify(exampleDoc)));
			return Object.keys(delta).length === 0;
		})());
		ok("absorbableFileDelta: 手改一项 → 只搬那一项", (() => {
			const delta = node.absorbableFileDelta(exampleDoc, node.mergeLayers(exampleDoc, null), { config: { danmaku: { enabled: false } } });
			return JSON.stringify(delta) === JSON.stringify({ config: { danmaku: { enabled: false } } });
		})());
		ok("absorbableFileDelta: 快照里那些只是随包旧版的词条不算用户改动", (() => {
			const snapshot = JSON.parse(JSON.stringify(exampleDoc));
			snapshot.config = { intervalMs: 7777 };
			const delta = node.absorbableFileDelta(exampleDoc, node.mergeLayers(exampleDoc, null), snapshot);
			return delta.config.intervalMs === 7777 && delta.packs === undefined && delta.phrases === undefined;
		})());
		fs.writeFileSync(storeFile, "{ 坏掉的 JSON");
		ok("存储损坏 → 保留上一次成功值并记录 error(不把配置丢回默认值)", (await node.readUserConfigDocument()).config.danmaku.enabled === false && typeof node.userConfigStatus().error === "string");

		// 外部反馈:设置页显示「共 0 个包,已启用 10 个」「暂无词库包」,内置词库整个消失。
		// 根因是保存路径把「提交的文档里没有某个包」当成用户删包写进存储(墓碑),而设置页的
		// 词库包区**没有删除按钮**(只有启用 / 停用开关),所以那只能是文档不完整。
		ok("词库包不写删除墓碑:提交 packs: [] 也删不掉内置词库", (() => {
			const delta = node.userConfigDeltaFor(exampleDoc, { packs: [], phrases: { zh: { running: ["我自己的文案…"] } } });
			const effective = node.mergeLayers(exampleDoc, delta);
			return delta.packs === undefined
				&& (effective.packs || []).length === exampleDoc.packs.length
				&& (effective.enabledPacks || []).length > 0
				&& effective.phrases.zh.running.join() === "我自己的文案…";
		})());
		ok("词库包不写删除墓碑:残缺文档(少一个包)不会删掉那个包", (() => {
			const stale = { ...exampleDoc, packs: exampleDoc.packs.slice(0, exampleDoc.packs.length - 1) };
			const effective = node.mergeLayers(exampleDoc, node.userConfigDeltaFor(exampleDoc, stale));
			return effective.packs.length === exampleDoc.packs.length;
		})());
		ok("词库包不写删除墓碑:改过文案的包仍然进存储(内容差异保留)", (() => {
			const edited = JSON.parse(JSON.stringify(exampleDoc));
			edited.packs[0].phrases.zh.thinking = ["改过的文案…"];
			const delta = node.userConfigDeltaFor(exampleDoc, edited);
			return Array.isArray(delta.packs) && delta.packs.length === 1
				&& delta.packs[0].id === exampleDoc.packs[0].id && delta.packs[0].phrases.zh.thinking[0] === "改过的文案…";
		})());
		ok("预设删除仍写墓碑(预设真的有删除入口,语义不能一起丢掉)", (() => {
			const base = { ...exampleDoc, presets: [{ id: "a", name: "A" }, { id: "b", name: "B" }] };
			const delta = node.userConfigDeltaFor(base, { ...base, presets: [{ id: "a", name: "A" }] });
			return delta.presets.length === 1 && delta.presets[0].id === "b" && delta.presets[0].$deleted === true;
		})());
		ok("withoutPackDeletions:清墓碑但保留用户词条与其它键", (() => {
			const poisoned = {
				config: { danmaku: { enabled: false } },
				phrases: { zh: { running: ["我的文案…"] } },
				packs: exampleDoc.packs.map((pk) => ({ id: pk.id, $deleted: true })),
			};
			const healed = node.withoutPackDeletions(poisoned);
			return healed.packs === undefined && healed.phrases.zh.running[0] === "我的文案…"
				&& healed.config.danmaku.enabled === false && poisoned.packs.length === exampleDoc.packs.length;
		})());
		ok("老宿主存储的收敛(pruneShippedBloat)同样会丢掉词库包墓碑", (() => {
			const poisoned = {
				phrases: { zh: { running: ["我的文案…"] } },
				packs: exampleDoc.packs.map((pk) => ({ id: pk.id, $deleted: true })),
			};
			const trimmed = node.pruneShippedBloat(exampleDoc, node.deltaOf(exampleDoc, poisoned));
			return trimmed.packs === undefined && trimmed.phrases.zh.running[0] === "我的文案…";
		})());
		ok("healedUserConfigDocument:已被写坏的存储读一次即修好(磁盘上也清掉墓碑)", await (async () => {
			const poisoned = {
				phrases: { zh: { running: ["我的文案…"] } },
				packs: exampleDoc.packs.map((pk) => ({ id: pk.id, $deleted: true })),
			};
			fs.writeFileSync(storeFile, JSON.stringify(poisoned, null, 4), "utf8");
			const healed = await node.healedUserConfigDocument();
			const onDisk = JSON.parse(fs.readFileSync(storeFile, "utf8"));
			return healed.packs === undefined && onDisk.packs === undefined
				&& onDisk.phrases.zh.running[0] === "我的文案…"
				&& (node.mergeLayers(exampleDoc, healed).packs || []).length === exampleDoc.packs.length;
		})());
		// 上面这组会改写存储文件本身,所以放在「存储损坏」之后 —— 否则会把那条测试的「上一次成功值」换掉
	} finally {
		if (prevStoreEnv === undefined) delete process.env.DSH_STATUS_ROTATOR_CONFIG; else process.env.DSH_STATUS_ROTATOR_CONFIG = prevStoreEnv;
		if (prevStoreHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevStoreHome;
		fs.rmSync(storeDir, { recursive: true, force: true });
	}

	// 投稿机器人的 JSON 哨兵:JSON.parse 对重复键是静默的(后一个覆盖前一个),
// 而「分支落后于 main → 人工解 config.example.json 的 JSON 冲突」正是重复键的来源:
// 两边的内容都塞进同一个 zh 对象,就得到 running/long 各两份 —— 解析不报错、条目悄悄少一半。
// issue #87:turnLabels 曾是唯一「只 set、从不 delete/clear」的容器,每个回合留一个
// 已脱离 DOM 的标签元素。运行时行为由浏览器回归页的 ?case=leak 断言;这里再加一道
// 廉价的静态契约,防止有人**删掉**某个容器的清理路径(冒烟测不到 DOM 生命周期)。
console.log("== 状态行:每回合容器的清理契约(issue #87)==");
(() => {
	const src = fs.readFileSync(path.join(__dirname, "..", "lib", "client.js"), "utf8");
	// 名字固定的一份清单:新增容器时也该在这里登记
	const containers = ["adopted", "typists", "lastPicks", "liveTemplates", "liveTimers",
		"lineButtons", "turnLabels", "turnLines", "turnPhases", "watchedButtons"];
	for (const name of containers) {
		const writes = (src.match(new RegExp("\\b" + name + "\\.(set|add)\\(", "g")) || []).length;
		const clears = (src.match(new RegExp("\\b" + name + "\\.(delete|clear)\\(", "g")) || []).length;
		ok(`容器 ${name}:有写入就必须有清理路径`, writes === 0 || clears > 0, `set/add=${writes} delete/clear=${clears}`);
	}
	// turnLabels 与 turnLines 的 key 都是折叠头按钮:释放回合时必须一起删
	ok("releaseStatusLine 同时清掉 turnLines 与 turnLabels(对称)", (() => {
		const body = src.slice(src.indexOf("const releaseStatusLine = (line) => {"));
		const end = body.indexOf("log(\"released status line\")");
		const chunk = body.slice(0, end);
		return chunk.includes("turnLines.delete(button)") && chunk.includes("turnLabels.delete(button)");
	})());
	ok("插件卸载时按按钮索引的容器也会被清空", (() => {
		const churn = src.slice(src.indexOf("adopted.clear();"));
		return churn.includes("turnLabels.clear()") && churn.includes("turnLines.clear()");
	})());
})();

console.log("== 投稿机器人:JSON 重复键哨兵 ==");
const bot = require("./phrase-bot.cjs");
ok("findDuplicateKeys: 抓得到截图那种(running / long 各两份)", (() => {
	const bad = '{\n  "packs": [\n    {\n      "id": "community",\n      "phrases": {\n        "zh": {\n          "thinking": ["a…"],\n          "running": ["a…"],\n          "long": ["a…", "b…"],\n          "running": ["b…"],\n          "long": ["b…"]\n        }\n      }\n    }\n  ]\n}';
	const dups = bot.findDuplicateKeys(bad);
	return dups.length === 2 && dups[0].key === "running" && dups[1].key === "long"
		&& dups[0].path === "$.packs[].phrases.zh.running";
})());
ok("findDuplicateKeys: 正常文档不误报(不同层的同名键、数组里的同名键、字符串里的括号)", (() => {
	const docs = [
		JSON.stringify({ packs: [{ id: "x", phrases: { zh: { running: ["a"] } } }], phrases: { zh: { running: ["b"] } } }),
		JSON.stringify({ a: "x \\\" {[ : y", b: { c: 1 }, d: [{ c: 1 }, { c: 2 }] }),
	];
	return docs.every((d) => bot.findDuplicateKeys(d).length === 0);
})());
ok("parseBankStrict: 重复键抛错并指出路径(不静默吞掉)", (() => {
	let msg = "";
	try { bot.parseBankStrict('{"zh": {"running": ["a"], "running": ["b"]}}', "config.example.json"); }
	catch (e) { msg = String(e.message); }
	return msg.includes("重复键") && msg.includes("$.zh.running");
})());
ok("parseBankStrict: 正常文档照常返回对象", (() => {
	const doc = bot.parseBankStrict('{"phrases": {"zh": {"running": ["a"]}}}', "x");
	return doc.phrases.zh.running[0] === "a";
})());

console.log("== 默认配置数据完整性 ==");
	const { validateConfigDocumentData } = require("./unify-ellipsis.cjs");
	const dataIssues = validateConfigDocumentData(exampleDoc);
	ok("config.example.json: 短语全部 … 结尾且 config 未被污染", dataIssues.length === 0);
	if (dataIssues.length > 0) console.error("  issues:", dataIssues.slice(0, 5).join("; "));
	ok("渐变颜色无污染", exampleDoc.config.gradient.colors.every((c) => !c.includes("\u2026")));
	ok("弹幕颜色/单色无污染", exampleDoc.config.danmaku.colors.every((c) => !c.includes("\u2026")) && !exampleDoc.config.danmaku.color.includes("\u2026"));
	ok("弹幕默认层级为 -1(界面后面)", exampleDoc.config.danmaku.zIndex === -1);
	ok("标题模板保留有意省略号", exampleDoc.config.title.templates.some((t) => t.includes("\u2026")));
	ok("config.example.json 无重复键(重复键会被 JSON.parse 静默吃掉,条目无声丢失)", (() => {
		const dups = bot.findDuplicateKeys(fs.readFileSync(path.join(__dirname, "..", "config.example.json"), "utf8"));
		if (dups.length > 0) console.error("  duplicate keys:", dups.slice(0, 5).map((d) => d.path).join(", "));
		return dups.length === 0;
	})());

	console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
	process.exit(failed === 0 ? 0 : 1);
})();
