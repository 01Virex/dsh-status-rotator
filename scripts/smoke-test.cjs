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

	console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
	process.exit(failed === 0 ? 0 : 1);
})();
