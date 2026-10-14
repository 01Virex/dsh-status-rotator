/**
 * 设置页真浏览器回归的公共夹具(dev-only,不随 npm 包发布)。
 *
 * 从 scripts/settings-save-test.html 里抽出来的那一套:能跑的最小 React(真 state /
 * 真 effect / 真事件)+ 真 DOM 挂载 + 插件侧桩 + 断言收集。抽出来的原因很实在 ——
 * issue #144 的回归页需要同一套状态机,复制一份就等于以后修一处漏一处。
 *
 * 用法(普通 <script>,不需要打包):
 *   <script src="./settings-harness.js"></script>
 *   <script src="../lib/client.js"></script>          // 真实插件代码
 *   <script> const h = createSettingsHarness({ doc }); ... </script>
 *
 * 页面可用 window.__SETTINGS_TAB__ 指定设置页首帧落在哪个 tab(默认 "text")。
 *
 * 同一窗口里多次调用返回**同一个实例**:React 替身的「当前渲染实例」游标只有一份,
 * 建两份实例会让第二份之外的渲染直接抛「hook 在组件外被调用」。
 */
const SETTINGS_HARNESS_CACHE = new WeakMap();
function createSettingsHarness(options) {
	const win = (options && options.window) || window;
	const cached = SETTINGS_HARNESS_CACHE.get(win);
	if (cached) return cached;
	const built = buildSettingsHarness(options);
	SETTINGS_HARNESS_CACHE.set(win, built);
	return built;
}

