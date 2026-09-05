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
 *                 liveTickMs, debug, fontWeight, gradient, title, pill, danmaku },
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
			/** 加权随机:文案可写成 { text, weight } 对象,按权重比例抽取;false = 完全均匀 */
			weightedRandom: true,
			/** 诊断日志开关 */
			debug: false,
			/** 状态文字/Pill/弹幕字体粗细:100~900 数字或 CSS 关键字;inherit = 跟随界面 */
			fontWeight: "inherit",
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
				template: "{model} · {phaseLabel} · {elapsed} · ⚡{tps} tok/s",
				/** 方位:right-bottom / left-bottom / right-top / left-top */
				position: "right-bottom",
				/** 不透明度(0.5 ~ 1) */
				opacity: 0.92,
			},
			/** 弹幕:文案以视频网站弹幕形式在页面背景飘过;false 关闭;或 { enabled, ... } */
			danmaku: {
				/** 总开关 */
				enabled: true,
				/** 发射间隔(毫秒):每过多久弹一颗;偏小 = 刷屏 */
				intervalMs: 2500,
				/** 从右到左穿过屏幕的时长(毫秒);偏大 = 飘得慢 */
				speedMs: 18000,
				/** 随机字号下限(px) */
				fontSizeMin: 14,
				/** 随机字号上限(px) */
				fontSizeMax: 30,
				/** 炫彩:每颗弹幕从 colors 里随机取色;false = 全部用 color 单色 */
				rainbow: true,
				/** 炫彩色板(至少 1 个;rainbow 时生效) */
				colors: ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"],
				/** 非炫彩模式下的文字颜色 */
				color: "#ffffff",
				/** 整体不透明度(0.05 ~ 1);每颗弹幕在此基础上做 ±25% 抖动,更有层次 */
				opacity: 0.3,
				/** 同屏弹幕数量上限 */
				maxCount: 12,
				/** 层级:负数 = 界面后面(默认 -1,弹幕夹在应用背景与聊天内容之间);非负数 = 浮于界面之上 */
				zIndex: -1,
				/** 文案范围:all = 当前语言全部文案;phase = 只取当前阶段(带回退) */
				scope: "all",
				/** 垂直活动区顶部留白(px) */
				marginTop: 16,
				/** 垂直活动区底部留白(px),避开输入区 */
				marginBottom: 160,
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
		 * 归一化一条文案:字符串 → { text, weight:1 };{ text, weight } → 校验权重;
		 * 非法返回 null。weight 缺省/非法按 1 处理,上限 1000。
		 */
		function normalizeEntry(item) {
			if (typeof item === "string") {
				return item.length > 0 ? { text: item, weight: 1 } : null;
			}
			if (item !== null && typeof item === "object" && !Array.isArray(item)
				&& typeof item.text === "string" && item.text.length > 0) {
				const w = typeof item.weight === "number" ? item.weight : 1;
				return { text: item.text, weight: Number.isFinite(w) && w > 0 ? Math.min(w, 1000) : 1 };
			}
			return null;
		}

		/** 文案条目 → 文本(字符串原样返回,{text,weight} 取 text) */
		function entryText(entry) {
			if (typeof entry === "string") return entry;
			return entry !== null && typeof entry === "object" && typeof entry.text === "string" ? entry.text : "";
		}

		/** 文案条目 → 权重(字符串为 1;非法/非正数按 1,上限 1000) */
		function entryWeight(entry) {
			const w = entry !== null && typeof entry === "object" && !Array.isArray(entry)
				? (typeof entry.weight === "number" ? entry.weight : 1) : 1;
			return Number.isFinite(w) && w > 0 ? Math.min(w, 1000) : 1;
		}

		/**
		 * 加权随机选一条(不回退重复):权重>=1 的条目按比例抽取,excludeText 的权重视为 0;
		 * 全部被排除时退化为全体均匀。rand ∈ [0,1) 可注入(测试),默认 Math.random。
		 * 返回选中条目的文本(entryText),非条目对象。
		 */
		function pickWeighted(list, excludeText, rand) {
			const rnd = typeof rand === "function" ? rand : Math.random;
			if (!Array.isArray(list) || list.length === 0) return null;
			if (list.length === 1) return entryText(list[0]);
			const items = [];
			let total = 0;
			for (const e of list) {
				const w = entryText(e) === excludeText ? 0 : entryWeight(e);
				if (w > 0) {
					items.push({ e, w });
					total += w;
				}
			}
			if (items.length === 0) return entryText(list[Math.floor(rnd() * list.length)]);
			let r = rnd() * total;
			for (const x of items) {
				r -= x.w;
				if (r <= 0) return entryText(x.e);
			}
			return entryText(items[items.length - 1].e);
		}

		/** 均匀随机选一条(不回退重复):排除 excludeText 后随机;全被排除时接受任意。返回文本。 */
		function uniformPick(list, excludeText, rand) {
			const rnd = typeof rand === "function" ? rand : Math.random;
			if (!Array.isArray(list) || list.length === 0) return null;
			if (list.length === 1) return entryText(list[0]);
			const pool = excludeText ? list.filter((e) => entryText(e) !== excludeText) : list;
			const cand = pool.length > 0 ? pool : list;
			return entryText(cand[Math.floor(rnd() * cand.length)]);
		}

		/**
		 * 把任意形态的文案列表归一化为阶段分组:
		 * 旧格式(字符串数组)视为 thinking 组;分组对象缺组补空数组。
		 * 条目支持字符串或 { text, weight } 加权对象(weight 1 的归一化回字符串,
		 * 纯文本词库保持原样,零破坏)。返回 null 表示非法。
		 */
		function normalizeGroups(list) {
			if (Array.isArray(list)) {
				const arr = list
					.map((s) => normalizeEntry(s))
					.filter((v) => v !== null)
					.map((v) => (v.weight === 1 ? v.text : v));
				return arr.length > 0 ? { thinking: arr, running: [], long: [] } : null;
			}
			if (list !== null && typeof list === "object") {
				const out = { thinking: [], running: [], long: [] };
				for (const phase of [PHASE_THINKING, PHASE_RUNNING, PHASE_LONG]) {
					const arr = Array.isArray(list[phase])
						? list[phase]
							.map((s) => normalizeEntry(s))
							.filter((v) => v !== null)
							.map((v) => (v.weight === 1 ? v.text : v))
						: [];
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
		 * 弹幕文案池:scope=all → 当前语言全部非空组去重合并;scope=phase →
		 * 取指定阶段(按 phase → running → thinking → 任意非空组顺序回退)。
		 * 返回数组,空池返回 []。
		 */
		function danmakuPool(groups, phase, scope) {
			if (!groups) return [];
			const keys = Object.keys(groups).filter((k) => Array.isArray(groups[k]) && groups[k].length > 0);
			if (keys.length === 0) return [];
			if (scope === "phase") {
				const ordered = [phase, PHASE_RUNNING, PHASE_THINKING];
				for (const k of keys) if (!ordered.includes(k)) ordered.push(k);
				for (const k of ordered) {
					if (groups[k] && groups[k].length > 0) return groups[k];
				}
				return [];
			}
			const seen = new Set();
			const out = [];
			for (const k of keys) {
				for (const s of groups[k]) {
					const t = entryText(s);
					if (t.length > 0 && !seen.has(t)) {
						seen.add(t);
						out.push(s);
					}
				}
			}
			return out;
		}

		/** 闭区间随机整数 */
		function randInt(min, max) {
			const lo = Math.ceil(min);
			const hi = Math.floor(max);
			if (hi <= lo) return lo;
			return lo + Math.floor(Math.random() * (hi - lo + 1));
		}

		/** 弹幕字号区间:修正 min > max,钳制到合理范围 */
		function danmakuFontSpan(min, max) {
			let lo = Number(min) || 14;
			let hi = Number(max) || 30;
			if (lo > hi) { const t = lo; lo = hi; hi = t; }
			lo = Math.max(8, Math.min(64, lo));
			hi = Math.max(lo, Math.min(96, hi));
			return { min: lo, max: hi };
		}

		/**
		 * 词库行解析(设置页):每行一条;`文本 | 权重` 形式解析为 { text, weight },
		 * 其余(含多个 |、右侧非正数)按纯字符串保留。权重须为正数(小数亦可)。
		 */
		function parseWeightedLines(text) {
			return String(text || "")
				.split(/\r?\n/)
				.map((s) => s.trim())
				.filter((s) => s.length > 0)
				.map((line) => {
					const idx = line.lastIndexOf("|");
					if (idx > 0) {
						const suffix = line.slice(idx + 1).trim();
						const w = /^\d+(?:\.\d+)?$/.test(suffix) ? Number(suffix) : NaN;
						if (Number.isFinite(w) && w > 0) {
							const left = line.slice(0, idx).trim();
							if (left.length > 0) return { text: left, weight: Math.min(w, 1000) };
						}
					}
					return line;
				});
		}

		/** 词库行渲染(设置页):条目回写为每行一条;weight>1 追加 ` | 权重` */
		function phraseLines(list) {
			if (!Array.isArray(list)) return "";
			return list
				.map((e) => {
					if (typeof e === "string") return e;
					if (e !== null && typeof e === "object" && typeof e.text === "string") {
						const w = entryWeight(e);
						return w === 1 ? e.text : e.text + " | " + w;
					}
					return null;
				})
				.filter((s) => s !== null)
				.join("\n");
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
			if (typeof raw.weightedRandom === "boolean") out.weightedRandom = raw.weightedRandom;
			if (typeof raw.debug === "boolean") out.debug = raw.debug;
			if (raw.fontWeight !== undefined) {
				const w = raw.fontWeight;
				if (typeof w === "number" && Number.isFinite(w) && w >= 1 && w <= 1000) out.fontWeight = w;
				else if (typeof w === "string") {
					if (/^(inherit|normal|bold|bolder|lighter|initial|unset)$/.test(w)) out.fontWeight = w;
					else if (/^\d{1,4}$/.test(w)) {
						const n = Number(w);
						if (n >= 1 && n <= 1000) out.fontWeight = w;
					}
				}
			}
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
			if (raw.danmaku !== undefined) {
				const d = raw.danmaku;
				if (d === true || d === false) out.danmaku = { enabled: d };
				else if (d !== null && typeof d === "object" && !Array.isArray(d)) {
					const dd = {};
					if (typeof d.enabled === "boolean") dd.enabled = d.enabled;
					if (typeof d.intervalMs === "number" && d.intervalMs > 0) dd.intervalMs = d.intervalMs;
					if (typeof d.speedMs === "number" && d.speedMs > 0) dd.speedMs = d.speedMs;
					if (typeof d.fontSizeMin === "number" && d.fontSizeMin > 0) dd.fontSizeMin = d.fontSizeMin;
					if (typeof d.fontSizeMax === "number" && d.fontSizeMax > 0) dd.fontSizeMax = d.fontSizeMax;
					if (typeof d.rainbow === "boolean") dd.rainbow = d.rainbow;
					if (Array.isArray(d.colors) && d.colors.length >= 1 && d.colors.every((c) => typeof c === "string" && c.length > 0)) dd.colors = d.colors;
					if (typeof d.color === "string" && d.color.length > 0) dd.color = d.color;
					if (typeof d.opacity === "number" && d.opacity > 0 && d.opacity <= 1) dd.opacity = d.opacity;
					if (typeof d.maxCount === "number" && d.maxCount >= 1 && Number.isInteger(d.maxCount)) dd.maxCount = d.maxCount;
					if (typeof d.zIndex === "number" && Number.isInteger(d.zIndex)) dd.zIndex = d.zIndex;
					if (d.scope === "all" || d.scope === "phase") dd.scope = d.scope;
					if (typeof d.marginTop === "number" && d.marginTop >= 0) dd.marginTop = d.marginTop;
					if (typeof d.marginBottom === "number" && d.marginBottom >= 0) dd.marginBottom = d.marginBottom;
					if (Object.keys(dd).length > 0) out.danmaku = dd;
				}
			}
			return Object.keys(out).length > 0 ? out : null;
		}

		/** 配置片段合并到默认配置(浅合并,gradient / title / pill / danmaku 对象深合并) */
		function mergeConfig(base, over) {
			if (!over) return { ...base };
			const out = { ...base };
			for (const key of Object.keys(over)) {
				if ((key === "gradient" || key === "title" || key === "pill" || key === "danmaku") && over[key] !== null && typeof over[key] === "object") {
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

			/** 从列表里选一句:加权随机(默认,按 {text,weight} 比例)或均匀,避免与上次相同 */
			const pickFrom = (list, el) => {
				const last = lastPicks.get(el);
				const exclude = typeof last === "string" ? last : entryText(last);
				const next = config.weightedRandom === false
					? uniformPick(list, exclude, Math.random)
					: pickWeighted(list, exclude, Math.random);
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

			/** 按当前配置同步字重到元素(内联,渐变开关与否都生效);重置时移除 */
			const syncWeight = (el) => {
				const w = config.fontWeight;
				const set = w !== undefined && w !== "inherit" && w !== null && w !== "";
				try {
					if (set) el.style.fontWeight = String(w);
					else el.style.removeProperty("font-weight");
				} catch (error) { /* ignore */ }
			};

			/** 按当前阶段重新选文案并打字(文案与当前相同则跳过) */
			const refresh = (el) => {
				const list = textsForPhase(groups, phaseOf(el));
				if (!list) return;
				const next = pickFrom(list, el);
				syncGradient(el);
				syncWeight(el);
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
				// 模型名:官方模型目录服务优先(同步快照 + load()),connection RPC 兜底
				updateModel(id);
			};

			/** 模型名更新(modelDirectories 优先,connection RPC 兜底;token 防过期) */
			const updateModel = (id) => {
				const token = ++liveModelToken;
				const setFromSelection = (sel) => {
					if (token !== liveModelToken) return;
					const { provider, model } = extractModel(sel);
					if (provider || model) setLive({ provider, model });
				};
				// 1) ctx.modelDirectories:官方 per-session 模型目录(共享快照 + load)
				try {
					const dirs = access("modelDirectories");
					if (dirs && typeof dirs.directoryFor === "function") {
						const dir = dirs.directoryFor(id);
						if (dir) {
							try {
								const st = dir.store && typeof dir.store.getSnapshot === "function"
									? dir.store.getSnapshot()
									: null;
								if (st && st.current) setFromSelection(st.current);
							} catch (error) { /* ignore */ }
							if (typeof dir.load === "function") {
								Promise.resolve(dir.load()).then(
									(res) => {
										if (token !== liveModelToken) return;
										const { provider, model } = pickModel(res);
										if (provider || model) setLive({ provider, model });
									},
									() => { /* 静默 */ }
								);
							}
							return;
						}
					}
				} catch (error) { /* ignore */ }
				// 2) connection.api RPC 兜底
				try {
					const api = (() => {
						const conn = access("connection");
						return conn && conn.api ? conn.api : null;
					})();
					if (api && api.sessions && typeof api.sessions.models === "function") {
						Promise.resolve(api.sessions.models(id)).then(
							(res) => {
								if (token !== liveModelToken) return;
								const { provider, model } = pickModel(res);
								if (provider || model) setLive({ provider, model });
							},
							() => { /* 静默 */ }
						);
					}
				} catch (error) { /* ignore */ }
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

			/** 引擎心跳:TPS 平滑 + 阶段/时长(会话快照优先,DOM 兜底) + 通知监听者 */
			let turnStartTs = null;
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
				// 会话快照优先(running):阶段/时长从回合开始时刻推导,稳定可靠;
				// 快照不可用/未运行 → DOM 兜底(老版本 dsh);都没有 → idle。
				if (liveState.running) {
					if (turnStartTs === null) turnStartTs = now;
					const elapsed = Math.floor((now - turnStartTs) / 1000);
					const phase = elapsed * 1000 >= config.longAfterMs ? PHASE_LONG : PHASE_RUNNING;
					setLive({ phase, elapsed, running: true });
				} else {
					const dom = domPhaseOf();
					if (dom) {
						if (turnStartTs === null) turnStartTs = now;
						setLive({ phase: dom.phase, elapsed: dom.elapsed, running: true });
					} else {
						turnStartTs = null;
						setLive({ phase: "idle", elapsed: 0, running: false });
					}
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
				// 弹幕:配置变化时重建层与发射定时器(和其他定时器一样按快照对比,不重复打断)
				const dmRaw = JSON.stringify(config.danmaku ?? null);
				if (dmRaw !== lastDanmakuRaw) {
					lastDanmakuRaw = dmRaw;
					teardownDanmaku();
					if (danmakuEnabled()) {
						ensureDanmakuLayer();
						const iv = Number(config.danmaku.intervalMs) > 0 ? Number(config.danmaku.intervalMs) : 2500;
						danmakuTimer = setInterval(spawnDanmaku, iv);
						spawnDanmaku();
					}
				}
				updateStyle();
				refreshAll();
			};

			// ══ 弹幕引擎:文案以视频网站弹幕形式在页面(默认在界面后面)飘过 ══
			const DANMAKU_LAYER_CLASS = "dsh-status-rotator-danmaku-layer";
			const DANMAKU_ITEM_CLASS = "dsh-status-rotator-danmaku-item";
			let danmakuLayer = null;               // 弹幕层容器(懒创建)
			let danmakuParent = null;              // 当前挂载节点(应用主框架或 body)
			let danmakuFrameSavedIsolation = null; // 恢复主框架 isolation 用的原值
			let danmakuStyleEl = null;             // 弹幕基础 CSS
			let danmakuTimer = null;               // 发射定时器
			let danmakuInFlight = [];              // 活动弹幕 { el, timer, done }
			let danmakuLastText = null;            // 防连续重复
			let lastDanmakuRaw = null;             // 上次生效的 danmaku 配置 JSON 快照

			const dcfg = () => (config.danmaku && typeof config.danmaku === "object" ? config.danmaku : { enabled: false });
			const danmakuEnabled = () => !!dcfg().enabled;

			/**
			 * 应用主框架:布局根(#root 或其子树)里那个覆盖视口、position:relative、
			 * overflow:hidden 的元素(DSH 的 AppFrame)。拿不到就返回 null,
			 * 弹幕退回 body 固定层。
			 */
			const appFrameOf = () => {
				let rootEl = null;
				try { rootEl = document.getElementById("root"); } catch (error) { /* ignore */ }
				if (!rootEl) return null;
				const cand = [rootEl, ...Array.from(rootEl.children || [])];
				const vw = window.innerWidth;
				const vh = window.innerHeight;
				for (const el of cand) {
					if (!(el instanceof Element)) continue;
					let cs = null;
					try { cs = getComputedStyle(el); } catch (error) { continue; }
					if (!["relative", "absolute", "fixed"].includes(cs.position)) continue;
					if (cs.overflow !== "hidden") continue;
					if (el.offsetWidth >= vw - 8 && el.offsetHeight >= vh - 8) return el;
				}
				for (const el of cand) {
					if (!(el instanceof Element)) continue;
					let cs = null;
					try { cs = getComputedStyle(el); } catch (error) { continue; }
					if (cs.position === "relative" && (cs.display === "grid" || cs.display === "flex")
						&& el.offsetWidth >= vw - 8 && el.offsetHeight >= vh - 8) return el;
				}
				return null;
			};

			/** 注入弹幕基础样式(静态,一次创建,卸载时移除) */
			const ensureDanmakuStyle = () => {
				if (danmakuStyleEl !== null) return;
				danmakuStyleEl = document.createElement("style");
				danmakuStyleEl.id = "dsh-status-rotator-danmaku-style";
				danmakuStyleEl.textContent =
					"." + DANMAKU_LAYER_CLASS + "{" +
						"inset:0;overflow:hidden;pointer-events:none;" +
					"}" +
					"." + DANMAKU_ITEM_CLASS + "{" +
						"position:absolute;left:-200vw;top:0;white-space:nowrap;pointer-events:none;" +
						"will-change:transform;line-height:1.35;font-weight:600;user-select:none;" +
						"text-shadow:0 0 4px rgba(0,0,0,.40),0 1px 3px rgba(0,0,0,.45);" +
					"}";
				document.head.appendChild(danmakuStyleEl);
			};

			/**
			 * 创建/恢复弹幕层。zIndex < 0(默认)时挂进应用主框架:
			 * 给框架加 isolation:isolate 使其成为 stacking context,层内 z-index:-1
			 * 的弹幕就被夹在「框架背景」与「聊天内容」之间——在界面后面,可见于空隙;
			 * zIndex >= 0 时挂在 body 上浮于界面:之上,层级 = zIndex。
			 */
			const ensureDanmakuLayer = () => {
				if (!danmakuEnabled()) return;
				ensureDanmakuStyle();
				if (danmakuLayer !== null && danmakuLayer.isConnected) return;
				const d = dcfg();
				const layer = document.createElement("div");
				layer.className = DANMAKU_LAYER_CLASS;
				layer.setAttribute("aria-hidden", "true");
				const z = Number.isInteger(d.zIndex) ? d.zIndex : -1;
				if (z < 0) {
					const frame = appFrameOf();
					if (frame) {
						try {
							danmakuFrameSavedIsolation = frame.style.isolation;
							frame.style.isolation = "isolate";
						} catch (error) { /* ignore */ }
						layer.style.position = "absolute";
						layer.style.zIndex = "-1";
						frame.appendChild(layer);
						danmakuParent = frame;
					} else {
						layer.style.position = "fixed";
						layer.style.zIndex = String(z);
						document.body.appendChild(layer);
						danmakuParent = document.body;
					}
				} else {
					layer.style.position = "fixed";
					layer.style.zIndex = String(z);
					document.body.appendChild(layer);
					danmakuParent = document.body;
				}
				danmakuLayer = layer;
			};

			/** 拆除弹幕层与所有在途弹幕;恢复主框架 isolation(退出时也调用) */
			const teardownDanmaku = () => {
				if (danmakuTimer !== null) {
					clearInterval(danmakuTimer);
					danmakuTimer = null;
				}
				for (const item of danmakuInFlight) {
					if (item.timer !== null) clearTimeout(item.timer);
					if (item.el && item.el.parentNode) {
						try { item.el.remove(); } catch (error) { /* ignore */ }
					}
				}
				danmakuInFlight = [];
				danmakuLastText = null;
				if (danmakuLayer !== null) {
					const layer = danmakuLayer;
					const parent = danmakuParent;
					danmakuLayer = null;
					danmakuParent = null;
					try { layer.remove(); } catch (error) { /* ignore */ }
					if (parent && parent !== document.body && parent.style && parent.style.isolation === "isolate") {
						try { parent.style.isolation = danmakuFrameSavedIsolation || ""; } catch (error) { /* ignore */ }
					}
					danmakuFrameSavedIsolation = null;
				}
			};

			/** 当前弹幕阶段:回合中取实时引擎阶段;否则 DOM 兜底;都没有 → thinking */
			const danmakuPhase = () => {
				if (liveState.running) return liveState.phase;
				const dom = domPhaseOf();
				return dom ? dom.phase : PHASE_THINKING;
			};

			/** 发射一颗弹幕:随机文案 + 随机字号 + (炫彩)随机颜色 + 轻微透明度抖动 */
			const spawnDanmaku = () => {
				const d = dcfg();
				if (!d.enabled) return;
				if (danmakuLayer !== null && !danmakuLayer.isConnected) teardownDanmaku();
				ensureDanmakuLayer();
				if (danmakuLayer === null) return;
				if (danmakuInFlight.length >= (Number(d.maxCount) || 12)) return;
				const pool = danmakuPool(groups, danmakuPhase(), d.scope === "phase" ? "phase" : "all");
				if (pool.length === 0) return;
				const picked = pickWeighted(pool, danmakuLastText, Math.random);
				const text = entryText(picked);
				danmakuLastText = text;
				const rendered = interpolate(text, ctxFor(null));
				if (!rendered) return;
				const span = danmakuFontSpan(d.fontSizeMin, d.fontSizeMax);
				const size = randInt(span.min, span.max);
				const palette = Array.isArray(d.colors) && d.colors.length > 0 ? d.colors : DEFAULT_CONFIG.danmaku.colors;
				const color = d.rainbow !== false
					? palette[randInt(0, palette.length - 1)]
					: (typeof d.color === "string" && d.color.length > 0 ? d.color : "#ffffff");
				const baseOpacity = typeof d.opacity === "number" ? Math.min(1, Math.max(0.05, d.opacity)) : 0.3;
				const opacity = Math.min(1, Math.max(0.05, baseOpacity * (0.75 + Math.random() * 0.25)));
				const vh = window.innerHeight;
				const topPad = Number(d.marginTop) || 0;
				const bottomPad = Number(d.marginBottom) || 0;
				const usable = Math.max(64, vh - topPad - bottomPad - size * 1.6);
				const el = document.createElement("span");
				el.className = DANMAKU_ITEM_CLASS;
				el.textContent = rendered;
				el.style.top = (topPad + Math.round(Math.random() * usable)) + "px";
				el.style.fontSize = size + "px";
				el.style.color = color;
				el.style.opacity = String(opacity);
				// 字重:配置了非 inherit 则用配置值,否则保持默认 600(原硬编码)
				const fw = config.fontWeight;
				el.style.fontWeight = (fw !== undefined && fw !== "inherit") ? String(fw) : "600";
				danmakuLayer.appendChild(el);
				const width = el.offsetWidth + 16;
				const vw = window.innerWidth;
				el.style.left = vw + "px";
				el.style.transition = "none";
				el.style.transform = "translateX(0)";
				void el.offsetWidth; // 强制 reflow:先落位再启动过渡
				const duration = Math.max(1200, Math.min(60000, (Number(d.speedMs) || 18000) * (0.85 + Math.random() * 0.3)));
				const total = width + vw + 40;
				const item = { el, timer: null, done: false };
				const cleanup = () => {
					if (item.done) return;
					item.done = true;
					if (item.timer !== null) {
						clearTimeout(item.timer);
						item.timer = null;
					}
					const idx = danmakuInFlight.indexOf(item);
					if (idx >= 0) danmakuInFlight.splice(idx, 1);
					if (el.parentNode) {
						try { el.remove(); } catch (error) { /* ignore */ }
					}
				};
				el.addEventListener("transitionend", cleanup, { once: true });
				item.timer = setTimeout(cleanup, duration + 2000);
				danmakuInFlight.push(item);
				el.style.transition = "transform " + duration + "ms linear";
				el.style.transform = "translateX(" + (-total) + "px)";
				log("danmaku:", JSON.stringify(rendered.slice(0, 30)), "size", size, "color", color);
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
					"title": "状态文案",
					"intro": "调整轮换节奏与实时显示,并编辑各阶段的提示文案。",
					"library": "文案词库",
					"basic": "基本设置",
					"basicDesc": "轮换间隔、打字机速度与阶段判定等核心参数。",
					"basic.fontWeight": "字体粗细",
					"fontWeight.inherit": "跟随界面(默认)",
					"fontWeight.invalid": "字重必须是 1~1000 的数字或 inherit",
					"basic.weightedRandom": "加权随机",
					"basic.weightedRandomHint": "词库行 `文案 | 权重`(如 `正在写代码 | 3`),按权重比例抽取;关 = 完全均匀",
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
					"danmaku": "弹幕",
					"danmaku.enabled": "启用弹幕(文案飘过页面)",
					"danmaku.intervalMs": "发射间隔(毫秒)",
					"danmaku.speedMs": "穿越时长(毫秒,右→左)",
					"danmaku.fontSizeMin": "随机字号下限(px)",
					"danmaku.fontSizeMax": "随机字号上限(px)",
					"danmaku.rainbow": "炫彩模式(每颗随机取色)",
					"danmaku.colors": "炫彩色板(逗号/空格分隔,至少 1 个)",
					"danmaku.opacity": "不透明度(0.05 ~ 1)",
					"danmaku.maxCount": "同屏弹幕上限",
					"danmaku.zIndex": "层级(负数 = 界面后面,正数 = 浮于界面之上)",
					"danmaku.scope": "文案范围",
					"danmaku.scope.all": "全部文案",
					"danmaku.scope.phase": "当前阶段(带回退)",
					"danmaku.invalid": "弹幕配置无效:请检查数值(间隔/时长/字号须为正,透明度 0.05~1,同屏上限 ≥1,字号下限 ≤ 上限)",
					"danmaku.hint": "默认夹在应用背景与聊天内容之间(层级为负);若主题背景不透明看不到弹幕,把层级调成非负数。",
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
					"hint": "每行一句,空行自动忽略;可写 `文案 | 权重` 加权(如 `正在写代码 | 3`);保存后立即生效。",
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
					"title": "Status Texts",
					"intro": "Tune rotation timing and live display, then edit the phrases shown per phase.",
					"library": "Phrase library",
					"basic": "Basic settings",
					"basicDesc": "Rotation interval, typewriter speed, and phase thresholds.",
					"basic.fontWeight": "Font weight",
					"fontWeight.inherit": "Follow UI (default)",
					"basic.weightedRandom": "Weighted random",
					"basic.weightedRandomHint": "Use `text | weight` per line (e.g. `coding hard | 3`) to weight phrases; off = fully uniform",
					"fontWeight.invalid": "Weight must be 1–1000 or \\\"inherit\\\"",
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
					"danmaku": "Danmaku",
					"danmaku.enabled": "Enable danmaku (phrases float across the page)",
					"danmaku.intervalMs": "Spawn interval (ms)",
					"danmaku.speedMs": "Cross duration (ms, right→left)",
					"danmaku.fontSizeMin": "Min random font size (px)",
					"danmaku.fontSizeMax": "Max random font size (px)",
					"danmaku.rainbow": "Rainbow mode (random color per bullet)",
					"danmaku.colors": "Palette (comma/space separated, at least 1)",
					"danmaku.opacity": "Opacity (0.05 ~ 1)",
					"danmaku.maxCount": "Max concurrent bullets",
					"danmaku.zIndex": "Layer (negative = behind UI, positive = above UI)",
					"danmaku.scope": "Phrase scope",
					"danmaku.scope.all": "All phrases",
					"danmaku.scope.phase": "Current phase (with fallback)",
					"danmaku.invalid": "Invalid danmaku — check numbers (intervals/durations/font sizes must be positive, opacity 0.05–1, maxCount ≥ 1, min ≤ max size)",
					"danmaku.hint": "By default the layer sits between the app background and the chat content (negative z-index); if your theme has an opaque background and you can't see it, set the layer to a non-negative value.",
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
					"hint": "One phrase per line; empty lines are ignored. Add `text | weight` to weight a phrase (e.g. `coding hard | 3`). Saved changes apply immediately.",
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
			const parseLines = (text) => String(text || "").split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);

			/** 设置页样式(纯 CSS,与官方设置页共用同一套 DSH 主题令牌与排版)
			 *  结构参考官方 Models / Plugins / Agent Presets 设置页:
			 *  section(720 列) → 页面标题/简介 → 分组卡片,内部用官方按钮/
			 *  输入框/开关/下拉/药丸等视觉语言,全部走 --dsw-alias-* 令牌。 */
			const SETTINGS_CSS =
				/* 根列:与官方设置页一致(Models 720 / Plugins 760),颜色默认继承 */
				".dsh-sr-settings{display:flex;flex-direction:column;gap:12px;width:100%;max-width:720px;color:var(--dsw-alias-label-primary)}" +
				/* 页面标题(官方 16/500 标题)与简介(次要三级文字) */
				".dsh-sr-title{margin:0;font-size:16px;font-weight:500;line-height:24px}" +
				".dsh-sr-intro{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}" +
				/* 分组:官方 row 分隔线风格(hairline 分隔,竖向堆叠) */
				".dsh-sr-group{border-bottom:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:12px;padding:16px 0;display:flex}" +
				".dsh-sr-group:last-child{border-bottom:none;padding-bottom:4px}" +
				".dsh-sr-grouphead{display:flex;align-items:center;justify-content:space-between;gap:8px}" +
				".dsh-sr-grouphead h3{margin:0;font-size:14px;font-weight:500;line-height:22px;color:var(--dsw-alias-label-primary)}" +
				".dsh-sr-phasehead{display:flex;align-items:baseline;justify-content:space-between;gap:8px}" +
				".dsh-sr-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}" +
				".dsh-sr-muted{font-size:12px;color:var(--dsw-alias-label-tertiary)}" +
				".dsh-sr-switchline{display:flex;align-items:center;gap:8px}" +
				/* 通用按钮:36px 胶囊,primary 用官方主按钮填充 */
				".dsh-sr-btn{box-sizing:border-box;height:36px;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:18px;align-items:center;gap:4px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex;color:var(--dsw-alias-label-primary);background:transparent}" +
				".dsh-sr-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}" +
				".dsh-sr-btn:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}" +
				".dsh-sr-btn:disabled{opacity:.4;cursor:default}" +
				".dsh-sr-btn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}" +
				".dsh-sr-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}" +
				".dsh-sr-btn-danger{color:var(--dsw-alias-state-error-primary)}" +
				".dsh-sr-btn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}" +
				/* 紧凑小按钮(28px,用于行内操作) */
				".dsh-sr-btn-sm{height:28px;border-radius:14px;padding:0 10px;font-size:12px;line-height:18px}" +
				/* 双列字段网格:间隔与官方 settings 一致 */
				".dsh-sr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}" +
				".dsh-sr-grid .dsh-sr-field{min-width:0}" +
				".dsh-sr-field{display:flex;flex-direction:column;gap:6px;min-width:0}" +
				".dsh-sr-label{font-size:12px;color:var(--dsw-alias-label-secondary)}" +
				/* 表单控件:输入框 h32 r8,官方 Input 风格;select 带右箭头 */
				".dsh-sr-input,.dsh-sr-textarea,.dsh-sr-select{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px;font:inherit;font-size:14px;line-height:22px}" +
				".dsh-sr-input,.dsh-sr-select{height:32px}" +
				".dsh-sr-input:focus,.dsh-sr-textarea:focus,.dsh-sr-select:focus{border-color:var(--dsw-alias-brand-primary);outline:none}" +
				".dsh-sr-input::placeholder,.dsh-sr-textarea::placeholder{color:var(--dsw-alias-label-dimmed)}" +
				".dsh-sr-input:disabled,.dsh-sr-textarea:disabled,.dsh-sr-select:disabled{opacity:.6;cursor:default}" +
				".dsh-sr-textarea{resize:vertical;min-height:96px;padding:8px 10px;line-height:1.5}" +
				".dsh-sr-select{appearance:none;cursor:pointer;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\");background-position:right 12px center;background-repeat:no-repeat;background-size:12px 12px;padding-right:32px}" +
				/* 官方风格开关:36×20 轨道 + 16 圆点 */
				".dsh-sr-toggle{box-sizing:border-box;background:var(--dsw-alias-border-l3);cursor:pointer;border:0;border-radius:10px;flex:none;width:36px;height:20px;padding:2px;position:relative}" +
				".dsh-sr-toggle:disabled{cursor:default;opacity:.5}" +
				".dsh-sr-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}" +
				".dsh-sr-toggleOn{background:var(--dsw-alias-brand-primary)}" +
				".dsh-sr-toggleThumb{background:var(--dsw-alias-label-primary-foreground);border-radius:50%;width:16px;height:16px;transition:transform .12s;display:block}" +
				".dsh-sr-toggleOn .dsh-sr-toggleThumb{transform:translate(16px)}" +
				/* 语言切换:官方底层 tab 风格(下划线指示条) */
				".dsh-sr-tabs{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:flex-end;gap:22px;display:flex}" +
				".dsh-sr-tab{color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:none;border:0;padding:7px 1px 9px;font-size:13px;line-height:20px;position:relative}" +
				".dsh-sr-tab:hover,.dsh-sr-tab.dsh-sr-active{color:var(--dsw-alias-label-primary)}" +
				".dsh-sr-tab.dsh-sr-active:after{background:var(--dsw-alias-label-primary);content:\"\";border-radius:2px 2px 0 0;height:2px;position:absolute;bottom:-1px;left:0;right:0}" +
				/* 星期药丸:官方 Pill 组件风格(24 高,active 用 ghost-active 填充+描边) */
				".dsh-sr-chips{display:flex;gap:4px;flex-wrap:wrap}" +
				".dsh-sr-btnrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
				".dsh-sr-chip{cursor:pointer;font:inherit;border:none;border-radius:12px;height:24px;align-items:center;padding:0 8px;font-size:12px;line-height:18px;display:inline-flex;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}" +
				".dsh-sr-chip:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}" +
				".dsh-sr-chip.dsh-sr-on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-ghost-active-fill);box-shadow:inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border)}" +
				".dsh-sr-chip:disabled{cursor:default;opacity:.5}" +
				/* 时段调度行:官方 28px 紧凑控件 */
				".dsh-sr-srow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
				".dsh-sr-srow .dsh-sr-select{flex:0 1 170px}" +
				".dsh-sr-srow .dsh-sr-input{width:auto;flex:0 1 100px}" +
				/* 状态条与警示 */
				".dsh-sr-status{font-size:12px;line-height:18px}" +
				".dsh-sr-error{color:var(--dsw-alias-state-error-primary)}" +
				".dsh-sr-ok{color:var(--dsw-alias-state-success-primary)}" +
				".dsh-sr-warning{color:var(--dsw-alias-state-warn-label);font-size:12px;line-height:18px}" +
				/* 底部提示:文案输入区下方的统一样式 */
				".dsh-sr-foot{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}" +
				/* 实时状态 Pill(浮层,与设置页无关但样式同处注入) */
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
				const [basic, setBasic] = react.useState({ intervalMs: "10000", typeSpeedMs: "30", longAfterMs: "60000", reloadIntervalMs: "15000", liveTickMs: "1000", fontWeight: "inherit" });
				const [weighted, setWeighted] = react.useState(true);
				const [pillDraft, setPillDraft] = react.useState({
					enabled: true,
					template: "{model} · {phaseLabel} · {elapsed} · ⚡{tps} tok/s",
					position: "right-bottom",
				});
				const [gradientDraft, setGradientDraft] = react.useState({
					enabled: true,
					colors: DEFAULT_CONFIG.gradient.colors.join(", "),
					speed: "4",
				});
				const [danmakuDraft, setDanmakuDraft] = react.useState({
					enabled: true,
					intervalMs: "2500",
					speedMs: "18000",
					fontSizeMin: "14",
					fontSizeMax: "30",
					rainbow: true,
					colors: DEFAULT_CONFIG.danmaku.colors.join(", "),
					opacity: "0.3",
					maxCount: "12",
					zIndex: "-1",
					scope: "all",
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
						fontWeight: String(cfg.fontWeight ?? "inherit"),
					});
					setWeighted(typeof cfg.weightedRandom === "boolean" ? cfg.weightedRandom : true);
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
					const dm = cfg && typeof cfg.danmaku === "object" ? cfg.danmaku : {};
					setDanmakuDraft({
						enabled: typeof dm.enabled === "boolean" ? dm.enabled : true,
						intervalMs: String(typeof dm.intervalMs === "number" ? dm.intervalMs : 2500),
						speedMs: String(typeof dm.speedMs === "number" ? dm.speedMs : 18000),
						fontSizeMin: String(typeof dm.fontSizeMin === "number" ? dm.fontSizeMin : 14),
						fontSizeMax: String(typeof dm.fontSizeMax === "number" ? dm.fontSizeMax : 30),
						rainbow: typeof dm.rainbow === "boolean" ? dm.rainbow : true,
						colors: Array.isArray(dm.colors) && dm.colors.length > 0 ? dm.colors.join(", ") : DEFAULT_CONFIG.danmaku.colors.join(", "),
						opacity: String(typeof dm.opacity === "number" ? dm.opacity : 0.3),
						maxCount: String(typeof dm.maxCount === "number" ? dm.maxCount : 12),
						zIndex: String(typeof dm.zIndex === "number" ? dm.zIndex : -1),
						scope: dm.scope === "phase" ? "phase" : "all",
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
					// 字重:inherit 或 1~1000 的数字(字符串得数也接受)
					const weight = basic.fontWeight === "inherit" ? "inherit" : Number(basic.fontWeight);
					if (weight !== "inherit" && (!Number.isFinite(weight) || weight < 1 || weight > 1000)) {
						setStatus({ kind: "error", text: t("fontWeight.invalid") });
						return;
					}
					const base = doc && typeof doc === "object" ? doc : {};
					const next = JSON.parse(JSON.stringify(base));
					const writeGroups = (holder) => {
						const phrases = holder.phrases && typeof holder.phrases === "object" ? holder.phrases : {};
						for (const loc of SETTINGS_LOCALES) {
							phrases[loc] = {};
							for (const phase of SETTINGS_PHASES) phrases[loc][phase] = parseWeightedLines(drafts[loc] ? drafts[loc][phase] : "");
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
					const dmInterval = Number(danmakuDraft.intervalMs);
					const dmSpeed = Number(danmakuDraft.speedMs);
					const dmMin = Number(danmakuDraft.fontSizeMin);
					const dmMax = Number(danmakuDraft.fontSizeMax);
					const dmOpacity = Number(danmakuDraft.opacity);
					const dmMaxCount = Number(danmakuDraft.maxCount);
					const dmZ = Number(danmakuDraft.zIndex);
					const dmColors = parseColorList(danmakuDraft.colors);
					if (!Number.isFinite(dmInterval) || dmInterval <= 0 ||
						!Number.isFinite(dmSpeed) || dmSpeed <= 0 ||
						!Number.isFinite(dmMin) || dmMin <= 0 || !Number.isFinite(dmMax) || dmMax <= 0 || dmMin > dmMax ||
						!Number.isFinite(dmOpacity) || dmOpacity < 0.05 || dmOpacity > 1 ||
						!Number.isFinite(dmMaxCount) || dmMaxCount < 1 || !Number.isInteger(dmMaxCount) ||
						!Number.isFinite(dmZ) || !Number.isInteger(dmZ) ||
						dmColors.length < 1) {
						setStatus({ kind: "error", text: t("danmaku.invalid") });
						return;
					}
					holder.config = {
						...(holder.config && typeof holder.config === "object" ? holder.config : {}),
						...numbers,
						fontWeight: weight,
						weightedRandom: weighted,
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
						danmaku: {
							...(holder.config && holder.config.danmaku && typeof holder.config.danmaku === "object" ? holder.config.danmaku : {}),
							enabled: danmakuDraft.enabled,
							intervalMs: dmInterval,
							speedMs: dmSpeed,
							fontSizeMin: dmMin,
							fontSizeMax: dmMax,
							rainbow: danmakuDraft.rainbow,
							colors: dmColors,
							opacity: dmOpacity,
							maxCount: dmMaxCount,
							zIndex: dmZ,
							scope: danmakuDraft.scope,
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
				}, [basic, doc, drafts, scheduleDrafts, pillDraft, gradientDraft, danmakuDraft, weighted, t]);

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
				const locked = loading || saving;
				const presetOptions = (selected, onChange) => react.createElement("select", {
					className: "dsh-sr-select",
					value: selected,
					disabled: locked,
					onChange,
				},
					react.createElement("option", { value: "" }, t("preset.none")),
					presets.map((p) => react.createElement("option", { key: p.id, value: p.id }, labelOf(p, editLang) || p.id))
				);
				/** 行内按钮(extraClass 追加 dsh-sr-btn-primary/-danger/-sm 等修饰) */
				const textBtn = (label, onClick, extraClass) => react.createElement("button", {
					type: "button",
					className: "dsh-sr-btn" + (extraClass ? " " + extraClass : ""),
					disabled: locked,
					onClick,
				}, label);
				/** 官方风格开关按钮(role="switch",36×20 轨道) */
				const toggle = (checked, onChange, label) => react.createElement("button", {
					type: "button",
					role: "switch",
					"aria-checked": checked,
					"aria-label": label,
					className: "dsh-sr-toggle" + (checked ? " dsh-sr-toggleOn" : ""),
					disabled: locked,
					onClick: () => onChange(!checked),
				}, react.createElement("span", { className: "dsh-sr-toggleThumb" }));
				const basicField = (key, labelKey) => react.createElement("label", { key, className: "dsh-sr-field" },
					react.createElement("span", { className: "dsh-sr-label" }, t(labelKey)),
					react.createElement("input", {
						className: "dsh-sr-input",
						type: "number",
						value: basic[key],
						disabled: locked,
						onChange: (event) => setBasic((prev) => ({ ...prev, [key]: event.target.value })),
					})
				);
				/** 数字字段通用输入(绑定任意 {key: string} 草稿对象) */
				const numField = (state, setter, key, labelKey, min, step) => react.createElement("label", { key, className: "dsh-sr-field" },
					react.createElement("span", { className: "dsh-sr-label" }, t(labelKey)),
					react.createElement("input", {
						className: "dsh-sr-input",
						type: "number",
						value: state[key],
						min,
						step,
						disabled: locked,
						onChange: (event) => setter((prev) => ({ ...prev, [key]: event.target.value })),
					})
				);

				return react.createElement("div", { className: "dsh-sr-settings" },
					// 页面标题 + 说明(与官方设置页一致)
					react.createElement("h2", { className: "dsh-sr-title" }, t("title")),
					react.createElement("p", { className: "dsh-sr-intro" }, t("intro")),
					// 工具栏:重读 + 保存(主按钮在右,同官方 header 动作区)
					react.createElement("div", { className: "dsh-sr-grouphead" },
						react.createElement("span", { "aria-hidden": "true" }),
						react.createElement("div", { className: "dsh-sr-btnrow", style: { marginLeft: "auto" } },
							textBtn(t("reload"), load),
							textBtn(saving ? t("saving") : t("save"), save, "dsh-sr-btn-primary")
						)
					),
					hasOverride ? react.createElement("p", { className: "dsh-sr-warning", role: "status" }, t("overrideWarning")) : null,
					loadError ? react.createElement("p", { className: "dsh-sr-error", role: "alert" }, t("loadError") + ": " + loadError) : null,
					status.text ? react.createElement("p", { className: "dsh-sr-status " + (status.kind === "ok" ? "dsh-sr-ok" : "dsh-sr-error"), role: "status" }, status.text) : null,
					// 预设选择
					react.createElement("section", { className: "dsh-sr-group" },
						react.createElement("div", { className: "dsh-sr-grouphead" },
							react.createElement("h3", null, t("preset")),
							react.createElement("span", { className: "dsh-sr-muted" }, t("preset.current").replace("{name}", currentLabel))
						),
						react.createElement("div", { className: "dsh-sr-btnrow" },
							presetOptions(sel, (event) => {
								setSelBoth(event.target.value);
								applyDoc(doc, event.target.value);
							}),
							textBtn(t("preset.set"), setCurrent)
						),
						react.createElement("p", { className: "dsh-sr-hint" }, t("preset.hint"))
					),
					// 基本设置
					react.createElement("section", { className: "dsh-sr-group" },
						react.createElement("div", { className: "dsh-sr-grouphead" },
							react.createElement("h3", null, t("basic")),
							react.createElement("span", { className: "dsh-sr-muted" }, t("basicDesc"))
						),
						react.createElement("div", { className: "dsh-sr-grid" },
							basicField("intervalMs", "intervalMs"),
							basicField("typeSpeedMs", "typeSpeedMs"),
							basicField("longAfterMs", "longAfterMs"),
							basicField("reloadIntervalMs", "reloadIntervalMs"),
							basicField("liveTickMs", "liveTickMs"),
							react.createElement("label", { key: "fontWeight", className: "dsh-sr-field" },
								react.createElement("span", { className: "dsh-sr-label" }, t("basic.fontWeight")),
								react.createElement("select", {
									className: "dsh-sr-select",
									value: basic.fontWeight,
									disabled: locked,
									onChange: (event) => setBasic((prev) => ({ ...prev, fontWeight: event.target.value })),
								},
									["inherit", "100", "200", "300", "400", "500", "600", "700", "800", "900"].map((v) =>
										react.createElement("option", { key: v, value: v }, v === "inherit" ? t("fontWeight.inherit") : v)
									)
								)
							),
							react.createElement("label", { key: "weightedRandom", className: "dsh-sr-field" },
								react.createElement("span", { className: "dsh-sr-label" }, t("basic.weightedRandom")),
								react.createElement("div", { className: "dsh-sr-switchline" },
									toggle(weighted, setWeighted, t("basic.weightedRandom")),
									react.createElement("span", { className: "dsh-sr-hint" }, t("basic.weightedRandomHint"))
								)
							)
						)
					),
					// 实时状态 Pill
					react.createElement("section", { className: "dsh-sr-group" },
						react.createElement("div", { className: "dsh-sr-grouphead" },
							react.createElement("h3", null, t("pill")),
							toggle(pillDraft.enabled, (next) => setPillDraft((prev) => ({ ...prev, enabled: next })), t("pill.enabled"))
						),
						react.createElement("label", { className: "dsh-sr-field" },
							react.createElement("span", { className: "dsh-sr-label" }, t("pill.template")),
							react.createElement("input", {
								className: "dsh-sr-input",
								type: "text",
								value: pillDraft.template,
								spellCheck: false,
								disabled: locked,
								onChange: (event) => setPillDraft((prev) => ({ ...prev, template: event.target.value })),
							})
						),
						react.createElement("label", { className: "dsh-sr-field" },
							react.createElement("span", { className: "dsh-sr-label" }, t("pill.position")),
							react.createElement("select", {
								className: "dsh-sr-select",
								value: pillDraft.position,
								disabled: locked,
								onChange: (event) => setPillDraft((prev) => ({ ...prev, position: event.target.value })),
							},
								["right-bottom", "left-bottom", "right-top", "left-top"].map((pos) => react.createElement("option", { key: pos, value: pos }, t("pill.pos." + pos)))
							)
						)
					),
					// 炫彩渐变
					react.createElement("section", { className: "dsh-sr-group" },
						react.createElement("div", { className: "dsh-sr-grouphead" },
							react.createElement("h3", null, t("gradient")),
							toggle(gradientDraft.enabled, (next) => setGradientDraft((prev) => ({ ...prev, enabled: next })), t("gradient.enabled"))
						),
						react.createElement("div", { className: "dsh-sr-grid" },
							react.createElement("label", { className: "dsh-sr-field" },
								react.createElement("span", { className: "dsh-sr-label" }, t("gradient.colors")),
								react.createElement("input", {
									className: "dsh-sr-input",
									type: "text",
									value: gradientDraft.colors,
									spellCheck: false,
									disabled: locked,
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
									disabled: locked,
									onChange: (event) => setGradientDraft((prev) => ({ ...prev, speed: event.target.value })),
								})
							)
						)
					),
					// 弹幕
					react.createElement("section", { className: "dsh-sr-group" },
						react.createElement("div", { className: "dsh-sr-grouphead" },
							react.createElement("h3", null, t("danmaku")),
							toggle(danmakuDraft.enabled, (next) => setDanmakuDraft((prev) => ({ ...prev, enabled: next })), t("danmaku.enabled"))
						),
						react.createElement("div", { className: "dsh-sr-grid" },
							numField(danmakuDraft, setDanmakuDraft, "intervalMs", "danmaku.intervalMs", "100"),
							numField(danmakuDraft, setDanmakuDraft, "speedMs", "danmaku.speedMs", "1000"),
							numField(danmakuDraft, setDanmakuDraft, "fontSizeMin", "danmaku.fontSizeMin", "8"),
							numField(danmakuDraft, setDanmakuDraft, "fontSizeMax", "danmaku.fontSizeMax", "8"),
							numField(danmakuDraft, setDanmakuDraft, "opacity", "danmaku.opacity", "0.05", "0.05"),
							numField(danmakuDraft, setDanmakuDraft, "maxCount", "danmaku.maxCount", "1"),
							numField(danmakuDraft, setDanmakuDraft, "zIndex", "danmaku.zIndex")
						),
						react.createElement("div", { className: "dsh-sr-grid" },
							react.createElement("label", { className: "dsh-sr-field" },
								react.createElement("span", { className: "dsh-sr-label" }, t("danmaku.colors")),
								react.createElement("input", {
									className: "dsh-sr-input",
									type: "text",
									value: danmakuDraft.colors,
									spellCheck: false,
									disabled: locked,
									onChange: (event) => setDanmakuDraft((prev) => ({ ...prev, colors: event.target.value })),
								})
							),
							react.createElement("label", { className: "dsh-sr-field" },
								react.createElement("span", { className: "dsh-sr-label" }, t("danmaku.scope")),
								react.createElement("select", {
									className: "dsh-sr-select",
									value: danmakuDraft.scope,
									disabled: locked,
									onChange: (event) => setDanmakuDraft((prev) => ({ ...prev, scope: event.target.value })),
								},
									["all", "phase"].map((s) => react.createElement("option", { key: s, value: s }, t("danmaku.scope." + s)))
								)
							)
						),
						react.createElement("div", { className: "dsh-sr-switchline" },
							toggle(danmakuDraft.rainbow, (next) => setDanmakuDraft((prev) => ({ ...prev, rainbow: next })), t("danmaku.rainbow")),
							react.createElement("span", { className: "dsh-sr-label" }, t("danmaku.rainbow"))
						),
						react.createElement("p", { className: "dsh-sr-hint" }, t("danmaku.hint"))
					),
					// 时段调度
					react.createElement("section", { className: "dsh-sr-group" },
						react.createElement("div", { className: "dsh-sr-grouphead" },
							react.createElement("h3", null, t("schedule")),
							textBtn(t("schedule.add"), () => setScheduleDrafts((prev) => [...prev, { preset: presets.length > 0 ? presets[0].id : "", days: SCHEDULE_DAYS.slice(), from: "09:00", to: "18:00" }]))
						),
						scheduleDrafts.map((row, idx) => react.createElement("div", { key: idx, className: "dsh-sr-srow" },
							presetOptions(row.preset, (event) => updateRow(idx, { preset: event.target.value })),
							react.createElement("div", { className: "dsh-sr-chips" },
								SCHEDULE_DAYS.map((day) => react.createElement("button", {
									key: day,
									type: "button",
									className: "dsh-sr-chip" + (row.days.includes(day) ? " dsh-sr-on" : ""),
									disabled: locked,
									onClick: () => updateRow(idx, { days: row.days.includes(day) ? row.days.filter((x) => x !== day) : [...row.days, day] }),
								}, t("day." + day)))
							),
							react.createElement("input", { className: "dsh-sr-input", type: "time", value: row.from, disabled: locked, onChange: (event) => updateRow(idx, { from: event.target.value }) }),
							react.createElement("input", { className: "dsh-sr-input", type: "time", value: row.to, disabled: locked, onChange: (event) => updateRow(idx, { to: event.target.value }) }),
							textBtn(t("schedule.remove"), () => setScheduleDrafts((prev) => prev.filter((_, i) => i !== idx)), "dsh-sr-btn-danger")
						)),
						react.createElement("p", { className: "dsh-sr-hint" }, t("schedule.hint"))
					),
					// 文案词库:语言切换 + 每阶段一个 textarea
					react.createElement("section", { className: "dsh-sr-group" },
						react.createElement("div", { className: "dsh-sr-grouphead" },
							react.createElement("h3", null, t("library"))
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
							react.createElement("div", { className: "dsh-sr-grouphead" },
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
						react.createElement("p", { className: "dsh-sr-foot" }, t("hint"))
					)
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
					style: Object.assign(
						{ opacity: typeof p.opacity === "number" ? p.opacity : 0.92 },
						config.fontWeight !== undefined && config.fontWeight !== "inherit"
							? { fontWeight: String(config.fontWeight) }
							: {}
					),
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
					teardownDanmaku();
					if (styleEl !== null && styleEl.isConnected) styleEl.remove();
					if (settingsStyleEl !== null && settingsStyleEl.isConnected) settingsStyleEl.remove();
					if (danmakuStyleEl !== null && danmakuStyleEl.isConnected) danmakuStyleEl.remove();
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
			normalizeEntry,
			entryText,
			entryWeight,
			pickWeighted,
			uniformPick,
			parseWeightedLines,
			phraseLines,
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
			danmakuPool,
			randInt,
			danmakuFontSpan,
		};
		return module.exports;
	}
});
