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
 *   { "config": { intervalMs, typeSpeedMs, longAfterMs, reloadIntervalMs,
 *                 liveTickMs, debug, gradient, title },
 *     "phrases": { zh: {thinking, running, long}, en: ... },
 *     "presets": [{ id, label?, config?, phrases? }],
 *     "activePreset": "…" | null,
 *     "schedule": [{ preset, days?, from, to }] }
 *
 * Phrases and title templates support placeholders: {elapsed} {phase}
 * {phaseLabel} {locale} {date} {time}; the time-varying ones ({elapsed},
 * {date}, {time}) refresh every liveTickMs. Presets carry their own config
 * and phrases; schedule rules switch the active preset by weekday/time.
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

		/** 设置页组件需要 React(DSH 模块加载器提供,与内置设置页共用同一份) */
		const react = require("react");

		// ══ 默认配置(可用配置文件 / 外部 JSON / localStorage 覆盖,见 README)══
		const DEFAULT_CONFIG = {
			/** 每隔多少毫秒换一句 */
			intervalMs: 10000,
			/** 打字机:每个字符间隔(毫秒),0 = 关闭打字机 */
			typeSpeedMs: 30,
			/** 运行超过多少毫秒进入 long 阶段 */
			longAfterMs: 60000,
			/** 页面打开时自动重读 config.json 的间隔(毫秒);0 = 关闭 */
			reloadIntervalMs: 15000,
			/** 动态占位符({elapsed}/{date}/{time})的刷新间隔(毫秒);0 = 只随轮换刷新 */
			liveTickMs: 1000,
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
			/** 标签页标题:false 关闭;或 { enabled, templates, idleTemplate, intervalMs } */
			title: {
				enabled: false,
				/** 标题模板(按 intervalMs 轮换),支持与文案相同的占位符 */
				templates: ["⏳ {phase} {elapsed}"],
				/** 无回合进行中时的标题模板;"" = 恢复原始标题 */
				idleTemplate: "",
				/** 标题模板轮换间隔(毫秒) */
				intervalMs: 8000,
			},
			/** 实时状态 Pill:false 关闭;或 { enabled, template, position, opacity } */
			pill: {
				enabled: true,
				/** 显示模板(与文案同占位符;新增 {model}/{provider}/{tps}/{pending}/{tools}) */
				template: "🧠 {model} · {phaseLabel} · {elapsed} · ⚡{tps} tok/s · ⏳{pending}",
				/** 方位:right-bottom / left-bottom / right-top / left-top */
				position: "right-bottom",
				/** 不透明度(0.5 ~ 1) */
				opacity: 0.92,
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
			if (typeof raw.reloadIntervalMs === "number" && raw.reloadIntervalMs >= 0) out.reloadIntervalMs = raw.reloadIntervalMs;
			if (typeof raw.liveTickMs === "number" && raw.liveTickMs >= 0) out.liveTickMs = raw.liveTickMs;
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
			if (raw.title !== undefined) {
				const t = raw.title;
				if (t === true || t === false) out.title = { enabled: t };
				else if (t !== null && typeof t === "object" && !Array.isArray(t)) {
					const tt = {};
					if (typeof t.enabled === "boolean") tt.enabled = t.enabled;
					if (Array.isArray(t.templates) && t.templates.every((x) => typeof x === "string")) tt.templates = t.templates;
					if (typeof t.idleTemplate === "string") tt.idleTemplate = t.idleTemplate;
					if (typeof t.intervalMs === "number" && t.intervalMs > 0) tt.intervalMs = t.intervalMs;
					if (Object.keys(tt).length > 0) out.title = tt;
				}
			}
			if (raw.pill !== undefined) {
				const p = raw.pill;
				if (p === true || p === false) out.pill = { enabled: p };
				else if (p !== null && typeof p === "object" && !Array.isArray(p)) {
					const pp = {};
					if (typeof p.enabled === "boolean") pp.enabled = p.enabled;
					if (typeof p.template === "string") pp.template = p.template;
					if (["right-bottom", "left-bottom", "right-top", "left-top"].includes(p.position)) pp.position = p.position;
					if (typeof p.opacity === "number" && p.opacity > 0 && p.opacity <= 1) pp.opacity = p.opacity;
					if (Object.keys(pp).length > 0) out.pill = pp;
				}
			}
			return Object.keys(out).length > 0 ? out : null;
		}

		/** 配置片段合并到默认配置(浅合并,gradient / title / pill 对象深合并) */
		function mergeConfig(base, over) {
			if (!over) return { ...base };
			const out = { ...base };
			for (const key of Object.keys(over)) {
				if ((key === "gradient" || key === "title" || key === "pill") && over[key] !== null && typeof over[key] === "object") {
					out[key] = { ...(base[key] || {}), ...over[key] };
				} else {
					out[key] = over[key];
				}
			}
			return out;
		}

		/** 预设列表归一化:[{ id, label?, config?, phrases? }];非法条目跳过,返回 null 表示无 */
		function normalizePresets(list) {
			if (!Array.isArray(list)) return null;
			const out = [];
			for (const item of list) {
				if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
				if (typeof item.id !== "string" || item.id.length === 0) continue;
				const p = { id: item.id };
				if (typeof item.label === "string" && item.label.length > 0) p.label = item.label;
				else if (item.label !== null && typeof item.label === "object") {
					const lab = {};
					for (const k of ["zh", "en"]) {
						if (typeof item.label[k] === "string" && item.label[k].length > 0) lab[k] = item.label[k];
					}
					if (Object.keys(lab).length > 0) p.label = lab;
				}
				if (item.config !== undefined) {
					const c = normalizeConfig(item.config);
					if (c) p.config = c;
				}
				if (item.phrases !== undefined) {
					const t = normalizeTable(item.phrases);
					if (t) p.phrases = t;
				}
				out.push(p);
			}
			return out.length > 0 ? out : null;
		}

		const SCHEDULE_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

		/** 调度规则归一化:[{ preset, days, from, to }];days 省略 = 每天 */
		function normalizeSchedule(list) {
			if (!Array.isArray(list)) return null;
			const out = [];
			for (const item of list) {
				if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
				if (typeof item.preset !== "string" || item.preset.length === 0) continue;
				const days = item.days === undefined
					? SCHEDULE_DAYS.slice()
					: (Array.isArray(item.days) ? item.days.filter((d) => SCHEDULE_DAYS.includes(d)) : []);
				if (days.length === 0) continue;
				const from = typeof item.from === "string" && /^\d{1,2}:\d{2}$/.test(item.from) ? item.from : "09:00";
				const to = typeof item.to === "string" && /^\d{1,2}:\d{2}$/.test(item.to) ? item.to : "18:00";
				out.push({ preset: item.preset, days, from, to });
			}
			return out.length > 0 ? out : null;
		}

		/** 当前时间命中的调度预设 id;未命中返回 null(由 activePreset 兜底) */
		function matchSchedule(schedule, now) {
			if (!schedule || schedule.length === 0) return null;
			const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
			const day = dayNames[now.getDay()];
			const minutes = now.getHours() * 60 + now.getMinutes();
			for (const entry of schedule) {
				if (!entry.days.includes(day)) continue;
				const [fh, fm] = entry.from.split(":").map(Number);
				const [th, tm] = entry.to.split(":").map(Number);
				const fromMin = fh * 60 + fm;
				const toMin = th * 60 + tm;
				if (fromMin <= toMin) {
					if (minutes >= fromMin && minutes < toMin) return entry.preset;
				} else if (minutes >= fromMin || minutes < toMin) {
					// 跨天窗口(如 22:00 - 06:00)
					return entry.preset;
				}
			}
			return null;
		}

		/** 秒数 → 本地化时长文本(与 dsh 时钟风格一致:zh "1分02秒" / en "1m 02s") */
		function formatElapsed(totalSeconds, locale) {
			const t = Math.max(0, Math.floor(Number(totalSeconds) || 0));
			const h = Math.floor(t / 3600);
			const m = Math.floor((t % 3600) / 60);
			const s = t % 60;
			const pad = (n) => String(n).padStart(2, "0");
			if (locale === "en") {
				if (h > 0) return h + "h " + m + "m " + s + "s";
				if (m > 0) return m + "m " + pad(s) + "s";
				return s + "s";
			}
			if (h > 0) return h + "小时" + m + "分" + pad(s) + "秒";
			if (m > 0) return m + "分" + pad(s) + "秒";
			return s + "秒";
		}

		/** 阶段短标签(供 {phaseLabel} 占位符使用) */
		const PHASE_LABELS = {
			zh: { thinking: "思考中", running: "运行中", long: "长任务", idle: "空闲" },
			en: { thinking: "thinking", running: "running", long: "long", idle: "idle" },
		};

		/** 模板占位符替换:{elapsed} {phase} {phaseLabel} {locale} {date} {time};未知占位符原样保留 */
		function interpolate(template, ctx) {
			return String(template || "").replace(/\{(\w+)\}/g, (match, key) => {
				if (ctx !== null && typeof ctx === "object" && Object.prototype.hasOwnProperty.call(ctx, key)) {
					return ctx[key];
				}
				return match;
			});
		}

		/** 模板是否含随时间变化的占位符(需要 live tick 刷新) */
		const isDynamicTemplate = (template) => /\{(elapsed|date|time|tps|pending|tools|model|provider)\}/.test(String(template || ""));

		/** ModelSelection → { provider, model }(防御性提取,非法返回空串) */
		function extractModel(sel) {
			if (!sel || typeof sel !== "object") return { provider: "", model: "" };
			return {
				provider: typeof sel.provider === "string" ? sel.provider : "",
				model: typeof sel.model === "string" ? sel.model : "",
			};
		}

		/** RpcResult<SessionModels> → { provider, model }(防御性穿透 res.value.current) */
		function pickModel(res) {
			const cur = res && res.current ? res.current
				: (res && res.value && res.value.current ? res.value.current : null);
			return extractModel(cur);
		}

		/**
		 * ConversationSnapshot → 实时状态片段(防御性遍历):
		 * { running, pending, tools[], streamChars }
		 */
		function extractSnapshot(snap) {
			if (!snap || typeof snap !== "object") return null;
			const pending = Array.isArray(snap.pending) ? snap.pending.length : 0;
			const calls = Array.isArray(snap.runningCalls) ? snap.runningCalls : [];
			const tools = calls
				.map((c) => (c && typeof c.name === "string" ? c.name : ""))
				.filter(Boolean);
			let streamChars = 0;
			const blocks = snap.partial && Array.isArray(snap.partial.blocks) ? snap.partial.blocks : [];
			for (const b of blocks) {
				if (b && typeof b.text === "string") streamChars += b.text.length;
			}
			return { running: !!snap.running, pending, tools, streamChars };
		}

		/** 颜色列表文本 → 字符串数组(逗号/空格/换行分隔,去空);非法返回 [] */
		function parseColorList(text) {
			return String(text || "")
				.split(/[\s,，、;；]+/)
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
		}

		/**
		 * 解析外部 JSON(URL 加载或 localStorage 粘贴,两种形态):
		 *   1. 完整配置: { "config": {...}, "phrases": {...}, "presets": [...], "activePreset": "...", "schedule": [...] }
		 *   2. 纯文案表(旧格式): { "zh": …, "en": … } 或 { "thinking": […] }
		 * 返回 { config, phrases, presets, activePreset, schedule },字段可为 null;整体非法返回 null。
		 */
		function parseExternal(data) {
			if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
			const out = { config: null, phrases: null, presets: null, activePreset: null, schedule: null };
			if (data.config !== undefined) {
				out.config = normalizeConfig(data.config);
				out.phrases = data.phrases !== undefined ? normalizeTable(data.phrases) : null;
			} else {
				out.phrases = normalizeTable(data);
			}
			if (data.presets !== undefined) out.presets = normalizePresets(data.presets);
			if (data.activePreset !== undefined) out.activePreset = typeof data.activePreset === "string" && data.activePreset.length > 0 ? data.activePreset : null;
			if (data.schedule !== undefined) out.schedule = normalizeSchedule(data.schedule);
			return out;
		}

		// ══ 插件定义 ══
		const name = "status-rotator";
		/** 需要 dsh 的 locale 服务(跟随语言)和 slots 服务(设置页词库编辑器) */
		const inject = ["locale", "slots"];

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
			/** el -> 动态占位符({elapsed} 等)刷新定时器 */
			const liveTimers = new Map();
			/** 外部加载成功的语言表;null 表示未加载/失败 */
			let externalTable = null;
			// 配置文档来源:localStorage 完整配置(localDoc)与外部 JSON(remoteDoc)。
			// 生效文档 = 两者按字段合并(remote 优先);预设/调度在生效文档之上再解析。
			let localDoc = null;
			let remoteDoc = null;
			/** 当前运行时生效的预设 id;null = 未启用预设 */
			let runtimePreset = null;
			/** 标签页标题管理 */
			let origTitle = "";
			let titleIndex = 0;

			/** 当前生效配置文档(localDoc + remoteDoc 合并,remote 优先) */
			const effectiveDoc = () => {
				const merge2 = (a, b) => {
					if (!a) return b;
					if (!b) return a;
					return {
						config: mergeConfig(a.config, b.config),
						phrases: b.phrases ?? a.phrases,
						presets: b.presets ?? a.presets,
						activePreset: b.activePreset ?? a.activePreset,
						schedule: b.schedule ?? a.schedule,
					};
				};
				return merge2(localDoc, remoteDoc);
			};

			/** 重算生效配置:默认值 → 文档 config → 预设 config;文案同理(调度命中优先于 activePreset) */
			const recomputeEffective = () => {
				const doc = effectiveDoc();
				let cfg = { ...DEFAULT_CONFIG };
				if (doc && doc.config) cfg = mergeConfig(cfg, doc.config);
				let preset = null;
				if (doc) {
					const target = doc.schedule ? matchSchedule(doc.schedule, new Date()) : null;
					const id = target !== null ? target : doc.activePreset;
					if (id && doc.presets) preset = doc.presets.find((p) => p.id === id) || null;
				}
				if (preset && preset.config) cfg = mergeConfig(cfg, preset.config);
				config = cfg;
				externalTable = preset && preset.phrases ? preset.phrases : (doc && doc.phrases ? doc.phrases : null);
				groups = readGroups(lastLocale);
				runtimePreset = preset ? preset.id : null;
			};

			// localStorage 完整配置(与外部 JSON 同构:可含 config / phrases / presets / schedule)
			try {
				const raw = localStorage.getItem(CONFIG_KEY);
				if (raw !== null) {
					const parsed = parseExternal(JSON.parse(raw));
					if (parsed) localDoc = parsed;
				}
			} catch (error) {
				/* 忽略损坏数据 */
			}
			let lastLocale = locale.getLocale().active;
			let groups = null;
			recomputeEffective();

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

			/** 打字机:把 el 的文本逐字输出成 text;打断进行中的打字。typeSpeedMs=0 时立即输出。 */
			const typeText = (el, text, onDone) => {
				const node = firstTextNode(el);
				if (!node) return;
				const state = typists.get(el) || { timer: null, text: "", index: 0 };
				if (state.timer !== null) clearInterval(state.timer);
				state.text = text;
				state.index = 0;
				node.nodeValue = "";
				if (config.typeSpeedMs === 0) {
					node.nodeValue = text;
					state.timer = null;
					if (typeof onDone === "function") onDone();
					return;
				}
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
						if (typeof onDone === "function") onDone();
					}
				}, config.typeSpeedMs);
				typists.set(el, state);
			};

			/** 当前文本(打字机进行中返回部分文本) */
			const currentText = (el) => {
				const node = firstTextNode(el);
				return node ? node.nodeValue : "";
			};

			/** 模板变量的上下文(el 为 null = 用引擎实时状态,供 Pill/标题使用) */
			const ctxFor = (el) => {
				const now = new Date();
				const pad = (n) => String(n).padStart(2, "0");
				const base = {
					locale: lastLocale,
					date: now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()),
					time: pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds()),
					// 实时引擎字段(无数据时显示 —)
					model: liveState.model || "—",
					provider: liveState.provider || "—",
					tps: String(liveState.tps),
					pending: String(liveState.pending),
					tools: liveState.tools.length > 0 ? liveState.tools.join("+") : "—",
					running: liveState.running ? "run" : "idle",
				};
				const labels = PHASE_LABELS[lastLocale] || PHASE_LABELS.en;
				if (el === null) {
					const phase = liveState.phase || "idle";
					return {
						...base,
						elapsed: formatElapsed(liveState.elapsed, lastLocale),
						phase,
						phaseLabel: labels[phase] ?? phase,
					};
				}
				const phase = phaseOf(el);
				const clock = clockEl(el);
				return {
					...base,
					elapsed: formatElapsed(clock ? parseClock(clock.textContent) : 0, lastLocale),
					phase,
					phaseLabel: labels[phase] ?? phase,
				};
			};

			/** 渲染一句模板(占位符替换) */
			const renderPhrase = (template, el) => interpolate(template, ctxFor(el));

			/** 停止 el 的动态占位符刷新 */
			const clearLive = (el) => {
				const t = liveTimers.get(el);
				if (t !== undefined) {
					clearInterval(t);
					liveTimers.delete(el);
				}
			};

			/** 若模板含随时间变化的占位符且 liveTickMs > 0,启动每秒刷新 */
			const maybeStartLive = (el, template) => {
				clearLive(el);
				if (!(config.liveTickMs > 0) || !isDynamicTemplate(template)) return;
				liveTimers.set(el, setInterval(() => {
					if (!el.isConnected) {
						clearLive(el);
						return;
					}
					const node = firstTextNode(el);
					if (!node) return;
					node.nodeValue = renderPhrase(template, el);
				}, config.liveTickMs));
			};

			/** 按当前阶段重新选文案并打字(文案与当前相同则跳过) */
			const refresh = (el) => {
				const list = textsForPhase(groups, phaseOf(el));
				if (!list) return;
				const next = pickFrom(list, el);
				syncGradient(el);
				clearLive(el);
				const rendered = renderPhrase(next, el);
				if (rendered !== currentText(el)) {
					typeText(el, rendered, () => maybeStartLive(el, next));
				} else {
					maybeStartLive(el, next);
				}
			};

			/** 第一个仍在文档里的已接管元素(作为标题的回合状态来源) */
			const activeEl = () => {
				for (const el of adopted) {
					if (el.isConnected) return el;
				}
				return null;
			};

			/** 标签页标题:回合中按模板轮换;无回合用 idleTemplate(空 = 恢复原始标题) */
			const updateTitle = () => {
				const t = config.title;
				if (!t || !t.enabled) {
					if (document.title !== origTitle) document.title = origTitle;
					return;
				}
				const el = activeEl();
				if (el) {
					const tpls = Array.isArray(t.templates) && t.templates.length > 0
						? t.templates
						: ["⏳ {phase} {elapsed}"];
					document.title = interpolate(tpls[titleIndex % tpls.length], ctxFor(el));
				} else if (typeof t.idleTemplate === "string" && t.idleTemplate.length > 0) {
					document.title = interpolate(t.idleTemplate, ctxFor(null));
				} else if (document.title !== origTitle) {
					document.title = origTitle;
				}
			};

			const advanceTitle = () => {
				titleIndex++;
				updateTitle();
			};

			// ══ 实时状态引擎:聚合 dsh 会话快照 / 模型 RPC / DOM 阶段兜底 ══
			// 供文案/标题占位符与实时 Pill 共用,单一数据源。
			const liveState = {
				model: "", provider: "", tps: 0, pending: 0,
				tools: [], streamChars: 0, running: false,
				phase: "idle", elapsed: 0,
			};
			const liveListeners = new Set();
			let liveSessionId = null;
			let liveSessionUnsub = null;
			let liveListUnsub = null;
			let liveModelToken = 0;
			let liveEngineTimer = null;
			let lastChars = 0;
			let lastCharsTime = 0;

			const setLive = (patch) => {
				let changed = false;
				for (const k of Object.keys(patch)) {
					if (liveState[k] !== patch[k]) { liveState[k] = patch[k]; changed = true; }
				}
				if (!changed) return;
				for (const fn of liveListeners) {
					try { fn(); } catch (error) { /* 单个监听失败不拖垮其他 */ }
				}
			};
			const subscribeLive = (fn) => {
				liveListeners.add(fn);
				return () => liveListeners.delete(fn);
			};

			/** 按名字取可选服务(不声明进 inject,避免旧版 dsh 缺服务导致插件启动失败) */
			const access = (name) => {
				try {
					if (typeof ctx.get === "function") {
						const v = ctx.get(name);
						if (v !== undefined && v !== null) return v;
					}
				} catch (error) { /* ignore */ }
				try {
					if (ctx[name] !== undefined && ctx[name] !== null) return ctx[name];
				} catch (error) { /* ignore */ }
				return null;
			};

			/** DOM 兜底:从 role=status 元素读阶段/耗时(与状态文案同一套判定) */
			const domPhaseOf = () => {
				for (const el of document.querySelectorAll('[role="status"][aria-live="polite"]')) {
					if (!el.isConnected) continue;
					const clock = clockEl(el);
					if (clock === undefined) continue;
					const hasClock = Boolean(clock && clock.textContent && clock.textContent.length > 0);
					const sec = hasClock ? parseClock(clock.textContent) : 0;
					return {
						phase: !hasClock ? PHASE_THINKING : (sec * 1000 >= config.longAfterMs ? PHASE_LONG : PHASE_RUNNING),
						elapsed: hasClock ? sec : 0,
					};
				}
				return null;
			};

			/** 绑定当前会话:订阅快照 + 拉取模型名 */
			const connectSession = (id) => {
				if (id === liveSessionId) return;
				liveSessionId = id;
				if (liveSessionUnsub) { liveSessionUnsub(); liveSessionUnsub = null; }
				setLive({ model: "", provider: "" });
				const sessions = access("sessions");
				if (!sessions) return;
				let face = null;
				try {
					const binding = typeof sessions.binding === "function" ? sessions.binding(id) : undefined;
					face = binding && binding.session ? binding.session : null;
				} catch (error) { /* ignore */ }
				if (face && typeof face.subscribe === "function" && typeof face.getSnapshot === "function") {
					liveSessionUnsub = face.subscribe(() => {
						try {
							const ex = extractSnapshot(face.getSnapshot());
							if (ex) setLive(ex);
						} catch (error) { /* ignore */ }
					});
					try {
						const ex = extractSnapshot(face.getSnapshot());
						if (ex) setLive(ex);
					} catch (error) { /* ignore */ }
				}
				// 模型名(异步 RPC,失败静默;token 防过期响应)
				const api = (() => {
					const conn = access("connection");
					return conn && conn.api ? conn.api : null;
				})();
				if (api && api.sessions && typeof api.sessions.models === "function") {
					const token = ++liveModelToken;
					Promise.resolve(api.sessions.models(id)).then(
						(res) => {
							if (token !== liveModelToken) return;
							const { provider, model } = pickModel(res);
							if (provider || model) setLive({ provider, model });
						},
						() => { /* 静默 */ }
					);
				}
			};

			/** 接线:跟随当前会话切换 */
			const wireLiveEngine = () => {
				const sessions = access("sessions");
				if (sessions && sessions.list && typeof sessions.list.subscribe === "function") {
					liveListUnsub = sessions.list.subscribe(() => {
						try {
							const st = sessions.list.getSnapshot();
							const id = st && st.current;
							if (id) connectSession(String(id));
						} catch (error) { /* ignore */ }
					});
					try {
						const st = sessions.list.getSnapshot();
						if (st && st.current) connectSession(String(st.current));
					} catch (error) { /* ignore */ }
				}
			};

			/** 引擎心跳:TPS 平滑 + DOM 阶段兜底 + 通知监听者 */
			const engineTick = () => {
				const now = Date.now();
				if (lastCharsTime > 0 && now > lastCharsTime) {
					const dt = (now - lastCharsTime) / 1000;
					const delta = liveState.streamChars - lastChars;
					// 粗略 tok 估算:4 字符 ≈ 1 token
					const tps = dt >= 0.2 && delta > 0 ? Math.round((delta / 4) / dt) : 0;
					if (tps !== liveState.tps) setLive({ tps });
				}
				lastChars = liveState.streamChars;
				lastCharsTime = now;
				// DOM 对 phase/running/elapsed 保持权威(与状态文案同一套判定):
				// 回合结束元素消失 → 立即回到 idle,不依赖会话 API。
				const dom = domPhaseOf();
				if (dom) {
					setLive({ phase: dom.phase, elapsed: dom.elapsed, running: true });
				} else {
					setLive({ phase: "idle", elapsed: 0, running: false });
				}
			};

			/** 轮换:所有已接管元素换一句新文案 */
			const rotate = () => {
				let count = 0;
				for (const el of adopted) {
					if (!el.isConnected) {
						adopted.delete(el);
						typists.delete(el);
						lastPicks.delete(el);
						clearLive(el);
						continue;
					}
					refresh(el);
					count++;
				}
				log("rotated, adopted =", adopted.size);
				updateTitle();
			};

			/** 语言/文案源变化后:重读分组,刷新全部已接管元素 */
			const refreshAll = () => {
				for (const el of adopted) {
					if (!el.isConnected) {
						adopted.delete(el);
						typists.delete(el);
						lastPicks.delete(el);
						clearLive(el);
						continue;
					}
					refresh(el);
				}
				updateTitle();
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
				updateTitle();
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
					// 自己 wrap 渐变 span 造成的新增要排除(防自我触发循环);
					// 但"span 被移除"(自己 unwrap 或 React 重渲染接管)必须刷新——
					// 否则 React 恢复的 Deep diving... 会闪回并丢渐变/文案。
					if (record.type === "childList" && adopted.has(record.target)) {
						const selfAdded = [...record.addedNodes].some(
							(n) => n.nodeType === 1 && n.classList && n.classList.contains(TEXT_SPAN_CLASS)
						);
						if (!selfAdded) {
							refresh(record.target);
							updateTitle();
						}
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

			/** localStorage 覆盖会压住外部 config.json;命中时给一条明确告警(每次会话只提示一次) */
			let localOverrideWarned = false;
			const warnIfLocalOverrides = () => {
				try {
					const hints = [];
					if (localStorage.getItem(CONFIG_KEY) !== null) hints.push(CONFIG_KEY);
					if (localStorage.getItem(STORAGE_KEY) !== null) hints.push(STORAGE_KEY);
					if (localStorage.getItem(STORAGE_KEY + "." + lastLocale) !== null) hints.push(STORAGE_KEY + "." + lastLocale);
					if (!localOverrideWarned && hints.length > 0) {
						localOverrideWarned = true;
						console.warn("[status-rotator] ⚠ localStorage 覆盖生效(" + hints.join(", ") + "),外部 config.json 不会生效;清除这些键可恢复。");
					}
				} catch (error) {
					/* ignore */
				}
			};

			/** 外部 JSON 加载(EXTERNAL_URL 或 localStorage URL_KEY,异步;可同时带配置和文案) */
			let externalLoading = false;
			let lastDocRaw = null;
			const loadExternal = async () => {
				if (externalLoading) return;
				externalLoading = true;
				try {
					let url = "";
					try {
						url = localStorage.getItem(URL_KEY) || "";
					} catch (error) {
						/* ignore */
					}
					if (!url) url = EXTERNAL_URL || LOCAL_CONFIG_URL;
					if (!url) return;
					const res = await fetch(url, { cache: "no-store" });
					if (!res.ok) throw new Error("HTTP " + res.status);
					const parsed = parseExternal(await res.json());
					if (!parsed) throw new Error("invalid JSON shape");
					// 自动重载不能无条件 applyConfig:否则每次轮询都会强换一句文案,
					// 打乱 intervalMs 的节奏。只有文档真正变化时才刷新。
					const docRaw = JSON.stringify(parsed);
					const docChanged = docRaw !== lastDocRaw;
					if (docChanged) {
						lastDocRaw = docRaw;
						remoteDoc = parsed;
						recomputeEffective();
						applyConfig();
					}
					log("external JSON loaded from", url, docChanged ? "(changed)" : "(unchanged)");
					warnIfLocalOverrides();
				} catch (error) {
					console.warn("[status-rotator] external JSON failed:", error);
				} finally {
					externalLoading = false;
				}
			};

			let timer = null;
			let rescanner = null;
			let reloadTimer = null;
			let titleTimer = null;
			let titleLiveTimer = null;
			let scheduleTimer = null;
			let activeIntervalMs = null;
			let activeReloadMs = null;
			let activeEngineMs = 0;
			let lastTitleRaw = null;
			let lastScheduleRaw = null;

			/** 每分钟重估调度:命中的预设变化时切换并刷新 */
			const scheduleTick = () => {
				const prev = runtimePreset;
				recomputeEffective();
				if (runtimePreset !== prev) {
					log("schedule → preset:", runtimePreset === null ? "(none)" : runtimePreset);
					applyConfig();
				}
			};

			/** 配置变化后的应用:轮换/自动重载/标题/调度定时器只在数值变化时重建,避免每次重载都打断节奏 */
			const applyConfig = () => {
				if (config.intervalMs !== activeIntervalMs) {
					activeIntervalMs = config.intervalMs;
					if (timer !== null) clearInterval(timer);
					timer = setInterval(rotate, config.intervalMs);
				}
				if (config.reloadIntervalMs !== activeReloadMs) {
					activeReloadMs = config.reloadIntervalMs;
					if (reloadTimer !== null) clearInterval(reloadTimer);
					reloadTimer = config.reloadIntervalMs > 0 ? setInterval(loadExternal, config.reloadIntervalMs) : null;
				}
				const titleRaw = JSON.stringify(config.title ?? null);
				if (titleRaw !== lastTitleRaw) {
					lastTitleRaw = titleRaw;
					if (titleTimer !== null) clearInterval(titleTimer);
					if (titleLiveTimer !== null) clearInterval(titleLiveTimer);
					titleTimer = null;
					titleLiveTimer = null;
					const t = config.title;
					if (t && t.enabled && Array.isArray(t.templates) && t.templates.length > 0) {
						const iv = Number(t.intervalMs) > 0 ? Number(t.intervalMs) : 8000;
						titleTimer = setInterval(advanceTitle, iv);
					}
					// 标题含动态占位符({elapsed} 等)时按 liveTickMs 实时刷新
					if (t && t.enabled && config.liveTickMs > 0) {
						titleLiveTimer = setInterval(updateTitle, config.liveTickMs);
					}
					updateTitle();
				}
				const doc = effectiveDoc();
				const schedRaw = JSON.stringify(doc && doc.schedule ? doc.schedule : null);
				if (schedRaw !== lastScheduleRaw) {
					lastScheduleRaw = schedRaw;
					if (scheduleTimer !== null) clearInterval(scheduleTimer);
					scheduleTimer = doc && doc.schedule && doc.schedule.length > 0
						? setInterval(scheduleTick, 60000)
						: null;
				}
				// 实时引擎:Pill 开启或存在动态占位符时运行(Pill 关闭且 liveTickMs=0 时完全停摆)
				const engineOn = !!((config.pill && config.pill.enabled) || config.liveTickMs > 0);
				const engineMs = engineOn ? Math.max(500, config.liveTickMs > 0 ? config.liveTickMs : 2000) : 0;
				if (engineMs !== activeEngineMs) {
					activeEngineMs = engineMs;
					if (liveEngineTimer !== null) clearInterval(liveEngineTimer);
					liveEngineTimer = engineMs > 0 ? setInterval(engineTick, engineMs) : null;
				}
				updateStyle();
				refreshAll();
			};

			const start = () => {
				document.documentElement.dataset.statusRotator = "active";
				origTitle = document.title;
				observer.observe(document.body, { childList: true, subtree: true });
				updateStyle();
				scan(document.body);
				rescanAll();
				// loadExternal 可能已在 visibilitychange/pageshow 里提前跑过并建好
				// 轮换定时器;applyConfig 只在数值变化时重建,不会双倍速度轮换。
				applyConfig();
				wireLiveEngine();
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

			// 页面重新可见(切回标签页 / 从 bfcache 恢复)时重读 config.json,
			// 这样改完配置文件不用重启 dsh,切回来就生效。
			const onVisibility = () => {
				if (document.visibilityState === "visible") {
					log("page visible, reloading external config");
					loadExternal();
				}
			};
			const onPageShow = (event) => {
				if (event.persisted) {
					log("page restored from bfcache, reloading external config");
					loadExternal();
				}
			};
			document.addEventListener("visibilitychange", onVisibility);
			window.addEventListener("pageshow", onPageShow);

			// ══ 设置页:词库编辑器 ══
			// 复用本插件自己的 locale 字典 + slots 注册,像内置的 General 一样
			// 在 DSH 设置面板里多出一个「状态文案」页。
			const SETTINGS_NS = "status-rotator";
			const SETTINGS_DICTS = {
				zh: {
					"nav.label": "状态文案",
					"title": "状态文案词库",
					"basic": "基本设置",
					"intervalMs": "轮换间隔(毫秒)",
					"typeSpeedMs": "打字机速度(毫秒/字,0 关)",
					"longAfterMs": "长任务阈值(毫秒)",
					"reloadIntervalMs": "自动重读间隔(毫秒,0 关)",
					"liveTickMs": "占位符刷新间隔(毫秒,0 关)",
					"pill.title": "实时状态",
					"pill": "实时状态 Pill",
					"pill.enabled": "启用实时 Pill",
					"pill.template": "显示模板(支持 {model}/{tps}/{pending} 等)",
					"pill.position": "位置",
					"pill.pos.right-bottom": "右下",
					"pill.pos.left-bottom": "左下",
					"pill.pos.right-top": "右上",
					"pill.pos.left-top": "左上",
					"gradient": "炫彩渐变",
					"gradient.enabled": "启用炫彩渐变",
					"gradient.colors": "颜色序列(逗号分隔,至少 2 个)",
					"gradient.speed": "流动速度(秒/圈)",
					"gradient.invalid": "渐变配置无效:颜色至少 2 个,速度须大于 0",
					"preset": "预设词库",
					"preset.none": "默认(基础词库)",
					"preset.set": "设为当前",
					"preset.current": "当前生效: {name}",
					"preset.hint": "预设可带独立的 config 与 phrases;选中后下方编辑区读写该预设。",
					"schedule": "时段调度",
					"schedule.add": "添加规则",
					"schedule.remove": "删除",
					"schedule.preset": "预设",
					"schedule.from": "从",
					"schedule.to": "到",
					"schedule.days": "星期",
					"schedule.invalid": "调度规则无效:请检查星期与时间",
					"schedule.hint": "命中时段自动切换预设;未命中时使用「设为当前」的预设。",
					"day.mon": "一", "day.tue": "二", "day.wed": "三", "day.thu": "四", "day.fri": "五", "day.sat": "六", "day.sun": "日",
					"language.zh": "中文",
					"language.en": "English",
					"phase.thinking": "thinking · 回合启动(无时钟)",
					"phase.running": "running · 运行中(有时钟)",
					"phase.long": "long · 长任务(超过阈值)",
					"hint": "每行一句,空行自动忽略;保存后立即生效。",
					"save": "保存词库",
					"saving": "保存中…",
					"saved": "已保存,文案即时生效",
					"reload": "重新读取",
					"loadError": "读取配置失败",
					"saveError": "保存失败",
					"invalidNumber": "数值无效:请检查基本设置",
					"overrideWarning": "⚠ localStorage 覆盖生效中,这里编辑的是本地 config.json,页面可能仍显示被覆盖的文案。",
					"count": "共 {n} 句"
				},
				en: {
					"nav.label": "Status Texts",
					"title": "Status Phrase Library",
					"basic": "Basic settings",
					"intervalMs": "Rotation interval (ms)",
					"typeSpeedMs": "Typewriter speed (ms/char, 0 = off)",
					"longAfterMs": "Long-turn threshold (ms)",
					"reloadIntervalMs": "Config reload interval (ms, 0 = off)",
					"liveTickMs": "Placeholder refresh interval (ms, 0 = off)",
					"pill.title": "Live Status",
					"pill": "Live status pill",
					"pill.enabled": "Enable live pill",
					"pill.template": "Template ({model}/{tps}/{pending} …)",
					"pill.position": "Position",
					"pill.pos.right-bottom": "Bottom right",
					"pill.pos.left-bottom": "Bottom left",
					"pill.pos.right-top": "Top right",
					"pill.pos.left-top": "Top left",
					"gradient": "Rainbow gradient",
					"gradient.enabled": "Enable rainbow gradient",
					"gradient.colors": "Colors (comma-separated, at least 2)",
					"gradient.speed": "Speed (s per cycle)",
					"gradient.invalid": "Invalid gradient: at least 2 colors, speed > 0",
					"preset": "Preset",
					"preset.none": "Default (base library)",
					"preset.set": "Set active",
					"preset.current": "Active: {name}",
					"preset.hint": "Presets may carry their own config & phrases; the editor below reads/writes the selected preset.",
					"schedule": "Time schedule",
					"schedule.add": "Add rule",
					"schedule.remove": "Remove",
					"schedule.preset": "Preset",
					"schedule.from": "From",
					"schedule.to": "To",
					"schedule.days": "Days",
					"schedule.invalid": "Invalid schedule rule — check days and times",
					"schedule.hint": "Switches the preset automatically while inside a window; otherwise the 'Set active' preset is used.",
					"day.mon": "M", "day.tue": "T", "day.wed": "W", "day.thu": "T", "day.fri": "F", "day.sat": "S", "day.sun": "S",
					"language.zh": "中文",
					"language.en": "English",
					"phase.thinking": "thinking · turn started (no clock)",
					"phase.running": "running · clock visible",
					"phase.long": "long · past threshold",
					"hint": "One phrase per line; empty lines are ignored. Saved changes apply immediately.",
					"save": "Save phrases",
					"saving": "Saving…",
					"saved": "Saved — live now",
					"reload": "Reload",
					"loadError": "Could not load config",
					"saveError": "Save failed",
					"invalidNumber": "Invalid number — check basic settings",
					"overrideWarning": "⚠ A localStorage override is active. This page edits the local config.json, so the UI may still show the overridden phrases.",
					"count": "{n} phrases"
				}
			};
			ctx.effect(() => locale.register(SETTINGS_NS, SETTINGS_DICTS), "status-rotator: settings dictionaries");
			const st = locale.bind(SETTINGS_NS);

			/** 设置页专用读写:目标固定为本插件的本地 config.json 路由 */
			const readConfigDocument = async () => {
				const res = await fetch(LOCAL_CONFIG_URL, { cache: "no-store" });
				if (!res.ok) throw new Error("HTTP " + res.status);
				return await res.json();
			};

			const writeConfigDocument = async (next) => {
				const res = await fetch(LOCAL_CONFIG_URL, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(next),
				});
				const text = await res.text();
				let payload = null;
				try {
					payload = JSON.parse(text);
				} catch (error) {
					/* ignore non-JSON response, use HTTP status below */
				}
				if (!res.ok) {
					throw new Error(payload && payload.error ? payload.error : "HTTP " + res.status);
				}
				// 保存成功后立刻把新配置应用到正在运行的轮换逻辑,
				// 不用等下一次 15 秒自动重读。
				const parsed = parseExternal(next);
				if (parsed) {
					remoteDoc = parsed;
					recomputeEffective();
					applyConfig();
				}
				return payload;
			};

			const SETTINGS_LOCALES = ["zh", "en"];
			const SETTINGS_PHASES = [PHASE_THINKING, PHASE_RUNNING, PHASE_LONG];
			const phraseLines = (list) => (Array.isArray(list) ? list.filter((s) => typeof s === "string").join("\n") : "");
			const parseLines = (text) => String(text || "").split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);

			/** 设置页样式(纯 CSS,复用 DSH 主题变量,不依赖额外包) */
			const SETTINGS_CSS =
				".dsh-sr-settings{display:flex;flex-direction:column;gap:14px;width:100%;max-width:560px;color:var(--dsw-alias-label-primary,inherit)}" +
				".dsh-sr-settings h3{margin:0;font-size:16px;font-weight:600}" +
				".dsh-sr-head{display:flex;align-items:center;justify-content:space-between;gap:12px}" +
				".dsh-sr-actions{display:flex;align-items:center;gap:8px}" +
				".dsh-sr-save,.dsh-sr-tab{cursor:pointer;font:inherit;border-radius:999px;padding:6px 14px;border:1px solid var(--dsw-alias-label-primary-dimmed,rgba(127,127,127,.45));background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,inherit)}" +
				".dsh-sr-save{background:var(--dsw-alias-label-primary,#111);color:var(--dsw-alias-label-primary-foreground,#fff)}" +
				".dsh-sr-save:disabled,.dsh-sr-tab:disabled{opacity:.55;cursor:default}" +
				".dsh-sr-tabs{display:flex;gap:8px}" +
				".dsh-sr-tab.dsh-sr-active{background:var(--dsw-alias-label-primary,#111);color:var(--dsw-alias-label-primary-foreground,#fff)}" +
				".dsh-sr-section{display:flex;flex-direction:column;gap:10px}" +
				".dsh-sr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}" +
				".dsh-sr-field{display:flex;flex-direction:column;gap:6px;min-width:0}" +
				".dsh-sr-label{font-size:12px;color:var(--dsw-alias-label-primary-dimmed,var(--dsw-alias-label-primary,inherit))}" +
				".dsh-sr-phasehead{display:flex;align-items:baseline;justify-content:space-between;gap:8px}" +
				".dsh-sr-muted{font-size:12px;color:var(--dsw-alias-label-primary-dimmed,var(--dsw-alias-label-primary,inherit))}" +
				".dsh-sr-input,.dsh-sr-textarea,.dsh-sr-select{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,inherit);border:1px solid var(--dsw-alias-label-primary-dimmed,rgba(127,127,127,.45));border-radius:10px;padding:8px 10px;font:inherit;line-height:1.5}" +
				".dsh-sr-textarea{resize:vertical;min-height:110px}" +
				".dsh-sr-chips{display:flex;gap:6px;flex-wrap:wrap}" +
				".dsh-sr-chip{cursor:pointer;font:inherit;font-size:12px;border-radius:999px;padding:3px 10px;border:1px solid var(--dsw-alias-label-primary-dimmed,rgba(127,127,127,.45));background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,inherit)}" +
				".dsh-sr-chip.dsh-sr-on{background:var(--dsw-alias-label-primary,#111);color:var(--dsw-alias-label-primary-foreground,#fff)}" +
				".dsh-sr-srow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border:1px solid var(--dsw-alias-label-primary-dimmed,rgba(127,127,127,.45));border-radius:10px;padding:8px}" +
				".dsh-sr-srow .dsh-sr-select{flex:0 1 160px}" +
				".dsh-sr-srow .dsh-sr-input{width:auto;flex:0 1 96px}" +
				".dsh-sr-status{font-size:12px}" +
				".dsh-sr-error{color:var(--dsw-alias-state-error-primary,#e5484d)}" +
				".dsh-sr-ok{color:#30a46c}" +
				".dsh-sr-warning{font-size:12px;color:var(--dsw-alias-state-warning-primary,#b7791f)}" +
				".dsh-sr-pill{position:fixed;z-index:2147483000;pointer-events:auto;font:inherit;font-size:12.5px;line-height:1.5;padding:6px 12px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(20,23,29,.92));border:1px solid var(--dsw-alias-label-primary-dimmed,rgba(127,127,127,.45));color:var(--dsw-alias-label-primary,#d8dbe0);box-shadow:0 4px 16px rgba(0,0,0,.35);backdrop-filter:blur(6px);white-space:nowrap;max-width:70vw;overflow:hidden;text-overflow:ellipsis}" +
				".dsh-sr-pill-right-bottom{right:16px;bottom:14px}" +
				".dsh-sr-pill-left-bottom{left:16px;bottom:14px}" +
				".dsh-sr-pill-right-top{right:16px;top:52px}" +
				".dsh-sr-pill-left-top{left:16px;top:52px}";
			const settingsStyleEl = document.createElement("style");
			settingsStyleEl.id = "dsh-status-rotator-settings-style";
			settingsStyleEl.textContent = SETTINGS_CSS;
			(document.head || document.documentElement).appendChild(settingsStyleEl);

			/** 取文档里某预设 */
			const presetOf = (data, id) =>
				id && data && Array.isArray(data.presets) ? data.presets.find((p) => p && p.id === id) : null;

			/** 预设显示名:字符串或 {zh,en} 对象,按当前编辑语言取 */
			const labelOf = (preset, lang) => {
				if (!preset) return "";
				const l = preset.label;
				if (typeof l === "string") return l;
				if (l && typeof l === "object") return l[lang] || l.zh || l.en || "";
				return preset.id;
			};

			/** 词库编辑组件;props.t 由 slot 系统按 locale 注入,跟随 DSH 语言 */
			const SettingsPanel = (props) => {
				const t = props.t || st;
				const [doc, setDoc] = react.useState(null);
				const [loading, setLoading] = react.useState(true);
				const [loadError, setLoadError] = react.useState("");
				const [lang, setLang] = react.useState("zh");
				/** 编辑目标:"" = 基础词库,否则预设 id */
				const [sel, setSel] = react.useState("");
				const [basic, setBasic] = react.useState({ intervalMs: "10000", typeSpeedMs: "30", longAfterMs: "60000", reloadIntervalMs: "15000", liveTickMs: "1000" });
				const [pillDraft, setPillDraft] = react.useState({
					enabled: true,
					template: "{model} · {phaseLabel} · {elapsed} · ⚡{tps} tok/s · ⏳{pending}",
					position: "right-bottom",
				});
				const [gradientDraft, setGradientDraft] = react.useState({
					enabled: true,
					colors: DEFAULT_CONFIG.gradient.colors.join(", "),
					speed: "4",
				});
				const [drafts, setDrafts] = react.useState({ zh: { thinking: "", running: "", long: "" }, en: { thinking: "", running: "", long: "" } });
				const [scheduleDrafts, setScheduleDrafts] = react.useState([]);
				const [saving, setSaving] = react.useState(false);
				const [status, setStatus] = react.useState({ kind: "idle", text: "" });
				/** sel 的 ref 版本,供 load/applyDoc 在异步回调里读取最新值 */
				const selRef = react.useRef("");
				const setSelBoth = (id) => {
					selRef.current = id;
					setSel(id);
				};

				const applyDoc = react.useCallback((data, presetId) => {
					const p = presetOf(data, presetId);
					const cfg = p && p.config && typeof p.config === "object"
						? p.config
						: (data && data.config && typeof data.config === "object" ? data.config : {});
					const phrases = p && p.phrases && typeof p.phrases === "object"
						? p.phrases
						: (data && data.phrases && typeof data.phrases === "object" ? data.phrases : {});
					setBasic({
						intervalMs: String(cfg.intervalMs ?? 10000),
						typeSpeedMs: String(cfg.typeSpeedMs ?? 30),
						longAfterMs: String(cfg.longAfterMs ?? 60000),
						reloadIntervalMs: String(cfg.reloadIntervalMs ?? 15000),
						liveTickMs: String(cfg.liveTickMs ?? 1000),
					});
					const pillRaw = cfg && typeof cfg.pill === "object" ? cfg.pill : {};
					setPillDraft({
						enabled: typeof pillRaw.enabled === "boolean" ? pillRaw.enabled : true,
						template: typeof pillRaw.template === "string" ? pillRaw.template : DEFAULT_CONFIG.pill.template,
						position: typeof pillRaw.position === "string" ? pillRaw.position : "right-bottom",
					});
					const g = cfg && typeof cfg.gradient === "object" ? cfg.gradient : {};
					setGradientDraft({
						enabled: typeof g.enabled === "boolean" ? g.enabled : true,
						colors: Array.isArray(g.colors) && g.colors.length > 0 ? g.colors.join(", ") : DEFAULT_CONFIG.gradient.colors.join(", "),
						speed: String(typeof g.speed === "number" ? g.speed : 4),
					});
					const nextDrafts = {};
					for (const loc of SETTINGS_LOCALES) {
						const src = phrases[loc];
						const groups = Array.isArray(src) ? { [PHASE_THINKING]: src } : (src && typeof src === "object" ? src : {});
						nextDrafts[loc] = {};
						for (const phase of SETTINGS_PHASES) nextDrafts[loc][phase] = phraseLines(groups[phase]);
					}
					setDrafts(nextDrafts);
				}, []);

				const load = react.useCallback(async () => {
					setLoading(true);
					setLoadError("");
					try {
						const data = await readConfigDocument();
						setDoc(data);
						const presets = Array.isArray(data && data.presets) ? data.presets : [];
						if (selRef.current && !presets.some((p) => p.id === selRef.current)) selRef.current = "";
						setSel(selRef.current);
						setScheduleDrafts(Array.isArray(data && data.schedule) ? data.schedule.map((r) => ({
							preset: typeof r.preset === "string" ? r.preset : "",
							days: Array.isArray(r.days) ? r.days.filter((d) => SCHEDULE_DAYS.includes(d)) : SCHEDULE_DAYS.slice(),
							from: typeof r.from === "string" ? r.from : "09:00",
							to: typeof r.to === "string" ? r.to : "18:00",
						})) : []);
						applyDoc(data, selRef.current);
						setStatus({ kind: "idle", text: "" });
					} catch (error) {
						setLoadError(String(error && error.message ? error.message : error));
					} finally {
						setLoading(false);
					}
				}, [applyDoc]);

				react.useEffect(() => {
					load();
				}, [load]);

				const presets = Array.isArray(doc && doc.presets) ? doc.presets : [];
				const editLang = lang === "en" ? "en" : "zh";
				const currentLabel = runtimePreset
					? (labelOf(presets.find((p) => p.id === runtimePreset), editLang) || runtimePreset)
					: t("preset.none");

				const updateRow = (idx, patch) => setScheduleDrafts((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

				const validateSchedule = (list) => {
					if (!Array.isArray(list) || list.length === 0) return true;
					for (const r of list) {
						if (!r || typeof r.preset !== "string" || r.preset.length === 0) return false;
						if (!Array.isArray(r.days) || r.days.length === 0 || !r.days.every((d) => SCHEDULE_DAYS.includes(d))) return false;
						if (!/^\d{1,2}:\d{2}$/.test(r.from) || !/^\d{1,2}:\d{2}$/.test(r.to)) return false;
					}
					return true;
				};

				const save = react.useCallback(async () => {
					const numbers = {
						intervalMs: Number(basic.intervalMs),
						typeSpeedMs: Number(basic.typeSpeedMs),
						longAfterMs: Number(basic.longAfterMs),
						reloadIntervalMs: Number(basic.reloadIntervalMs),
						liveTickMs: Number(basic.liveTickMs),
					};
					if (!Number.isFinite(numbers.intervalMs) || numbers.intervalMs <= 0 ||
						!Number.isFinite(numbers.typeSpeedMs) || numbers.typeSpeedMs < 0 ||
						!Number.isFinite(numbers.longAfterMs) || numbers.longAfterMs <= 0 ||
						!Number.isFinite(numbers.reloadIntervalMs) || numbers.reloadIntervalMs < 0 ||
						!Number.isFinite(numbers.liveTickMs) || numbers.liveTickMs < 0) {
						setStatus({ kind: "error", text: t("invalidNumber") });
						return;
					}
					if (!validateSchedule(scheduleDrafts)) {
						setStatus({ kind: "error", text: t("schedule.invalid") });
						return;
					}
					const base = doc && typeof doc === "object" ? doc : {};
					const next = JSON.parse(JSON.stringify(base));
					const writeGroups = (holder) => {
						const phrases = holder.phrases && typeof holder.phrases === "object" ? holder.phrases : {};
						for (const loc of SETTINGS_LOCALES) {
							phrases[loc] = {};
							for (const phase of SETTINGS_PHASES) phrases[loc][phase] = parseLines(drafts[loc] ? drafts[loc][phase] : "");
						}
						holder.phrases = phrases;
					};
					const target = presetOf(next, selRef.current);
					const holder = target || next;
					const gradientSpeed = Number(gradientDraft.speed);
					const gradientColors = parseColorList(gradientDraft.colors);
					if (!Number.isFinite(gradientSpeed) || gradientSpeed <= 0 || gradientColors.length < 2) {
						setStatus({ kind: "error", text: t("gradient.invalid") });
						return;
					}
					holder.config = {
						...(holder.config && typeof holder.config === "object" ? holder.config : {}),
						...numbers,
						gradient: {
							enabled: gradientDraft.enabled,
							colors: gradientColors,
							speed: gradientSpeed,
						},
						pill: {
							...(holder.config && holder.config.pill && typeof holder.config.pill === "object" ? holder.config.pill : {}),
							enabled: pillDraft.enabled,
							template: pillDraft.template,
							position: pillDraft.position,
						},
					};
					writeGroups(holder);
					next.schedule = scheduleDrafts.map((r) => ({ preset: r.preset, days: r.days.slice(), from: r.from, to: r.to }));
					setSaving(true);
					try {
						await writeConfigDocument(next);
						setDoc(next);
						setStatus({ kind: "ok", text: t("saved") });
					} catch (error) {
						setStatus({ kind: "error", text: t("saveError") + ": " + String(error && error.message ? error.message : error) });
					} finally {
						setSaving(false);
					}
				}, [basic, doc, drafts, scheduleDrafts, pillDraft, gradientDraft, t]);

				const setCurrent = react.useCallback(async () => {
					const base = doc && typeof doc === "object" ? doc : {};
					const next = JSON.parse(JSON.stringify(base));
					next.activePreset = selRef.current || null;
					setSaving(true);
					try {
						await writeConfigDocument(next);
						setDoc(next);
						setStatus({ kind: "ok", text: t("saved") });
					} catch (error) {
						setStatus({ kind: "error", text: t("saveError") + ": " + String(error && error.message ? error.message : error) });
					} finally {
						setSaving(false);
					}
				}, [doc, t]);

				const hasOverride = (() => {
					try {
						return localStorage.getItem(CONFIG_KEY) !== null ||
							localStorage.getItem(STORAGE_KEY) !== null ||
							localStorage.getItem(STORAGE_KEY + "." + lastLocale) !== null;
					} catch (error) {
						return false;
					}
				})();

				const loc = editLang;
				const d = drafts[loc] || {};
				const presetOptions = (selected, onChange) => react.createElement("select", {
					className: "dsh-sr-select",
					value: selected,
					disabled: loading || saving,
					onChange,
				},
					react.createElement("option", { value: "" }, t("preset.none")),
					presets.map((p) => react.createElement("option", { key: p.id, value: p.id }, labelOf(p, editLang) || p.id))
				);
				const basicField = (key, labelKey) => react.createElement("label", { key, className: "dsh-sr-field" },
					react.createElement("span", { className: "dsh-sr-label" }, t(labelKey)),
					react.createElement("input", {
						className: "dsh-sr-input",
						type: "number",
						value: basic[key],
						onChange: (event) => setBasic((prev) => ({ ...prev, [key]: event.target.value })),
					})
				);

				return react.createElement("div", { className: "dsh-sr-settings" },
					react.createElement("div", { className: "dsh-sr-head" },
						react.createElement("h3", null, t("title")),
						react.createElement("div", { className: "dsh-sr-actions" },
							react.createElement("button", { type: "button", className: "dsh-sr-tab", disabled: loading || saving, onClick: load }, t("reload")),
							react.createElement("button", { type: "button", className: "dsh-sr-save", disabled: loading || saving, onClick: save }, saving ? t("saving") : t("save"))
						)
					),
					hasOverride ? react.createElement("div", { className: "dsh-sr-warning" }, t("overrideWarning")) : null,
					loadError ? react.createElement("div", { className: "dsh-sr-error" }, t("loadError") + ": " + loadError) : null,
					status.text ? react.createElement("div", { className: "dsh-sr-status " + (status.kind === "ok" ? "dsh-sr-ok" : "dsh-sr-error") }, status.text) : null,
					react.createElement("div", { className: "dsh-sr-section" },
						react.createElement("div", { className: "dsh-sr-phasehead" },
							react.createElement("span", { className: "dsh-sr-label" }, t("preset")),
							react.createElement("span", { className: "dsh-sr-muted" }, t("preset.current").replace("{name}", currentLabel))
						),
						react.createElement("div", { className: "dsh-sr-actions" },
							presetOptions(sel, (event) => {
								setSelBoth(event.target.value);
								applyDoc(doc, event.target.value);
							}),
							react.createElement("button", { type: "button", className: "dsh-sr-tab", disabled: loading || saving, onClick: setCurrent }, t("preset.set"))
						),
						react.createElement("div", { className: "dsh-sr-muted" }, t("preset.hint"))
					),
					react.createElement("div", { className: "dsh-sr-section" },
						react.createElement("div", { className: "dsh-sr-label" }, t("basic")),
						react.createElement("div", { className: "dsh-sr-grid" },
							basicField("intervalMs", "intervalMs"),
							basicField("typeSpeedMs", "typeSpeedMs"),
							basicField("longAfterMs", "longAfterMs"),
							basicField("reloadIntervalMs", "reloadIntervalMs"),
							basicField("liveTickMs", "liveTickMs")
						)
					),
					react.createElement("div", { className: "dsh-sr-section" },
						react.createElement("div", { className: "dsh-sr-phasehead" },
							react.createElement("span", { className: "dsh-sr-label" }, t("pill")),
							react.createElement("label", { className: "dsh-sr-muted", style: { display: "flex", alignItems: "center", gap: 6 } },
								react.createElement("input", {
									type: "checkbox",
									checked: pillDraft.enabled,
									disabled: loading || saving,
									onChange: (event) => setPillDraft((prev) => ({ ...prev, enabled: event.target.checked })),
								}),
								react.createElement("span", null, t("pill.enabled"))
							)
						),
						react.createElement("label", { className: "dsh-sr-field" },
							react.createElement("span", { className: "dsh-sr-label" }, t("pill.template")),
							react.createElement("input", {
								className: "dsh-sr-input",
								type: "text",
								value: pillDraft.template,
								spellCheck: false,
								disabled: loading || saving,
								onChange: (event) => setPillDraft((prev) => ({ ...prev, template: event.target.value })),
							})
						),
						react.createElement("label", { className: "dsh-sr-field" },
							react.createElement("span", { className: "dsh-sr-label" }, t("pill.position")),
							react.createElement("select", {
								className: "dsh-sr-select",
								value: pillDraft.position,
								disabled: loading || saving,
								onChange: (event) => setPillDraft((prev) => ({ ...prev, position: event.target.value })),
							},
								["right-bottom", "left-bottom", "right-top", "left-top"].map((pos) => react.createElement("option", { key: pos, value: pos }, t("pill.pos." + pos)))
							)
						)
					),
					react.createElement("div", { className: "dsh-sr-section" },
						react.createElement("div", { className: "dsh-sr-phasehead" },
							react.createElement("span", { className: "dsh-sr-label" }, t("gradient")),
							react.createElement("label", { className: "dsh-sr-muted", style: { display: "flex", alignItems: "center", gap: 6 } },
								react.createElement("input", {
									type: "checkbox",
									checked: gradientDraft.enabled,
									disabled: loading || saving,
									onChange: (event) => setGradientDraft((prev) => ({ ...prev, enabled: event.target.checked })),
								}),
								react.createElement("span", null, t("gradient.enabled"))
							)
						),
						react.createElement("div", { className: "dsh-sr-grid" },
							react.createElement("label", { className: "dsh-sr-field" },
								react.createElement("span", { className: "dsh-sr-label" }, t("gradient.colors")),
								react.createElement("input", {
									className: "dsh-sr-input",
									type: "text",
									value: gradientDraft.colors,
									spellCheck: false,
									disabled: loading || saving,
									onChange: (event) => setGradientDraft((prev) => ({ ...prev, colors: event.target.value })),
								})
							),
							react.createElement("label", { className: "dsh-sr-field" },
								react.createElement("span", { className: "dsh-sr-label" }, t("gradient.speed")),
								react.createElement("input", {
									className: "dsh-sr-input",
									type: "number",
									value: gradientDraft.speed,
									min: "0.5",
									step: "0.5",
									disabled: loading || saving,
									onChange: (event) => setGradientDraft((prev) => ({ ...prev, speed: event.target.value })),
								})
							)
						)
					),
					react.createElement("div", { className: "dsh-sr-section" },
						react.createElement("div", { className: "dsh-sr-phasehead" },
							react.createElement("span", { className: "dsh-sr-label" }, t("schedule")),
							react.createElement("button", {
								type: "button",
								className: "dsh-sr-tab",
								disabled: loading || saving,
								onClick: () => setScheduleDrafts((prev) => [...prev, { preset: presets.length > 0 ? presets[0].id : "", days: SCHEDULE_DAYS.slice(), from: "09:00", to: "18:00" }]),
							}, t("schedule.add"))
						),
						scheduleDrafts.map((row, idx) => react.createElement("div", { key: idx, className: "dsh-sr-srow" },
							presetOptions(row.preset, (event) => updateRow(idx, { preset: event.target.value })),
							react.createElement("div", { className: "dsh-sr-chips" },
								SCHEDULE_DAYS.map((day) => react.createElement("button", {
									key: day,
									type: "button",
									className: "dsh-sr-chip" + (row.days.includes(day) ? " dsh-sr-on" : ""),
									disabled: loading || saving,
									onClick: () => updateRow(idx, { days: row.days.includes(day) ? row.days.filter((x) => x !== day) : [...row.days, day] }),
								}, t("day." + day)))
							),
							react.createElement("input", { className: "dsh-sr-input", type: "time", value: row.from, disabled: loading || saving, onChange: (event) => updateRow(idx, { from: event.target.value }) }),
							react.createElement("input", { className: "dsh-sr-input", type: "time", value: row.to, disabled: loading || saving, onChange: (event) => updateRow(idx, { to: event.target.value }) }),
							react.createElement("button", {
								type: "button",
								className: "dsh-sr-tab",
								disabled: loading || saving,
								onClick: () => setScheduleDrafts((prev) => prev.filter((_, i) => i !== idx)),
							}, t("schedule.remove"))
						)),
						react.createElement("div", { className: "dsh-sr-muted" }, t("schedule.hint"))
					),
					react.createElement("div", { className: "dsh-sr-tabs" },
						SETTINGS_LOCALES.map((code) => react.createElement("button", {
							key: code,
							type: "button",
							className: "dsh-sr-tab" + (lang === code ? " dsh-sr-active" : ""),
							onClick: () => setLang(code),
						}, t("language." + code)))
					),
					SETTINGS_PHASES.map((phase) => react.createElement("div", { key: phase, className: "dsh-sr-field" },
						react.createElement("div", { className: "dsh-sr-phasehead" },
							react.createElement("span", { className: "dsh-sr-label" }, t("phase." + phase)),
							react.createElement("span", { className: "dsh-sr-muted" }, t("count").replace("{n}", String(parseLines(d[phase]).length)))
						),
						react.createElement("textarea", {
							className: "dsh-sr-textarea",
							value: d[phase] || "",
							spellCheck: false,
							onChange: (event) => setDrafts((prev) => ({ ...prev, [loc]: { ...prev[loc], [phase]: event.target.value } })),
						})
					)),
					react.createElement("div", { className: "dsh-sr-muted" }, t("hint"))
				);
			};

			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "status-rotator",
				order: 50,
				label: () => st("nav.label"),
				locale: SETTINGS_NS
			}, SettingsPanel));

			// ══ 实时状态 Pill:注册进官方 shell.overlay 座位(文档明示 status pill 属此)
			/** Pill 配置读取(防御性) */
			const pillCfg = () => ((config.pill && typeof config.pill === "object") ? config.pill : {});
			/** shell.overlay 组件:订阅实时引擎,按模板渲染 */
			const PillComponent = () => {
				const [text, setText] = react.useState("");
				react.useEffect(() => {
					const render = () => {
						const p = pillCfg();
						const tpl = typeof p.template === "string" ? p.template : "";
						try {
							setText(tpl ? interpolate(tpl, ctxFor(null)) : "");
						} catch (error) {
							// 模板或上下文异常:置空,不崩组件
							setText("");
						}
					};
					render();
					return subscribeLive(render);
				}, []);
				const p = pillCfg();
				if (!p.enabled) return null;
				const pos = ["right-bottom", "left-bottom", "right-top", "left-top"].includes(p.position)
					? p.position : "right-bottom";
				return react.createElement("div", {
					className: "dsh-sr-pill dsh-sr-pill-" + pos,
					style: { opacity: typeof p.opacity === "number" ? p.opacity : 0.92 },
				}, text);
			};

			try {
				ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: "status-rotator-pill",
					order: 90,
					label: () => st("pill.title"),
					locale: SETTINGS_NS
				}, PillComponent));
			} catch (error) {
				// 旧版 dsh 无 shell.overlay 座位:静默降级(其余功能不受影响)
				log("shell.overlay unavailable:", error);
			}

			// dsh 的 ctx.effect 会「立即执行」回调,并把回调的「返回值」当作卸载时的
			// 清理函数注册。因此清理逻辑必须包在返回的函数里,否则 apply 一结束
			// 观察器和定时器就被立刻拆掉,文本替换永远不会生效。
			ctx.effect(() => {
				return () => {
					unsubscribe();
					document.removeEventListener("visibilitychange", onVisibility);
					window.removeEventListener("pageshow", onPageShow);
					observer.disconnect();
					if (timer !== null) clearInterval(timer);
					if (rescanner !== null) clearInterval(rescanner);
					if (reloadTimer !== null) clearInterval(reloadTimer);
					if (titleTimer !== null) clearInterval(titleTimer);
					if (titleLiveTimer !== null) clearInterval(titleLiveTimer);
					if (scheduleTimer !== null) clearInterval(scheduleTimer);
					if (liveEngineTimer !== null) clearInterval(liveEngineTimer);
					if (liveSessionUnsub) { try { liveSessionUnsub(); } catch (error) { /* ignore */ } }
					if (liveListUnsub) { try { liveListUnsub(); } catch (error) { /* ignore */ } }
					for (const state of typists.values()) {
						if (state.timer !== null) clearInterval(state.timer);
					}
					for (const live of liveTimers.values()) clearInterval(live);
					if (origTitle && document.title !== origTitle) document.title = origTitle;
					if (styleEl !== null && styleEl.isConnected) styleEl.remove();
					if (settingsStyleEl !== null && settingsStyleEl.isConnected) settingsStyleEl.remove();
					adopted.clear();
					typists.clear();
					lastPicks.clear();
					liveTimers.clear();
				};
			}, "status-rotator: label rotation");
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		// 仅供 smoke test(scripts/smoke-test.cjs)引用的纯函数;运行时无副作用
		exports.__test = {
			interpolate,
			isDynamicTemplate,
			normalizeGroups,
			normalizeTable,
			normalizeConfig,
			normalizePresets,
			normalizeSchedule,
			matchSchedule,
			formatElapsed,
			parseClock,
			parseExternal,
			extractModel,
			pickModel,
			extractSnapshot,
			parseColorList,
		};
		return module.exports;
	}
});
