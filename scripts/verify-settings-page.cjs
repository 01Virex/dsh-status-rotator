#!/usr/bin/env node
/**
 * 设置页(词库编辑器)的独立验证。
 *
 * 设置页原先长在 apply(ctx) 的闭包里(约 1900 行),隐式捕获了十来个运行时变量,因此**只能**
 * 通过 apply() 端到端撞 —— browser 侧的 scripts/settings-save-test.html 走的就是那条路,
 * 它覆盖了保存行为(整份 PUT、开关即写盘、issue #96 的回归),但覆盖不到「设置页本身能不能
 * 脱离 apply 存在」。本轮把这一段抽成模块级工厂 createSettingsPage(deps)。
 *
 * 本脚本是那次抽取的回归网,锁的是**结构契约**(保存行为仍归 settings-save-test.html):
 *
 *   1. 不经 apply() 就能拿到工厂并实例化,且只需要 8 个显式依赖;
 *   2. 字典注册与 st 绑定确实走注入的 locale / effect,而不是模块里的其它路径;
 *   3. 组件能真的渲染(首屏 + 载入完成后各一次),四个 Tab 仍在;
 *   4. dispose() 摘掉自有样式表;
 *   5. 护栏:工厂源码里不得再出现 apply 作用域的绑定名 —— 防止日后有人把隐式捕获加回来。
 *
 * 第 1、5 条是这次重构真正新增的保障:抽取前这段代码在 Node 里根本无法单独跑起来。
 *
 * 运行:node scripts/verify-settings-page.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let failures = 0;
const report = (name, pass, extra) => {
	console.log(`  ${pass ? "✓" : "✗"} ${name}${extra ? "  — " + extra : ""}`);
	if (!pass) failures++;
};
const section = (title) => console.log(`\n== ${title} ==`);

// ───────────────────────────────────────────────────────────────────────────
// 1) 在 Node 沙箱里加载真实插件代码
// ───────────────────────────────────────────────────────────────────────────

/** 设置页要读的配置文档(GET 的应答):四个 Tab、预设、词库包都给全 */
const DOC = {
	config: { intervalMs: 10000, typeSpeedMs: 30, danmaku: { enabled: true }, gradient: { enabled: true } },
	phrases: { zh: { thinking: ["沙箱里的一句…"] }, en: { thinking: ["a sandboxed phrase..."] } },
	presets: [{ id: "night", label: { zh: "夜间", en: "Night" } }],
	packs: [{ id: "coding", label: { zh: "写代码", en: "Coding" }, phrases: { zh: { thinking: ["包里的一句…"] } } }],
	enabledPacks: ["coding"]
};

/** fetch 桩:GET 给文档,PUT 给成功应答(保存路径要能走通) */
const fetchStub = async (url, options) => {
	const method = (options && options.method) || "GET";
	if (method === "PUT" || method === "POST") {
		return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => JSON.stringify({ ok: true }) };
	}
	return { ok: true, status: 200, json: async () => DOC, text: async () => JSON.stringify(DOC) };
};

/** 极简 react 桩:够让组件真的渲染一次并重渲染一次(setState 会改写槽位) */
function makeReact() {
	const store = { states: [], refs: [], effects: [] };
	let index = 0;
	const api = {
		useState(initial) {
			const i = index++;
			if (!(i in store.states)) store.states[i] = typeof initial === "function" ? initial() : initial;
			return [store.states[i], (value) => {
				store.states[i] = typeof value === "function" ? value(store.states[i]) : value;
			}];
		},
		useRef(initial) {
			const i = index++;
			if (!(i in store.refs)) store.refs[i] = { current: initial };
			return store.refs[i];
		},
		useCallback(fn) { index++; return fn; },
		useMemo(fn) { index++; return fn(); },
		// 只在首次渲染时登记,避免「load 重跑」这种假循环
		useEffect(fn) { const i = index++; if (!store.effects[i]) store.effects[i] = fn; },
		createElement(type, props, ...children) { return { type, props: props || {}, children }; }
	};
	api.__begin = () => { index = 0; };
	api.__effects = store.effects;
	return api;
}

/** 造一个够用的 DOM:createOwnedStyle 只要 createElement("style") + setAttribute + remove/isConnected */
function makeDocument() {
	const makeEl = (tag) => {
		const el = {
			tagName: String(tag).toUpperCase(),
			id: "",
			textContent: "",
			style: {},
			isConnected: false,
			attributes: {},
			children: [],
			setAttribute(k, v) { this.attributes[k] = String(v); },
			getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
			appendChild(c) { this.children.push(c); c.isConnected = true; return c; },
			remove() { this.isConnected = false; },
			removeAttribute() {},
			querySelector() { return null; },
			querySelectorAll() { return []; },
			addEventListener() {}
		};
		return el;
	};
	const head = makeEl("head");
	return {
		createElement: makeEl,
		head,
		body: makeEl("body"),
		documentElement: Object.assign(makeEl("html"), { dataset: {} }),
		addEventListener() {},
		removeEventListener() {},
		querySelector() { return null; },
		querySelectorAll() { return []; }
	};
}

