/**
 * dsh-status-rotator — browser half.
 *
 * Swaps the hardcoded "Deep diving..." turn-status label in the DSH chat UI
 * for phrases that fit the current turn phase, typewriter-style, rotating
 * every intervalMs. Optional rainbow-gradient text (config.gradient). The
 * elapsed-time clock (appears after 15s) is left untouched — but it IS used
 * to detect the phase:
 *
 *   thinking → turn just started (no clock yet)
 *   running  → clock present, under config.longAfterMs
 *   long     → clock reached config.longAfterMs (stuck / slow turn)
 *
 * Everything is configurable from a JSON config file (see config.json /
 * config.example.json):
 *   { "config": { intervalMs, typeSpeedMs, longAfterMs, debug, gradient },
 *     "phrases": { zh: {thinking, running, long}, en: ... } }
 *
 * Phrase lists are NOT bundled in this source — they come from config.json,
 * which the node half serves automatically at LOCAL_CONFIG_URL (drop the file
 * beside the package and refresh; no manual step). Source priority, highest
 * first:
 *   1. localStorage "dsh-status-rotator.texts[.<locale>]" phrase overrides
 *   2. localStorage "dsh-status-rotator.config" full config+phrases
 *   3. external JSON: localStorage "dsh-status-rotator.url" > EXTERNAL_URL >
 *      LOCAL_CONFIG_URL (the auto-served package config.json)
 *   4. built-in DEFAULT_CONFIG only (no phrases)
 * With no phrase source, the label is left untouched ("Deep diving...").
 * Phrase lists follow the DSH UI language (zh / en) live; unknown locales
 * fall back to zh. Legacy flat-array phrase lists are treated as thinking.
 */