function buildSettingsHarness(options) {
	const opts = options || {};
	const win = opts.window || window;
	const doc = opts.document || document;

	// ══ 断言收集:页面自己宣告「跑完了」,runner 据此判断不是截断的假阳性 ══
	const results = [];
	const R = (name, pass, extra) => {
		results.push({ name, pass: !!pass, extra: extra === undefined || extra === null ? "" : String(extra) });
		return !!pass;
	};

	// ══ 最小 React:只实现设置页用到的四个 hook + createElement ══
	let current = null;
	const hooksOf = () => { if (!current) throw new Error("hook 在组件外被调用"); return current; };
	const depsChanged = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => v !== b[i]);
	const reactStub = {
		createElement: (type, props, ...children) => ({
			type,
			props: props || {},
			children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true),
		}),
		useState: (init) => {
			const inst = hooksOf();
			const i = inst.cursor++;
			if (!(i in inst.slots)) {
				// 设置页首个 useState 就是 tab;夹具可以指定首帧落在哪一页
				inst.slots[i] = init === "text" && win.__SETTINGS_TAB__
					? win.__SETTINGS_TAB__
					: (typeof init === "function" ? init() : init);
			}
			return [inst.slots[i], (v) => {
				inst.slots[i] = typeof v === "function" ? v(inst.slots[i]) : v;
				inst.render();
			}];
		},
		useRef: (init) => {
			const inst = hooksOf();
			const i = inst.cursor++;
			if (!(i in inst.slots)) inst.slots[i] = { current: init === undefined ? null : init };
			return inst.slots[i];
		},
		useCallback: (fn, deps) => {
			const inst = hooksOf();
			const i = inst.cursor++;
			const slot = inst.slots[i];
			if (!slot || depsChanged(slot.deps, deps)) inst.slots[i] = { fn, deps };
			return inst.slots[i].fn;
		},
		useEffect: (fn, deps) => {
			const inst = hooksOf();
			const i = inst.cursor++;
			const key = "e" + i;
			const slot = inst.slots[key];
			if (!slot || depsChanged(slot.deps, deps)) {
				inst.slots[key] = { fn, deps, pending: true, cleanup: slot ? slot.cleanup : undefined };
			}
		},
	};

	const toDom = (node) => {
		if (node === null || node === undefined || node === false || node === true) return doc.createTextNode("");
		if (typeof node === "string" || typeof node === "number") return doc.createTextNode(String(node));
		if (Array.isArray(node)) {
			const frag = doc.createDocumentFragment();
			for (const child of node) frag.appendChild(toDom(child));
			return frag;
		}
		if (typeof node.type === "function") return toDom(node.type({ ...node.props, children: node.children }));
		const el = doc.createElement(node.type);
		for (const [key, value] of Object.entries(node.props || {})) {
			if (key === "children" || key === "key" || value === null || value === undefined) continue;
			if (key === "className") el.className = String(value);
			else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
			else if (key === "ref" && typeof value === "object") value.current = el;
			else if (key === "value") el.value = String(value);
			else if (key === "checked") el.checked = !!value;
			else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
			// aria-* 的布尔值 React 会渲染成字符串("true"/"false")——先于下面的布尔分支处理
			else if (key.startsWith("aria-") || key.startsWith("data-")) el.setAttribute(key, String(value));
			// 其余布尔属性按 React 的语义:false = **不写**这个属性(写成 "disabled=\"false\"" 也会禁用元素)
			else if (typeof value === "boolean") { if (value) el.setAttribute(key, ""); }
			else el.setAttribute(key, String(value));
		}
		for (const child of node.children || []) el.appendChild(toDom(child));
		// React applies a controlled select's value after its options exist.
		// Setting it on an empty select silently falls back to the first option.
		if (el.tagName === "SELECT" && node.props?.value !== undefined && node.props?.value !== null) el.value = String(node.props.value);
		return el;
	};

	const mount = (Component, props, container) => {
		const inst = { Component, props, slots: [], cursor: 0, render: null };
		let queued = false;
		// 状态更新**不在渲染过程中同步重入**,而是排队到 microtask(React 的批量语义):
		// 否则 effect 里发起的 setState 会在上一次渲染还没结束时就再渲染一次,游标串槽。
		const doRender = () => {
			queued = false;
			current = inst;
			inst.cursor = 0;
			const tree = inst.Component(inst.props);
			current = null;
			container.textContent = "";
			container.appendChild(toDom(tree));
			const pending = [];
			for (const key of Object.keys(inst.slots)) {
				const slot = inst.slots[key];
				if (slot && slot.pending) pending.push(slot);
			}
			for (const slot of pending) {
				slot.pending = false;
				if (typeof slot.cleanup === "function") { try { slot.cleanup(); } catch (error) { /* ignore */ } }
				const cleanup = slot.fn();
				slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
			}
		};
		inst.render = () => {
			if (queued) return;
			queued = true;
			queueMicrotask(doRender);
		};
		doRender();
		return inst;
	};

	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	/**
	 * 插件侧桩 + 应用真实 lib/client.js:localStorage 置空(不要覆盖 fetch 回来的文档),
	 * ctx.locale 收集字典(供页面按 key 查真实中文,而不是拿到 key 本身)。
	 */
	const pluginDictionaries = {};
	let settingsComponent = null;
	const applyPlugin = (ctx) => {
		win.__ModuleLoader__ = {
			load(def) {
				win.__PLUGIN__ = def.factory((name) => {
					if (name === "react") return reactStub;
					throw new Error("unexpected require: " + name);
				});
			},
		};
	};
	/** 默认 ctx:与 settings-save-test.html 同形;可用 opts.ctx 覆盖 */
	const defaultCtx = {
		locale: {
			register: (namespace, tables) => { pluginDictionaries[namespace] = tables; return () => {}; },
			subscribe: () => () => {},
			getLocale: () => ({ active: "zh" }),
			bind: () => null,
		},
		slots: {
			inject: (name, fn) => fn(),
			register: (def, comp) => { if (typeof comp === "function") settingsComponent = comp; return { dispose() {} }; },
		},
		effect: (cb) => cb(),
		get: () => undefined,
		on: () => {},
	};

	/** 按 key 取字典里的真实文案(字典里没有就回 key);与 settings-save-test 的 t(k)=k 不同 */
	const dictTranslate = (namespace) => (key, params) => {
		let text = pluginDictionaries[namespace]?.zh?.[key] || key;
		for (const [name, value] of Object.entries(params || {})) text = text.replaceAll("{" + name + "}", String(value));
		return text;
	};

	/**
	 * 挂载设置页。props.t 走**键名直通**(与 settings-save-test.html 同形):
	 * 设置页内部优先用自己注册的字典(locale.bind),只有 bind 返回 null 时才用 props.t,
	 * 所以塞进 props 并不会变成真中文 —— 页面文案仍是 i18n 键,断言按键名找元素。
	 */
	const mountSettings = (container) => {
		mount(settingsComponent, { t: (key) => key }, container);
	};

	/** 按 key 取插件注册的真实字典文案(没注册就回 key);断言"用户真的能看到中文"时用 */
	const rawTranslate = (namespace, key) => (pluginDictionaries[namespace] && pluginDictionaries[namespace].zh && pluginDictionaries[namespace].zh[key]) || key;

	return {
		R,
		results,
		reactStub,
		mount,
		sleep,
		applyPlugin,
		mountSettings,
		defaultCtx,
		dictTranslate,
		rawTranslate,
		dictionaries: pluginDictionaries,
		settingsComponent: () => settingsComponent,
	};
}