// 组件本体在模块级 require("react")(client.js:50),所以桩要在加载插件代码之前就位
const react = makeReact();

let pluginExports = null;
const sandbox = {
	window: {
		__ModuleLoader__: {
			load: (definition) => {
				const require = (name) => {
					if (name === "react") return react;
					throw new Error("verify-settings-page 意外 require: " + name);
				};
				pluginExports = definition.factory(require);
			}
		}
	},
	document: makeDocument(),
	localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
	navigator: {},
	console,
	setTimeout,
	clearTimeout,
	setInterval: () => 0,
	clearInterval: () => {},
	fetch: fetchStub,
	Element: class Element {},
	MutationObserver: class MutationObserver { observe() {} disconnect() {} },
	requestAnimationFrame: () => 0
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "lib", "client.js"), "utf8"), sandbox, { filename: "client.js" });

const T = pluginExports && pluginExports.__test;
const createSettingsPage = T && T.createSettingsPage;

section("工厂的可见性(抽取前这段代码无法脱离 apply 运行)");
report("__test 导出 createSettingsPage", typeof createSettingsPage === "function");
if (typeof createSettingsPage !== "function") {
	console.log("\n──── 结论 ────\n工厂不可见,后续断言无法进行");
	process.exit(1);
}

// ───────────────────────────────────────────────────────────────────────────
// 2) 用 8 个显式依赖实例化 —— 任何隐式捕获都会在这里炸成 ReferenceError
// ───────────────────────────────────────────────────────────────────────────

const registered = [];
const boundNamespaces = [];
const effectCalls = [];
const toolMotionListeners = new Set();
const savedDocs = [];

const page = createSettingsPage({
	locale: {
		register: (ns, dicts) => { registered.push({ ns, dicts }); return () => {}; },
		bind: (ns) => { boundNamespaces.push(ns); return (key) => key; }
	},
	effect: (callback, label) => { effectCalls.push({ callback, label }); return callback(); },
	toolMotionStatus: () => ({ calls: 7, matches: 2, switches: 1, channel: "ready", activeTails: 0, pendingSwitch: null }),
	toolMotionListeners,
	getRuntimePreset: () => "night",
	getLastLocale: () => "zh",
	isDarkTheme: () => false,
	onSaved: (parsed) => { savedDocs.push(parsed); }
});

section("独立实例化(仅靠显式依赖)");
report("返回 SETTINGS_NS", page && page.SETTINGS_NS === "status-rotator", String(page && page.SETTINGS_NS));
report("返回四个 Tab 的字典(zh / en 各一份)",
	!!page && !!page.SETTINGS_DICTS && !!page.SETTINGS_DICTS.zh && !!page.SETTINGS_DICTS.en && ["tab.text", "tab.appearance", "tab.behavior", "tab.schedule"].every((key) => typeof page.SETTINGS_DICTS.zh[key] === "string"));
report("返回 SettingsPanel 组件", typeof page.SettingsPanel === "function");
report("返回 st", typeof page.st === "function");
report("返回 dispose", typeof page.dispose === "function");

section("依赖走向(字典与文案都走注入的 locale/effect)");
report("effect 注册了一次,且带标签", effectCalls.length === 1 && /settings dictionaries/.test(effectCalls[0].label || ""),
	`calls=${effectCalls.length} label=${effectCalls[0] && effectCalls[0].label}`);
report("locale.register 拿到本插件的命名空间", registered.length === 1 && registered[0].ns === "status-rotator",
	`ns=${registered.map((r) => r.ns).join(",")}`);
report("st 绑定在本插件的命名空间上", boundNamespaces.length === 1 && boundNamespaces[0] === "status-rotator",
	`bind=${boundNamespaces.join(",")}`);

// ───────────────────────────────────────────────────────────────────────────
// 3) 真的渲染一次(首屏),再驱动载入后重渲染一次
// ───────────────────────────────────────────────────────────────────────────

const collectStrings = (node, out = []) => {
	if (node === null || node === undefined || node === false) return out;
	if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
	if (Array.isArray(node)) { for (const child of node) collectStrings(child, out); return out; }
	if (node.children) for (const child of node.children) collectStrings(child, out);
	return out;
};