window.__ModuleLoader__.load({
	id: "dsh-status-rotator",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		// ══ 默认配置(可用配置文件 / 外部 JSON / localStorage 覆盖,见 README)══
		const DEFAULT_CONFIG = {
			/** 每隔多少毫秒换一句 */
			intervalMs: 10000,
			/** 打字机:每个字符间隔(毫秒),0 = 关闭打字机 */
			typeSpeedMs: 30,
			/** 运行超过多少毫秒进入 long 阶段 */
			longAfterMs: 60000,
			/** 诊断日志开关 */
			debug: false,
			/** 炫彩渐变文字:false 关闭;true 用默认配色;或 { enabled, colors, speed } */
			gradient: {
				enabled: true,
				/** 渐变颜色序列(至少 2 个),循环首尾 */
				colors: ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"],
				/** 渐变流动速度(秒/圈) */
				speed: 4,
			},
		};

		/** localStorage 文案覆盖键;按语言覆盖用 `${STORAGE_KEY}.${locale}` */
		const STORAGE_KEY = "dsh-status-rotator.texts";
		/** localStorage 外部 JSON URL 键(覆盖内置 EXTERNAL_URL) */
		const URL_KEY = "dsh-status-rotator.url";
		/** localStorage 完整配置键(粘贴整个配置文件内容,免部署,刷新生效) */
		const CONFIG_KEY = "dsh-status-rotator.config";
		/** 内置外部 JSON 地址(http(s)/data: 均可);空 = 回退到本地插件路由(自动加载) */
		const EXTERNAL_URL = "";
		/** 本地自动加载地址:node half 注册的 route,serve 插件同目录 config.json */
		const LOCAL_CONFIG_URL = "/plugins/dsh-status-rotator/config.json";

		const PHASE_THINKING = "thinking";
		const PHASE_RUNNING = "running";
		const PHASE_LONG = "long";

		

		// ══ 纯工具函数 ══

		/**
		 * 把任意形态的文案列表归一化为阶段分组:
		 * 旧格式(字符串数组)视为 thinking 组;分组对象缺组补空数组。
		 * 返回 null 表示非法。
		 */
		function normalizeGroups(list) {
			if (Array.isArray(list)) {
				const arr = list.filter((s) => typeof s === "string" && s.length > 0);
				return arr.length > 0 ? { thinking: arr, running: [], long: [] } : null;
			}
			if (list !== null && typeof list === "object") {
				const out = { thinking: [], running: [], long: [] };
				for (const phase of [PHASE_THINKING, PHASE_RUNNING, PHASE_LONG]) {
					const arr = Array.isArray(list[phase]) ? list[phase].filter((s) => typeof s === "string" && s.length > 0) : [];
					if (arr.length > 0) out[phase] = arr;
				}
				return Object.keys(out).some((k) => out[k].length > 0) ? out : null;
			}
			return null;
		}

		/**
		 * 归一化外部 JSON 为 { zh: groups, en: groups } 语言表。
		 * 支持两种形态:
		 *   1. { "zh": …, "en": … } 按语言(每组为数组或分组对象)
		 *   2. { "thinking": […], "running": […], "long": […] } 单组,所有语言共用
		 * 返回 null 表示非法。
		 */
		function normalizeTable(data) {
			if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
			const hasLang = data.zh !== undefined || data.en !== undefined;
			if (!hasLang) {
				const groups = normalizeGroups(data);
				return groups ? { zh: groups, en: groups } : null;
			}
			const out = {};
			for (const key of ["zh", "en"]) {
				if (data[key] === undefined) continue;
				const groups = normalizeGroups(data[key]);
				if (groups) out[key] = groups;
			}
			return Object.keys(out).length > 0 ? out : null;
		}

		/** 取某阶段可用的文案组;缺组时按 running → thinking 顺序回退,最终兜底任意非空组 */
		function textsForPhase(groups, phase) {
			if (!groups) return null;
			if (groups[phase] && groups[phase].length > 0) return groups[phase];
			for (const fallback of [PHASE_RUNNING, PHASE_THINKING]) {
				if (groups[fallback] && groups[fallback].length > 0) return groups[fallback];
			}
			for (const key of Object.keys(groups)) {
				if (groups[key].length > 0) return groups[key];
			}
			return null;
		}

		/**
		 * 解析时钟文本为秒数,解析失败返回 0。dsh 的时钟文本是本地化的:
		 *   zh: "15秒" / "1分02秒"
		 *   en: "15s" / "1m 02s"
		 * 兼容旧的冒号与纯数字格式。不再做「任意数字」兜底:
		 * 文案里出现数字不应被当成时长(如「正在安装2345…」)。
		 */
		function parseClock(text) {
			const t = String(text || "").trim();
			const m = t.match(/^(\d+):(\d{2})$/);
			if (m) return +m[1] * 60 + +m[2];
			const h = t.match(/^(\d+):(\d{2}):(\d{2})$/);
			if (h) return +h[1] * 3600 + +h[2] * 60 + +h[3];
			const zh = t.match(/^(\d+)分(\d+)秒$/);
			if (zh) return +zh[1] * 60 + +zh[2];
			const en = t.match(/^(\d+)m\s*(\d+)s$/);
			if (en) return +en[1] * 60 + +en[2];
			const zhSec = t.match(/^(\d+)秒$/);
			if (zhSec) return +zhSec[1];
			const enSec = t.match(/^(\d+)s$/);
			if (enSec) return +enSec[1];
			const n = t.match(/^(\d+)$/);
			if (n) return +n[1];
			return 0;
		}

		/** 校验配置片段:只保留类型合法的键,非法返回 null */
		function normalizeConfig(raw) {
			if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
			const out = {};
			if (typeof raw.intervalMs === "number" && raw.intervalMs > 0) out.intervalMs = raw.intervalMs;
			if (typeof raw.typeSpeedMs === "number" && raw.typeSpeedMs >= 0) out.typeSpeedMs = raw.typeSpeedMs;
			if (typeof raw.longAfterMs === "number" && raw.longAfterMs > 0) out.longAfterMs = raw.longAfterMs;
			if (typeof raw.debug === "boolean") out.debug = raw.debug;
			if (raw.gradient !== undefined) {
				const g = raw.gradient;
				if (g === true || g === false) out.gradient = { enabled: g };
				else if (g !== null && typeof g === "object" && !Array.isArray(g)) {
					const gg = {};
					if (typeof g.enabled === "boolean") gg.enabled = g.enabled;
					if (Array.isArray(g.colors) && g.colors.length >= 2 && g.colors.every((c) => typeof c === "string")) gg.colors = g.colors;
					if (typeof g.speed === "number" && g.speed > 0) gg.speed = g.speed;
					if (Object.keys(gg).length > 0) out.gradient = gg;
				}
			}
			return Object.keys(out).length > 0 ? out : null;
		}

		/** 配置片段合并到默认配置(浅合并,gradient 对象深合并) */
		function mergeConfig(base, over) {
			if (!over) return { ...base };
			const out = { ...base };
			for (const key of Object.keys(over)) {
				if (key === "gradient" && over[key] !== null && typeof over[key] === "object") {
					out[key] = { ...(base[key] || {}), ...over[key] };
				} else {
					out[key] = over[key];
				}
			}
			return out;
		}

		/**
		 * 解析外部 JSON(URL 加载或 localStorage 粘贴,两种形态):
		 *   1. 完整配置: { "config": {...}, "phrases": {...} }
		 *   2. 纯文案表(旧格式): { "zh": …, "en": … } 或 { "thinking": […] }
		 * 返回 { config, phrases },字段可为 null;整体非法返回 null。
		 */
		function parseExternal(data) {
			if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
			if (data.config !== undefined) {
				return {
					config: normalizeConfig(data.config),
					phrases: data.phrases !== undefined ? normalizeTable(data.phrases) : null,
				};
			}
			return { config: null, phrases: normalizeTable(data) };
		}

		// ══ 插件定义 ══
		const name = "status-rotator";
		/** 需要 dsh 的 locale 服务,以跟随「设置 → 语言」 */
		const inject = ["locale"];

		function apply(ctx) {
			const locale = ctx.locale;
			// 配置:默认值 → localStorage 完整配置 → (异步)外部 JSON,逐级合并
			let config = { ...DEFAULT_CONFIG };
			const log = (...args) => {
				if (config.debug) console.log("[status-rotator]", ...args);
			};
			const adopted = new Set();
			/** el -> 打字机状态 { timer, text, index } */
			const typists = new Map();
			/** el -> 上次选中的文案(防连续重复) */
			const lastPicks = new Map();
			/** 外部加载成功的语言表;null 表示未加载/失败 */
			let externalTable = null;
			// localStorage 完整配置(与外部 JSON 同构:可含 config + phrases)
			try {
				const raw = localStorage.getItem(CONFIG_KEY);
				if (raw !== null) {
					const parsed = parseExternal(JSON.parse(raw));
					if (parsed) {
						if (parsed.config) config = mergeConfig(config, parsed.config);
						if (parsed.phrases) externalTable = parsed.phrases;
					}
				}
			} catch (error) {
				/* 忽略损坏数据 */
			}
			let groups = readGroups(locale.getLocale().active);
			let lastLocale = locale.getLocale().active;

			/**
			 * 读取当前语言的阶段分组,优先级:
			 * localStorage texts.<locale> > texts > 外部文案表(config.json / 外部 URL)
			 * 无任何文案源时返回 null,保持状态文字原样。
			 */
			function readGroups(active) {
				for (const key of [STORAGE_KEY + "." + active, STORAGE_KEY]) {
					try {
						const raw = localStorage.getItem(key);
						if (raw !== null) {
							const parsed = normalizeGroups(JSON.parse(raw));
							if (parsed) return parsed;
						}
					} catch (error) {
						/* 忽略损坏数据,继续回退 */
					}
				}
				if (externalTable) {
					const ext = externalTable[active] ?? externalTable.zh ?? externalTable.en;
					if (ext) return ext;
				}
				// 源码不再内置文案:文案必须来自 config.json / localStorage / 外部 URL
				return null;
			}

			/**
			 * TurnStatus 的时钟是直接子元素,且带 aria-hidden="true"(dsh 本体
			 * 渲染约定)。不能取「第一个元素子节点」:渐变开启时第一个元素是本
			 * 插件包出的文案 span,会抢走时钟的位置,导致阶段判定彻底错乱。
			 */
			const clockEl = (el) => Array.from(el.children).find(
				(n) => n.getAttribute("aria-hidden") === "true"
			);

			/** 判定元素当前阶段:无时钟 → thinking;有时钟按秒数分 running / long */
			function phaseOf(el) {
				const clock = clockEl(el);
				if (!clock) return PHASE_THINKING;
				return parseClock(clock.textContent) * 1000 >= config.longAfterMs ? PHASE_LONG : PHASE_RUNNING;
			}

			/** 渐变包裹 span 的 class */
			const TEXT_SPAN_CLASS = "dsh-status-rotator-text";
			/** 渐变文字样式(按 config.gradient 生成,注入 <style>;关闭时清空) */
			let styleEl = null;
			const updateStyle = () => {
				if (styleEl === null) {
					styleEl = document.createElement("style");
					styleEl.id = "dsh-status-rotator-style";
					document.head.appendChild(styleEl);
				}
				const g = config.gradient;
				if (!g || !g.enabled) {
					styleEl.textContent = "";
					return;
				}
				const colors = Array.isArray(g.colors) && g.colors.length >= 2
					? g.colors
					: ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"];
				const speed = Math.max(1, Number(g.speed) || 4);
				const gradient = "linear-gradient(90deg, " + colors.join(", ") + ", " + colors[0] + ")";
				styleEl.textContent =
					"." + TEXT_SPAN_CLASS + ".dsh-status-rotator-rainbow {" +
					"background-image: " + gradient + ";" +
					"background-size: 200% auto;" +
					"-webkit-background-clip: text;" +
					"background-clip: text;" +
					"color: transparent;" +
					"animation: dsh-status-rotator-flow " + speed + "s linear infinite;" +
					"}" +
					"@keyframes dsh-status-rotator-flow { to { background-position: 200% center; } }";
			};

			/** 元素内的第一个文本节点(渐变开启时优先 span 内;不一定是 firstChild,防御性写法) */
			const firstTextNode = (el) => {
				const span = el.querySelector(":scope > ." + TEXT_SPAN_CLASS);
				if (span) {
					for (const node of span.childNodes) if (node.nodeType === 3) return node;
				}
				for (const node of el.childNodes) if (node.nodeType === 3) return node;
				return null;
			};

			/** 把文案文本节点包进渐变 span(开启时调用) */
			const wrapText = (el) => {
				const node = firstTextNode(el);
				if (!node || node.parentElement !== el) return;
				const span = document.createElement("span");
				span.className = TEXT_SPAN_CLASS;
				el.insertBefore(span, node);
				span.appendChild(node);
			};

			/** 拆掉渐变 span,文本节点移回元素(关闭时调用) */
			const unwrapText = (el) => {
				const span = el.querySelector(":scope > ." + TEXT_SPAN_CLASS);
				if (!span) return;
				const text = document.createTextNode(span.textContent);
				el.insertBefore(text, span);
				span.remove();
			};

			/** 按当前配置同步渐变开关与 class;返回是否发生了包装变化 */
			const syncGradient = (el) => {
				const want = !!(config.gradient && config.gradient.enabled);
				const has = el.querySelector(":scope > ." + TEXT_SPAN_CLASS) !== null;
				if (want && !has) wrapText(el);
				if (!want && has) unwrapText(el);
				const span = el.querySelector(":scope > ." + TEXT_SPAN_CLASS);
				if (span) span.classList.toggle("dsh-status-rotator-rainbow", want);
				return want !== has;
			};

			/** 从列表里随机选一句,避免与上次相同 */
			const pickFrom = (list, el) => {
				if (list.length === 1) return list[0];
				let next = lastPicks.get(el);
				while (next === undefined || next === lastPicks.get(el)) {
					next = list[Math.floor(Math.random() * list.length)];
					if (next !== lastPicks.get(el)) break;
				}
				lastPicks.set(el, next);
				return next;
			};

			/** 打字机:把 el 的文本逐字输出成 text;打断进行中的打字 */
			const typeText = (el, text) => {
				const node = firstTextNode(el);
				if (!node) return;
				const state = typists.get(el) || { timer: null, text: "", index: 0 };
				if (state.timer !== null) clearInterval(state.timer);
				state.text = text;
				state.index = 0;
				node.nodeValue = "";
				state.timer = setInterval(() => {
					const current = firstTextNode(el);
					// React 可能替换了文本节点:每 tick 重新找;找不到就放弃
					if (!current) {
						clearInterval(state.timer);
						state.timer = null;
						typists.delete(el);
						return;
					}
					state.index++;
					current.nodeValue = text.slice(0, state.index);
					if (state.index >= text.length) {
						clearInterval(state.timer);
						state.timer = null;
					}
				}, config.typeSpeedMs);
				typists.set(el, state);
			};

			/** 当前文本(打字机进行中返回部分文本) */
			const currentText = (el) => {
				const node = firstTextNode(el);
				return node ? node.nodeValue : "";
			};

			/** 按当前阶段重新选文案并打字(文案与当前相同则跳过) */
			const refresh = (el) => {
				const list = textsForPhase(groups, phaseOf(el));
				if (!list) return;
				const next = pickFrom(list, el);
				syncGradient(el);
				if (next !== currentText(el)) typeText(el, next);
			};

			/** 轮换:所有已接管元素换一句新文案 */
			const rotate = () => {
				let count = 0;
				for (const el of adopted) {
					if (!el.isConnected) {
						adopted.delete(el);
						typists.delete(el);
						lastPicks.delete(el);
						continue;
					}
					refresh(el);
					count++;
				}
				log("rotated, adopted =", adopted.size);
			};

			/** 语言/文案源变化后:重读分组,刷新全部已接管元素 */
			const refreshAll = () => {
				for (const el of adopted) {
					if (!el.isConnected) {
						adopted.delete(el);
						typists.delete(el);
						lastPicks.delete(el);
						continue;
					}
					refresh(el);
				}
			};

			const adopt = (el) => {
				if (adopted.has(el)) return;
				// role="status" + aria-live="polite" 在页面上并不唯一(轨迹历史
				// 加载、模型保存提示等区域也用它),所以必须再按 TurnStatus 的
				// 内容/结构过滤:
				//   1. 时钟出现前:初始文案固定是 "Deep diving...";
				//   2. 时钟出现后:存在一个能解析出正时长的 aria-hidden 直接子元素。
				// 其余 status 区域两个条件都不满足,不会被动到。
				const clock = clockEl(el);
				const isTurnStatus =
					el.getAttribute("role") === "status" &&
					el.getAttribute("aria-live") === "polite" &&
					(el.textContent.startsWith("Deep diving...") ||
						(clock !== undefined && parseClock(clock.textContent) > 0));
				if (!isTurnStatus) return;
				adopted.add(el);
				log("adopted, 当前文本:", JSON.stringify(el.textContent.slice(0, 40)));
				refresh(el);
			};

			const scan = (root) => {
				if (!(root instanceof Element)) return;
				for (const el of root.querySelectorAll('[role="status"][aria-live="polite"]')) adopt(el);
			};

			/** 兜底轮询:每 2 秒重扫一次(防止 MutationObserver 漏掉早期节点) */
			let lastSeenStatusCount = -1;
			const rescanAll = () => {
				const status = document.querySelectorAll('[role="status"][aria-live="polite"]');
				if (status.length !== lastSeenStatusCount) {
					lastSeenStatusCount = status.length;
					log("rescan: 状态标签 ×", status.length);
				}
				for (const el of status) adopt(el);
			};

			const observer = new MutationObserver((records) => {
				for (const record of records) {
					// 阶段变化:adopted 元素内部结构变化(时钟出现/移除)→ 立即换文案;
					// 我们自己 wrap/unwrap 渐变 span 造成的变化要排除,避免自我触发循环
					if (record.type === "childList" && adopted.has(record.target)) {
						const selfAdded = [...record.addedNodes].some(
							(n) => n.nodeType === 1 && n.classList && n.classList.contains(TEXT_SPAN_CLASS)
						);
						const selfRemoved = [...record.removedNodes].some(
							(n) => n.nodeType === 1 && n.classList && n.classList.contains(TEXT_SPAN_CLASS)
						);
						if (!selfAdded && !selfRemoved) refresh(record.target);
					}
					for (const node of record.addedNodes) {
						if (node instanceof Element) {
							// 新增节点本身可能是目标,也可能嵌套着目标
							adopt(node);
							scan(node);
						}
					}
				}
			});

			/** 外部 JSON 加载(EXTERNAL_URL 或 localStorage URL_KEY,异步;可同时带配置和文案) */
			const loadExternal = async () => {
				let url = "";
				try {
					url = localStorage.getItem(URL_KEY) || "";
				} catch (error) {
					/* ignore */
				}
				if (!url) url = EXTERNAL_URL || LOCAL_CONFIG_URL;
				if (!url) return;
				try {
					const res = await fetch(url, { cache: "no-store" });
					if (!res.ok) throw new Error("HTTP " + res.status);
					const parsed = parseExternal(await res.json());
					if (!parsed) throw new Error("invalid JSON shape");
					if (parsed.config) config = mergeConfig(config, parsed.config);
					if (parsed.phrases) {
						externalTable = parsed.phrases;
						// 关键:refresh 读取的是闭包 groups,必须用新文案源重算
						groups = readGroups(lastLocale);
					}
					applyConfig();
					log("external JSON loaded from", url);
				} catch (error) {
					console.warn("[status-rotator] external JSON failed, using built-ins:", error);
				}
			};

			/** 配置变化后的应用:重建轮换定时器、刷新渐变样式与全部文案 */
			const applyConfig = () => {
				if (timer !== null) {
					clearInterval(timer);
					timer = setInterval(rotate, config.intervalMs);
				}
				updateStyle();
				refreshAll();
			};

			let timer = null;
			let rescanner = null;

			const start = () => {
				document.documentElement.dataset.statusRotator = "active";
				observer.observe(document.body, { childList: true, subtree: true });
				updateStyle();
				scan(document.body);
				rescanAll();
				timer = setInterval(rotate, config.intervalMs);
				rescanner = setInterval(rescanAll, 2000);
				loadExternal();
				log("plugin active, locale =", locale.getLocale().active, ", config =", JSON.stringify(config));
			};

			if (document.body !== null) start();
			else {
				log("waiting for DOMContentLoaded…");
				document.addEventListener("DOMContentLoaded", start, { once: true });
			}

			// 跟随 DSH 语言设置:语言切换时立即刷新文案。
			const unsubscribe = locale.subscribe(() => {
				const active = locale.getLocale().active;
				if (active === lastLocale) return;
				lastLocale = active;
				groups = readGroups(active);
				lastPicks.clear();
				log("locale →", active);
				refreshAll();
			});

			// dsh 的 ctx.effect 会「立即执行」回调,并把回调的「返回值」当作卸载时的
			// 清理函数注册。因此清理逻辑必须包在返回的函数里,否则 apply 一结束
			// 观察器和定时器就被立刻拆掉,文本替换永远不会生效。
			ctx.effect(() => {
				return () => {
					unsubscribe();
					observer.disconnect();
					if (timer !== null) clearInterval(timer);
					if (rescanner !== null) clearInterval(rescanner);
					for (const state of typists.values()) {
						if (state.timer !== null) clearInterval(state.timer);
					}
					if (styleEl !== null && styleEl.isConnected) styleEl.remove();
					adopted.clear();
					typists.clear();
					lastPicks.clear();
				};
			}, "status-rotator: label rotation");
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