section("渲染(不经 apply,直接调用组件)");
let firstTree = null;
try {
	react.__begin();
	firstTree = page.SettingsPanel({ t: (key) => key });
	report("首屏渲染不抛异常", firstTree !== null && firstTree !== undefined);
} catch (error) {
	report("首屏渲染不抛异常", false, String((error && error.stack) || error));
}

// 跑一遍 effect:其中一个会 load()(异步读文档),另外两个订阅诊断状态
try {
	for (const effect of react.__effects) if (typeof effect === "function") effect();
	report("effect 在沙箱里跑通(load / 诊断订阅)", true);
} catch (error) {
	report("effect 在沙箱里跑通(load / 诊断订阅)", false, String((error && error.stack) || error));
}
report("组件挂载时把自己加进了诊断订阅集合", toolMotionListeners.size === 1, `listeners=${toolMotionListeners.size}`);

let loadedTree = null;
(async () => {
	// 等 load() 的 await 链走完(读文档 → 若干 setState),再渲染第二遍
	for (let i = 0; i < 8; i++) await Promise.resolve();
	try {
		react.__begin();
		loadedTree = page.SettingsPanel({ t: (key) => key });
	} catch (error) {
		report("载入后重渲染不抛异常", false, String((error && error.stack) || error));
	}

	try {
		const strings = collectStrings(loadedTree);
		const tabs = ["tab.text", "tab.appearance", "tab.behavior", "tab.schedule"];
		const missing = tabs.filter((key) => !strings.includes(key));
		report("载入后仍渲染出四个 Tab", missing.length === 0, missing.length ? "缺 " + missing.join(",") : `树中字符串 ${strings.length} 个`);
		report("四个 Tab 的字典键在 zh/en 里都在",
			tabs.every((key) => typeof page.SETTINGS_DICTS.zh[key] === "string" && typeof page.SETTINGS_DICTS.en[key] === "string"));
	} catch (error) {
		report("载入后仍渲染出四个 Tab", false, String((error && error.stack) || error));
	}

	// ─────────────────────────────────────────────────────────────────────────
	// 4) dispose() 释放自有样式表
	// ─────────────────────────────────────────────────────────────────────────
	section("卸载");
	const styleEls = sandbox.document.head.children.filter((el) => el.id === "dsh-status-rotator-settings-style");
	report("工厂调用时就挂了一块自有样式表", styleEls.length === 1 && styleEls[0].isConnected,
		`found=${styleEls.length}`);
	try {
		page.dispose();
		report("dispose() 摘掉它", styleEls.length === 1 && styleEls[0].isConnected === false);
	} catch (error) {
		report("dispose() 摘掉它", false, String((error && error.stack) || error));
	}

	// ─────────────────────────────────────────────────────────────────────────
	// 5) 护栏:工厂源码里不得再出现 apply 作用域的绑定
	// ─────────────────────────────────────────────────────────────────────────
	section("护栏:不再有隐式捕获");
	const source = createSettingsPage.toString();
	// apply 作用域的运行时状态与函数。判定规则:这些名字**可以**出现,但只能以工厂自己声明的
	// 局部变量形式出现(const runtimePreset = getRuntimePreset() 就是合法的);裸引用即为泄漏。
	const APPLY_SCOPE = [
		"ctx", "remoteDoc", "recomputeEffective", "applyConfig", "runtimePreset", "lastLocale",
		"toolMotionCounts", "pendingToolSwitch", "liveSessionId", "liveEventsUnsub",
		"adopted", "typists", "lastPicks", "liveTimers", "liveTemplates",
		"turnLabels", "turnLines", "lineButtons", "runningLabels", "runningLines", "runningTails",
		"whaleTailMotionStates", "whaleTailPlaybackByRow"
	];
	const leaked = APPLY_SCOPE.filter((name) => {
		const used = new RegExp("(?<![\\w$.])" + name + "(?![\\w$])").test(source);
		if (!used) return false;
		const declared = new RegExp("\\b(?:const|let|var)\\s+" + name + "\\b").test(source);
		return !declared;
	});
	report("工厂源码里没有 apply 作用域的裸引用", leaked.length === 0,
		leaked.length ? "泄漏: " + leaked.join(",") : `检查了 ${APPLY_SCOPE.length} 个名字`);

	console.log("\n──── 结论 ────");
	console.log(failures === 0
		? "设置页可脱离 apply 独立实例化、独立渲染、独立卸载;字典与文案都走显式依赖"
		: `仍有 ${failures} 项不成立(见上面的 ✗)`);
	process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
	console.error(error);
	process.exit(2);
});
