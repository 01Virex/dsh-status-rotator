/**
 * dsh-status-rotator — browser half.
 *
 * Swaps the turn-status label in the DSH chat UI (en "Deep diving...", zh
 * "深度求索中...", resolved via the dsh "chat" locale dictionary) for phrases
 * that fit the current turn phase, typewriter-style, rotating
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
 *                 liveTickMs, debug, fontWeight, gradient, title, danmaku },
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

		// ══ 弹幕类型:滚动(原有) / 顶部 / 底部 ══
		/** 类型标识;scroll 是原有且唯一的默认值,历史配置(没有该字段)一律按它处理 */
		const DANMAKU_MODES = ["scroll", "top", "bottom"];
		/** bilibili 弹幕协议 mode 属性 → 本插件类型标识(1 = 滚动 / 4 = 底部 / 5 = 顶部) */
		const DANMAKU_MODE_ALIASES = { "1": "scroll", "4": "bottom", "5": "top" };
		
		/**
		 * 顶部 / 底部弹幕(bilibili 风格固定弹幕)的集中默认值 —— 全项目唯一出处。
		 *
		 * 观感对齐 bilibili:白字 + 四向 1px 黑描边、无背景块、水平居中、不随播放
		 * 进度变形(整条固定不动),到停留时长后消失。用户配置里的同名字段可逐项覆盖,
		 * 改这里即改默认值(一句话改掉)。
		 *
		 * ⚠️ 下列数值 [待确认]:字号 / 边距 / 堆叠间距 / 停留时长 / 同屏上限都是按
		 * bilibili 观感取的合理默认值,未查证到官方实现的确切数字,不要当成官方数值。
		 */
		const DANMAKU_FIXED_DEFAULTS = {
			/** 字号(px):与滚动弹幕共用同一套渲染管线,仅默认值不同 */
			fontSize: 25,
			/** 文字颜色:白字 */
			color: "#ffffff",
			/** 描边/阴影:四向 1px 黑描边(无背景块) */
			shadow: "1px 0 1px rgba(0,0,0,.85),-1px 0 1px rgba(0,0,0,.85),0 1px 1px rgba(0,0,0,.85),0 -1px 1px rgba(0,0,0,.85)",
			/** 顶部弹幕距播放区域上边的边距(px) */
			marginTop: 16,
			/** 底部弹幕距播放区域下边的边距(px) */
			marginBottom: 160,
			/** 多条堆叠间距(px) */
			gap: 4,
			/** 单条停留时长(ms):到点整条消失(不动画) */
			durationMs: 4500,
			/** 同类弹幕同屏最大条数 */
			maxCount: 3,
			/** 超限处理:drop = 丢弃这一拍(与现有滚动弹幕一致) */
			overflow: "drop",
			/**
			 * 层级:顶部 / 底部弹幕默认浮在聊天内容之上(这时才像 bilibili 那样压着画面)。
			 * dsh 外壳自己的层级是 overlay 层 20、侧栏拖拽手柄 11,所以取 10:压住聊天内容、
			 * 又不糊住设置弹窗;面板上的 isolation:isolate 会把这个层级关在面板内部。
			 * 负数 = 与滚动弹幕同层(塞回界面后面,和旧行为一致)。
			 */
			zIndex: 10,
			/**
			 * 滚动弹幕是否避开顶部 / 底部弹幕占用的那条竖直带。
			 * true(默认)= 各占各的高度,不会两条文案叠在一起;false = 老行为(随机落点,
			 * 滚动弹幕可能从固定弹幕后面穿过)。
			 */
			reserveBands: true,
			/**
			 * 底部弹幕是否贴住「输入区上沿」(dsh 状态行上方)而不是只用 marginBottom。
			 * 半透明弹幕压在状态行的 shimmer 上会看着像「特效映射到了弹幕上」,所以默认贴住它;
			 * 找不到状态行时自动回落到 marginBottom。
			 */
			anchorBottomToHost: true,
		};
		
		/** 类型标识合法值 → 归一化结果;未知值返回 null(调用方决定怎么兜底) */
		function danmakuModeToken(value) {
			if (typeof value === "string") {
				const s = value.trim().toLowerCase();
				if (DANMAKU_MODES.includes(s)) return s;
				if (Object.prototype.hasOwnProperty.call(DANMAKU_MODE_ALIASES, s)) return DANMAKU_MODE_ALIASES[s];
				return null;
			}
			if (typeof value === "number" && Object.prototype.hasOwnProperty.call(DANMAKU_MODE_ALIASES, String(value))) {
				return DANMAKU_MODE_ALIASES[String(value)];
			}
			return null;
		}
		
		/** 类型标识归一化:非法 / 缺省一律回落 scroll(保证历史配置行为不变) */
		function normalizeDanmakuMode(value) {
			const token = danmakuModeToken(value);
			return token === null ? "scroll" : token;
		}

		// ══ 炫彩渐变:白天 / 黑夜两套配色 ══
		/** 配色模式标识;auto = 跟随宿主深浅色主题 */
		const GRADIENT_MODES = ["auto", "day", "night"];
		/** 模式标识归一化:非法 / 缺省一律回落 auto(历史配置行为 = 跟随界面) */
		function normalizeGradientMode(value) {
			return GRADIENT_MODES.indexOf(value) >= 0 ? value : "auto";
		}
		/** 流动方向标识;rtl = 从右向左(默认,历史行为),ltr = 从左向右 */
		const GRADIENT_DIRECTIONS = ["rtl", "ltr"];
		/** 方向标识归一化:非法 / 缺省一律回落 rtl(不改变既有观感) */
		function normalizeGradientDirection(value) {
			return GRADIENT_DIRECTIONS.indexOf(value) >= 0 ? value : "rtl";
		}
		/** 流动方向 → CSS animation-direction:ltr 把同一段循环倒放(首尾仍无缝) */
		function gradientAnimationDirection(value) {
			return normalizeGradientDirection(value) === "ltr" ? "reverse" : "normal";
		}
		/** 文案 span 的类名(渐变与截断都挂在它上面);运行期多处引用,统一放在顶层 */
		const TEXT_SPAN_CLASS = "dsh-status-rotator-text";
		/**
		 * 渐变文字 CSS(纯函数,便于测试与运行期复用):rtl 默认从右往左;
		 * ltr 用 animation-direction:reverse 倒放同一段循环,让流光与从左往右的打字机同向。
		 */
		function gradientTextCss(colors, speed, direction) {
			const list = (Array.isArray(colors) ? colors : []).filter(isSafeColorToken);
			const dur = Math.max(0.5, Number(speed) || 4);
			const gradient = "linear-gradient(90deg, " + list.join(", ") + ", " + list[0] + ")";
			return "." + TEXT_SPAN_CLASS + ".dsh-status-rotator-rainbow {" +
				"background-image: " + gradient + ";" +
				"background-size: 200% 100%;" +
				"background-repeat: repeat-x;" +
				"-webkit-background-clip: text;" +
				"background-clip: text;" +
				"color: transparent;" +
				"animation: dsh-status-rotator-flow " + dur + "s linear infinite;" +
				"animation-direction: " + gradientAnimationDirection(direction) + ";" +
				"}" +
				"@keyframes dsh-status-rotator-flow { to { background-position: 200% 0; } }";
		}
		/**
		 * 按模式 + 当前是否深色主题选出生效配色:auto 跟随主题,day / night 强制。
		 * 选中的那套没配(不是数组)时回退另一套 —— 老配置只写了 colors 时行为不变;
		 * 配了但非法(< 2 个合法色)一律视为不可用,返回空数组,调用方据此不接管文字
		 * (文字是 color:transparent,配了坏色板还硬接管会直接看不见)。
		 * 纯函数,dark 由调用方注入(运行时读 body[data-ds-dark-theme],测试直接传布尔)。
		 */
		function resolveGradientColors(gradient, dark) {
			const g = gradient !== null && typeof gradient === "object" && !Array.isArray(gradient) ? gradient : {};
			const mode = normalizeGradientMode(g.mode);
			const preferDay = mode === "day" || (mode === "auto" && dark !== true);
			const chosen = preferDay ? g.dayColors : g.colors;
			const list = Array.isArray(chosen) ? chosen : (preferDay ? g.colors : g.dayColors);
			const colors = (Array.isArray(list) ? list : []).filter(isSafeColorToken);
			return colors.length >= 2 ? colors : [];
		}
		
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
			/** 状态文字/弹幕字体粗细:100~900 数字或 CSS 关键字;inherit = 跟随界面 */
			fontWeight: "inherit",
			/**
			 * 炫彩渐变文字:false 关闭;true 用默认配色;
			 * 或 { enabled, mode, colors, dayColors, speed }(dayColors 缺省 = 浅色主题沿用 colors)。
			 */
			gradient: {
				enabled: true,
				/** 配色模式:auto = 跟随界面深浅色自动切换;day / night = 强制其中一套 */
				mode: "auto",
				/** 流动方向:rtl = 从右向左(默认,历史行为);ltr = 从左向右,与打字机同向 */
				direction: "rtl",
				/** 黑夜(深色主题)渐变颜色序列(至少 2 个),循环首尾 */
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
			/**
			 * 观测通道(参考 deepseek-harness discussion #3669「重试 / 降级藏在 Deep diving… 后面」):
			 * 把宿主暴露的**结构化**运行信号显示在状态行上 —— 目前是 dsh 的
			 * `llm/retry` / `llm/retry-started` 会话事件(重试次数、provider、失败 code)。
			 * 三条原则照抄那份讨论:渲染归插件、词汇表 provider 中立(provider / code
			 * 原样透传,不枚举产品专属码)、拿不到信号就什么都不显示(绝不从日志或
			 * 界面文本里猜次数)。
			 */
			details: {
				/** 总开关:关掉后连占位符也恒为空串 */
				enabled: true,
				/**
				 * 徽标模板,显示在时钟后面:{retry} {max} {provider} {code} {delay};
				 * "" = 不显示徽标(占位符仍可用于文案 / 标题)
				 */
				badge: "⟳ {retry}/{max}",
			},
			/**
			 * 状态行文案来源:
			 *   "phrases"(默认)= 从短语库里抽一句轮换 —— 插件本来的样子;
			 *   "host" = 只用宿主原文「Deep diving…」/「深度求索中」,不轮换。
			 * 位置上仍在输入框上方(0.1.6 的位置)、样式仍照抄 0.1.6 的 .turnStatus,
			 * 所以 "host" 就是「0.1.6 的观感,但跑在 0.1.7 上」。
			 * 两种模式下,短语库为空(没 config.json / 没文案)时插件自己那条线都会
			 * 回落宿主原文,不再出现空状态行。
			 */
			labelSource: "phrases",
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
				/**
				 * 宿主弹出「全屏 backdrop-filter 遮罩」时暂停弹幕(默认 true,issue #60)。
				 * dsh 的设置弹窗就是这种层:遮罩铺满视口、只带 blur(2px)、不透明度才 24%,
				 * 弹幕层在它后面持续位移会让 Chromium 每帧重算全屏模糊 —— 设置弹窗因此持续闪烁。
				 * 开着 = 检测到这种遮罩就整体停摆(拆层 + 停在途动画),遮罩关掉立刻恢复;
				 * 设 false = 老行为(弹幕照跑,闪烁自担)。
				 */
				pauseBehindMask: true,
				/**
				 * 类型分发:滚动 / 顶部 / 底部(weight 是相对权重,越大越常出现)。
				 * 三种类型共用同一套字号范围、色板、透明度与渲染管线;
				 * enabled:false 即整个类型不再发射;权重全为 0 时回落滚动。
				 */
				types: {
					scroll: { enabled: true, weight: 2 },
					top: { enabled: true, weight: 1 },
					bottom: { enabled: true, weight: 1 },
				},
				/**
				 * 顶部 / 底部弹幕样式(集中默认值见 DANMAKU_FIXED_DEFAULTS,数值 [待确认])。
				 * 用户只写其中几项时,其余项在渲染时与默认值合并(不会丢键)。
				 */
				fixed: { ...DANMAKU_FIXED_DEFAULTS },
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
		/**
		 * dsh UI 自己记的「当前会话」选择(0.1.7 起 sessions.list 快照不再有 current,
		 * 实时引擎靠它拿会话 id;旧宿主优先用快照的 current)。
		 */
		const CURRENT_SESSION_KEY = "dsh.sessions.current";
		/** 本地自动加载地址:node half 注册的 route,serve 插件同目录 config.json */
		const LOCAL_CONFIG_URL = "/plugins/dsh-status-rotator/config.json";
		/** 仓库地址(设置页最底部的链接) */
		const REPO_URL = "https://github.com/01Virex/dsh-status-rotator";

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

		/** 状态行文案来源:phrases = 轮换短语库(默认);host = 只用宿主原文(0.1.6 观感) */
		const LABEL_SOURCES = ["phrases", "host"];
		/** 来源标识归一化:非法 / 缺省一律回落 phrases(不改变既有行为) */
		function normalizeLabelSource(value) {
			return LABEL_SOURCES.indexOf(value) >= 0 ? value : "phrases";
		}

		/**
		 * 状态行这一次该显示什么(纯函数,供 smoke test 覆盖):
		 *   "phrases" → 从短语库里抽一句轮换;
		 *   "host"    → 显示宿主原文(「Deep diving…」/「深度求索中」),不走打字机;
		 *   "keep"    → 什么都不做,保持现状。
		 *
		 * 两条回落规则:
		 *   1. `labelSource: "host"` = 用户要「纯 0.1.6 观感」:插件自己那条线(0.1.7
		 *      的 LINE_CLASS)写宿主原文;旧宿主(≤0.1.6)的 TurnStatus 本来就写着宿主
		 *      原文,插件不该去改写它 → keep。
		 *   2. 短语库为空(没 config.json / 没文案)时,插件自己那条线**回落宿主原文**
		 *      —— 这就是「状态行变成一条空行、deep diving 不见了」的修复;旧宿主同理
		 *      保持 keep(它自己那句就是原文,不碰最忠实)。
		 */
		function labelPlanFor(source, hasPhrases, ownLine) {
			if (source === "host") return ownLine ? "host" : "keep";
			if (hasPhrases) return "phrases";
			return ownLine ? "host" : "keep";
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
		 * 按类型开关与权重抽一种本次要发射的类型(纯函数,random 可注入,供 smoke test 覆盖)。
		 * - enabled === false 的类型直接不参与(三种全关 → null,这一拍不发);
		 * - 缺省 weight 按 1 处理;权重非正 / 非法则不参与;
		 * - 有类型开着但权重全非法 → 回落 scroll(弹幕不会整块消失)。
		 */
		function pickDanmakuMode(types, random) {
			const rnd = typeof random === "function" ? random : Math.random;
			const pool = [];
			let total = 0;
			let openCount = 0;
			for (const mode of DANMAKU_MODES) {
				const t = types && typeof types === "object" ? types[mode] : undefined;
				if (t && t.enabled === false) continue;
				openCount++;
				const weight = t && t.weight !== undefined ? Number(t.weight) : 1;
				if (!Number.isFinite(weight) || weight <= 0) continue;
				pool.push({ mode, weight });
				total += weight;
			}
			if (openCount === 0) return null;
			if (pool.length === 0 || total <= 0) return "scroll";
			let r = rnd() * total;
			for (const item of pool) {
				r -= item.weight;
				if (r < 0) return item.mode;
			}
			return pool[pool.length - 1].mode;
		}
		
		/**
		 * 给新弹幕分配一条空闲「车道」(纯函数,供 smoke test 覆盖)。
		 * 顶部 / 底部弹幕按车道堆叠:第 0 条贴边,第 n 条在 (高度 + 间距) × n 处。
		 * 车道号取最小的空闲值 —— 中间那条到点消失后车道会被放出来,后来的弹幕
		 * 立刻补进空位,而不是像「按在途高度累加」那样在旧位子上叠成一条。
		 * occupied = 已在屏同类弹幕占用的车道号;limit = 车道数(= 同屏上限)。
		 * 返回可用车道号;没有空位返回 -1(调用方丢弃这一拍)。
		 */
		function danmakuFreeLane(occupied, limit) {
			const count = Math.max(1, Math.round(Number(limit) || 1));
			const used = new Set();
			for (const lane of occupied || []) {
				const n = Number(lane);
				if (Number.isInteger(n) && n >= 0 && n < count) used.add(n);
			}
			for (let i = 0; i < count; i++) if (!used.has(i)) return i;
			return -1;
		}
		
		/**
		 * 滚动弹幕可用的竖直区间(纯函数,供 smoke test 覆盖)。
		 * reserve=false 或固定类型都关着时,返回旧行为的那一整段 [topPad, available-bottomPad];
		 * 否则把顶部 / 底部弹幕占用的车道带(含一道 gap)挖掉 —— 这样滚动弹幕
		 * 不会从固定弹幕后面穿过叠字。区间被挤没了就退回整段,保证弹幕不会消失。
		 * bulletHeight 是该条弹幕自己占的高度(滚动用的是 size × 1.6)。
		 */
		function danmakuScrollBand(types, fixed, reserve, topPad, bottomPad, available, bulletHeight) {
			const start = Number(topPad) || 0;
			const end = (Number(available) || 0) - (Number(bottomPad) || 0);
			const base = { start, end };
			if (reserve === false) return base;
			const f = fixed && typeof fixed === "object" ? fixed : {};
			const t = types && typeof types === "object" ? types : {};
			const laneCount = Math.max(1, Math.round(Number(f.maxCount) || 3));
			const rowH = Math.max(1, Math.round((Number(f.fontSize) || 25) * 1.35));
			const gap = Number(f.gap) >= 0 ? Number(f.gap) : 4;
			const bandH = laneCount * rowH + (laneCount - 1) * gap;
			let from = start;
			let to = end;
			if (!(t.top && t.top.enabled === false)) {
				from = Math.max(from, Math.max(0, Number(f.marginTop) || 0) + bandH + gap);
			}
			if (!(t.bottom && t.bottom.enabled === false)) {
				to = Math.min(to, (Number(available) || 0) - (Math.max(0, Number(f.marginBottom) || 0) + bandH) - gap);
			}
			if (to - from < Math.max(64, Number(bulletHeight) || 0)) return base;
			return { start: from, end: to };
		}
		
		/** 车道号 → 距对应边(顶部弹幕取上边 / 底部弹幕取下边)的偏移(px) */
		function danmakuLaneOffset(lane, height, gap) {
			const g = Number.isFinite(gap) && gap >= 0 ? gap : 0;
			const h = Math.max(1, Number(height) || 0);
			const n = Number(lane);
			return (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0) * (h + g);
		}
		
		/** 固定弹幕再堆一条是否放得下(纯函数):offset + size 须落在可用高度内 */
		function danmakuStackFits(offset, size, available) {
			if (!Number.isFinite(offset) || !Number.isFinite(size) || !Number.isFinite(available)) return false;
			return offset + size <= available;
		}

		/**
		 * 弹幕挂载方案(纯函数,供 smoke test 覆盖):
		 * - zIndex >= 0 → body 固定层,层级 = zIndex(浮于界面之上);
		 * - zIndex < 0 且拿到主框架 → 框架内 absolute + z-index:-1(界面后面,默认);
		 * - zIndex < 0 但拿不到主框架 → body 固定层 + 层级 1。
		 *   最后一条是可见兜底:旧实现退回 body 后仍写 z-index:-1,会被 body 的
		 *   不透明背景整块盖住 —— 弹幕不是「没生成」,而是「生成了却永远看不见」。
		 */
		function danmakuMountPlan(zIndex, frameFound) {
			const z = Number.isInteger(zIndex) ? zIndex : -1;
			if (z >= 0) return { mode: "fixed", z: String(z) };
			if (frameFound) return { mode: "frame", z: "-1" };
			return { mode: "fixed", z: "1" };
		}

		/**
		 * 是否需要重建弹幕层(纯函数,供 smoke test 覆盖):层不存在、已脱离文档,
		 * 或当前挂载节点/层级与期望不符 → 重建。
		 * 旧实现只判断「层是否存在」,于是首拍挂到 body 的兜底状态会一直留着,
		 * 弹幕便永远停在看不见的层级 —— 这就是 v0.15.2 修复的失效根因。
		 */
		function danmakuNeedsRemount(current, desired) {
			if (!current || current.layer === null || current.connected !== true) return true;
			if (current.parent !== desired.parent) return true;
			return current.z !== desired.z;
		}

		/**
		 * 背景色是否不透明(纯函数,供 smoke test 覆盖)。
		 * `transparent` / 空串 / `rgba(…,0)` 视为透明;`rgb(…)`、带 alpha>0 的
		 * `rgba(…)`、以及 `color(…)` 等新语法一律按不透明处理(保守:认成透明
		 * 会让弹幕层挂错位置,认成不透明最多是退回主框架)。
		 */
		function isOpaqueBackgroundColor(value) {
			const bg = String(value || "").trim().toLowerCase();
			if (bg.length === 0 || bg === "transparent" || bg === "none") return false;
			const m = bg.match(/^rgba?\(([^)]+)\)$/);
			if (m) {
				const parts = m[1].split(/[,\s/]+/).filter((s) => s.length > 0);
				if (parts.length >= 4) {
					const alpha = Number(parts[3]);
					if (Number.isFinite(alpha)) return alpha > 0;
				}
				return true;
			}
			return true;
		}

		/**
		 * 面板够不够大(纯函数,供 smoke test 覆盖):弹幕层要挂进「真正画界面
		 * 底色的那个面板」,所以只认覆盖参照框大部分面积的面板 —— 聊天消息、
		 * 代码块这类小面积不透明元素不能当挂载点(否则弹幕会被裁进气泡里)。
		 */
		function danmakuPanelFits(panelRect, boxRect) {
			if (!panelRect || !boxRect) return false;
			if (!(boxRect.width > 0) || !(boxRect.height > 0)) return false;
			return panelRect.width >= boxRect.width * 0.8 && panelRect.height >= boxRect.height * 0.5;
		}

		/**
		 * computed 样式里是否真的在模糊(纯函数,供 smoke test 覆盖)。
		 * `none` / 空串 = 没有 backdrop-filter;其余(`blur(2px)`、`blur(2px) saturate(1.2)`、
		 * 变量没解析出来的 `var(--x)` 等)一律按「有」处理 —— 认成「没有」会让弹幕
		 * 在遮罩后面继续跑(闪烁复发),认成「有」最多是多停一次弹幕。
		 */
		function hasBackdropFilter(value) {
			const bf = String(value === undefined || value === null ? "" : value).trim().toLowerCase();
			return bf.length > 0 && bf !== "none";
		}

		/**
		 * 宿主「全屏遮罩」判定(纯函数,供 smoke test 覆盖):同时满足
		 *   1. 覆盖(几乎)整个视口 —— dsh 设置弹窗的 mask 是 `position:absolute; inset:0`,
		 *      宿主 root 是 `position:fixed; inset:0; z-index:1000`;
		 *   2. 自己带 backdrop-filter —— 只有这样,它后面有东西动才会逼浏览器每帧重算全屏模糊。
		 * 小面积的 backdrop-filter 元素(菜单 / 卡片 / 提示气泡)不满足第 1 条,不会误判;
		 * 铺满视口但没有模糊的普通浮层不满足第 2 条,也不会误判(它不会引起这个闪烁)。
		 * 容差:视口 2% 或 8px 取大者 —— 宿主的 inset:0 层可能有 1px 边框 / 取整误差。
		 */
		function danmakuMaskOverlayHit(rect, viewport, backdropFilter) {
			if (!rect || !viewport) return false;
			const vw = Number(viewport.width);
			const vh = Number(viewport.height);
			if (!(vw > 0) || !(vh > 0)) return false;
			const tolX = Math.max(8, vw * 0.02);
			const tolY = Math.max(8, vh * 0.02);
			if (!(Number(rect.left) <= tolX)) return false;
			if (!(Number(rect.top) <= tolY)) return false;
			if (!(Number(rect.right) >= vw - tolX)) return false;
			if (!(Number(rect.bottom) >= vh - tolY)) return false;
			return hasBackdropFilter(backdropFilter);
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
		/** 数值钳制表(与 lib/index.js 的 CONFIG_LIMITS 保持一致) */
		const CONFIG_LIMITS = {
			intervalMs: [250, 3600000],
			typeSpeedMs: [0, 1000],
			longAfterMs: [1000, 86400000],
			reloadIntervalMs: [1000, 3600000],
			liveTickMs: [250, 60000],
		};
		/** 允许显式写 0 = 关闭的键 */
		const ZERO_DISABLES = new Set(["typeSpeedMs", "reloadIntervalMs", "liveTickMs"]);
		const DANMAKU_LIMITS = {
			intervalMs: [200, 600000],
			speedMs: [1000, 120000],
			fontSizeMin: [8, 200],
			fontSizeMax: [8, 200],
			opacity: [0.05, 1],
			maxCount: [1, 60],
			zIndex: [-1000, 10000],
		};
		/** 顶部 / 底部弹幕数值范围(与 lib/index.js 的 DANMAKU_FIXED_LIMITS 同口径) */
		/** 顶部 / 底部弹幕数值范围(与 lib/index.js 的 DANMAKU_FIXED_LIMITS 同口径) */
		const DANMAKU_FIXED_LIMITS = {
			fontSize: [8, 200],
			marginTop: [0, 2000],
			marginBottom: [0, 2000],
			gap: [0, 200],
			durationMs: [500, 60000],
			maxCount: [1, 20],
			zIndex: [-1000, 10000],
		};
		/** 类型权重范围(0 = 该类型不再被抽到,仍可用 danmaku.mode 强制) */
		const DANMAKU_TYPE_WEIGHT = [0, 100];
		/**
		 * DOM 变更后合并复查「宿主全屏遮罩」的延迟(ms)。
		 * 开设置弹窗时先等这么久再停弹幕:拖长 = 闪烁多持续一会儿,
		 * 压太短 = 宿主流式渲染期间查得太勤(每次要读几个 computed style)。
		 */
		const DANMAKU_MASK_PROBE_MS = 250;
		
		/**
		 * text-shadow 值是否可安全写进内联样式(挡注入:只允许长度 / 颜色 / 逗号 / 空格)。
		 * 与 isSafeColorToken 同一思路 —— 样式值来自用户配置,不能直接丢进 DOM。
		 */
		function isSafeShadow(value) {
			const s = String(value || "").trim();
			if (s.length === 0 || s.length > 240) return false;
			if (/[;{}<>"'`\\]/.test(s) || /url\s*\(/i.test(s)) return false;
			return /^[#0-9a-zA-Z(),.%\s/+-]+$/.test(s);
		}
		const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

		function normalizeConfig(raw) {
			if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
			const out = {};
			// 数值一律钳制(和 node 半区的 sanitizeConfig 同一张表):
			// intervalMs 直接喂给 setInterval,没有下限时 1ms 会把页面拖死。
			for (const [key, range] of Object.entries(CONFIG_LIMITS)) {
				const value = raw[key];
				if (typeof value !== "number" || !Number.isFinite(value)) continue;
				if (ZERO_DISABLES.has(key) && value === 0) { out[key] = 0; continue; }
				out[key] = clampNumber(value, range[0], range[1]);
			}
			if (typeof raw.weightedRandom === "boolean") out.weightedRandom = raw.weightedRandom;
			// 状态行文案来源:phrases(默认)/ host;非法值丢弃,保持默认
			if (raw.labelSource !== undefined) {
				const source = normalizeLabelSource(raw.labelSource);
				if (raw.labelSource === source) out.labelSource = source;
			}
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
					if (GRADIENT_MODES.indexOf(g.mode) >= 0) gg.mode = g.mode;
					if (GRADIENT_DIRECTIONS.indexOf(g.direction) >= 0) gg.direction = g.direction;
					if (Array.isArray(g.colors) && g.colors.length >= 2 && g.colors.every((c) => typeof c === "string")) gg.colors = g.colors;
					if (Array.isArray(g.dayColors) && g.dayColors.length >= 2 && g.dayColors.every((c) => typeof c === "string")) gg.dayColors = g.dayColors;
					if (typeof g.speed === "number" && g.speed > 0) gg.speed = g.speed;
					if (Object.keys(gg).length > 0) out.gradient = gg;
				}
			}
			if (raw.details !== undefined) {
				const d = raw.details;
				if (d === true || d === false) out.details = { enabled: d };
				else if (d !== null && typeof d === "object" && !Array.isArray(d)) {
					const dd = {};
					if (typeof d.enabled === "boolean") dd.enabled = d.enabled;
					if (typeof d.badge === "string" && d.badge.length <= 64) dd.badge = d.badge;
					if (Object.keys(dd).length > 0) out.details = dd;
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
			if (raw.danmaku !== undefined) {
				const d = raw.danmaku;
				if (d === true || d === false) out.danmaku = { enabled: d };
				else if (d !== null && typeof d === "object" && !Array.isArray(d)) {
					const dd = {};
					if (typeof d.enabled === "boolean") dd.enabled = d.enabled;
					if (typeof d.rainbow === "boolean") dd.rainbow = d.rainbow;
					// 宿主全屏遮罩期间暂停弹幕(默认 true,见 DEFAULT_CONFIG.danmaku.pauseBehindMask)
					if (typeof d.pauseBehindMask === "boolean") dd.pauseBehindMask = d.pauseBehindMask;
					for (const [key, range] of Object.entries(DANMAKU_LIMITS)) {
						const value = d[key];
						if (typeof value !== "number" || !Number.isFinite(value)) continue;
						const clamped = clampNumber(value, range[0], range[1]);
						dd[key] = key === "maxCount" || key === "zIndex" ? Math.round(clamped) : clamped;
					}
					if (Array.isArray(d.colors)) {
						const colors = d.colors.filter(isSafeColorToken);
						if (colors.length >= 1) dd.colors = colors;
					}
					if (typeof d.color === "string" && isSafeColorToken(d.color)) dd.color = d.color;
					if (d.scope === "all" || d.scope === "phase") dd.scope = d.scope;
					if (typeof d.marginTop === "number" && d.marginTop >= 0) dd.marginTop = d.marginTop;
					if (typeof d.marginBottom === "number" && d.marginBottom >= 0) dd.marginBottom = d.marginBottom;
					// 类型标识:danmaku.mode 显式指定整条弹幕的类型(便于只发某一种);非法值丢弃,缺省 = 按权重分发
					if (d.mode !== undefined) {
						const mode = danmakuModeToken(d.mode);
						if (mode !== null) dd.mode = mode;
					}
					// 类型分发:布尔简写(true/false)或 { enabled, weight }
					if (d.types !== undefined && d.types !== null && typeof d.types === "object" && !Array.isArray(d.types)) {
						const tt = {};
						for (const mode of DANMAKU_MODES) {
							const src = d.types[mode];
							if (src === undefined) continue;
							if (typeof src === "boolean") { tt[mode] = { enabled: src }; continue; }
							if (src === null || typeof src !== "object" || Array.isArray(src)) continue;
							const one = {};
							if (typeof src.enabled === "boolean") one.enabled = src.enabled;
							if (src.weight !== undefined) {
								const weight = Number(src.weight);
								if (Number.isFinite(weight)) one.weight = clampNumber(weight, DANMAKU_TYPE_WEIGHT[0], DANMAKU_TYPE_WEIGHT[1]);
							}
							if (Object.keys(one).length > 0) tt[mode] = one;
						}
						if (Object.keys(tt).length > 0) dd.types = tt;
					}
					// 顶部 / 底部弹幕样式:数值钳制 + 颜色 / 描边白名单
					if (d.fixed !== undefined && d.fixed !== null && typeof d.fixed === "object" && !Array.isArray(d.fixed)) {
						const ff = {};
						for (const [key, range] of Object.entries(DANMAKU_FIXED_LIMITS)) {
							const value = d.fixed[key];
							if (typeof value !== "number" || !Number.isFinite(value)) continue;
							ff[key] = Math.round(clampNumber(value, range[0], range[1]));
						}
						if (typeof d.fixed.color === "string" && isSafeColorToken(d.fixed.color)) ff.color = d.fixed.color.trim();
						if (typeof d.fixed.shadow === "string" && isSafeShadow(d.fixed.shadow)) ff.shadow = d.fixed.shadow.trim();
						if (d.fixed.overflow === "drop") ff.overflow = "drop";
						if (typeof d.fixed.reserveBands === "boolean") ff.reserveBands = d.fixed.reserveBands;
						if (typeof d.fixed.anchorBottomToHost === "boolean") ff.anchorBottomToHost = d.fixed.anchorBottomToHost;
						if (Object.keys(ff).length > 0) dd.fixed = ff;
					}
					if (Object.keys(dd).length > 0) out.danmaku = dd;
				}
			}
			return Object.keys(out).length > 0 ? out : null;
		}

		/**
		 * dsh 状态区回合初始文案的已知取值:随 UI 语言不同(en 为 "Deep diving...",
		 * zh 为 "深度求索中...")。新语言/文案变更应优先走 locale 字典实时解析,
		 * 这个集合只作字典不可用时的回退。
		 */
		const DIVE_LABEL_KEY = "chat.deepDiving";
		const KNOWN_DIVE_LABELS = ["Deep diving...", "深度求索中..."];

		/**
		 * 解析当前生效的 dsh TurnStatus 初始文案(纯函数,供测试注入)。
		 * tChat 为 dsh "chat" 命名空间的翻译函数(可空);翻译兜底会原样返回
		 * key("chat.deepDiving") 或参数模板,这两种都视为不可用,再按 locale
		 * 回退已知文案。
		 */
		function resolveDiveLabel(tChat, locale) {
			let value = "";
			try {
				value = typeof tChat === "function" ? String(tChat(DIVE_LABEL_KEY)) : "";
			} catch (error) { /* ignore */ }
			if (value.length > 0 && value !== DIVE_LABEL_KEY && !/\{/.test(value)) return value;
			return locale === "zh" ? KNOWN_DIVE_LABELS[1] : KNOWN_DIVE_LABELS[0];
		}

		/** 状态区文本是否为 dsh 回合初始文案:按当前语言标签或已知文案前缀匹配 */
		function matchesDiveText(text, label) {
			const t = String(text || "");
			return t.startsWith(label) || KNOWN_DIVE_LABELS.some((l) => t.startsWith(l));
		}

		/**
		 * dsh 0.1.7 起回合状态行不再只有初始文案:运行中把时长直接并进同一段文本
		 * (同一个 "chat" 字典命名空间里的键 message.turnProcess.deepDivingFor),
		 * en 为 "Deep diving for 12s"、zh 为 "深度求索中，用时12秒";纯 "Deep diving..."
		 * 只在这一版之前的宿主里当可见文案用。前缀从字典实时解析(把 {duration}
		 * 传空串),字典不可用时回退已知前缀。
		 */
		const DIVE_DURATION_LABEL_KEY = "message.turnProcess.deepDivingFor";
		const KNOWN_DIVE_DURATION_PREFIXES = ["Deep diving for ", "深度求索中，用时", "深度求索中,用时"];

		/**
		 * 解析「运行中 + 时长」文案的前缀(纯函数,供测试注入)。
		 * tChat 为 dsh "chat" 命名空间的翻译函数(可空);字典未注册时 bind 兜底
		 * 返回 key 本身、模板未解析时仍带 {…},这两种都视为不可用,再按 locale 回退。
		 */
		function resolveDiveDurationPrefix(tChat, locale) {
			let value = "";
			try {
				value = typeof tChat === "function" ? String(tChat(DIVE_DURATION_LABEL_KEY, { duration: "" })) : "";
			} catch (error) { /* ignore */ }
			if (value.length > 0 && value !== DIVE_DURATION_LABEL_KEY && !/\{/.test(value)) return value;
			return locale === "zh" ? KNOWN_DIVE_DURATION_PREFIXES[1] : KNOWN_DIVE_DURATION_PREFIXES[0];
		}

		/**
		 * 把宿主状态文本归类成「回合运行中」并取出其中的时长文本(纯函数):
		 *   命中 → 时长字符串(旧宿主时长在时钟子元素里,这里恒为 "")
		 *   未命中(Worked / Took 12s / Failed / 其他状态区文案)→ null
		 * 「运行中 + 时长」前缀优先用当前语言解析出的模板前缀,再按已知前缀兜底
		 * (语言切换的那一瞬间字典和 DOM 可能不同步)。
		 */
		function matchDiveLabel(text, label, durationPrefix) {
			const t = String(text || "");
			const prefixes = [durationPrefix].concat(KNOWN_DIVE_DURATION_PREFIXES)
				.filter((p) => typeof p === "string" && p.length > 0);
			for (const prefix of prefixes) {
				if (t.startsWith(prefix)) return t.slice(prefix.length).trim();
			}
			return matchesDiveText(t, label) ? "" : null;
		}

		/**
		 * 观测通道(参考 deepseek-harness discussion #3669):把一批会话事件折叠成
		 * 「当前这一步的重试状态」纯函数。只认结构化事件,不做日志/文本推断 ——
		 * 没有可认的信号就返回 null,调用方什么都不显示(显式降级,绝不猜次数)。
		 *
		 *   llm/retry         → { retry, max, provider, code, delayMs }(dsh-llm-retry 发的)
		 *   llm/retry-started → 标记这次重试已经开始跑(started = true)
		 *   step/start|end、turn/start|end、assistant/message → 清空(该步/该回合翻篇了)
		 *
		 * entries 是客户端事件窗口的条目数组(`{ type: "event", event }` / transient);
		 * previous 是上一拍的状态(用于增量折叠)。provider / code 原样透传,
		 * 但 code 先过 safeObservationToken 脱敏。
		 */
		function retryStateFromEntries(entries, previous) {
			let state = previous && typeof previous === "object" ? { ...previous } : null;
			const list = Array.isArray(entries) ? entries : [];
			for (const entry of list) {
				const event = entry && entry.type === "event" ? entry.event : null;
				if (!event || typeof event.type !== "string") continue;
				const type = event.type;
				if (type === "step/start" || type === "step/end" || type === "turn/start" || type === "turn/end" || type === "assistant/message") {
					state = null;
					continue;
				}
				if (type === "llm/retry") {
					const d = event.data && typeof event.data === "object" ? event.data : {};
					const retry = Number.isFinite(d.retry) ? d.retry : null;
					if (retry === null || retry <= 0) continue;
					const failure = d.failure && typeof d.failure === "object" ? d.failure : {};
					state = {
						retry,
						max: Number.isFinite(d.maxRetries) && d.maxRetries > 0 ? d.maxRetries : null,
						provider: typeof d.provider === "string" ? d.provider : "",
						code: safeObservationToken(failure.code),
						delayMs: Number.isFinite(d.delayMs) && d.delayMs >= 0 ? d.delayMs : null,
						retryId: typeof d.retryId === "string" ? d.retryId : "",
						started: false,
					};
					continue;
				}
				if (type === "llm/retry-started" && state !== null) {
					const d = event.data && typeof event.data === "object" ? event.data : {};
					const id = typeof d.retryId === "string" ? d.retryId : "";
					// 只认同一串重试的 started:别的重试链 / 迟到事件不乱入
					if (state.retryId && id && state.retryId !== id) continue;
					state.started = true;
				}
			}
			return state;
		}

		/**
		 * 只放行像「短错误码」的 token(字母数字 + . _ : - ,≤32 字符)。
		 * provider 的失败报文可能夹带 URL / 路径 / 凭据,这类一律不显示 ——
		 * 对应讨论里「不得暴露 endpoints / paths / credentials」那条。
		 */
		function safeObservationToken(value) {
			if (typeof value !== "string") return "";
			const v = value.trim();
			if (v.length === 0 || v.length > 32) return "";
			return /^[A-Za-z0-9_.:-]+$/.test(v) ? v : "";
		}

		/**
		 * 按模板渲染观测徽标。state 为空 / 模板为空 → ""(不占位、不显示)。
		 * {max} 缺失时会顺手把模板里留下的孤立斜杠收掉("⟳ 3/" → "⟳ 3")。
		 */
		function retryBadgeText(state, template) {
			if (!state || !Number.isFinite(state.retry)) return "";
			const tpl = typeof template === "string" ? template : "";
			if (tpl.length === 0) return "";
			const map = {
				retry: String(state.retry),
				max: Number.isFinite(state.max) ? String(state.max) : "",
				provider: typeof state.provider === "string" ? state.provider : "",
				code: typeof state.code === "string" ? state.code : "",
				delay: Number.isFinite(state.delayMs) ? String(Math.round(state.delayMs / 1000 * 10) / 10) : "",
			};
			let out = tpl.replace(/\{(\w+)\}/g, (m, key) => (key in map ? map[key] : m));
			out = out.replace(/[·|,，、/\s]+$/, "").replace(/\s{2,}/g, " ").trim();
			return out;
		}

		/** 配置片段合并到默认配置(浅合并,gradient / title / danmaku 对象深合并) */
		function mergeConfig(base, over) {
			if (!over) return { ...base };
			const out = { ...base };
			for (const key of Object.keys(over)) {
				if ((key === "gradient" || key === "title" || key === "danmaku") && over[key] !== null && typeof over[key] === "object") {
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

		/** 词库包列表归一化:[{ id, label?, phrases? }];非法/重复 id 跳过,返回 null 表示无 */
		function normalizePacks(list) {
			if (!Array.isArray(list)) return null;
			const out = [];
			const seen = new Set();
			for (const item of list) {
				if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
				if (typeof item.id !== "string" || item.id.length === 0) continue;
				if (seen.has(item.id)) continue;
				seen.add(item.id);
				const p = { id: item.id };
				if (typeof item.label === "string" && item.label.length > 0) p.label = item.label;
				else if (item.label !== null && typeof item.label === "object") {
					const lab = {};
					for (const k of ["zh", "en"]) {
						if (typeof item.label[k] === "string" && item.label[k].length > 0) lab[k] = item.label[k];
					}
					if (Object.keys(lab).length > 0) p.label = lab;
				}
				if (item.phrases !== undefined) {
					const t = normalizeTable(item.phrases);
					if (t) p.phrases = t;
				}
				out.push(p);
			}
			return out.length > 0 ? out : null;
		}

		/**
		 * 合并两套语言表(bank 与 pack 形态均为 { zh: groups, en: groups } 或 null):
		 * 同语言同阶段按文本去重,先出现者优先(保核心库权重);合法阶段组缺失即跳过。
		 * 返回合并后的语言表;全空返回 null。
		 */
		function mergeGroups(bank, pack) {
			const out = {};
			for (const lang of ["zh", "en"]) {
				const a = (bank && bank[lang]) || null;
				const b = (pack && pack[lang]) || null;
				const merged = {};
				for (const phase of [PHASE_THINKING, PHASE_RUNNING, PHASE_LONG]) {
					const la = a && Array.isArray(a[phase]) ? a[phase] : [];
					const lb = b && Array.isArray(b[phase]) ? b[phase] : [];
					if (lb.length === 0) {
						if (la.length > 0) merged[phase] = la;
						continue;
					}
					const seen = new Set(la.map(entryText).filter(Boolean));
					const items = la.slice();
					for (const e of lb) {
						const t = entryText(e);
						if (t.length > 0 && !seen.has(t)) {
							seen.add(t);
							items.push(e);
						}
					}
					if (items.length > 0) merged[phase] = items;
				}
				if (Object.keys(merged).length > 0) out[lang] = merged;
			}
			return Object.keys(out).length > 0 ? out : null;
		}

		/**
		 * 词库包链式合并:bank 为核心库(或预设词库),packs 按顺序叠加;
		 * enabledIds 为 null 表示全部启用,否则只合并名单内的包。
		 */
		function mergePackChain(bank, packs, enabledIds) {
			if (!packs || packs.length === 0) return bank;
			const enabled = Array.isArray(enabledIds) ? new Set(enabledIds) : null;
			let out = bank;
			for (const p of packs) {
				if (enabled && !enabled.has(p.id)) continue;
				if (!p.phrases) continue;
				out = mergeGroups(out, p.phrases);
			}
			return out;
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

		/**
		 * 标题写不写的纯函数决策(供测试):
		 *  - wants 是字符串 → 这一拍要写插件自己的文案:写,并标记标题「由我们持有」;
		 *  - wants 为 null 且**从没持有过** → 一个字都不写(别人的标题不归我们管);
		 *  - wants 为 null 且持有过 → 交还一次(origTitle 为空就只是放弃持有,不写)。
		 */
		function titleWritePlan(owned, wants, origTitle) {
			if (typeof wants === "string") return { owned: true, write: wants };
			if (!owned) return { owned: false, write: null };
			return { owned: false, write: typeof origTitle === "string" && origTitle.length > 0 ? origTitle : null };
		}

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

		/**
		 * 待作答交互数({pending} 的唯一来源)。
		 *
		 * 会话快照上**没有** pending 字段(dsh 0.1.5 起也不再有):待作答交互(审批面板
		 * / 提问面板)由客户端 UI 会话服务以 `SessionId → 交互` 的 map 形式发布,也就是
		 * ctx.uiSession.pendingInteractions。语义自带审批策略差异 —— 审批请求只在真的
		 * 等待点选时进入这张表:
		 *   · approval=ask   敏感动作先问,面板等待期间计数为 1;
		 *   · approval=never dsh-user-approval 在派发瀑布前就直接返回 rejected,
		 *                    客户端连面板都不会建,该项恒为 0(被拒绝不是「待作答」);
		 *   · 提问面板与策略无关,never 下依然可以计数为 1。
		 * 旧版 dsh 没有该服务 / 表里没有这个会话 → 0。
		 */
		function pendingCountOf(source, sessionId) {
			try {
				if (sessionId === null || sessionId === undefined || !source) return 0;
				const entries = typeof source.entries === "function" ? Array.from(source.entries())
					: (typeof source === "object" ? Object.entries(source) : []);
				let n = 0;
				for (const [key, value] of entries) {
					// value 为空 = 该会话没有待作答交互(发布方用 undefined/null 表示「无」)
					if (String(key) === String(sessionId) && value !== undefined && value !== null) n++;
				}
				return n;
			} catch (error) {
				return 0;
			}
		}

		/** {pending} 的字符串化:负数/NaN/非数字一律回落到 0 */
		function formatPending(value) {
			const n = Math.floor(Number(value));
			return String(Number.isFinite(n) && n > 0 ? n : 0);
		}

		/**
		 * 单个颜色值是否可用。颜色值会被拼进注入的 <style>(updateStyle),
		 * 所以这里既挡 CSS 注入(;{}url() 等),也挡非法值 —— 非法值会让整条
		 * background-image 声明失效,而文字又是 color:transparent 的。
		 */
		function isSafeColorToken(value) {
			const s = String(value || "").trim();
			if (s.length === 0 || s.length > 64) return false;
			if (/[;{}<>"'\`\\]/.test(s) || /url\s*\(/i.test(s)) return false;
			try {
				if (typeof CSS !== "undefined" && CSS && typeof CSS.supports === "function") {
					return CSS.supports("color", s);
				}
			} catch (error) { /* 回退到正则 */ }
			return /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/deg-]+\))$/i.test(s);
		}

		/**
		 * 颜色列表文本 → 原始 token(逗号/空格/换行分隔,去空)。
		 * 括号内的分隔符不切分,否则 rgb(255, 0, 0) 会被拆成三段。
		 */
		function splitColorList(text) {
			const raw = String(text || "");
			const tokens = [];
			let depth = 0;
			let current = "";
			for (const ch of raw) {
				if (ch === "(") depth++;
				else if (ch === ")") depth = Math.max(0, depth - 1);
				if (depth === 0 && /[\s,，、;；]/.test(ch)) {
					if (current.length > 0) tokens.push(current);
					current = "";
					continue;
				}
				current += ch;
			}
			if (current.length > 0) tokens.push(current);
			return tokens.map((s) => s.trim()).filter((s) => s.length > 0);
		}

		/** 颜色列表文本 → 合法颜色数组(非法项丢弃) */
		function parseColorList(text) {
			return splitColorList(text).filter(isSafeColorToken);
		}

		/** 颜色列表文本里的非法 token(设置页用来标红提示) */
		function invalidColorList(text) {
			return splitColorList(text).filter((s) => !isSafeColorToken(s));
		}

		/**
		 * 解析外部 JSON(URL 加载或 localStorage 粘贴,两种形态):
		 *   1. 完整配置: { "config": {...}, "phrases": {...}, "presets": [...], "activePreset": "...", "schedule": [...], "packs": [...], "enabledPacks": [...] }
		 *   2. 纯文案表(旧格式): { "zh": …, "en": … } 或 { "thinking": […] }
		 * 返回 { config, phrases, presets, activePreset, schedule, packs, enabledPacks },字段可为 null;整体非法返回 null。
		 */
		function parseExternal(data) {
			if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
			const out = { config: null, phrases: null, presets: null, activePreset: null, schedule: null, packs: null, enabledPacks: null };
			if (data.config !== undefined) {
				out.config = normalizeConfig(data.config);
				out.phrases = data.phrases !== undefined ? normalizeTable(data.phrases) : null;
			} else {
				out.phrases = normalizeTable(data);
			}
			if (data.presets !== undefined) out.presets = normalizePresets(data.presets);
			if (data.activePreset !== undefined) out.activePreset = typeof data.activePreset === "string" && data.activePreset.length > 0 ? data.activePreset : null;
			if (data.schedule !== undefined) out.schedule = normalizeSchedule(data.schedule);
			if (data.packs !== undefined) out.packs = normalizePacks(data.packs);
			if (data.enabledPacks !== undefined) {
				out.enabledPacks = Array.isArray(data.enabledPacks) && data.enabledPacks.every((s) => typeof s === "string" && s.length > 0)
					? data.enabledPacks.slice()
					: null;
			}
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
			/** el -> 当前原始模板(未插值);实时状态变化时按它重渲染 */
			const liveTemplates = new Map();
			/** 记下/读取/清除某元素的原始模板(元素被回收时一并清掉,避免 map 泄漏) */
			const setLiveTemplate = (el, template) => {
				if (typeof template === "string" && template.length > 0) liveTemplates.set(el, template);
				else liveTemplates.delete(el);
			};
			const liveTemplateOf = (el) => liveTemplates.get(el);
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
						packs: b.packs ?? a.packs,
						enabledPacks: b.enabledPacks ?? a.enabledPacks,
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
				const core = preset && preset.phrases ? preset.phrases : (doc && doc.phrases ? doc.phrases : null);
				// 词库包:核心库(或预设词库)之上按 enabledPacks 链式叠加,同文本去重
				externalTable = mergePackChain(core, doc && doc.packs ? doc.packs : null, doc ? doc.enabledPacks : null);
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
			 * 0.1.7 的按钮宿主上还有别的 aria-hidden 直接子元素(chevron 图标就是
			 * aria-hidden="true"),所以插件自己的时钟 span 优先。
			 */
			const clockEl = (el) => el.querySelector(":scope > ." + CLOCK_CLASS)
				|| Array.from(el.children).find((n) => n.getAttribute("aria-hidden") === "true");

			/** 0.1.7 宿主:回合折叠头 class 名带构建哈希,只能靠 data-turn-process 按钮定位 */
			const TURN_PROCESS_SELECTOR = "[data-turn-process]";
			/** 0.1.7 宿主:插件自己的时钟 span(内容 = 宿主时长文本原样搬过来) */
			const CLOCK_CLASS = "dsh-status-rotator-clock";
			/** 0.1.7 宿主:插件自己的状态行(dsh ≤0.1.6 的位置:输入框上方、对话下方) */
			const LINE_CLASS = "dsh-status-rotator-line";
			/** 观测徽标(重试 / 降级等结构化信号):挂在时钟后面,两代宿主都渲染 */
			const BADGE_CLASS = "dsh-status-rotator-badge";

			/**
			 * 旧宿主(dsh ≤ 0.1.6)的时钟阈值:回合开始 15 秒后 TurnStatus 才渲染出
			 * 时长子元素,插件据此把「回合刚起步」判成 thinking。0.1.7 起宿主每秒都
			 * 把时长写进标签文本、不再有这个信号,所以对新宿主沿用同一阈值,
			 * 让 thinking → running 的分界与旧版保持一致(时长本身照旧显示)。
			 */
			const HOST_CLOCK_APPEAR_MS = 15000;

			/** 判定元素当前阶段:时长不足 15 秒(旧宿主即「时钟还没出现」)→ thinking;否则按秒数分 running / long */
			function phaseOf(el) {
				const clock = clockEl(el);
				const sec = clock ? parseClock(clock.textContent) : 0;
				if (sec * 1000 < HOST_CLOCK_APPEAR_MS) return PHASE_THINKING;
				return sec * 1000 >= config.longAfterMs ? PHASE_LONG : PHASE_RUNNING;
			}

			/** 文案包裹 span 的 class(渐变与截断都挂在它上面) */
			/** 宿主(被接管的 status 元素)class:长文案截断 + 关掉宿主自带 shimmer */
			const HOST_CLASS = "dsh-status-rotator-host";
			const HOST_GRADIENT_CLASS = "dsh-status-rotator-host-gradient";
			/** 文本真的溢出时才加,右侧做淡出(没溢出时加会把最后一个字切淡) */
			const CLIP_CLASS = "dsh-status-rotator-clip";
			/**
			 * 常驻布局样式,与渐变开关无关。
			 * 宿主 .turnStatus 是 height:26px + white-space:nowrap + inline-flex,
			 * 既不换行也没有省略号:超长文案会把滚动容器撑出横向滚动条。
			 * 这里用 max-width + overflow 收住,并让时钟(flex:none)不被挤走。
			 * 0.1.7 的状态行是插件自己的 div(见 LINE_CLASS):样式照抄 dsh ≤0.1.6 的
			 * .turnStatus / .turnStatusClock(26px 高 / 14px 字 / nowrap / 自带 shimmer
			 * 渐变;时钟 13px + 8px 间距 + caption 色)。插件渐变打开时,
			 * .dsh-status-rotator-host-gradient 会关掉这里的 shimmer,换成插件配色。
			 */
			const layoutStyleEl = document.createElement("style");
			layoutStyleEl.id = "dsh-status-rotator-layout-style";
			layoutStyleEl.textContent =
				"." + HOST_CLASS + "{max-width:100%;min-width:0;overflow:hidden}" +
				"." + HOST_CLASS + " > [aria-hidden=\"true\"]{flex:none}" +
				"." + HOST_CLASS + "." + HOST_GRADIENT_CLASS + "{animation:none;background-image:none}" +
				"." + LINE_CLASS + "{" +
				// 以下逐条照抄 dsh ≤0.1.6 的 .turnStatus(ChatView module css),顺序也保持一致:
				// height → font 简写 → font-size → line-height → white-space → background… → display。
				// 三处差异是插件故意留的:
				//   · overflow:hidden —— 这条线在 0.1.7 的输入框座位里(满宽),超长文案必须收住,
				//     否则撑出横向滚动条;0.1.6 的 .turnStatus 在居中内容列里靠 align-self:flex-start
				//     贴左,没有这个问题,所以那一条**不抄**:这里靠父容器 stretch 拿满宽,
				//     对齐由 alignStatusLine 用左右内边距做(text 落点与旧版一致,截断也才有边界)。
				//   · shimmer 关键帧换成自己的名字(不与宿主同名,卸载时干净)。
				//   · font 简写把字重写成 500 —— 这正是 0.1.6 的观感
				//     (--dsw-font-s-strong-14 = "500 14px/22px <family>",不是 600)。
				"height:calc(26px + var(--dsh-content-font-delta,0px));" +
				"font:var(--dsw-font-s-strong-14);" +
				"font-size:var(--dsh-content-font-size,14px);" +
				"line-height:calc(22px + var(--dsh-content-font-delta,0px));" +
				"white-space:nowrap;" +
				"background:linear-gradient(90deg,var(--dsw-static-deepseek-500) 0%,var(--dsw-static-deepseek-500) 40%,var(--dsw-static-deepseek-200) 50%,var(--dsw-static-deepseek-500) 60%,var(--dsw-static-deepseek-500) 100%);" +
				"color:#0000;-webkit-text-fill-color:transparent;" +
				"background-position:100% 0;background-size:250% 100%;" +
				"-webkit-background-clip:text;background-clip:text;" +
				"flex:none;align-items:center;" +
				"animation:1.8s linear infinite dsh-status-rotator-shimmer;" +
				"overflow:hidden;display:inline-flex}" +
				"@keyframes dsh-status-rotator-shimmer{to{background-position:0 0}}" +
				"@media (prefers-reduced-motion:reduce){" + "." + LINE_CLASS + "{background-position:0 0;background-size:100% 100%;animation:none}}" +
				"." + LINE_CLASS + " > ." + CLOCK_CLASS + "{" +
				// 同样逐条照抄 0.1.6 的 .turnStatusClock(font 简写 → font-size → line-height →
				// tabular-nums → caption 色 → 8px 间距 → font-weight:400)。
				"font:var(--dsw-font-xs-13);" +
				"font-size:var(--dsh-content-font-size-secondary,13px);" +
				"line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));" +
				"font-variant-numeric:tabular-nums;" +
				"color:var(--dsw-alias-label-caption);-webkit-text-fill-color:var(--dsw-alias-label-caption);" +
				"margin-left:8px;font-weight:400}" +
				// 观测徽标:时钟后面一个小胶囊;空内容时不占位(显示:无)
				"." + BADGE_CLASS + "{" +
				"flex:none;margin-left:8px;padding:0 6px;border-radius:8px;" +
				"font-size:var(--dsh-content-font-size-secondary,13px);line-height:18px;" +
				"font-variant-numeric:tabular-nums;font-weight:400;" +
				"color:var(--dsw-alias-label-secondary);-webkit-text-fill-color:var(--dsw-alias-label-secondary);" +
				"background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16))}" +
				"." + BADGE_CLASS + ":empty{display:none}" +
				"." + TEXT_SPAN_CLASS + "{display:inline-block;min-width:0;max-width:100%;overflow:hidden;white-space:nowrap}" +
				"." + TEXT_SPAN_CLASS + "." + CLIP_CLASS + "{" +
				"-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 22px),transparent);" +
				"mask-image:linear-gradient(90deg,#000 calc(100% - 22px),transparent)}";
			(document.head || document.documentElement).appendChild(layoutStyleEl);
			/** 宿主当前是否深色主题(DSH ui-layout 给 body 打 data-ds-dark-theme);读不到按浅色处理 */
			const isDarkTheme = () => {
				try {
					return !!(document.body && document.body.hasAttribute && document.body.hasAttribute("data-ds-dark-theme"));
				} catch (error) {
					return false;
				}
			};
			/** 渐变文字样式(按 config.gradient 生成,注入 <style>;关闭/配色非法时清空) */
			let styleEl = null;
			/** 注入的渐变 CSS 当前是否真的生效:配色非法时不能接管文字,否则文字会变透明 */
			let gradientCssActive = false;
			const updateStyle = () => {
				if (styleEl === null) {
					styleEl = document.createElement("style");
					styleEl.id = "dsh-status-rotator-style";
					document.head.appendChild(styleEl);
				}
				const g = config.gradient;
				// 白天 / 黑夜两套色板:auto 按宿主深浅色主题选,day / night 强制
				const colors = g && g.enabled ? resolveGradientColors(g, isDarkTheme()) : [];
				if (!g || !g.enabled || colors.length < 2) {
					// 关闭或配色非法:不写规则,文字回退宿主自带的 shimmer 渐变(不会变透明)
					styleEl.textContent = "";
					gradientCssActive = false;
					return;
				}
				const speed = Math.max(0.5, Number(g.speed) || 4);
				// CSS 生成抽成纯函数(gradientTextCss):方向选项 ltr / rtl 都在那里落地
				styleEl.textContent = gradientTextCss(colors, speed, g.direction);
				gradientCssActive = true;
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

			/** 文本是否真的溢出 → 加/去右侧淡出(没溢出时加会把最后一个字切淡) */
			const syncTruncation = (el) => {
				const span = el.querySelector(":scope > ." + TEXT_SPAN_CLASS);
				if (!span) return;
				span.classList.toggle(CLIP_CLASS, span.scrollWidth > span.clientWidth + 1);
			};

			/**
			 * 同步渐变/截断相关的 DOM 状态。
			 * 文本一律包进 span(不再按渐变开关反复 wrap/unwrap):截断需要一个
			 * 能收窄的盒子,而 span 是唯一不会打乱宿主 flex 布局的位置。
			 */
			const syncGradient = (el) => {
				const want = !!(config.gradient && config.gradient.enabled) && gradientCssActive;
				if (!el.querySelector(":scope > ." + TEXT_SPAN_CLASS)) wrapText(el);
				const span = el.querySelector(":scope > ." + TEXT_SPAN_CLASS);
				if (span) span.classList.toggle("dsh-status-rotator-rainbow", want);
				el.classList.add(HOST_CLASS);
				el.classList.toggle(HOST_GRADIENT_CLASS, want);
				syncTruncation(el);
			};

			/**
			 * 观测徽标(重试 / 降级等结构化信号)的 DOM:
			 * 挂在时钟后面,内容由观测通道喂(没有信号就是空串 → CSS 里不显示)。
			 * 两代宿主共用:旧宿主(dsh ≤0.1.6 的 role=status)与新状态行都调它。
			 */
			const ensureBadge = (el) => {
				let badge = el.querySelector(":scope > ." + BADGE_CLASS);
				if (!badge) {
					badge = document.createElement("span");
					badge.className = BADGE_CLASS;
					badge.setAttribute("aria-hidden", "true");
					const clock = clockEl(el);
					if (clock && clock.parentElement === el && clock.nextSibling) el.insertBefore(badge, clock.nextSibling);
					else if (clock && clock.parentElement === el) el.appendChild(badge);
					else el.appendChild(badge);
				}
				return badge;
			};
			/** 把当前观测状态写进徽标(关闭 / 无信号 / 模板为空 → 清空,不占位) */
			const syncBadge = (el) => {
				try {
					const on = !config.details || config.details.enabled !== false;
					const text = on ? retryBadgeText(liveState.retry, config.details && config.details.badge) : "";
					const badge = ensureBadge(el);
					if (badge.textContent !== text) badge.textContent = text;
				} catch (error) { /* ignore */ }
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

			/**
			 * 用 canvas 量一句文本的像素宽度。宿主是 inline-flex 且时钟紧跟其后,
			 * 打字机逐字输出会让宽度每 30ms 变一次,时钟随之左右跳 —— 开打前把
			 * 整句宽度锁住,打完再释放。
			 */
			const measureText = (text, el) => {
				try {
					if (typeof getComputedStyle !== "function") return 0;
					const cs = getComputedStyle(el);
					if (!measureText.canvas) measureText.canvas = document.createElement("canvas");
					const context = measureText.canvas.getContext && measureText.canvas.getContext("2d");
					if (!context) return 0;
					context.font = [cs.fontStyle, cs.fontVariant, cs.fontWeight, cs.fontSize, cs.fontFamily].join(" ");
					return context.measureText(text).width;
				} catch (error) {
					return 0;
				}
			};

			/** 打字机:把 el 的文本逐字输出成 text;打断进行中的打字。typeSpeedMs=0 时立即输出。 */
			const typeText = (el, text, onDone) => {
				const node = firstTextNode(el);
				if (!node) return;
				const state = typists.get(el) || { timer: null, text: "", index: 0, lockedWidth: undefined };
				if (state.timer !== null) clearInterval(state.timer);
				if (state.lockedWidth !== undefined) {
					el.style.removeProperty("min-width");
					state.lockedWidth = undefined;
				}
				const unlock = () => {
					if (state.lockedWidth !== undefined) {
						el.style.removeProperty("min-width");
						state.lockedWidth = undefined;
					}
				};
				state.text = text;
				state.index = 0;
				node.nodeValue = "";
				if (config.typeSpeedMs === 0) {
					node.nodeValue = text;
					state.timer = null;
					typists.delete(el);
					syncTruncation(el);
					if (typeof onDone === "function") onDone();
					return;
				}
				const fullWidth = measureText(text, el);
				if (fullWidth > 0) {
					el.style.minWidth = Math.ceil(fullWidth) + "px";
					state.lockedWidth = true;
				}
				state.timer = setInterval(() => {
					const current = firstTextNode(el);
					// React 可能替换了文本节点:每 tick 重新找;找不到就放弃
					if (!current) {
						clearInterval(state.timer);
						state.timer = null;
						unlock();
						typists.delete(el);
						return;
					}
					state.index++;
					current.nodeValue = text.slice(0, state.index);
					if (state.index >= text.length) {
						clearInterval(state.timer);
						state.timer = null;
						unlock();
						syncTruncation(el);
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

			/** 这条线是不是插件自己画的(0.1.7 的状态行;旧宿主是宿主自己的 TurnStatus) */
			const isOwnLine = (el) => {
				try {
					return !!(el.classList && el.classList.contains(LINE_CLASS));
				} catch (error) {
					return false;
				}
			};

			/**
			 * 直接落字(不走打字机):「只用宿主原文」与「短语库为空回落宿主原文」两种情况用。
			 * 0.1.6 的 TurnStatus 是一上来就写着 Deep diving…,没有逐字动画;回落时也照这个来,
			 * 免得为了显示一句原文再演一遍打字机。
			 */
			const setTextNow = (el, text, onDone) => {
				const state = typists.get(el);
				if (state) {
					if (state.timer !== null) clearInterval(state.timer);
					if (state.lockedWidth !== undefined) el.style.removeProperty("min-width");
					typists.delete(el);
				}
				const node = firstTextNode(el);
				if (!node) return;
				node.nodeValue = text;
				syncTruncation(el);
				if (typeof onDone === "function") onDone();
			};

			/** 模板变量的上下文(el 为 null = 用引擎实时状态,供文案/标题占位符使用) */
			const ctxFor = (el) => {
				const now = new Date();
				const pad = (n) => String(n).padStart(2, "0");
				// 观测通道字段:没有重试时全部为空串(模板里 {retry} 之类会渲染成空)
				const retry = config.details && config.details.enabled !== false ? liveState.retry : null;
				const badge = retryBadgeText(retry, config.details && config.details.badge);
				const base = {
					locale: lastLocale,
					date: now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()),
					time: pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds()),
					// 实时引擎字段(无数据时显示 —)
					model: liveState.model || "—",
					provider: liveState.provider || "—",
					tps: String(liveState.tps),
					pending: formatPending(liveState.pending),
					tools: liveState.tools.length > 0 ? liveState.tools.join("+") : "—",
					running: liveState.running ? "run" : "idle",
					// {detail} = 整条观测徽标;其余是拆开的字段,便于写自己的文案
					detail: badge,
					retry: retry ? String(retry.retry) : "",
					retryMax: retry && Number.isFinite(retry.max) ? String(retry.max) : "",
					retryProvider: retry && typeof retry.provider === "string" ? retry.provider : "",
					retryCode: retry && typeof retry.code === "string" ? retry.code : "",
					retryStarted: retry && retry.started ? "1" : "",
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
					syncTruncation(el);
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
				syncBadge(el);
				// 本次该显示什么:轮换短语 / 宿主原文 / 保持现状(见 labelPlanFor)。
				// 关键修复:短语库为空时不再直接 return —— 0.1.7 上插件把宿主那行藏了,
				// 自己这条线要是也空着,界面上就再没有「Deep diving…」了。
				const list = config.labelSource === "host" ? null : textsForPhase(groups, phaseOf(el));
				const plan = labelPlanFor(config.labelSource, list !== null, isOwnLine(el));
				if (plan === "keep") {
					// 旧宿主(≤0.1.6)的 TurnStatus 本来就写着宿主原文 —— 不接管、也不给它
					// 套插件渐变(保持既有行为)。只有当前文本已经不是原文了(刚从 phrases
					// 切到 host、或短语库被清空)才把它擦回原文。
					const hostText = resolveDiveLabel(chatT(), lastLocale);
					if (hostText && !matchesDiveText(currentText(el), hostText)) setTextNow(el, hostText);
					return;
				}
				const next = plan === "host" ? resolveDiveLabel(chatT(), lastLocale) : pickFrom(list, el);
				if (!next) return;
				syncGradient(el);
				syncWeight(el);
				clearLive(el);
				// 记下「原始模板」:文本节点里已经插值过,再插值一次 {pending}
				// 这种占位符就找不回来了,实时重渲染必须靠这份原始模板。
				setLiveTemplate(el, next);
				const rendered = renderPhrase(next, el);
				if (plan === "host") {
					// 宿主原文:已经写着同一句(旧宿主的 TurnStatus / 上一拍刚写过)就什么都不做
					if (currentText(el) === rendered || matchesDiveText(currentText(el), rendered)) {
						maybeStartLive(el, next);
						return;
					}
					setTextNow(el, rendered, () => maybeStartLive(el, next));
					return;
				}
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

			/** 标题是否正被本插件持有(我们写过、还没交还);只有持有过才谈得上「还回去」 */
			let titleOwned = false;
			/** 我们上一次写进 document.title 的值:用来分辨「现在这个标题是不是别人写的」 */
			let lastTitleWritten = null;

			/**
			 * 标签页标题:回合中按模板轮换;无回合用 idleTemplate(空 = 交还标题)。
			 *
			 * **只有本插件写过的标题才交还,没持有过就一个字都不碰**(见 titleWritePlan)。
			 * 旧实现是「读回来的值 != 启动那一刻缓存的值就写回去」,于是任何别的标题写者
			 * (宿主的会话标题、oh-my-dsh 的品牌名替换)都会被顶掉;遇到还会把写入值再改一手的
			 * 写者时更是**永远不收敛**:OMD 把 `… — DeepSeek Harness` 换成 `… — Oh My DSH`,
			 * 我们读回来的值于是永远不等于写进去的值,每一拍都重写一次。
			 * 真浏览器回归见 scripts/title-coexistence-test.html(用的是 OMD 的真实品牌替换代码)。
			 */
			const updateTitle = () => {
				const current = typeof document.title === "string" ? document.title : "";
				// 当前标题不是我们写的那句 → 别人(宿主 / 别的插件)刚写过它:记成交还目标。
				// 这样即使标题功能开着(我们的文案会盖住宿主的会话标题),关掉时也能把宿主那一份
				// 还回去,而不是还给插件启动那一刻的产品名快照。
				if (current.length > 0 && (!titleOwned || current !== lastTitleWritten)) origTitle = current;
				const t = config.title;
				let wants = null;
				if (t && t.enabled) {
					const el = activeEl();
					if (el) {
						const tpls = Array.isArray(t.templates) && t.templates.length > 0
							? t.templates
							: ["⏳ {phase} {elapsed}"];
						wants = interpolate(tpls[titleIndex % tpls.length], ctxFor(el));
					} else if (typeof t.idleTemplate === "string" && t.idleTemplate.length > 0) {
						wants = interpolate(t.idleTemplate, ctxFor(null));
					}
				}
				const plan = titleWritePlan(titleOwned, wants, origTitle);
				titleOwned = plan.owned;
				// 值没变就不写:document.title 的 setter 会把「写同一个值」也算成一次写入,
				// 别人(例如品牌替换)看到的就是我们在不停抢标题。
				if (plan.write !== null && current !== plan.write) {
					document.title = plan.write;
					lastTitleWritten = plan.write;
				}
			};

			const advanceTitle = () => {
				titleIndex++;
				updateTitle();
			};

			// ══ 实时状态引擎:聚合 dsh 会话快照 / 模型 RPC / DOM 阶段兜底 ══
			// 供文案/标题占位符共用,单一数据源。
			const liveState = {
				model: "", provider: "", tps: 0, pending: 0,
				tools: [], streamChars: 0, running: false,
				phase: "idle", elapsed: 0,
				// 观测通道(重试/降级):结构化事件里读到的当前状态;没有就是 null
				retry: null,
			};
			let liveSessionId = null;
			let liveSessionUnsub = null;
			let liveEventsUnsub = null;
			let liveListUnsub = null;
			let liveModelToken = 0;
			let liveEngineTimer = null;
			let lastChars = 0;
			let lastCharsTime = 0;

			// 重渲染合并到微任务:一次 engineTick 会连着 setLive 好几次
			// (phase / elapsed / running / tps / pending),逐次重渲染会让「已接管」
			// 元素每秒画两三遍。合并后每拍最多一次。
			// (v0.15.0 的 Pill 下线、其监听者机制随 v0.17.3 删除后,这里不再需要
			//   监听者集合:唯一的消费者就是 renderLiveNow 自己。)
			let liveRenderQueued = false;
			/** 已接管元素按当前实时状态重渲染(只做占位符替换,不重新抽文案/不重打) */
			const renderLiveNow = () => {
				liveRenderQueued = false;
				for (const el of adopted) {
					if (!el.isConnected) continue;
					// 观测徽标只依赖实时状态,不依赖文案模板 —— 先同步
					syncBadge(el);
					if (typists.has(el)) continue;   // 正在逐字输出:交给打字机,免得抢文本
					const template = liveTemplateOf(el);
					if (typeof template !== "string" || !isDynamicTemplate(template)) continue;
					try {
						const rendered = renderPhrase(template, el);
						const node = firstTextNode(el);
						if (node) node.nodeValue = rendered;
						syncTruncation(el);
					} catch (error) { /* 单个元素失败不影响其他 */ }
				}
				updateTitle();
			};
			const setLive = (patch) => {
				let changed = false;
				for (const k of Object.keys(patch)) {
					if (liveState[k] !== patch[k]) { liveState[k] = patch[k]; changed = true; }
				}
				if (!changed || liveRenderQueued) return;
				liveRenderQueued = true;
				// 优先用微任务(同一拍合并);环境没有 queueMicrotask 时退回同步重渲染
				if (typeof queueMicrotask === "function") queueMicrotask(renderLiveNow);
				else renderLiveNow();
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

			/** DOM 兜底:从 role=status 元素(及 0.1.7 宿主时钟)读阶段/耗时(与状态文案同一套判定) */
			const domPhaseOf = () => {
				// 0.1.7 宿主:时长由插件搬到自己的时钟 span 上,读它即可
				// (此时 role=status 是那个 1px 读屏公告,里面没有任何时钟子元素)
				for (const el of adopted) {
					if (!el.isConnected) continue;
					const clock = clockEl(el);
					if (!clock || !clock.textContent) continue;
					const sec = parseClock(clock.textContent);
					return {
						phase: sec * 1000 >= config.longAfterMs ? PHASE_LONG : PHASE_RUNNING,
						elapsed: sec,
					};
				}
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

			/**
			 * 观测通道订阅:跟随当前会话的事件窗口,把结构化重试状态喂进 liveState。
			 * 窗口是「有界的连续事件窗口」,每次通知重折一遍(窗口只有几百条,
			 * 每秒最多一次,开销可忽略);拿不到 eventSource 就什么都不做(显式降级)。
			 */
			const wireSessionEvents = (binding) => {
				if (liveEventsUnsub) { try { liveEventsUnsub(); } catch (error) { /* ignore */ } liveEventsUnsub = null; }
				setLive({ retry: null });
				const source = binding && binding.eventSource;
				if (!source || typeof source.subscribe !== "function" || typeof source.getSnapshot !== "function") {
					log("observation channel unavailable(宿主没有会话事件窗口)→ 观测徽标保持隐藏");
					return;
				}
				let logged = false;
				const refresh = () => {
					try {
						const win = source.getSnapshot();
						const entries = win && Array.isArray(win.entries) ? win.entries : [];
						const retry = retryStateFromEntries(entries, null);
						if (!logged) {
							logged = true;
							log("observation channel wired,", entries.length, "events;", retry ? "retry " + retry.retry : "no retry in flight");
						}
						setLive({ retry });
					} catch (error) { /* 单个窗口失败不影响其他实时字段 */ }
				};
				try {
					liveEventsUnsub = source.subscribe(refresh);
					refresh();
				} catch (error) {
					liveEventsUnsub = null;
					log("observation channel subscribe failed, badge stays hidden");
				}
			};

			/** 绑定当前会话:订阅快照 + 拉取模型名 */
			const connectSession = (id) => {
				if (id === liveSessionId) return;
				liveSessionId = id;
				if (liveSessionUnsub) { liveSessionUnsub(); liveSessionUnsub = null; }
				if (liveEventsUnsub) { try { liveEventsUnsub(); } catch (error) { /* ignore */ } liveEventsUnsub = null; }
				setLive({ model: "", provider: "", retry: null });
				const sessions = access("sessions");
				if (!sessions) return;
				let face = null;
				let binding = null;
				try {
					binding = typeof sessions.binding === "function" ? sessions.binding(id) : undefined;
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
				// ══ 观测通道:会话事件窗口里的结构化重试事件 ══
				// dsh 的 llm-retry 把 llm/retry、llm/retry-started 追加进会话事件日志,
				// 客户端的 binding.eventSource 就是那扇窗口(协议优先,不解析任何文本)。
				// 该 API 在旧宿主上不存在 → 静默降级:不显示、不猜。
				wireSessionEvents(binding);
				// 模型名:官方模型目录服务优先(同步快照 + load()),connection RPC 兜底
				updateModel(id);
				refreshPendingCount();
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

			/**
			 * 待作答交互的订阅(ctx.uiSession.pendingInteractions)。
			 * 这是 {pending} 的真实来源:审批面板与提问面板都在这里发布;审批策略
			 * 为 never 时审批请求根本不会进入这张表(见 pendingCountOf 注释)。
			 * 服务缺失(旧版 dsh / 无该插件)时静默保持 0,其余功能不受影响。
			 */
			let pendingSource = null;
			let pendingUnsub = null;
			/**
			 * 读一次待作答交互数。pendingInteractions 是 HostObservable
			 * (getSnapshot()/subscribe()),**不是** Map —— 快照才是
			 * 「SessionId → 交互」的表;直接对 observable 本身取 entries 会数到
			 * 它自己的方法名(实测恒为 0)。
			 */
			const pendingCount = () => {
				try {
					if (!pendingSource) return 0;
					const snap = typeof pendingSource.getSnapshot === "function" ? pendingSource.getSnapshot() : null;
					return pendingCountOf(snap, liveSessionId);
				} catch (error) {
					return 0;
				}
			};
			const refreshPendingCount = () => setLive({ pending: pendingCount() });
			const wirePendingInteractions = () => {
				try {
					if (pendingSource) return;
					const uiSession = access("uiSession");
					const source = uiSession && uiSession.pendingInteractions;
					if (!source || typeof source.getSnapshot !== "function") return;
					pendingSource = source;
					if (typeof source.subscribe === "function") {
						pendingUnsub = source.subscribe(refreshPendingCount);
					}
					refreshPendingCount();
				} catch (error) { /* 单点失败不影响其余实时字段 */ }
			};

			/** 接线:跟随当前会话切换 */
			/**
			 * 当前会话 id。旧宿主(dsh ≤0.1.6)的 sessions.list 快照里有 `current`;
			 * 0.1.7 起列表快照只剩 ids / byId / phase / projectionsBySession(不再有
			 * `current`,实测确认),于是退回 UI 自己记的选择:
			 *   · localStorage["dsh.sessions.current"] = { sessionId }(0.1.7 的界面就用它);
			 *   · DOM 上的 [data-sidebar-right-session](右栏按当前会话挂)。
			 * 三个来源都取不到就返回 null(不猜),由 2 秒兜底轮询重试。
			 */
			const currentSessionId = (sessions) => {
				try {
					const st = sessions && sessions.list && typeof sessions.list.getSnapshot === "function"
						? sessions.list.getSnapshot() : null;
					if (st && st.current) return String(st.current);
				} catch (error) { /* ignore */ }
				try {
					const raw = localStorage.getItem(CURRENT_SESSION_KEY);
					if (raw) {
						const parsed = JSON.parse(raw);
						if (parsed && typeof parsed.sessionId === "string" && parsed.sessionId.length > 0) return parsed.sessionId;
					}
				} catch (error) { /* ignore */ }
				try {
					const el = document.querySelector("[data-sidebar-right-session]");
					const id = el && el.getAttribute("data-sidebar-right-session");
					if (typeof id === "string" && id.length > 0) return id;
				} catch (error) { /* ignore */ }
				return null;
			};

			/** 把「当前会话」同步到实时引擎(列表快照 / UI 选择 / DOM 标记三路取一个) */
			const syncCurrentSession = () => {
				const sessions = access("sessions");
				if (!sessions) return;
				const id = currentSessionId(sessions);
				if (id) connectSession(String(id));
			};

			const wireLiveEngine = () => {
				const sessions = access("sessions");
				if (sessions && sessions.list && typeof sessions.list.subscribe === "function") {
					if (!liveListUnsub) {
						liveListUnsub = sessions.list.subscribe(syncCurrentSession);
					}
					syncCurrentSession();
				}
				// {pending} 这类事件驱动的占位符:订阅待作答交互表,值一变就重渲染
				// (文案/标题里的动态占位符由 setLive 自己调度重渲染,见 renderLiveNow)。
				wirePendingInteractions();
			};

			/** 引擎心跳:TPS 平滑 + 阶段/时长(会话快照优先,DOM 兜底) + 驱动实时重渲染 */
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
						liveTemplates.delete(el);
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
						liveTemplates.delete(el);
						clearLive(el);
						continue;
					}
					refresh(el);
				}
				updateTitle();
			};

			/**
			 * dsh "chat" 命名空间的翻译函数(惰性绑定,随当前语言实时翻译;
			 * 字典未注册时 bind 兜底返回 key 本身,由 resolveDiveLabel 判定不可用)。
			 */
			const chatT = () => {
				try {
					return typeof ctx.locale.bind === "function" ? ctx.locale.bind("chat") : null;
				} catch (error) {
					return null;
				}
			};

			// ══ dsh 0.1.7+ 状态行:搬回旧版位置(输入框上方、对话下方) ══
			//
			// 0.1.7 把回合状态塞进了 button[data-turn-process] —— 回合折叠头,长在
			// 回合开头;长回合里它早被滚出视口,于是「替换 deep diving」看不见。
			// 旧宿主(dsh ≤0.1.6)的状态行在另一个位置:ChatView 里 ChatNodeList 之后
			// 渲染的 TurnStatus —— 对话流末尾、输入框正上方那一行,样式 26px 高 /
			// nowrap / inline-flex / 自带 shimmer 渐变,时钟 13px + 8px 间距。
			//
			// 这里按旧版位置来:
			//   · 状态行 = 插件自己的 div(LINE_CLASS),插进输入框座位
			//     (composer stack)第一位 —— 跟着输入框常驻可见,占真实布局空间,
			//     不覆盖对话;水平方向与消息列同一左边界(量 flow 项的 x),整行居中;
			//   · 回合折叠头里那行原样藏起来(display:none),避免同一状态出现两处;
			//     回合结束时撤掉状态行、把折叠头放出来(显示 Took 12s / Worked);
			//   · 时长 / 阶段仍从折叠头的标签文本里读 —— React 每秒用 setTextContent
			//     整段重写那个标签(不是改 nodeValue),所以插件不往标签里塞任何东西,
			//     只在旁边读它:时长原样搬进状态行时钟,phase / {elapsed} 照旧。
			//
			// 读屏公告 span(1px 的 role="status",内容仍是 Deep diving...)不碰。

			/** 元素是否被宿主视觉隐藏(0.1.7 的读屏公告 span = clip:rect(0 0 0 0) + 1px 盒) */
			const isVisuallyHidden = (el) => {
				try {
					const cls = String(el.className || "");
					if (/(^|_)visuallyhidden$/i.test(cls)) return true;
					const rect = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null;
					return !!rect && rect.width <= 1 && rect.height <= 1;
				} catch (error) {
					return false;
				}
			};

			/** 0.1.7 宿主:折叠头按钮 → React 那个会被每秒重写的标签元素 */
			const turnLabels = new Map();
			/** 0.1.7 宿主:折叠头按钮 ↔ 插件状态行 */
			const turnLines = new Map();
			const lineButtons = new Map();
			/** 0.1.7 宿主:状态行 → 上次判定出的阶段(阶段变化时立刻换文案,不等轮换) */
			const turnPhases = new Map();

			/**
			 * 宿主每秒重写折叠头里的标签文本。React 走 setTextContent → 标签内部是
			 * childList 变化,而主观察器只盯 document 的 childList/attributes —— 所以
			 * 对每个 data-turn-process 按钮单独挂一个观察器:
			 *   · 已接管 → 同步时长 / 判断回合是否结束;
			 *   · 未接管 → 重新判定(回合结束后宿主写 Worked / Took 12s,下一次回合
			 *     开始又写回运行中文案,这样能立刻接管,不用等 2 秒兜底轮询)。
			 * 插件状态行不在按钮里,打字机写入不会触发它。
			 */
			const watchedButtons = new Set();
			const sourceObserver = new MutationObserver((records) => {
				const synced = new Set();
				const rescanned = new Set();
				for (const record of records) {
					const node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
					if (!node || typeof node.closest !== "function") continue;
					const button = node.closest(TURN_PROCESS_SELECTOR);
					if (!button) continue;
					if (turnLines.has(button)) {
						if (!synced.has(button)) {
							synced.add(button);
							syncTurnProcessLine(turnLines.get(button));
						}
						continue;
					}
					if (!rescanned.has(button)) {
						rescanned.add(button);
						scanTurnProcess(button);
					}
				}
			});
			const watchTurnProcessButton = (button) => {
				if (watchedButtons.has(button)) return;
				watchedButtons.add(button);
				try {
					sourceObserver.observe(button, { childList: true, characterData: true, subtree: true });
				} catch (error) {
					watchedButtons.delete(button);   // 观察失败不影响静态接管
				}
			};

			/**
			 * 0.1.7 宿主:取折叠头里 React 的标签元素。优先用接管时记下的那个;
			 * 宿主重渲染换了元素时,按「有文本」重新认领(chevron 是 svg,无文本)。
			 */
			const turnLabelOf = (button) => {
				const tracked = turnLabels.get(button);
				if (tracked && tracked.isConnected && tracked.parentElement === button) return tracked;
				for (const child of Array.from(button.children)) {
					if ((child.textContent || "").length === 0) continue;
					turnLabels.set(button, child);
					return child;
				}
				return null;
			};

			/** 藏起折叠头里那行宿主状态(幂等);它继续被每秒重写,只是不显示 */
			const hideTurnHeader = (button) => {
				try {
					if (button.style.display !== "none") button.style.display = "none";
				} catch (error) { /* ignore */ }
			};

			/** 折叠头恢复显示(回合结束 / 插件卸载时) */
			const showTurnHeader = (button) => {
				try {
					button.style.removeProperty("display");
				} catch (error) { /* ignore */ }
			};

			/**
			 * 0.1.7:状态行的挂载点 = 输入框座位(composer stack)—— sticky 在会话底部,
			 * 里面就是输入卡片,插它第一位即「对话下方、输入框上方」,且常驻可见。
			 * 从按钮往上找第一个含 [data-slot="conversation.composer.bar"] 的祖先,
			 * 那个 slot 的父元素就是座位(同一会话视图内,不会串到别的会话)。
			 */
			const composerSeatOf = (button) => {
				let el = button;
				while (el && el !== document.body) {
					try {
						const slot = el.querySelector('[data-slot="conversation.composer.bar"]');
						if (slot && slot.parentElement) return slot.parentElement;
					} catch (error) { /* ignore */ }
					el = el.parentElement;
				}
				return null;
			};

			/**
			 * 水平对齐:旧版状态行在居中内容列里靠左 —— 左边界与消息文本一致
			 * (dsh ≤0.1.6 的 .turnStatus 是 align-self:flex-start)。量当前会话
			 * 第一条 flow 项的 x(没有消息时退回输入卡片)换算成状态行左右内边距,
			 * 整行满宽 + 文字从消息列左边界开始。
			 * 注意座位外面可能还套着 display:contents 的 slot 容器(线上就是),
			 * 所以往上找到第一个含 flow 项的祖先再取基准。
			 */
			const alignStatusLine = (line, seat) => {
				try {
					if (!seat || !seat.getBoundingClientRect) return;
					const seatRect = seat.getBoundingClientRect();
					if (seatRect.width <= 0) return;
					let ref = null;
					let scope = seat.parentElement;
					while (scope && scope !== document.body) {
						const flow = scope.querySelector("[data-chat-flow-kind]");
						if (flow) { ref = flow.getBoundingClientRect(); break; }
						scope = scope.parentElement;
					}
					if ((!ref || ref.width <= 0) && seat.querySelector("[data-composer-input]")) {
						let el = seat.querySelector("[data-composer-input]");
						while (el && el !== seat) {
							const r = el.getBoundingClientRect();
							if (r.width > 0 && r.width < seatRect.width - 1) ref = r;
							el = el.parentElement;
						}
					}
					if (!ref || ref.width <= 0) return;
					const left = Math.max(0, Math.round(ref.left - seatRect.left));
					const right = Math.max(0, Math.round(seatRect.right - ref.right));
					line.style.paddingLeft = left + "px";
					line.style.paddingRight = right + "px";
				} catch (error) { /* ignore */ }
			};

			/** 建状态行:插在输入框座位第一位,自带文案 span 与时钟 span */
			const buildStatusLine = (seat) => {
				const line = document.createElement("div");
				line.className = LINE_CLASS + " " + HOST_CLASS;
				const text = document.createElement("span");
				text.className = TEXT_SPAN_CLASS;
				text.appendChild(document.createTextNode(""));
				line.appendChild(text);
				const clock = document.createElement("span");
				clock.className = CLOCK_CLASS;
				clock.setAttribute("aria-hidden", "true");
				line.appendChild(clock);
				seat.insertBefore(line, seat.firstChild);
				alignStatusLine(line, seat);
				return line;
			};

			/** 释放状态行:撤掉插件元素、把折叠头放出来(回合结束 / 插件卸载时) */
			const releaseStatusLine = (line) => {
				const button = lineButtons.get(line);
				try {
					if (line.isConnected) line.remove();
				} catch (error) { /* ignore */ }
				if (button) showTurnHeader(button);
				const state = typists.get(line);
				if (state && state.timer !== null) clearInterval(state.timer);
				typists.delete(line);
				clearLive(line);
				lastPicks.delete(line);
				liveTemplates.delete(line);
				turnPhases.delete(line);
				lineButtons.delete(line);
				if (button) turnLines.delete(button);
				adopted.delete(line);
				log("released status line");
			};

			/**
			 * 从折叠头的标签文本里同步时长到状态行时钟,并按阶段变化换文案。
			 * 文本不再是「运行中」文案(Worked / Took 12s / Failed / Stopped…)时,
			 * 说明回合已经结束 —— 撤掉状态行、把折叠头放出来。
			 */
			const syncTurnProcessLine = (line) => {
				const button = lineButtons.get(line);
				if (!line.isConnected || !button || !button.isConnected) { releaseStatusLine(line); return; }
				const labelEl = turnLabelOf(button);
				if (!labelEl) { releaseStatusLine(line); return; }
				const label = resolveDiveLabel(chatT(), lastLocale);
				const prefix = resolveDiveDurationPrefix(chatT(), lastLocale);
				const duration = matchDiveLabel(labelEl.textContent || "", label, prefix);
				if (duration === null) { releaseStatusLine(line); return; }
				hideTurnHeader(button);
				const clock = clockEl(line);
				if (clock) {
					if (clock.textContent !== duration) clock.textContent = duration;
					// 「只用宿主原文」= 纯 0.1.6 观感,连时钟的出现时机也照旧版:
					// 0.1.6 的 TurnStatus 是 elapsedMs >= 15s 才渲染时钟子元素
					// (showClock = elapsedMs >= 15e3),这里照做。默认(轮换短语)模式下
					// 时钟一直显示 —— 0.1.7 的宿主自己从第一秒就把时长写进标签里。
					const gate = config.labelSource === "host";
					const show = !gate || parseClock(duration) * 1000 >= HOST_CLOCK_APPEAR_MS;
					clock.style.display = show ? "" : "none";
				}
				alignStatusLine(line, line.parentElement);
				const phase = phaseOf(line);
				const previous = turnPhases.get(line);
				turnPhases.set(line, phase);
				// 时钟出现(thinking → running)或跨过 longAfterMs 时立刻换文案,
				// 与旧宿主「时钟出现即切换」的手感一致;首次接管由 adopt 自己 refresh。
				if (previous !== undefined && previous !== phase) refresh(line);
			};

			/**
			 * 接管运行中的回合:确保状态行在旧版位置,再把折叠头藏起来。
			 * 顺序很重要:折叠头只在「状态行确实存在」之后才藏 —— 万一输入框座位
			 * 还没渲染出来(布局变了 / 非聊天页),也不能把宿主的运行中状态弄没,
			 * 顶多是这拍不接管,交给 2 秒兜底轮询重试。
			 */
			const adoptTurnProcessButton = (button, labelEl) => {
				turnLabels.set(button, labelEl);
				const existing = turnLines.get(button);
				if (existing && existing.isConnected) {
					hideTurnHeader(button);
					syncTurnProcessLine(existing);
					return;
				}
				const seat = composerSeatOf(button);
				if (!seat) return;   // 座位还没渲染:不藏折叠头,等兜底轮询
				const line = buildStatusLine(seat);
				turnLines.set(button, line);
				lineButtons.set(line, button);
				turnPhases.set(line, undefined);
				adopted.add(line);
				hideTurnHeader(button);
				log("adopted turn-process line, 宿主文本:", JSON.stringify((labelEl.textContent || "").slice(0, 40)));
				syncTurnProcessLine(line);
				if (adopted.has(line)) {
					refresh(line);
					updateTitle();
				}
			};

			/** 扫描 0.1.7 宿主(root 本身可能就是那个按钮,也可能是它的祖先/自身) */
			const scanTurnProcess = (root) => {
				if (!(root instanceof Element)) return;
				const buttons = [];
				try {
					if (typeof root.matches === "function" && root.matches(TURN_PROCESS_SELECTOR)) buttons.push(root);
					for (const button of root.querySelectorAll(TURN_PROCESS_SELECTOR)) buttons.push(button);
				} catch (error) {
					return;
				}
				const label = resolveDiveLabel(chatT(), lastLocale);
				const prefix = resolveDiveDurationPrefix(chatT(), lastLocale);
				for (const button of buttons) {
					// 即使是「回合已结束」的按钮也挂上观察器:下一次回合开始宿主会
					// 把文本写回运行中文案,那一刻直接接管,不用等 2 秒兜底轮询。
					watchTurnProcessButton(button);
					for (const child of Array.from(button.children)) {
						if (matchDiveLabel(child.textContent || "", label, prefix) === null) continue;
						adoptTurnProcessButton(button, child);
						break;
					}
				}
			};

			/** 已断开连接的按钮不必再观察(map 不随回合累积) */
			const pruneWatchedButtons = () => {
				for (const button of watchedButtons) if (!button.isConnected) watchedButtons.delete(button);
			};

			const adopt = (el) => {
				if (adopted.has(el)) return;
				// 0.1.7 的读屏公告 span 也带 role="status" + 初始文案,但它是 1px 的
				// 视觉隐藏盒:接管它等于什么都没换(可见标签在旁边的按钮里,由
				// scanTurnProcess 处理),所以直接跳过。
				if (isVisuallyHidden(el)) return;
				// role="status" + aria-live="polite" 在页面上并不唯一(轨迹历史
				// 加载、模型保存提示等区域也用它),所以必须再按 TurnStatus 的
				// 内容/结构过滤:
				//   1. 时钟出现前:初始文案随 UI 语言不同(经 dsh "chat" 字典实时
				//      解析,zh 为「深度求索中...」,en 为 "Deep diving...");
				//   2. 时钟出现后:存在一个能解析出正时长的 aria-hidden 直接子元素。
				// 其余 status 区域两个条件都不满足,不会被动到。
				const clock = clockEl(el);
				const label = resolveDiveLabel(chatT(), lastLocale);
				const text = el.textContent || "";
				const isTurnStatus =
					el.getAttribute("role") === "status" &&
					el.getAttribute("aria-live") === "polite" &&
					(matchesDiveText(text, label) ||
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
				scanTurnProcess(root);
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
				// 会话/输入框座位重渲染可能把那行状态行一起换掉:清掉失效的再重扫重建
				for (const line of Array.from(lineButtons.keys())) {
					if (!line.isConnected) releaseStatusLine(line);
				}
				scanTurnProcess(document.body);
				pruneWatchedButtons();
				// 实时引擎兜底:服务或「当前会话」可能晚于插件就绪(0.1.7 的 sessions
				// 服务就常晚一拍),或用户在会话间切换 —— 每 2 秒重新接一次线
				try {
					wireLiveEngine();
					syncCurrentSession();
				} catch (error) { /* ignore */ }
				// 窗口尺寸变化后重新判断是否溢出(2 秒一次,开销可忽略);
				// 同时兜底同步一次 0.1.7 宿主的时长/回合状态(正常路径由按钮观察器触发)
				for (const el of adopted) {
					if (!el.isConnected) continue;
					if (lineButtons.has(el)) syncTurnProcessLine(el);
					syncTruncation(el);
				}
				// 宿主遮罩兜底:只切样式(不增删节点)的显隐不会触发 mutation,2 秒查一次
				syncDanmakuMask();
			};

			const observer = new MutationObserver((records) => {
				for (const record of records) {
					// 深浅色主题切换(body[data-ds-dark-theme] 增删)→ 重算渐变 CSS 并刷新已接管元素
					if (record.type === "attributes" && record.attributeName === "data-ds-dark-theme") {
						updateStyle();
						for (const el of adopted) if (el.isConnected) syncGradient(el);
						continue;
					}
					// 阶段变化:adopted 元素内部结构变化(时钟出现/移除)→ 立即换文案;
					// 自己 wrap 渐变 span 造成的新增要排除(防自我触发循环);
					// 但"span 被移除"(自己 unwrap 或 React 重渲染接管)必须刷新——
					// 否则 React 恢复的初始文案(Deep diving.../深度求索中...)
					// 会闪回并丢渐变/文案。
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
				// 宿主遮罩(设置弹窗 / 灯箱)开关改的是结构和样式:整批变更合并成一次探针复查
				scheduleDanmakuMaskCheck();
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
				// 实时引擎:存在动态占位符时运行(liveTickMs=0 时完全停摆)
				const engineOn = config.liveTickMs > 0;
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
					// 刚打开(或刚改)弹幕时先确认宿主没压着全屏遮罩:有就这一轮先不建,
					// 等遮罩关掉由 syncDanmakuMask 恢复 —— 否则设置弹窗一开就会闪(issue #60)。
					if (danmakuEnabled() && !refreshDanmakuMask(true)) startDanmaku();
				}
				updateStyle();
				refreshAll();
			};

			// ══ 弹幕引擎:文案以视频网站弹幕形式在页面(默认在界面后面)飘过 ══
			const DANMAKU_LAYER_CLASS = "dsh-status-rotator-danmaku-layer";
			const DANMAKU_ITEM_CLASS = "dsh-status-rotator-danmaku-item";
			/** 顶部 / 底部弹幕条目类名(定位与居中;文字样式走内联,便于按配置覆盖) */
			const DANMAKU_ITEM_TOP_CLASS = "dsh-status-rotator-danmaku-item-top";
			const DANMAKU_ITEM_BOTTOM_CLASS = "dsh-status-rotator-danmaku-item-bottom";
			/** 顶部 / 底部弹幕的前层类名(与滚动层同一个宿主,靠正层级压在聊天内容之上) */
			const DANMAKU_FRONT_CLASS = "dsh-status-rotator-danmaku-layer-front";
			let danmakuLayer = null;               // 滚动弹幕层容器(懒创建)
			let danmakuFrontLayer = null;          // 顶部/底部弹幕前层容器(懒创建)
			let danmakuFrontParent = null;         // 前层当前挂载节点
			let danmakuMountMode = null;           // 上一次解析出的挂载方式(frame / fixed)
			let danmakuParent = null;              // 当前挂载节点(底色面板/主框架/body)
			let danmakuIsolatedEl = null;          // 当前被加上 isolation 的挂载点(恢复用)
			let danmakuIsolatedSaved = null;       // 该挂载点 isolation 的原值
			let danmakuStyleEl = null;             // 弹幕基础 CSS
			let danmakuTimer = null;               // 发射定时器
			let danmakuInFlight = [];              // 活动弹幕 { el, timer, done }
			let danmakuLastText = null;            // 防连续重复
			let lastDanmakuRaw = null;             // 上次生效的 danmaku 配置 JSON 快照
			let danmakuMasked = false;             // 宿主全屏 backdrop-filter 遮罩在 → 弹幕整体停摆(issue #60)
			let danmakuMaskEl = null;              // 命中的遮罩元素(复查 / 日志用)
			let danmakuMaskProbeTimer = null;      // 变更后合并探针的一次性定时器

			const dcfg = () => (config.danmaku && typeof config.danmaku === "object" ? config.danmaku : { enabled: false });
			const danmakuEnabled = () => !!dcfg().enabled;
			/** 是否检测宿主全屏遮罩(默认开;关掉 = 老行为,弹幕在遮罩后面照跑) */
			const danmakuMaskPauseOn = () => dcfg().pauseBehindMask !== false;
			
			/** 顶部 / 底部弹幕样式:与集中默认值合并,用户只写几项也不会丢键 */
			const fixedCfg = () => {
				const f = dcfg().fixed;
				return f && typeof f === "object" ? { ...DANMAKU_FIXED_DEFAULTS, ...f } : { ...DANMAKU_FIXED_DEFAULTS };
			};
			/** 顶部 / 底部弹幕层级:整数;负数 = 与滚动弹幕同层(界面后面) */
			const danmakuFixedZIndex = () => {
				const z = Number(fixedCfg().zIndex);
				if (!Number.isFinite(z)) return DANMAKU_FIXED_DEFAULTS.zIndex;
				return Math.max(DANMAKU_FIXED_LIMITS.zIndex[0], Math.min(DANMAKU_FIXED_LIMITS.zIndex[1], Math.round(z)));
			};
			/** 类型开关与权重:与默认配置逐类型合并(缺省即默认 滚动 2 : 顶部 1 : 底部 1) */
			const typeCfg = () => {
				const t = dcfg().types;
				const out = {};
				for (const mode of DANMAKU_MODES) {
					const base = DEFAULT_CONFIG.danmaku.types[mode];
					const over = t && typeof t === "object" && t[mode] && typeof t[mode] === "object" ? t[mode] : null;
					out[mode] = over ? { ...base, ...over } : { ...base };
				}
				return out;
			};
			/** 本次要发的类型:danmaku.mode 显式指定优先(只发某一种),否则按权重抽;null = 三种都关了 */
			const nextDanmakuMode = () => {
				const d = dcfg();
				if (d.mode !== undefined && d.mode !== null) return normalizeDanmakuMode(d.mode);
				return pickDanmakuMode(typeCfg(), Math.random);
			};

			/**
			 * 应用主框架:布局根(#root 或其子树)里那个覆盖视口、position:relative、
			 * overflow:hidden 的元素(DSH 的 AppFrame)。拿不到就返回 null,
			 * 弹幕退回 body 固定层。
			 */
			const appFrameOf = () => {
				// 显式钩子:DSH 外壳把 shell.overlay 渲染成 AppFrame 内的
				// div[data-shell-overlay],它的父元素就是主框架。类名是哈希的,
				// 不能按类名找;这个属性是外壳自己写的稳定标记,优先用它。
				try {
					const overlay = document.querySelector("[data-shell-overlay]");
					const parent = overlay ? overlay.parentElement : null;
					if (parent instanceof Element && parent.offsetWidth > 0 && parent.offsetHeight > 0) return parent;
				} catch (error) { /* ignore */ }
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
					if (el.offsetWidth >= vw - 48 && el.offsetHeight >= vh - 48) return el;
				}
				for (const el of cand) {
					if (!(el instanceof Element)) continue;
					let cs = null;
					try { cs = getComputedStyle(el); } catch (error) { continue; }
					if (cs.position === "relative" && (cs.display === "grid" || cs.display === "flex")
						&& el.offsetWidth >= vw - 48 && el.offsetHeight >= vh - 48) return el;
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
					"}" +
					// 顶部 / 底部弹幕:水平居中、不随播放进度移动(具体边距 / 堆叠位置由内联样式给出)
					"." + DANMAKU_ITEM_TOP_CLASS + "," + "." + DANMAKU_ITEM_BOTTOM_CLASS + "{" +
						"left:50%;transform:translateX(-50%);" +
					"}";
				document.head.appendChild(danmakuStyleEl);
			};

			/** 元素是否画着不透明底色或背景图(命中测试用) */
			const paintsBackground = (el) => {
				try {
					const cs = getComputedStyle(el);
					if (cs.backgroundImage && cs.backgroundImage !== "none") return true;
					return isOpaqueBackgroundColor(cs.backgroundColor);
				} catch (error) {
					return false;
				}
			};

			/** 命中点上的元素栈(自顶向下);不支持 elementsFromPoint 时退化为单元素 */
			const stackAtPoint = (x, y) => {
				try {
					if (typeof document.elementsFromPoint === "function") return document.elementsFromPoint(x, y) || [];
				} catch (error) { /* ignore */ }
				try {
					const el = document.elementFromPoint(x, y);
					return el ? [el] : [];
				} catch (error) { /* ignore */ }
				return [];
			};

			/**
			 * 找「真正画界面底色的面板」。弹幕默认层级 -1,只有挂在画底色的元素
			 * 内部,才会被夹在「底色」与「内容」之间;挂在 AppFrame 上时,一旦
			 * 内容面板自己画了不透明底色,弹幕就被整块盖住 —— 生成了却看不见。
			 *
			 * v0.16.1 的失效点正在这里:dsh 的会话面板(.wSkVaW_root,
			 * background:var(--dsw-alias-bg-base) + position:relative)不再透明,
			 * 而它作为定位后代会画在框架内 z-index:-1 的弹幕层之上。
			 *
			 * 取主框架中心点命中的元素栈,沿祖先链找最内层、背景不透明且够大的
			 * 面板;找不到返回 null(退回主框架,保持旧行为)。
			 */
			const backgroundPanelOf = (frame) => {
				try {
					const fr = frame.getBoundingClientRect();
					if (!(fr.width > 0) || !(fr.height > 0)) return null;
					const cx = fr.left + fr.width / 2;
					const cy = fr.top + fr.height / 2;
					// 参照框:主框架里包含中心点的直接子元素(会话列);没有就退回主框架
					let box = fr;
					for (const child of Array.from(frame.children || [])) {
						const r = child.getBoundingClientRect();
						if (r.width > 0 && r.height > 0 && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
							box = r;
							break;
						}
					}
					for (const hit of stackAtPoint(cx, cy)) {
						let node = hit;
						while (node && node !== frame && frame.contains(node)) {
							// 外壳浮层(弹窗/抽屉)不进去:它画在内容之上,挂进去等于藏起来
							if (typeof node.getAttribute === "function" && node.getAttribute("data-shell-overlay") !== null) break;
							if (node.classList && node.classList.contains(DANMAKU_LAYER_CLASS)) {
								node = node.parentElement;
								continue;
							}
							if (paintsBackground(node) && danmakuPanelFits(node.getBoundingClientRect(), box)) return node;
							node = node.parentElement;
						}
					}
				} catch (error) { /* ignore */ }
				return null;
			};

			let danmakuUpgradeTimer = null;        // 兜底挂载后重试主框架的一次性定时器

			/**
			 * 单个元素是否「铺满视口 + 自带 backdrop-filter」(快路径与命中栈共用同一套规则)。
			 * `viewport` 缺省时现取一次(命中栈里逐元素复用同一个视口尺寸,不重复读)。
			 */
			const maskOverlayMatches = (el, viewport) => {
				if (!(el instanceof Element)) return false;
				let cs = null;
				try { cs = getComputedStyle(el); } catch (error) { return false; }
				// 老 Chromium 只认 -webkit-backdrop-filter
				const bf = cs.backdropFilter !== undefined && cs.backdropFilter !== ""
					? cs.backdropFilter
					: cs.webkitBackdropFilter;
				let rect = null;
				try { rect = el.getBoundingClientRect(); } catch (error) { return false; }
				let vp = viewport;
				if (!vp) {
					try { vp = { width: window.innerWidth, height: window.innerHeight }; } catch (error) { return false; }
				}
				return danmakuMaskOverlayHit(rect, vp, bf);
			};

			/**
			 * 采样点命中栈里找宿主遮罩(issue #60)。**整个栈**都要看:采样点最上面那个
			 * 元素可能是别的东西(对话框卡片、verdict 条),遮罩在它下面,只看栈顶会漏。
			 * 自己的两个层本来就不会进命中栈(都是 `pointer-events:none`),这里仍显式跳过。
			 */
			const maskOverlayAt = (x, y, viewport, seen) => {
				for (const el of stackAtPoint(x, y)) {
					if (!(el instanceof Element) || seen.has(el)) continue;
					seen.add(el);
					if (el.classList && el.classList.contains(DANMAKU_LAYER_CLASS)) continue;
					if (maskOverlayMatches(el, viewport)) return el;
				}
				return null;
			};

			/**
			 * 当前视口有没有宿主全屏 backdrop-filter 遮罩;有则返回该元素,没有返回 null。
			 * 只做命中测试采样,不遍历整棵 DOM:这类遮罩必然铺满视口,所以视口四角 +
			 * 中心这 5 个点里必然有它(设置弹窗的对话框居中、只有 380px 宽,盖不住四角)。
			 */
			const findMaskOverlay = () => {
				let viewport = null;
				try {
					viewport = { width: window.innerWidth, height: window.innerHeight };
				} catch (error) { return null; }
				if (!(viewport.width > 0) || !(viewport.height > 0)) return null;
				const seen = new Set();
				// 采样点:四角(留 6px 余量,避开 1px 边框 / 取整)+ 中心
				const xs = [6, viewport.width / 2, viewport.width - 6];
				const ys = [6, viewport.height / 2, viewport.height - 6];
				for (const y of ys) {
					for (const x of xs) {
						const hit = maskOverlayAt(x, y, viewport, seen);
						if (hit !== null) return hit;
					}
				}
				return null;
			};

			/** 上次命中的遮罩还在不在(快路径:设置弹窗开着时 mutation 不断,不必每次重新采样) */
			const maskOverlayStillOpen = () => danmakuMaskEl !== null
				&& danmakuMaskEl.isConnected === true
				&& maskOverlayMatches(danmakuMaskEl, null);

			/**
			 * 解析本次应把弹幕层挂到哪里。每次都重新解析:客户端插件是立即加载的,
			 * 而应用主框架要等外壳渲染完才存在,首拍拿不到很正常,挂错位置时
			 * 下一拍(或下面的升级重试)会自动纠正。
			 *
			 * zIndex < 0(默认)时优先挂进「画底色的面板」(isolate = 该面板),
			 * 拿不到面板才退回主框架;两者都用 isolation:isolate 造 stacking
			 * context,让层内 z-index:-1 的弹幕夹在底色与内容之间。
			 */
			const resolveDanmakuMount = () => {
				const z = Number.isInteger(dcfg().zIndex) ? dcfg().zIndex : -1;
				if (z >= 0) return { parent: document.body, mode: "fixed", z: String(z), isolate: null, panel: false };
				const frame = appFrameOf();
				const plan = danmakuMountPlan(z, frame !== null);
				if (plan.mode !== "frame") return { parent: document.body, mode: plan.mode, z: plan.z, isolate: null, panel: false };
				const panel = backgroundPanelOf(frame);
				const host = panel || frame;
				return { parent: host, mode: "frame", z: plan.z, isolate: host, panel: panel !== null };
			};

			/** 兜底挂到 body/主框架之后短时间内再试一次(外壳/会话面板可能刚好渲染完) */
			const scheduleDanmakuUpgrade = () => {
				if (danmakuUpgradeTimer !== null) return;
				danmakuUpgradeTimer = setTimeout(() => {
					danmakuUpgradeTimer = null;
					if (!danmakuEnabled()) return;
					ensureDanmakuLayer();
				}, 800);
			};

			/**
			 * 创建/恢复弹幕层。zIndex < 0(默认)时挂进「画底色的面板」(通常就是
			 * 会话面板):给该面板加 isolation:isolate 使其成为 stacking context,
			 * 层内 z-index:-1 的弹幕就被夹在「面板底色」与「聊天内容」之间 ——
			 * 在界面后面,但看得见;zIndex >= 0 时挂在 body 上浮于界面之上。
			 *
			 * 与旧实现的差别:不再「层存在就早退」,而是比对当前挂载目标,目标变了
			 * (例如插件早于外壳渲染时先落到 body 兜底、或底色面板晚于框架出现)
			 * 就重建 —— 这正是历次弹幕失效的根因所在。
			 */
			const ensureDanmakuLayer = () => {
				if (!danmakuEnabled() || danmakuMasked) return;
				ensureDanmakuStyle();
				const mount = resolveDanmakuMount();
				if (mount.parent === null) return;
				danmakuMountMode = mount.mode;           // 前层复用同一个宿主与定位方式
				if (!danmakuNeedsRemount({
					layer: danmakuLayer,
					connected: danmakuLayer !== null && danmakuLayer.isConnected === true,
					parent: danmakuParent,
					z: danmakuLayer !== null ? danmakuLayer.style.zIndex : null
				}, { parent: mount.parent, z: mount.z })) return;
				detachDanmakuLayer();
				const layer = document.createElement("div");
				layer.className = DANMAKU_LAYER_CLASS;
				layer.setAttribute("aria-hidden", "true");
				layer.style.position = mount.mode === "frame" ? "absolute" : "fixed";
				layer.style.zIndex = mount.z;
				if (mount.isolate !== null) {
					try {
						danmakuIsolatedEl = mount.isolate;
						danmakuIsolatedSaved = mount.isolate.style.isolation;
						mount.isolate.style.isolation = "isolate";
					} catch (error) { /* ignore */ }
				}
				mount.parent.appendChild(layer);
				danmakuLayer = layer;
				danmakuParent = mount.parent;
				if (mount.mode === "frame") {
					if (mount.panel) {
						log("danmaku layer mounted inside the background panel");
					} else {
						log("danmaku layer mounted inside the app frame (no opaque background panel found)");
						scheduleDanmakuUpgrade();
					}
				} else if (mount.z === "1") {
					log("danmaku layer: app frame not found, using the visible body fallback (z-index 1)");
					scheduleDanmakuUpgrade();
				}
			};

			/** 摘掉顶部 / 底部弹幕前层(在途弹幕由 detachDanmakuLayer 统一清理) */
			const detachDanmakuFrontLayer = () => {
				if (danmakuFrontLayer === null) return;
				const layer = danmakuFrontLayer;
				danmakuFrontLayer = null;
				danmakuFrontParent = null;
				try { layer.remove(); } catch (error) { /* ignore */ }
			};
			
			/**
			 * 顶部 / 底部弹幕的「前层」:与滚动层挂在同一个宿主里(通常就是画底色的会话
			 * 面板),但用正层级浮在聊天内容之上 —— 这才是 bilibili 里顶部/底部弹幕压着画面
			 * 显示的样子(滚动弹幕仍然在界面后面,行为不变)。
			 *
			 * 层级由 danmaku.fixed.zIndex 控制(默认 10):dsh 外壳 overlay 层是 20、侧栏
			 * 拖拽手柄 11,所以 10 既能压住聊天内容,又不会糊住设置弹窗;面板上的
			 * isolation:isolate 会把这个层级关在面板内部。设为负数即塞回界面后面。
			 */
			const ensureDanmakuFrontLayer = () => {
				if (!danmakuEnabled() || danmakuMasked) return null;
				ensureDanmakuLayer();                  // 宿主与 isolation 由滚动层统一解析
				if (danmakuParent === null) return null;
				const z = String(danmakuFixedZIndex());
				if (!danmakuNeedsRemount({
					layer: danmakuFrontLayer,
					connected: danmakuFrontLayer !== null && danmakuFrontLayer.isConnected === true,
					parent: danmakuFrontParent,
					z: danmakuFrontLayer !== null ? danmakuFrontLayer.style.zIndex : null
				}, { parent: danmakuParent, z })) return danmakuFrontLayer;
				detachDanmakuFrontLayer();
				const layer = document.createElement("div");
				layer.className = DANMAKU_LAYER_CLASS + " " + DANMAKU_FRONT_CLASS;
				layer.setAttribute("aria-hidden", "true");
				layer.style.position = danmakuMountMode === "frame" ? "absolute" : "fixed";
				layer.style.zIndex = z;
				danmakuParent.appendChild(layer);
				danmakuFrontLayer = layer;
				danmakuFrontParent = danmakuParent;
				log("danmaku front layer (top/bottom) mounted beside the background layer, z-index " + z);
				return layer;
			};
			
			/**
			 * 底部弹幕的下边界:优先贴住「输入区上沿」。
			 * dsh 的状态行(插件已经给它打了 .dsh-status-rotator-host)就在输入区最上面,
			 * 它的上边就是底部弹幕该停的地方 —— 否则半透明弹幕会压在状态行的 shimmer 上,
			 * 看起来就像那个流光特效「映射」到了弹幕上。量不到状态行时回落到配置边距。
			 */
			const danmakuBottomEdge = (pad) => {
				let edge = pad;
				try {
					const host = danmakuParent !== null ? danmakuParent.querySelector("." + HOST_CLASS) : null;
					const layer = danmakuFrontLayer !== null ? danmakuFrontLayer : danmakuLayer;
					if (host === null || layer === null) return edge;
					const lr = layer.getBoundingClientRect();
					const hr = host.getBoundingClientRect();
					if (!(lr.height > 0) || !(hr.height > 0)) return edge;
					const above = lr.bottom - hr.top;
					// 只信「贴着底部」的状态行:量到的值离谱(超过层高 60%)就当没找到
					if (above > edge && above < lr.height * 0.6) edge = above;
				} catch (error) { /* 保持配置边距 */ }
				return edge;
			};
			
			/** 摘掉弹幕层与在途弹幕(不动发射定时器);恢复挂载点的 isolation */
			const detachDanmakuLayer = () => {
				for (const item of danmakuInFlight) {
					if (item.timer !== null) clearTimeout(item.timer);
					if (item.el && item.el.parentNode) {
						try { item.el.remove(); } catch (error) { /* ignore */ }
					}
				}
				danmakuInFlight = [];
				danmakuLastText = null;
				detachDanmakuFrontLayer();
				if (danmakuLayer !== null) {
					const layer = danmakuLayer;
					danmakuLayer = null;
					danmakuParent = null;
					try { layer.remove(); } catch (error) { /* ignore */ }
				}
				if (danmakuIsolatedEl !== null) {
					try { danmakuIsolatedEl.style.isolation = danmakuIsolatedSaved || ""; } catch (error) { /* ignore */ }
					danmakuIsolatedEl = null;
					danmakuIsolatedSaved = null;
				}
			};

			/** 拆除弹幕层与所有在途弹幕;恢复主框架 isolation(退出时也调用) */
			const teardownDanmaku = () => {
				if (danmakuTimer !== null) {
					clearInterval(danmakuTimer);
					danmakuTimer = null;
				}
				if (danmakuUpgradeTimer !== null) {
					clearTimeout(danmakuUpgradeTimer);
					danmakuUpgradeTimer = null;
				}
				detachDanmakuLayer();
			};

			/** 建层 + 起发射定时器 + 立刻发一拍(宿主遮罩期间不调用) */
			const startDanmaku = () => {
				ensureDanmakuLayer();
				ensureDanmakuFrontLayer();
				const iv = Number(dcfg().intervalMs) > 0 ? Number(dcfg().intervalMs) : 2500;
				danmakuTimer = setInterval(spawnDanmaku, iv);
				spawnDanmaku();
			};

			/**
			 * 复查宿主全屏遮罩并更新 danmakuMasked;返回「此刻是否被遮罩挡住」。
			 * `force` 用于「弹幕刚被打开」这种必须查一次的场景(否则弹幕没开就不查,
			 * 省掉每个 mutation 批次都要读样式)。
			 * 上次命中的元素还挂着、还符合条件时走快路径(设置弹窗开着时 mutation 不断,
			 * 没必要每次都重新采样 9 个点)。
			 */
			const refreshDanmakuMask = (force) => {
				if ((force !== true && !danmakuEnabled()) || !danmakuMaskPauseOn()) {
					danmakuMaskEl = null;
					danmakuMasked = false;
					return false;
				}
				if (maskOverlayStillOpen()) {
					danmakuMasked = true;
					return true;
				}
				danmakuMaskEl = findMaskOverlay();
				danmakuMasked = danmakuMaskEl !== null;
				return danmakuMasked;
			};

			/**
			 * 遮罩状态变化时暂停 / 恢复弹幕 —— issue #60 的修复本体。
			 *
			 * 暂停 = teardownDanmaku():层、在途条目的 CSS 过渡、发射定时器全拆掉,
			 * 遮罩后面不再有任何持续位移的合成层,backdrop-filter 不必每帧重算。
			 * 恢复 = startDanmaku():重建层并从下一拍重新发射(在途那几颗不续播,
			 * 弹幕是背景装饰,重来一遍比续播更简单也更不容易出残影)。
			 */
			const syncDanmakuMask = () => {
				const was = danmakuMasked;
				const now = refreshDanmakuMask(false);
				if (now === was) return;
				if (now) {
					teardownDanmaku();
					log("danmaku paused: host full-viewport backdrop-filter overlay detected (issue #60)");
					return;
				}
				if (!danmakuEnabled()) return;
				startDanmaku();
				log("danmaku resumed: host overlay closed");
			};

			/**
			 * 变更后合并探针:React 一次渲染会连着抛很多条 mutation,统一压到 250ms 后查一次;
			 * 弹窗开关都能在这个延迟内被发现(远小于 2 秒的 rescanAll 兜底)。
			 */
			const scheduleDanmakuMaskCheck = () => {
				if (danmakuMaskProbeTimer !== null) return;
				danmakuMaskProbeTimer = setTimeout(() => {
					danmakuMaskProbeTimer = null;
					syncDanmakuMask();
				}, DANMAKU_MASK_PROBE_MS);
			};

			/** 当前弹幕阶段:回合中取实时引擎阶段;否则 DOM 兜底;都没有 → thinking */
			const danmakuPhase = () => {
				if (liveState.running) return liveState.phase;
				const dom = domPhaseOf();
				return dom ? dom.phase : PHASE_THINKING;
			};

			/**
			 * 发射一颗顶部 / 底部弹幕:固定不动、水平居中,先来后到堆叠
			 * (顶部自上而下 / 底部自下而上),到停留时长后整条消失。
			 * 视觉(字号 / 颜色 / 描边 / 边距 / 间距 / 停留时长 / 同屏上限 / 层级)全部来自
			 * config.danmaku.fixed(集中默认值 DANMAKU_FIXED_DEFAULTS),不散落硬编码;
			 * 炫彩色板与滚动弹幕共用,颜色按 danmaku.rainbow 逐颗随机或取单色。
			 * 条目进「前层」:正层级浮在聊天内容之上,不会被消息气泡盖住。
			 * 同屏满载 / 已堆到区域另一头时,与滚动弹幕一致:丢弃这一拍。
			 */
			const spawnFixedDanmaku = (mode, d) => {
				const f = fixedCfg();
				// 前层每拍重解析:层被外壳重渲染顶掉、或挂载点升级,都会在这里自动补回来
				const layer = ensureDanmakuFrontLayer();
				if (layer === null) return;
				const maxCount = Math.max(1, Math.round(Number(f.maxCount) || DANMAKU_FIXED_DEFAULTS.maxCount));
				const live = danmakuInFlight.filter((item) => item.mode === mode);
				// 车道分配:取最小空闲车道;没有空位 = 同类满载 → 丢弃这一拍(与滚动弹幕一致)
				const lane = danmakuFreeLane(live.map((item) => item.lane), maxCount);
				if (lane < 0) return;
				const pool = danmakuPool(groups, danmakuPhase(), d.scope === "phase" ? "phase" : "all");
				if (pool.length === 0) return;
				const picked = pickWeighted(pool, danmakuLastText, Math.random);
				const text = entryText(picked);
				danmakuLastText = text;
				const rendered = interpolate(text, ctxFor(null));
				if (!rendered) return;
				const size = Math.max(8, Math.min(200, Math.round(Number(f.fontSize) || DANMAKU_FIXED_DEFAULTS.fontSize)));
				const gap = Number(f.gap) >= 0 ? Number(f.gap) : DANMAKU_FIXED_DEFAULTS.gap;
				const pad = Math.max(0, Number(mode === "top" ? f.marginTop : f.marginBottom) || 0);
				const edge = mode === "bottom" && f.anchorBottomToHost !== false ? danmakuBottomEdge(pad) : pad;
				const band = layer.clientHeight > 0 ? layer.clientHeight : window.innerHeight;
				const el = document.createElement("span");
				el.className = DANMAKU_ITEM_CLASS + " " + (mode === "top" ? DANMAKU_ITEM_TOP_CLASS : DANMAKU_ITEM_BOTTOM_CLASS);
				el.setAttribute("data-danmaku-mode", mode);
				el.setAttribute("data-danmaku-lane", String(lane));
				el.textContent = rendered;
				el.style.fontSize = size + "px";
				// 炫彩与滚动弹幕共用同一套色板(rainbow !== false 时逐颗随机取色);
				// 关掉炫彩才用 fixed.color(默认白字)
				const palette = Array.isArray(d.colors) && d.colors.length > 0 ? d.colors : DEFAULT_CONFIG.danmaku.colors;
				const color = d.rainbow !== false
					? palette[randInt(0, palette.length - 1)]
					: (typeof f.color === "string" && f.color.length > 0 ? f.color : DANMAKU_FIXED_DEFAULTS.color);
				el.style.color = color;
				// 明确压掉宿主可能继承下来的文字特效(shimmer 用的 -webkit-text-fill-color/描边/动画)
				el.style.webkitTextFillColor = color;
				el.style.webkitTextStroke = "0";
				el.style.animation = "none";
				el.style.textShadow = typeof f.shadow === "string" && f.shadow.length > 0 ? f.shadow : DANMAKU_FIXED_DEFAULTS.shadow;
				const baseOpacity = typeof d.opacity === "number" ? Math.min(1, Math.max(0.05, d.opacity)) : 0.3;
				el.style.opacity = String(baseOpacity);           // 固定弹幕不做滚动弹幕那种逐颗抖动
				const fw = config.fontWeight;
				el.style.fontWeight = (fw !== undefined && fw !== "inherit") ? String(fw) : "600";
				el.style.left = "50%";
				el.style.transform = "translateX(-50%)";
				layer.appendChild(el);                             // 先入 DOM,才量得到真实行高
				const height = el.offsetHeight || Math.round(size * 1.35);
				const offset = danmakuLaneOffset(lane, height, gap);
				// 车道有空位,但堆到区域另一头了 → 同样丢弃这一拍
				if (!danmakuStackFits(offset, height, Math.max(height, band - edge))) {
					try { el.remove(); } catch (error) { /* ignore */ }
					return;
				}
				if (mode === "top") {
					el.style.top = (edge + offset) + "px";
				} else {
					el.style.top = "auto";                         // 清掉基类 top:0,否则 bottom 会被忽略
					el.style.bottom = (edge + offset) + "px";
				}
				const item = { el, timer: null, done: false, mode, height, lane };
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
				const duration = Math.max(500, Math.min(60000, Number(f.durationMs) || DANMAKU_FIXED_DEFAULTS.durationMs));
				item.timer = setTimeout(cleanup, duration);
				danmakuInFlight.push(item);
				log("danmaku:", mode, JSON.stringify(rendered.slice(0, 30)), "size", size, "color", color, "offset", offset, "z", layer.style.zIndex);
			};
			
			/** 发射一颗弹幕:随机文案 + 随机字号 + (炫彩)随机颜色 + 轻微透明度抖动 */
			const spawnDanmaku = () => {
				const d = dcfg();
				if (!d.enabled || danmakuMasked) return;
				// 每拍都重解析挂载点:层被外壳重渲染顶掉、或首拍落到 body 兜底,
				// 都会在这里自动纠正(不拆发射定时器,否则弹幕会停摆)。
				ensureDanmakuLayer();
				if (danmakuLayer === null) return;
				if (danmakuInFlight.length >= (Number(d.maxCount) || 12)) return;
				// 类型分发:顶部 / 底部走固定弹幕渲染,滚动保持原有代码路径(向后兼容)
				const mode = nextDanmakuMode();
				if (mode === null) return;                       // 三种类型全部关闭 → 这一拍不发
				if (mode !== "scroll") { spawnFixedDanmaku(mode, d); return; }
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
				// 与固定弹幕车道用同一个参照(层高),两者才在同一套坐标里;拿不到层高才退回视口
				const vh = danmakuLayer.clientHeight > 0 ? danmakuLayer.clientHeight : window.innerHeight;
				const topPad = Number(d.marginTop) || 0;
				const bottomPad = Number(d.marginBottom) || 0;
				// 竖直落点:避开顶部 / 底部弹幕占用的车道带,免得两条文案叠在一起
				const scrollFixed = fixedCfg();
				const band = danmakuScrollBand(typeCfg(), scrollFixed, scrollFixed.reserveBands !== false, topPad, bottomPad, vh, size * 1.6);
				const usable = Math.max(64, band.end - band.start - size * 1.6);
				const el = document.createElement("span");
				el.className = DANMAKU_ITEM_CLASS;
				el.setAttribute("data-danmaku-mode", "scroll");
				el.textContent = rendered;
				el.style.top = (band.start + Math.round(Math.random() * usable)) + "px";
				el.style.fontSize = size + "px";
				el.style.color = color;
				// 明确压掉宿主可能继承下来的文字特效(shimmer 用的 -webkit-text-fill-color/描边/动画)
				el.style.webkitTextFillColor = color;
				el.style.webkitTextStroke = "0";
				el.style.animation = "none";
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
				const item = { el, timer: null, done: false, mode: "scroll", height: el.offsetHeight };
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
				observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-ds-dark-theme"] });
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
					"tab.text": "文案",
					"tab.appearance": "外观",
					"tab.behavior": "行为",
					"tab.schedule": "自动化",
					"textStyle": "文字样式",
					"reset": "恢复默认",
					"library": "文案词库",
					"basic": "基本设置",
					"basicDesc": "轮换间隔、打字机速度与阶段判定等核心参数。",
					"basic.fontWeight": "字体粗细",
					"fontWeight.inherit": "跟随界面(默认)",
					"labelSource": "状态行文案来源",
					"labelSource.phrases": "轮换短语库(插件默认)",
					"labelSource.host": "只用宿主原文(Deep diving…,0.1.6 观感)",
					"labelSource.hint": "「只用宿主原文」= 不轮换短语,状态行只写宿主那句 Deep diving… / 深度求索中;位置与样式都照 0.1.6(dsh ≤0.1.6 的 .turnStatus:26px、shimmer 流光、15 秒后出时钟)。短语库为空时(没 config.json)也会回落到宿主原文,不会再出现空状态行。",
					"fontWeight.invalid": "字重必须是 1~1000 的数字或 inherit",
					"basic.weightedRandom": "加权随机",
					"basic.weightedRandomHint": "词库行 `文案 | 权重`(如 `正在写代码 | 3`),按权重比例抽取;关 = 完全均匀",
					"intervalMs": "轮换间隔(毫秒)",
					"typeSpeedMs": "打字机速度(毫秒/字,0 关)",
					"longAfterMs": "长任务阈值(毫秒)",
					"reloadIntervalMs": "自动重读间隔(毫秒,0 关)",
					"liveTickMs": "占位符刷新间隔(毫秒,0 关)",
					"title": "标签页标题",
					"titleDesc": "浏览器标签页上写什么(默认关闭:一个字都不碰,连宿主自己写的会话标题也不会被插件改掉)",
					"title.enabled": "接管标签页标题",
					"title.enabledHint": "开启后标签页标题变成下面的模板(回合中轮换);关掉时插件把标题交还宿主,之后不再碰它",
					"title.templates": "标题模板(每行一条,轮换)",
					"title.idleTemplate": "空闲时的标题",
					"title.idlePlaceholder": "留空 = 空闲时把标题交还宿主(例如:💤 dsh 空闲)",
					"title.intervalMs": "标题轮换间隔(毫秒)",
					"title.invalidInterval": "标题轮换间隔必须是大于 0 的数字",
					"title.invalidTemplate": "开启标签页标题后,至少要写一条标题模板",
					"title.hint": "模板支持与文案相同的占位符:{phase} {phaseLabel} {elapsed} {model} {tps} {pending} {time} …。插件只在「自己接管过标题」时才会写回:关掉这个开关、或从没开过,它都不会去动别的插件(例如 oh-my-dsh 的品牌名替换)或宿主写的标题。",
					"gradient": "炫彩渐变",
					"gradient.enabled": "启用炫彩渐变",
					"gradient.mode": "配色模式",
					"gradient.mode.auto": "跟随界面深浅色",
					"gradient.mode.day": "白天(浅色)配色",
					"gradient.mode.night": "黑夜(深色)配色",
					"gradient.mode.hint": "跟随界面时,按 DSH 的浅色 / 深色主题自动切换上下两套配色。",
					"gradient.direction": "流动方向",
					"gradient.direction.rtl": "从右向左(默认)",
					"gradient.direction.ltr": "从左向右",
					"gradient.direction.hint": "打字机从左往右出字;想让流光同向、看着更协调,选「从左向右」。",
					"gradient.colors": "黑夜配色(逗号分隔,至少 2 个)",
					"gradient.dayColors": "白天配色(逗号分隔,至少 2 个)",
					"gradient.speed": "流动速度(秒/圈)",
					"gradient.invalid": "渐变配置无效:白天 / 黑夜配色各至少 2 个,速度须大于 0",
					"gradient.invalidColor": "颜色序列里有非法值(会被丢弃,请改成 #rrggbb / rgb() / 颜色名):",
					"preview": "实时预览",
					"preview.hint": "设置弹窗会盖住真实状态行,这里按当前参数实时渲染",
					"preview.sample": "正在写代码…",
					"preview.bullet1": "这段弹幕用的是当前色板",
					"preview.bullet2": "字号范围与透明度实时生效",
					"preview.bullet3": "层级为负时在聊天内容后面",
					"danmaku": "弹幕",
					"danmaku.enabled": "启用弹幕(文案飘过页面)",
					"danmaku.pauseBehindMask": "宿主弹出全屏模糊遮罩时暂停弹幕(避免设置弹窗持续闪烁)",
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
					"danmaku.types": "弹幕类型",
					"danmaku.types.hint": "顶部 / 底部为 bilibili 风格固定弹幕:水平居中、按先来后到堆叠;权重决定抽中概率",
					"danmaku.type.scroll": "滚动",
					"danmaku.type.top": "顶部",
					"danmaku.type.bottom": "底部",
					"danmaku.typeWeight": "权重",
					"danmaku.mode": "强制类型",
					"danmaku.mode.auto": "按权重分发",
					"danmaku.fixed": "顶部 / 底部弹幕样式",
					"danmaku.fixed.hint": "对齐 bilibili:白字 + 四向描边、无背景块;下列数值为合理默认值 [待确认],集中定义在 DANMAKU_FIXED_DEFAULTS",
					"danmaku.fixed.fontSize": "字号(px)",
					"danmaku.fixed.color": "文字颜色(关闭炫彩时生效)",
					"danmaku.fixed.zIndex": "层级(正数 = 浮在聊天内容之上,-1 = 与滚动弹幕同层/界面后面)",
					"danmaku.fixed.reserveBands": "滚动弹幕避开顶部 / 底部弹幕占用的竖直带(避免两条文案叠在一起)",
					"danmaku.fixed.anchorBottom": "底部弹幕贴住输入区上沿(不让状态行的流光从弹幕里透出来)",
					"danmaku.fixed.shadow": "描边 / 阴影(text-shadow)",
					"danmaku.fixed.marginTop": "顶部边距(px)",
					"danmaku.fixed.marginBottom": "底部边距(px)",
					"danmaku.fixed.gap": "堆叠间距(px)",
					"danmaku.fixed.durationMs": "停留时长(毫秒)",
					"danmaku.fixed.maxCount": "同类同屏上限(超限丢弃)",
					"danmaku.fixed.invalid": "顶部 / 底部弹幕配置无效:请检查数字范围、文字颜色与描边值",
					"preview.top": "顶部弹幕(居中 · 自上而下)",
					"preview.bottom": "底部弹幕(居中 · 自下而上)",
					"preset": "预设词库",
					"preset.none": "默认(基础词库)",
					"preset.set": "设为当前",
					"preset.add": "新建",
					"preset.remove": "删除",
					"preset.name": "名称",
					"preset.untitled": "新预设",
					"preset.removeConfirm": "删除预设「{name}」?引用它的调度规则会一并移除。",
					"preset.current": "当前生效: {name}",
					"preset.hint": "预设可带独立的 config 与 phrases;选中后下方编辑区读写该预设。",
					"packs": "词库包",
					"packs.none": "暂无词库包。词库包是按主题分装的文案集合,保存后可逐个开关;词库投稿机器人收录的投稿会自动进入「社区投稿」包。",
					"packs.enabled": "启用该包",
					"packs.enabledCount": "共 {n} 个包,已启用 {m} 个",
					"packs.editTarget": "编辑目标(词库包)",
					"packs.editing": "当前编辑: {name}",
					"packs.target.base": "默认词库",
					"packs.hint": "词库按主题拆成多个词库包,缺省全部启用。关掉某个包 = 这类文案不再出现(保存后生效);在下方「文案词库」顶部选择要编辑的词库包。",
					"pack.items": "{n} 条",
					"schedule": "时段调度",
					"schedule.add": "添加规则",
					"schedule.remove": "删除",
					"schedule.preset": "预设",
					"schedule.from": "从",
					"schedule.to": "到",
					"schedule.days": "星期",
					"schedule.invalid": "调度规则无效:请检查目标预设、星期与时间",
					"schedule.hint": "命中时段自动切换预设;未命中时使用「设为当前」的预设。",
					"schedule.none": "还没有规则 —— 点右上角「添加规则」开始。",
					"schedule.noPreset": "定时规则要绑定一个预设才能切换 —— 先到「文案」页新建一个预设。",
					"schedule.pickPreset": "请选择预设",
					"day.mon": "一", "day.tue": "二", "day.wed": "三", "day.thu": "四", "day.fri": "五", "day.sat": "六", "day.sun": "日",
					"language.zh": "中文",
					"language.en": "English",
					"phase.thinking": "thinking · 回合启动(无时钟)",
					"phase.running": "running · 运行中(有时钟)",
					"phase.long": "long · 长任务(超过阈值)",
					"hint": "每行一句,空行自动忽略;可写 `文案 | 权重` 加权(如 `正在写代码 | 3`);保存后立即生效。",
					"footer.repo": "GitHub 仓库 · 01Virex/dsh-status-rotator ↗",
					"reload": "重新读取",
					"loadError": "读取配置失败",
					"saveError": "保存失败",
					"noDocument": "配置还没读到,先点「重读」再改",
					"invalidNumber": "数值无效:请检查基本设置",
					"overrideWarning": "⚠ localStorage 覆盖生效中,这里编辑的是本地 config.json,页面可能仍显示被覆盖的文案。",
					"count": "共 {n} 句"
				},
				en: {
					"nav.label": "Status Texts",
					"title": "Status Texts",
					"intro": "Tune rotation timing and live display, then edit the phrases shown per phase.",
					"tab.text": "Content",
					"tab.appearance": "Appearance",
					"tab.behavior": "Behavior",
					"tab.schedule": "Automation",
					"textStyle": "Text style",
					"reset": "Reset",
					"library": "Phrase library",
					"basic": "Basic settings",
					"basicDesc": "Rotation interval, typewriter speed, and phase thresholds.",
					"basic.fontWeight": "Font weight",
					"fontWeight.inherit": "Follow UI (default)",
					"labelSource": "Status line text source",
					"labelSource.phrases": "Rotating phrase bank (plugin default)",
					"labelSource.host": "Host text only (Deep diving…, the 0.1.6 look)",
					"labelSource.hint": "\"Host text only\" stops rotating phrases: the status line just reads the host's own Deep diving… / 深度求索中, in the exact 0.1.6 position and style (dsh ≤0.1.6's .turnStatus: 26px, shimmer sweep, clock after 15s). With an empty phrase bank (no config.json) both modes fall back to the host text, so the line is never blank.",
					"basic.weightedRandom": "Weighted random",
					"basic.weightedRandomHint": "Use `text | weight` per line (e.g. `coding hard | 3`) to weight phrases; off = fully uniform",
					"fontWeight.invalid": "Weight must be 1-1000 or \"inherit\"",
					"intervalMs": "Rotation interval (ms)",
					"typeSpeedMs": "Typewriter speed (ms/char, 0 = off)",
					"longAfterMs": "Long-turn threshold (ms)",
					"reloadIntervalMs": "Config reload interval (ms, 0 = off)",
					"liveTickMs": "Placeholder refresh interval (ms, 0 = off)",
					"title": "Tab title",
					"titleDesc": "What the browser tab shows (off by default: the plugin does not touch it at all — not even the session title the host writes)",
					"title.enabled": "Take over the tab title",
					"title.enabledHint": "When on, the tab title becomes the templates below (rotating during a turn); when turned off the plugin hands the title back and never touches it again",
					"title.templates": "Title templates (one per line, rotating)",
					"title.idleTemplate": "Title when idle",
					"title.idlePlaceholder": "Empty = hand the title back to the host while idle (e.g. 💤 idle)",
					"title.intervalMs": "Title rotation interval (ms)",
					"title.invalidInterval": "Title rotation interval must be a number greater than 0",
					"title.invalidTemplate": "Add at least one title template before enabling the tab title",
					"title.hint": "Templates take the same placeholders as phrases: {phase} {phaseLabel} {elapsed} {model} {tps} {pending} {time} … The plugin only writes back a title it took over itself: with this off (or never on) it leaves titles alone — including other plugins' (e.g. oh-my-dsh's brand rename) and the host's session title.",
					"gradient": "Rainbow gradient",
					"gradient.enabled": "Enable rainbow gradient",
					"gradient.mode": "Palette mode",
					"gradient.mode.auto": "Follow interface (light/dark)",
					"gradient.mode.day": "Day (light) palette",
					"gradient.mode.night": "Night (dark) palette",
					"gradient.mode.hint": "Auto switches palettes with the interface light/dark theme.",
					"gradient.direction": "Flow direction",
					"gradient.direction.rtl": "Right to left (default)",
					"gradient.direction.ltr": "Left to right",
					"gradient.direction.hint": "The typewriter types left to right; pick \"Left to right\" to make the shimmer follow it.",
					"gradient.colors": "Night colors (comma-separated, at least 2)",
					"gradient.dayColors": "Day colors (comma-separated, at least 2)",
					"gradient.speed": "Speed (s per cycle)",
					"gradient.invalid": "Invalid gradient: at least 2 colors per palette, speed > 0",
					"gradient.invalidColor": "Invalid color value(s) (dropped — use #rrggbb / rgb() / a color name):",
					"preview": "Live preview",
					"preview.hint": "The settings dialog covers the real status line — this renders your current values",
					"preview.sample": "Writing code…",
					"preview.bullet1": "This bullet uses your current palette",
					"preview.bullet2": "Font-size range and opacity apply live",
					"preview.bullet3": "A negative layer sits behind the chat",
					"danmaku": "Danmaku",
					"danmaku.enabled": "Enable danmaku (phrases float across the page)",
					"danmaku.pauseBehindMask": "Pause danmaku behind a host full-screen blur mask (stops the settings dialog from flickering)",
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
					"danmaku.types": "Danmaku types",
					"danmaku.types.hint": "Top / bottom are bilibili-style fixed bullets: centered, stacked in arrival order; weight sets the odds",
					"danmaku.type.scroll": "Scroll",
					"danmaku.type.top": "Top",
					"danmaku.type.bottom": "Bottom",
					"danmaku.typeWeight": "Weight",
					"danmaku.mode": "Force type",
					"danmaku.mode.auto": "Weighted",
					"danmaku.fixed": "Top / bottom style",
					"danmaku.fixed.hint": "bilibili-aligned: white text + 4-way stroke, no background block; the numbers below are reasonable defaults [TBC], defined once in DANMAKU_FIXED_DEFAULTS",
					"danmaku.fixed.fontSize": "Font size (px)",
					"danmaku.fixed.color": "Text color (used when rainbow is off)",
					"danmaku.fixed.zIndex": "Layer (positive = above the chat; -1 = same layer as scrolling)",
					"danmaku.fixed.reserveBands": "Keep scrolling bullets out of the top/bottom lanes (no overlapping text)",
					"danmaku.fixed.anchorBottom": "Anchor bottom bullets above the input area (so the status shimmer cannot show through)",
					"danmaku.fixed.shadow": "Stroke / shadow (text-shadow)",
					"danmaku.fixed.marginTop": "Top margin (px)",
					"danmaku.fixed.marginBottom": "Bottom margin (px)",
					"danmaku.fixed.gap": "Stack gap (px)",
					"danmaku.fixed.durationMs": "Hold time (ms)",
					"danmaku.fixed.maxCount": "Max on screen per type (drop on overflow)",
					"danmaku.fixed.invalid": "Invalid top/bottom danmaku config — check the number ranges, text color and stroke value",
					"preview.top": "Top bullet (centered · stacked downward)",
					"preview.bottom": "Bottom bullet (centered · stacked upward)",
					"preset": "Preset",
					"preset.none": "Default (base library)",
					"preset.set": "Set active",
					"preset.add": "New",
					"preset.remove": "Delete",
					"preset.name": "Name",
					"preset.untitled": "New preset",
					"preset.removeConfirm": "Delete preset \"{name}\"? Schedule rules referencing it are removed too.",
					"preset.current": "Active: {name}",
					"preset.hint": "Presets may carry their own config & phrases; the editor below reads/writes the selected preset.",
					"packs": "Phrase packs",
					"packs.none": "No phrase packs yet. Packs are theme-scoped phrase sets you can toggle here; submissions picked up by the phrase-submission bot land in the 'Community' pack.",
					"packs.enabled": "Enable pack",
					"packs.enabledCount": "{n} packs, {m} enabled",
					"packs.editTarget": "Edit target (pack)",
					"packs.editing": "Editing: {name}",
					"packs.target.base": "Default bank",
					"packs.hint": "The bank is split into theme packs, all enabled by default. Switch a pack off and that theme disappears from the pool (applies on save). Pick a pack in the 'Phrase library' section below to edit its phrases.",
					"pack.items": "{n} items",
					"schedule": "Time schedule",
					"schedule.add": "Add rule",
					"schedule.remove": "Remove",
					"schedule.preset": "Preset",
					"schedule.from": "From",
					"schedule.to": "To",
					"schedule.days": "Days",
					"schedule.invalid": "Invalid schedule rule — check the target preset, days and times",
					"schedule.hint": "Switches the preset automatically while inside a window; otherwise the 'Set active' preset is used.",
					"schedule.none": "No rules yet — click \"Add rule\" above to start.",
					"schedule.noPreset": "A rule needs a preset to switch to — create one on the Content tab first.",
					"schedule.pickPreset": "Pick a preset",
					"day.mon": "M", "day.tue": "T", "day.wed": "W", "day.thu": "T", "day.fri": "F", "day.sat": "S", "day.sun": "S",
					"language.zh": "中文",
					"language.en": "English",
					"phase.thinking": "thinking · turn started (no clock)",
					"phase.running": "running · clock visible",
					"phase.long": "long · past threshold",
					"hint": "One phrase per line; empty lines are ignored. Add `text | weight` to weight a phrase (e.g. `coding hard | 3`). Saved changes apply immediately.",
					"footer.repo": "GitHub repository · 01Virex/dsh-status-rotator ↗",
					"reload": "Reload",
					"loadError": "Could not load config",
					"saveError": "Save failed",
					"noDocument": "Config has not loaded yet — hit Reload first",
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

			/** 编辑器草稿签名:用于判断是否有未保存改动(键顺序固定,只比较内容) */
			const editorSignature = (state) => JSON.stringify([
				state.basic, state.weighted, state.gradientDraft, state.danmakuDraft, state.titleDraft,
				state.drafts, state.scheduleDrafts, state.packEnabled
			]);

			/** 数值范围(与 lib/index.js 的 CONFIG_LIMITS 一致;第三项 true = 允许写 0 关闭) */
			const CONFIG_RANGES = {
				intervalMs: [250, 3600000, false],
				typeSpeedMs: [0, 1000, true],
				longAfterMs: [1000, 86400000, false],
				reloadIntervalMs: [1000, 3600000, true],
				liveTickMs: [250, 60000, true]
			};
			/** 弹幕数值范围(与 lib/index.js 的 DANMAKU_LIMITS 一致) */
			const DANMAKU_RANGES = {
				intervalMs: [200, 600000, false],
				speedMs: [1000, 120000, false],
				fontSizeMin: [8, 200, false],
				fontSizeMax: [8, 200, false],
				opacity: [0.05, 1, false],
				maxCount: [1, 60, false],
				zIndex: [-1000, 10000, false],
				/** 类型权重(0 = 不再抽到该类型,仍可用 danmaku.mode 强制) */
				typeWeight: [0, 100, false],
				/** 顶部 / 底部弹幕样式(与 DANMAKU_FIXED_LIMITS 同口径) */
				fixedFontSize: [8, 200, false],
				fixedMarginTop: [0, 2000, false],
				fixedMarginBottom: [0, 2000, false],
				fixedGap: [0, 200, false],
				fixedDurationMs: [500, 60000, false],
				fixedMaxCount: [1, 20, false],
				fixedZIndex: [-1000, 10000, false]
			};

			/** 设置页样式(纯 CSS,对齐官方插件设置页 dsh-client-ui-settings-plugins 的规格)
			 *  结构参考官方 .pbvGtq_*(section / heading / intro / tabs / panel)与
			 *  .At1oFq_*(field / label / input / reset / hint),颜色一律走 --dsw-alias-* 令牌。 */
			const SETTINGS_CSS =
				/* 根列:官方插件设置页 760 列 */
				".dsh-sr-settings{display:flex;flex-direction:column;gap:12px;width:100%;max-width:760px;color:var(--dsw-alias-label-primary)}" +
				/* 页面标题(官方 18/600)与简介(13 次要文字) */
				".dsh-sr-title{margin:0;font-size:18px;font-weight:600;line-height:26px}" +
				".dsh-sr-intro{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}" +
				/* 分组:官方字段 .5px hairline 分隔,竖向堆叠 */
				".dsh-sr-group{border-bottom:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;padding:12px 0;display:flex}" +
				".dsh-sr-group:last-child{border-bottom:none;padding-bottom:4px}" +
				".dsh-sr-grouphead{display:flex;align-items:center;justify-content:space-between;gap:8px}" +
				".dsh-sr-grouphead h3{margin:0;font-size:14px;font-weight:500;line-height:22px;color:var(--dsw-alias-label-primary)}" +
				".dsh-sr-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}" +
				".dsh-sr-muted{font-size:12px;color:var(--dsw-alias-label-tertiary)}" +
				".dsh-sr-switchline{display:flex;align-items:center;gap:8px}" +
				/* 次级动作:官方式无边框文本按钮(对应 .At1oFq_reset) */
				".dsh-sr-btn{font:inherit;cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}" +
				".dsh-sr-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary)}" +
				".dsh-sr-btn:focus-visible{color:var(--dsw-alias-label-primary);border-radius:4px;outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}" +
				".dsh-sr-btn:disabled{opacity:.4;cursor:default}" +
				".dsh-sr-btn-danger{color:var(--dsw-alias-state-error-primary)}" +
				".dsh-sr-btn-danger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}" +
				/* 双列字段网格:间隔与官方 cards 一致 */
				".dsh-sr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}" +
				".dsh-sr-grid .dsh-sr-field{min-width:0}" +
				".dsh-sr-field{display:flex;flex-direction:column;gap:6px;min-width:0}" +
				".dsh-sr-label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-secondary)}" +
				/* 表单控件:对齐官方 .At1oFq_input(h34 / .5px border-l4 / bg-layer-3 / 13px) */
				".dsh-sr-input,.dsh-sr-textarea,.dsh-sr-select{box-sizing:border-box;width:100%;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font:inherit;font-size:13px;line-height:1.5}" +
				".dsh-sr-input,.dsh-sr-select{height:34px}" +
				".dsh-sr-input:focus,.dsh-sr-textarea:focus,.dsh-sr-select:focus{border-color:var(--dsw-alias-brand-primary);outline:none}" +
				".dsh-sr-input::placeholder,.dsh-sr-textarea::placeholder{color:var(--dsw-alias-label-dimmed)}" +
				".dsh-sr-input:disabled,.dsh-sr-textarea:disabled,.dsh-sr-select:disabled{opacity:.6;cursor:default}" +
				".dsh-sr-textarea{resize:vertical;min-height:96px;padding:8px 12px;line-height:1.5}" +
				/* select 箭头:纯 CSS 折线,颜色跟随令牌(不再写死灰色) */
				".dsh-sr-select{appearance:none;cursor:pointer;background-image:linear-gradient(45deg,transparent 50%,var(--dsw-alias-label-tertiary) 50%),linear-gradient(135deg,var(--dsw-alias-label-tertiary) 50%,transparent 50%);background-position:calc(100% - 17px) calc(50% + 1px),calc(100% - 12px) calc(50% + 1px);background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:32px}" +
				/* 官方风格开关:36×20 轨道 + 16 圆点 */
				".dsh-sr-toggle{box-sizing:border-box;background:var(--dsw-alias-border-l3);cursor:pointer;border:0;border-radius:10px;flex:none;width:36px;height:20px;padding:2px;position:relative}" +
				".dsh-sr-toggle:disabled{cursor:default;opacity:.5}" +
				".dsh-sr-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}" +
				".dsh-sr-toggleOn{background:var(--dsw-alias-brand-primary)}" +
				".dsh-sr-toggleThumb{background:var(--dsw-alias-label-primary-foreground);border-radius:50%;width:16px;height:16px;transition:transform .12s;display:block}" +
				".dsh-sr-toggleOn .dsh-sr-toggleThumb{transform:translate(16px)}" +
				/* tab:官方 .pbvGtq_tabs/.pbvGtq_tab(页面级与词库语言级共用) */
				".dsh-sr-tabs{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:flex-end;gap:22px;display:flex;margin-top:2px}" +
				".dsh-sr-subtabs{margin-top:0}" +
				".dsh-sr-tab{color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:none;border:0;padding:7px 1px 9px;font-size:13px;line-height:20px;position:relative}" +
				".dsh-sr-tab:hover,.dsh-sr-tab.dsh-sr-active{color:var(--dsw-alias-label-primary)}" +
				".dsh-sr-tab.dsh-sr-active:after{background:var(--dsw-alias-label-primary);content:\"\";border-radius:2px 2px 0 0;height:2px;position:absolute;bottom:-1px;left:0;right:0}" +
				/* tab 面板:官方 .pbvGtq_panel */
				".dsh-sr-panel{display:flex;flex-direction:column;gap:12px;min-width:0;padding-top:2px}" +
				/* 星期药丸:官方 Pill 风格(24 高,active 用 ghost-active 填充+描边) */
				".dsh-sr-chips{display:flex;gap:4px;flex-wrap:wrap}" +
				".dsh-sr-btnrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
				".dsh-sr-chip{cursor:pointer;font:inherit;border:none;border-radius:12px;height:24px;align-items:center;padding:0 8px;font-size:12px;line-height:18px;display:inline-flex;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}" +
				".dsh-sr-chip:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}" +
				".dsh-sr-chip.dsh-sr-on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-ghost-active-fill);box-shadow:inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border)}" +
				".dsh-sr-chip:disabled{cursor:default;opacity:.5}" +
				/* 时段调度:一条规则一张卡,控件挤在同一行 */
				".dsh-sr-rule{display:flex;align-items:center;gap:6px;flex-wrap:wrap;border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1)}" +
				".dsh-sr-rule .dsh-sr-select{flex:0 1 104px;width:auto;padding-right:24px}" +
				".dsh-sr-rule .dsh-sr-chips{flex:1 1 auto;min-width:0;overflow:hidden}" +
				".dsh-sr-rule .dsh-sr-chip{flex:none;padding:0 6px}" +
				".dsh-sr-rule .dsh-sr-input{flex:0 0 96px;width:96px;padding:0 6px}" +
				".dsh-sr-rule .dsh-sr-btn{flex:none}" +
				".dsh-sr-ruleTime{display:flex;align-items:center;gap:6px;flex:none}" +
				".dsh-sr-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;margin:0}" +
				/* 状态条与警示 */
				".dsh-sr-status{font-size:12px;line-height:1.5}" +
				".dsh-sr-error{color:var(--dsw-alias-state-error-primary)}" +
				".dsh-sr-warning{color:var(--dsw-alias-state-warn-label);font-size:12px;line-height:1.5}" +
				/* 底部提示与页脚 */
				".dsh-sr-foot{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}" +
				".dsh-sr-footer{display:flex;justify-content:center;padding:2px 0 6px}" +
				".dsh-sr-repolink{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-decoration:none;border-radius:6px;padding:2px 8px;transition:color .14s,background-color .14s}" +
				".dsh-sr-repolink:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}" +
				".dsh-sr-repolink:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}" +
				/* 实时预览:模拟状态行(26px 高 / nowrap / 时钟紧跟) + 弹幕条 */
				".dsh-sr-previewRow{display:flex;align-items:center;height:26px;white-space:nowrap;overflow:hidden;font-size:14px;line-height:22px}" +
				".dsh-sr-previewText{min-width:0;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 18px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 18px),transparent)}" +
				".dsh-sr-previewClock{margin-left:8px;flex:none;font-size:13px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-caption)}" +
				".dsh-sr-previewDanmaku{position:relative;height:76px;overflow:hidden;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}" +
				".dsh-sr-previewBullet{position:absolute;top:8px;left:100%;white-space:nowrap;font-weight:600;animation:dsh-sr-preview-marquee 7s linear infinite}" +
				".dsh-sr-previewBullet:nth-child(2){top:30px}" +
				".dsh-sr-previewBullet:nth-child(3){top:52px}" +
				// 顶部 / 底部弹幕预览:水平居中固定,不参与滚动
				".dsh-sr-previewTop,.dsh-sr-previewBottom{position:absolute;left:50%;transform:translateX(-50%);white-space:nowrap;font-weight:600}" +
				".dsh-sr-previewTop{top:6px}" +
				".dsh-sr-previewBottom{bottom:6px}" +
				"@keyframes dsh-sr-preview-flow{to{background-position:200% 0}}" +
				"@keyframes dsh-sr-preview-marquee{from{left:100%}to{left:-100%}}" +
				".dsh-sr-input-invalid{border-color:var(--dsw-alias-state-error-primary)}";
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

			/** 取文档里某词库包 */
			const packOf = (data, id) =>
				id && data && Array.isArray(data.packs) ? data.packs.find((p) => p && p.id === id) : null;

			/** 词库包条目总数(跨语言跨阶段,去重前) */
			const packSize = (pack) => {
				if (!pack || !pack.phrases || typeof pack.phrases !== "object") return 0;
				let n = 0;
				for (const lang of ["zh", "en"]) {
					const g = pack.phrases[lang];
					if (!g || typeof g !== "object") continue;
					for (const phase of SETTINGS_PHASES) {
						const list = g[phase];
						if (Array.isArray(list)) n += list.length;
					}
				}
				return n;
			};

			/** 词库编辑组件;props.t 由 slot 系统按 locale 注入,跟随 DSH 语言 */
			const SettingsPanel = (props) => {
				const t = props.t || st;
				const [doc, setDoc] = react.useState(null);
				const [loading, setLoading] = react.useState(true);
				const [loadError, setLoadError] = react.useState("");
				const [lang, setLang] = react.useState("zh");
				/** 页面导航:文案 / 外观 / 行为 / 自动化 */
				const [tab, setTab] = react.useState("text");
				/** 编辑目标:"" = 基础词库;"preset:<id>" = 预设;"pack:<id>" = 词库包 */
				const [editTarget, setEditTarget] = react.useState("");
				const editTargetRef = react.useRef("");
				const setEditTargetBoth = (id) => {
					editTargetRef.current = id;
					setEditTarget(id);
				};
				/** 编辑目标分解(基础 / 预设 / 词库包),供保存与「设为当前」使用 */
				const targetPreset = editTarget.startsWith("preset:") ? editTarget.slice(7) : "";
				const targetPack = editTarget.startsWith("pack:") ? editTarget.slice(5) : "";
				/** 已保存状态的草稿签名;"" = 尚未加载完成 */
				const [baseline, setBaseline] = react.useState("");
				/** 文档 ref:写盘始终基于最新文档,连续改动不会互相覆盖 */
				const docRef = react.useRef(null);
				/** 写盘串行队列:先后顺序与用户操作一致 */
				const writeChain = react.useRef(Promise.resolve());
				/** 写盘状态:idle / saving / saved / error */
				const [saveState, setSaveState] = react.useState({ kind: "idle", text: "" });
				const [basic, setBasic] = react.useState({ intervalMs: "10000", typeSpeedMs: "30", longAfterMs: "60000", reloadIntervalMs: "15000", liveTickMs: "1000", fontWeight: "inherit", labelSource: "phrases" });
				const [weighted, setWeighted] = react.useState(true);
				const [gradientDraft, setGradientDraft] = react.useState({
					enabled: true,
					mode: "auto",
					direction: "rtl",
					colors: DEFAULT_CONFIG.gradient.colors.join(", "),
					dayColors: DEFAULT_CONFIG.gradient.colors.join(", "),
					speed: "4",
				});
				/** 标签页标题草稿(templates 用多行文本,一行一条模板) */
				const [titleDraft, setTitleDraft] = react.useState({
					enabled: false,
					templates: DEFAULT_CONFIG.title.templates.join("\n"),
					idleTemplate: DEFAULT_CONFIG.title.idleTemplate,
					intervalMs: String(DEFAULT_CONFIG.title.intervalMs),
				});
				const [danmakuDraft, setDanmakuDraft] = react.useState({
					enabled: true,
					pauseBehindMask: true,
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
					/** 类型标识:"" = 不强制(按权重分发);scroll / top / bottom = 只发该类型 */
					mode: "",
					typeScroll: true,
					typeScrollWeight: String(DEFAULT_CONFIG.danmaku.types.scroll.weight),
					typeTop: true,
					typeTopWeight: String(DEFAULT_CONFIG.danmaku.types.top.weight),
					typeBottom: true,
					typeBottomWeight: String(DEFAULT_CONFIG.danmaku.types.bottom.weight),
					fixedFontSize: String(DANMAKU_FIXED_DEFAULTS.fontSize),
					fixedColor: DANMAKU_FIXED_DEFAULTS.color,
					fixedShadow: DANMAKU_FIXED_DEFAULTS.shadow,
					fixedMarginTop: String(DANMAKU_FIXED_DEFAULTS.marginTop),
					fixedMarginBottom: String(DANMAKU_FIXED_DEFAULTS.marginBottom),
					fixedGap: String(DANMAKU_FIXED_DEFAULTS.gap),
					fixedDurationMs: String(DANMAKU_FIXED_DEFAULTS.durationMs),
					fixedMaxCount: String(DANMAKU_FIXED_DEFAULTS.maxCount),
					fixedZIndex: String(DANMAKU_FIXED_DEFAULTS.zIndex),
					fixedReserveBands: DANMAKU_FIXED_DEFAULTS.reserveBands,
					fixedAnchorBottom: DANMAKU_FIXED_DEFAULTS.anchorBottomToHost
				});
				const [drafts, setDrafts] = react.useState({ zh: { thinking: "", running: "", long: "" }, en: { thinking: "", running: "", long: "" } });
				const [scheduleDrafts, setScheduleDrafts] = react.useState([]);
				/** 预设名称输入框的草稿(失焦才落盘) */
				const [presetNameDraft, setPresetNameDraft] = react.useState("");
				/** 已启用的词库包 id 列表(空数组 = 全部关闭) */
				const [packEnabled, setPackEnabled] = react.useState([]);
				/** 草稿与基线不一致 = 还有没落盘的改动 */
				const dirty = baseline !== "" && editorSignature({ basic, weighted, gradientDraft, danmakuDraft, titleDraft, drafts, scheduleDrafts, packEnabled }) !== baseline;

				/** 把文档按编辑目标灌进编辑器(重读 / 切目标 / 保存后都会走这里);
				 *  返回灌入的草稿值,供调用方计算「已保存基线」 */
				const applyDoc = react.useCallback((data, target) => {
					const presetId = target.startsWith("preset:") ? target.slice(7) : "";
					const packId = target.startsWith("pack:") ? target.slice(5) : "";
					const p = presetOf(data, presetId);
					const cfg = p && p.config && typeof p.config === "object"
						? p.config
						: (data && data.config && typeof data.config === "object" ? data.config : {});
					const pk = packOf(data, packId);
					const phrases = pk && pk.phrases && typeof pk.phrases === "object"
						? pk.phrases
						: (p && p.phrases && typeof p.phrases === "object"
							? p.phrases
							: (data && data.phrases && typeof data.phrases === "object" ? data.phrases : {}));
					const nextBasic = {
						intervalMs: String(cfg.intervalMs ?? 10000),
						typeSpeedMs: String(cfg.typeSpeedMs ?? 30),
						longAfterMs: String(cfg.longAfterMs ?? 60000),
						reloadIntervalMs: String(cfg.reloadIntervalMs ?? 15000),
						liveTickMs: String(cfg.liveTickMs ?? 1000),
						fontWeight: String(cfg.fontWeight ?? "inherit"),
						labelSource: normalizeLabelSource(cfg.labelSource),
					};
					const nextWeighted = typeof cfg.weightedRandom === "boolean" ? cfg.weightedRandom : true;
					const g = cfg && typeof cfg.gradient === "object" ? cfg.gradient : {};
					const nextGradient = {
						enabled: typeof g.enabled === "boolean" ? g.enabled : true,
						mode: normalizeGradientMode(g.mode),
						direction: normalizeGradientDirection(g.direction),
						colors: Array.isArray(g.colors) && g.colors.length > 0 ? g.colors.join(", ") : DEFAULT_CONFIG.gradient.colors.join(", "),
						// 白天色板:文档没配过时沿用黑夜色板(等价于「只有一套」的老配置)
						dayColors: Array.isArray(g.dayColors) && g.dayColors.length > 0
							? g.dayColors.join(", ")
							: (Array.isArray(g.colors) && g.colors.length > 0 ? g.colors.join(", ") : DEFAULT_CONFIG.gradient.colors.join(", ")),
						speed: String(typeof g.speed === "number" ? g.speed : 4),
					};
					// 标签页标题:false / true 也接受(与 config.json 里的简写一致)
					const tt = cfg && typeof cfg.title === "object" && cfg.title !== null ? cfg.title : {};
					const nextTitle = {
						enabled: cfg && typeof cfg.title === "boolean" ? cfg.title : tt.enabled === true,
						templates: Array.isArray(tt.templates) && tt.templates.length > 0
							? tt.templates.join("\n")
							: DEFAULT_CONFIG.title.templates.join("\n"),
						idleTemplate: typeof tt.idleTemplate === "string" ? tt.idleTemplate : DEFAULT_CONFIG.title.idleTemplate,
						intervalMs: String(typeof tt.intervalMs === "number" && tt.intervalMs > 0 ? tt.intervalMs : DEFAULT_CONFIG.title.intervalMs),
					};
					const dm = cfg && typeof cfg.danmaku === "object" ? cfg.danmaku : {};
					/** 顶部 / 底部弹幕样式块(用户只写几项时其余按集中默认值回填) */
					const dmFixed = dm && typeof dm.fixed === "object" && dm.fixed !== null ? dm.fixed : {};
					const nextDanmaku = {
						enabled: typeof dm.enabled === "boolean" ? dm.enabled : true,
						pauseBehindMask: dm.pauseBehindMask !== false,
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
						// 类型:mode 显式指定优先;types 缺省即默认 滚动 2 : 顶部 1 : 底部 1
						mode: danmakuModeToken(dm.mode) || "",
						typeScroll: !(dm.types && dm.types.scroll && dm.types.scroll.enabled === false),
						typeScrollWeight: String(dm.types && typeof dm.types.scroll === "object" && typeof dm.types.scroll.weight === "number" ? dm.types.scroll.weight : DEFAULT_CONFIG.danmaku.types.scroll.weight),
						typeTop: !(dm.types && dm.types.top && dm.types.top.enabled === false),
						typeTopWeight: String(dm.types && typeof dm.types.top === "object" && typeof dm.types.top.weight === "number" ? dm.types.top.weight : DEFAULT_CONFIG.danmaku.types.top.weight),
						typeBottom: !(dm.types && dm.types.bottom && dm.types.bottom.enabled === false),
						typeBottomWeight: String(dm.types && typeof dm.types.bottom === "object" && typeof dm.types.bottom.weight === "number" ? dm.types.bottom.weight : DEFAULT_CONFIG.danmaku.types.bottom.weight),
						fixedFontSize: String(typeof dmFixed.fontSize === "number" ? dmFixed.fontSize : DANMAKU_FIXED_DEFAULTS.fontSize),
						fixedColor: typeof dmFixed.color === "string" && dmFixed.color.length > 0 ? dmFixed.color : DANMAKU_FIXED_DEFAULTS.color,
						fixedShadow: typeof dmFixed.shadow === "string" && dmFixed.shadow.length > 0 ? dmFixed.shadow : DANMAKU_FIXED_DEFAULTS.shadow,
						fixedMarginTop: String(typeof dmFixed.marginTop === "number" ? dmFixed.marginTop : DANMAKU_FIXED_DEFAULTS.marginTop),
						fixedMarginBottom: String(typeof dmFixed.marginBottom === "number" ? dmFixed.marginBottom : DANMAKU_FIXED_DEFAULTS.marginBottom),
						fixedGap: String(typeof dmFixed.gap === "number" ? dmFixed.gap : DANMAKU_FIXED_DEFAULTS.gap),
						fixedDurationMs: String(typeof dmFixed.durationMs === "number" ? dmFixed.durationMs : DANMAKU_FIXED_DEFAULTS.durationMs),
						fixedMaxCount: String(typeof dmFixed.maxCount === "number" ? dmFixed.maxCount : DANMAKU_FIXED_DEFAULTS.maxCount),
						fixedZIndex: String(typeof dmFixed.zIndex === "number" ? dmFixed.zIndex : DANMAKU_FIXED_DEFAULTS.zIndex),
						fixedReserveBands: dmFixed.reserveBands !== false,
						fixedAnchorBottom: dmFixed.anchorBottomToHost !== false,
					};
					const nextDrafts = {};
					for (const loc of SETTINGS_LOCALES) {
						const src = phrases[loc];
						const groups = Array.isArray(src) ? { [PHASE_THINKING]: src } : (src && typeof src === "object" ? src : {});
						nextDrafts[loc] = {};
						for (const phase of SETTINGS_PHASES) nextDrafts[loc][phase] = phraseLines(groups[phase]);
					}
					setBasic(nextBasic);
					setWeighted(nextWeighted);
					setGradientDraft(nextGradient);
					setDanmakuDraft(nextDanmaku);
					setTitleDraft(nextTitle);
					setDrafts(nextDrafts);
					return { basic: nextBasic, weighted: nextWeighted, gradientDraft: nextGradient, danmakuDraft: nextDanmaku, titleDraft: nextTitle, drafts: nextDrafts };
				}, []);

				const load = react.useCallback(async () => {
					setLoading(true);
					setLoadError("");
					try {
						const data = await readConfigDocument();
						setDoc(data);
						const presets = Array.isArray(data && data.presets) ? data.presets : [];
						const packs = Array.isArray(data && data.packs) ? data.packs : [];
						const packIds = packs.map((p) => p.id);
						// 默认(未写 enabledPacks)= 全部启用,UI 显示全开
						const effectiveEnabled = Array.isArray(data && data.enabledPacks) ? data.enabledPacks.slice() : packIds;
						setPackEnabled(effectiveEnabled);
						// 编辑目标失效(预设或词库包被删)则退回基础词库
						const targetId = editTargetRef.current.startsWith("preset:") || editTargetRef.current.startsWith("pack:")
							? editTargetRef.current.slice(editTargetRef.current.indexOf(":") + 1)
							: "";
						let target = editTargetRef.current;
						const targetOk = target === ""
							|| (target.startsWith("preset:") && presets.some((p) => p.id === targetId))
							|| (target.startsWith("pack:") && packs.some((p) => p.id === targetId));
						if (!targetOk) target = "";
						// 核心词库为空时落在第一个包上,避免打开就是空编辑区
						const coreEmpty = !data || !data.phrases || typeof data.phrases !== "object"
							|| ["zh", "en"].every((l) => ["thinking", "running", "long"].every((ph) => {
								const g = data.phrases[l];
								return !g || !Array.isArray(g[ph]) || g[ph].length === 0;
							}));
						if (target === "" && coreEmpty && packs.length > 0) target = "pack:" + packs[0].id;
						setEditTargetBoth(target);
						const nextSchedule = Array.isArray(data && data.schedule) ? data.schedule.map((r) => ({
							preset: typeof r.preset === "string" ? r.preset : "",
							days: Array.isArray(r.days) ? r.days.filter((d) => SCHEDULE_DAYS.includes(d)) : SCHEDULE_DAYS.slice(),
							from: typeof r.from === "string" ? r.from : "09:00",
							to: typeof r.to === "string" ? r.to : "18:00",
						})) : [];
						setScheduleDrafts(nextSchedule);
						const applied = applyDoc(data, target);
						setBaseline(editorSignature({ ...applied, scheduleDrafts: nextSchedule, packEnabled: effectiveEnabled }));
						setSaveState({ kind: "idle", text: "" });
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
				const packs = Array.isArray(doc && doc.packs) ? doc.packs : [];
				const editLang = lang === "en" ? "en" : "zh";
				const currentLabel = runtimePreset
					? (labelOf(presets.find((p) => p.id === runtimePreset), editLang) || runtimePreset)
					: t("preset.none");

				const updateRow = (idx, patch) => setScheduleDrafts((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

				const validateSchedule = (list) => {
					if (!Array.isArray(list) || list.length === 0) return true;
					for (const r of list) {
						if (!r || typeof r.preset !== "string" || r.preset.length === 0) return false;
						// 规则必须指向真实存在的预设,否则永远不会命中
						if (!presets.some((p) => p.id === r.preset)) return false;
						if (!Array.isArray(r.days) || r.days.length === 0 || !r.days.every((d) => SCHEDULE_DAYS.includes(d))) return false;
						if (!/^\d{1,2}:\d{2}$/.test(r.from) || !/^\d{1,2}:\d{2}$/.test(r.to)) return false;
					}
					return true;
				};

				/** 改即写盘:mutate 在最新文档上应用改动,按队列顺序落盘 */
				const persist = react.useCallback((mutate) => {
					const base = docRef.current && typeof docRef.current === "object" ? docRef.current : {};
					const next = mutate(JSON.parse(JSON.stringify(base)));
					// 乐观更新:界面立刻反映,真正写盘在队列里进行
					docRef.current = next;
					setDoc(next);
					setSaveState({ kind: "saving", text: "" });
					const done = writeChain.current.then(async () => {
						try {
							await writeConfigDocument(next);
							setSaveState({ kind: "saved", text: "" });
						} catch (error) {
							setSaveState({ kind: "error", text: t("saveError") + ": " + String(error && error.message ? error.message : error) });
						}
					});
					writeChain.current = done.catch(() => {});
					return done;
				}, [t]);

				/** 把编辑区的草稿合并进文档并落盘;校验不过只标错、不写盘 */
				const commitDrafts = react.useCallback(() => {
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
						setSaveState({ kind: "error", text: t("invalidNumber") });
						return null;
					}
					if (scheduleDrafts.length > 0 && presets.length === 0) {
						setSaveState({ kind: "error", text: t("schedule.noPreset") });
						return null;
					}
					if (!validateSchedule(scheduleDrafts)) {
						setSaveState({ kind: "error", text: t("schedule.invalid") });
						return null;
					}
					// 字重:inherit 或 1~1000 的数字(字符串得数也接受)
					const weight = basic.fontWeight === "inherit" ? "inherit" : Number(basic.fontWeight);
					if (weight !== "inherit" && (!Number.isFinite(weight) || weight < 1 || weight > 1000)) {
						setSaveState({ kind: "error", text: t("fontWeight.invalid") });
						return null;
					}
					// 没读到文档就不许写:base 为空时提交出去的是「只有本次动过的键」的残缺文档,
					// 而保存是**整份替换**存储 —— 会把用户其余设置一起抹掉(配置读取失败 / 还没读完
					// 就切编辑目标时会走到这里)。
					if (!docRef.current || typeof docRef.current !== "object") {
						setSaveState({ kind: "error", text: t("noDocument") });
						return null;
					}
					const base = docRef.current;
					const next = JSON.parse(JSON.stringify(base));
					const writeGroups = (holder) => {
						const phrases = holder.phrases && typeof holder.phrases === "object" ? holder.phrases : {};
						for (const loc of SETTINGS_LOCALES) {
							phrases[loc] = {};
							for (const phase of SETTINGS_PHASES) phrases[loc][phase] = parseWeightedLines(drafts[loc] ? drafts[loc][phase] : "");
						}
						holder.phrases = phrases;
					};
					const target = presetOf(next, targetPreset);
					const holder = target || next;
					// 编辑目标决定词库写进哪里:选中词库包时写包,否则写预设(无预设写顶层)
					const packTarget = packOf(next, targetPack);
					writeGroups(packTarget || holder);
					const badColorTokens = invalidColorList(gradientDraft.colors).concat(invalidColorList(gradientDraft.dayColors)).concat(invalidColorList(danmakuDraft.colors));
					if (badColorTokens.length > 0) {
						setSaveState({ kind: "error", text: t("gradient.invalidColor") + " " + badColorTokens.join(", ") });
						return null;
					}
					const gradientSpeed = Number(gradientDraft.speed);
					const gradientColors = parseColorList(gradientDraft.colors);
					const gradientDayColors = parseColorList(gradientDraft.dayColors);
					if (!Number.isFinite(gradientSpeed) || gradientSpeed <= 0 || gradientColors.length < 2 || gradientDayColors.length < 2) {
						setSaveState({ kind: "error", text: t("gradient.invalid") });
						return null;
					}
					// 标签页标题:开启时必须至少有一条模板;间隔必须是正数(0/负数会让轮换空转)
					const titleTemplates = parseLines(titleDraft.templates);
					const titleInterval = Number(titleDraft.intervalMs);
					if (!Number.isFinite(titleInterval) || titleInterval <= 0) {
						setSaveState({ kind: "error", text: t("title.invalidInterval") });
						return null;
					}
					if (titleDraft.enabled && titleTemplates.length === 0) {
						setSaveState({ kind: "error", text: t("title.invalidTemplate") });
						return null;
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
						setSaveState({ kind: "error", text: t("danmaku.invalid") });
						return null;
					}
					// 类型权重 + 顶部 / 底部样式:与运行时同一套范围校验,颜色 / 描边走白名单
					const dmWeights = [danmakuDraft.typeScrollWeight, danmakuDraft.typeTopWeight, danmakuDraft.typeBottomWeight].map(Number);
					const dmFixed = {
						fontSize: Number(danmakuDraft.fixedFontSize),
						marginTop: Number(danmakuDraft.fixedMarginTop),
						marginBottom: Number(danmakuDraft.fixedMarginBottom),
						gap: Number(danmakuDraft.fixedGap),
						durationMs: Number(danmakuDraft.fixedDurationMs),
						maxCount: Number(danmakuDraft.fixedMaxCount),
						zIndex: Number(danmakuDraft.fixedZIndex),
					};
					const dmFixedOutOfRange = Object.entries(DANMAKU_FIXED_LIMITS).some(([key, range]) => {
						const value = dmFixed[key];
						return !Number.isFinite(value) || value < range[0] || value > range[1];
					});
					if (dmFixedOutOfRange || !Number.isInteger(dmFixed.maxCount) || !Number.isInteger(dmFixed.zIndex) ||
						dmWeights.some((w) => !Number.isFinite(w) || w < DANMAKU_TYPE_WEIGHT[0] || w > DANMAKU_TYPE_WEIGHT[1]) ||
						!isSafeColorToken(danmakuDraft.fixedColor) || !isSafeShadow(danmakuDraft.fixedShadow)) {
						setSaveState({ kind: "error", text: t("danmaku.fixed.invalid") });
						return null;
					}
					holder.config = {
						...(holder.config && typeof holder.config === "object" ? holder.config : {}),
						...numbers,
						fontWeight: weight,
						weightedRandom: weighted,
						labelSource: normalizeLabelSource(basic.labelSource),
						// 标签页标题:关着也把模板留着(下次打开不用重写);enabled=false 时插件完全不碰 document.title
						title: {
							enabled: titleDraft.enabled === true,
							templates: titleTemplates,
							idleTemplate: String(titleDraft.idleTemplate || "").trim(),
							intervalMs: titleInterval,
						},
						gradient: {
							enabled: gradientDraft.enabled,
							mode: normalizeGradientMode(gradientDraft.mode),
							direction: normalizeGradientDirection(gradientDraft.direction),
							colors: gradientColors,
							dayColors: gradientDayColors,
							speed: gradientSpeed,
						},
						danmaku: {
							...(holder.config && holder.config.danmaku && typeof holder.config.danmaku === "object" ? holder.config.danmaku : {}),
							enabled: danmakuDraft.enabled,
							pauseBehindMask: danmakuDraft.pauseBehindMask !== false,
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
							// 类型标识:"" = 不强制(按权重分发),写 undefined 即不落盘,保持历史配置形状
							mode: danmakuDraft.mode === "scroll" || danmakuDraft.mode === "top" || danmakuDraft.mode === "bottom" ? danmakuDraft.mode : undefined,
							types: {
								scroll: { enabled: danmakuDraft.typeScroll, weight: dmWeights[0] },
								top: { enabled: danmakuDraft.typeTop, weight: dmWeights[1] },
								bottom: { enabled: danmakuDraft.typeBottom, weight: dmWeights[2] },
							},
							fixed: {
								fontSize: dmFixed.fontSize,
								color: danmakuDraft.fixedColor.trim(),
								shadow: danmakuDraft.fixedShadow.trim(),
								marginTop: dmFixed.marginTop,
								marginBottom: dmFixed.marginBottom,
								gap: dmFixed.gap,
								durationMs: dmFixed.durationMs,
								maxCount: Math.round(dmFixed.maxCount),
								zIndex: Math.round(dmFixed.zIndex),
								reserveBands: danmakuDraft.fixedReserveBands !== false,
								anchorBottomToHost: danmakuDraft.fixedAnchorBottom !== false,
								overflow: "drop",
							},
						},
					};
					const allPackIds = (Array.isArray(next.packs) ? next.packs : []).map((p) => p.id);
					if (allPackIds.length > 0 && packEnabled.length === allPackIds.length && allPackIds.every((id) => packEnabled.includes(id))) {
						// 全开 = 缺省语义,不写字段(等于"全部启用")
						delete next.enabledPacks;
					} else if (allPackIds.length === 0) {
						delete next.enabledPacks;
					} else {
						next.enabledPacks = packEnabled.slice();
					}
					next.schedule = scheduleDrafts.map((r) => ({ preset: r.preset, days: r.days.slice(), from: r.from, to: r.to }));
					const signature = editorSignature({ basic, weighted, gradientDraft, danmakuDraft, drafts, scheduleDrafts, packEnabled });
					const done = persist(() => next);
					// 落盘成功才更新基线;失败时保留 dirty,下一次改动会重试
					done.then(() => setBaseline(signature)).catch(() => {});
					return done;
				}, [basic, drafts, scheduleDrafts, gradientDraft, danmakuDraft, weighted, packEnabled, targetPreset, targetPack, persist, t]);

				/** 有未落盘的草稿就先落盘,返回写队列的完成 Promise */
				const flush = () => {
					if (dirty) commitDrafts();
					return writeChain.current;
				};

				/** 切换编辑目标:先落盘当前草稿,再灌入新目标的草稿,并把基线对齐到灌入值 */
				const switchTarget = (next) => {
					flush();
					setEditTargetBoth(next);
					const applied = applyDoc(docRef.current || doc, next);
					setBaseline(editorSignature({ ...applied, scheduleDrafts, packEnabled }));
				};

				/** 改即写盘:草稿变化后停顿 400ms 自动落盘,连续输入合并成一次写。
				 *  与基线相同则不写(重读后不会回写一遍),写盘失败也不会原地重试。 */
				react.useEffect(() => {
					if (baseline === "") return undefined;
					const signature = editorSignature({ basic, weighted, gradientDraft, danmakuDraft, drafts, scheduleDrafts, packEnabled });
					if (signature === baseline) return undefined;
					const timer = setTimeout(() => { commitDrafts(); }, 400);
					return () => clearTimeout(timer);
				}, [basic, weighted, gradientDraft, danmakuDraft, drafts, scheduleDrafts, packEnabled, baseline]);

				/** 设为当前预设:与其它改动一样走改即写盘 */
				const setCurrent = react.useCallback(() => {
					persist((next) => {
						next.activePreset = targetPreset || null;
						return next;
					});
				}, [persist, targetPreset]);

				/** 新建预设:先建一个沿用顶层词库的空壳预设,命名后即可编辑;创建即落盘 */
				const addPreset = () => {
					flush();
					let id = "";
					persist((next) => {
						const list = Array.isArray(next.presets) ? next.presets : [];
						let n = list.length + 1;
						while (list.some((p) => p && p.id === "preset-" + n)) n += 1;
						id = "preset-" + n;
						const name = t("preset.untitled");
						next.presets = list.concat([{ id, label: { zh: name, en: name } }]);
						return next;
					}).then(() => switchTarget("preset:" + id));
				};

				/** 重命名当前预设:只改当前编辑语言的名称,失焦即落盘 */
				const renamePreset = (name) => {
					if (!targetPreset) return;
					persist((next) => {
						const list = Array.isArray(next.presets) ? next.presets : [];
						next.presets = list.map((p) => {
							if (!p || p.id !== targetPreset) return p;
							const label = typeof p.label === "string"
								? { zh: p.label, en: p.label }
								: (p.label && typeof p.label === "object" ? p.label : {});
							return { ...p, label: { ...label, [editLang]: name } };
						});
						return next;
					});
				};

				/** 删除当前预设:一并清掉引用它的调度规则与「当前预设」,删除即落盘 */
				const removePreset = () => {
					if (!targetPreset) return;
					if (!window.confirm(t("preset.removeConfirm").replace("{name}", presetName))) return;
					const id = targetPreset;
					flush();
					persist((next) => {
						next.presets = (Array.isArray(next.presets) ? next.presets : []).filter((p) => !p || p.id !== id);
						next.schedule = (Array.isArray(next.schedule) ? next.schedule : []).filter((r) => !r || r.preset !== id);
						if (next.activePreset === id) next.activePreset = null;
						return next;
					}).then(() => {
						const nextSchedule = scheduleDrafts.filter((r) => r.preset !== id);
						setScheduleDrafts(nextSchedule);
						setEditTargetBoth("");
						const applied = applyDoc(docRef.current, "");
						setBaseline(editorSignature({ ...applied, scheduleDrafts: nextSchedule, packEnabled }));
					});
				};

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
				/** 只有首次加载锁 UI:改即写盘走后台队列,写盘期间不禁用输入,否则会打断打字 */
				const locked = loading;
				// ── 实时预览:设置弹窗是全屏遮罩,看不到真实状态行,这里按当前草稿
				//    现算一份(渐变/字重/弹幕色板),改一处立刻可见 ──
				// 预览按当前模式 + 宿主主题选色板,与运行时同一套判定
				const previewColors = resolveGradientColors({
					mode: gradientDraft.mode,
					colors: parseColorList(gradientDraft.colors),
					dayColors: parseColorList(gradientDraft.dayColors),
				}, isDarkTheme());
				const previewGradientOk = gradientDraft.enabled && previewColors.length >= 2;
				const previewSpeed = Number(gradientDraft.speed) > 0 ? Number(gradientDraft.speed) : 4;
				const previewWeight = basic.fontWeight === "inherit" || basic.fontWeight === "" ? undefined : basic.fontWeight;
				/** 预览样本:按 thinking → running → long 取当前语言第一条非空文案 */
				const previewSample = SETTINGS_PHASES
					.map((phase) => String(d[phase] || "").split(/\r?\n/).find((line) => line.trim().length > 0))
					.find((line) => typeof line === "string" && line.trim().length > 0);
				const previewText = (previewSample || t("preview.sample")).trim();
				const previewStyle = {
					fontWeight: previewWeight,
					...(previewGradientOk ? {
						backgroundImage: "linear-gradient(90deg, " + previewColors.join(", ") + ", " + previewColors[0] + ")",
						backgroundSize: "200% 100%",
						backgroundRepeat: "repeat-x",
						WebkitBackgroundClip: "text",
						backgroundClip: "text",
						color: "transparent",
						animation: "dsh-sr-preview-flow " + previewSpeed + "s linear infinite",
						animationDirection: gradientAnimationDirection(gradientDraft.direction),
					} : {}),
				};
				const previewPalette = (() => {
					const picked = parseColorList(danmakuDraft.colors);
					return picked.length > 0 ? picked : DEFAULT_CONFIG.danmaku.colors;
				})();
				const previewOpacity = danmakuDraft.enabled ? Math.min(1, Math.max(0.05, Number(danmakuDraft.opacity) || 0.3)) : 0;
				const previewBullets = ["preview.bullet1", "preview.bullet2", "preview.bullet3"].map((key, index) => ({
					text: t(key),
					style: {
						color: previewPalette[index % previewPalette.length],
						// 预览条只有 76px 高,字号压小一点、每条给不同周期,避免三条叠在一起
						fontSize: Math.round(Math.min(Number(danmakuDraft.fontSizeMin) || 14, 16) * (0.8 + index * 0.15)) + "px",
						opacity: previewOpacity,
						animationDelay: index * 1.2 + "s",
						animationDuration: 9 + index * 3 + "s",
					},
				}));
				/** 顶部 / 底部弹幕预览:与真实渲染同一套配置(居中、无背景块、四向描边) */
				const previewFixedColor = isSafeColorToken(danmakuDraft.fixedColor) ? danmakuDraft.fixedColor.trim() : DANMAKU_FIXED_DEFAULTS.color;
				const previewFixedShadow = isSafeShadow(danmakuDraft.fixedShadow) ? danmakuDraft.fixedShadow.trim() : DANMAKU_FIXED_DEFAULTS.shadow;
				// 炫彩开启时与真实渲染一致:从当前色板取色;关闭时用 fixed.color
				const previewFixedColorAt = (index) => (danmakuDraft.rainbow && previewPalette.length > 0
					? previewPalette[index % previewPalette.length]
					: previewFixedColor);
				const previewFixedBase = {
					textShadow: previewFixedShadow,
					// 预览条只有 76px 高,字号压一档,避免上下两条顶到一起
					fontSize: Math.round(Math.min(Number(danmakuDraft.fixedFontSize) || DANMAKU_FIXED_DEFAULTS.fontSize, 20) * 0.8) + "px",
					opacity: previewOpacity,
				};
				const previewFixedTopStyle = { ...previewFixedBase, color: previewFixedColorAt(0) };
				const previewFixedBottomStyle = { ...previewFixedBase, color: previewFixedColorAt(1) };
				const badColors = invalidColorList(gradientDraft.colors).concat(invalidColorList(danmakuDraft.colors));
				/** 预设下拉;allowNone=false 时不提供「默认(基础词库)」—— 定时规则必须绑定一个预设 */
				const presetOptions = (selected, onChange, allowNone = true) => {
					// 规则指向了已不存在的预设(手改过 config.json 时会出现):给个占位项,别显示成别的预设
					const unknown = !allowNone && !presets.some((p) => p.id === selected);
					return react.createElement("select", {
						className: "dsh-sr-select",
						value: selected,
						disabled: locked,
						onChange,
					},
						allowNone ? react.createElement("option", { value: "" }, t("preset.none")) : null,
						unknown ? react.createElement("option", { value: selected }, t("schedule.pickPreset")) : null,
						presets.map((p) => react.createElement("option", { key: p.id, value: p.id }, labelOf(p, editLang) || p.id))
					);
				};
				/** 添加定时规则:规则要绑定一个预设,没有预设就没有可选目标 */
				const addRule = () => {
					if (presets.length === 0) return;
					setScheduleDrafts((prev) => [...prev, { preset: presets[0].id, days: SCHEDULE_DAYS.slice(), from: "09:00", to: "18:00" }]);
				};
				/** 行内按钮(extraClass 追加 dsh-sr-btn-danger 等修饰) */
				const textBtn = (label, onClick, extraClass, disabled) => react.createElement("button", {
					type: "button",
					className: "dsh-sr-btn" + (extraClass ? " " + extraClass : ""),
					disabled: locked || !!disabled,
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
				/** 数值是否落在钳制范围内(与 lib/index.js 同口径,越界即标红) */
				const inRange = (value, range) => {
					const n = Number(value);
					if (!Number.isFinite(n)) return false;
					if (n === 0 && range[2] === true) return true;
					return n >= range[0] && n <= range[1];
				};
				/** 字段头:标签 + 「恢复默认」(仅当值已偏离默认值时出现) */
				const fieldHead = (labelKey, value, fallback, onReset) => react.createElement("div", { className: "dsh-sr-grouphead" },
					react.createElement("span", { className: "dsh-sr-label" }, t(labelKey)),
					String(value) === String(fallback) || locked
						? null
						: react.createElement("button", {
							type: "button",
							className: "dsh-sr-btn",
							disabled: locked,
							onClick: () => onReset(String(fallback)),
						}, t("reset"))
				);
				const basicField = (key, labelKey) => react.createElement("label", { key, className: "dsh-sr-field" },
					fieldHead(labelKey, basic[key], DEFAULT_CONFIG[key], (value) => setBasic((prev) => ({ ...prev, [key]: value }))),
					react.createElement("input", {
						className: "dsh-sr-input" + (inRange(basic[key], CONFIG_RANGES[key]) ? "" : " dsh-sr-input-invalid"),
						type: "number",
						value: basic[key],
						disabled: locked,
						onChange: (event) => setBasic((prev) => ({ ...prev, [key]: event.target.value })),
					})
				);
				/** 数字字段通用输入(绑定任意 {key: string} 草稿对象) */
				const numField = (state, setter, key, labelKey, range, fallback, step) => react.createElement("label", { key, className: "dsh-sr-field" },
					fieldHead(labelKey, state[key], fallback, (value) => setter((prev) => ({ ...prev, [key]: value }))),
					react.createElement("input", {
						className: "dsh-sr-input" + (inRange(state[key], range) ? "" : " dsh-sr-input-invalid"),
						type: "number",
						value: state[key],
						min: String(range[0]),
						step,
						disabled: locked,
						onChange: (event) => setter((prev) => ({ ...prev, [key]: event.target.value })),
					})
				);

				/** 当前预设名称(编辑目标落在预设上时供重命名输入框使用) */
				const presetName = targetPreset ? (labelOf(presetOf(doc, targetPreset), editLang) || targetPreset) : "";
				// 切换预设或重读后,用文档里的名称重置输入框草稿
				react.useEffect(() => { setPresetNameDraft(presetName); }, [presetName]);
				/** 编辑目标显示名(基础词库 / 预设名 / 词库包名) */
				const targetLabel = editTarget === ""
					? t("packs.target.base")
					: editTarget.startsWith("preset:")
						? (labelOf(presetOf(doc, targetPreset), editLang) || targetPreset)
						: (labelOf(packOf(doc, targetPack), editLang) || targetPack);
				/** 页面导航:一页四区(文案 / 外观 / 行为 / 自动化) */
				const PAGE_TABS = ["text", "appearance", "behavior", "schedule"];

				const tabBtn = (id) => react.createElement("button", {
					key: id,
					type: "button",
					role: "tab",
					"aria-selected": tab === id,
					className: "dsh-sr-tab" + (tab === id ? " dsh-sr-active" : ""),
					onClick: () => setTab(id),
				}, t("tab." + id));

				/** 弹幕类型行:开关 + 权重(权重 0 = 不再抽到该类型,mode 强制时不受权重影响) */
				const typeField = (mode) => {
					const enabledKey = mode === "scroll" ? "typeScroll" : mode === "top" ? "typeTop" : "typeBottom";
					const weightKey = enabledKey + "Weight";
					return react.createElement("label", { key: mode, className: "dsh-sr-field" },
						react.createElement("span", { className: "dsh-sr-label" }, t("danmaku.type." + mode)),
						react.createElement("div", { className: "dsh-sr-switchline" },
							toggle(danmakuDraft[enabledKey], (next) => setDanmakuDraft((prev) => ({ ...prev, [enabledKey]: next })), t("danmaku.type." + mode)),
							react.createElement("input", {
								className: "dsh-sr-input" + (inRange(danmakuDraft[weightKey], DANMAKU_RANGES.typeWeight) ? "" : " dsh-sr-input-invalid"),
								type: "number",
								min: "0",
								step: "1",
								value: danmakuDraft[weightKey],
								disabled: locked,
								"aria-label": t("danmaku.typeWeight"),
								onChange: (event) => setDanmakuDraft((prev) => ({ ...prev, [weightKey]: event.target.value })),
							})
						)
					);
				};
				
				return react.createElement("div", { className: "dsh-sr-settings" },
					react.createElement("h2", { className: "dsh-sr-title" }, t("title")),
					react.createElement("p", { className: "dsh-sr-intro" }, t("intro")),
					// 工具栏:重读 + 保存(主按钮在右)
					react.createElement("div", { className: "dsh-sr-grouphead" },
						// 只在写盘失败时提示;正常状态(改动即保存 / 保存中 / 已保存)不显示
						saveState.kind === "error" ? react.createElement("span", { className: "dsh-sr-status dsh-sr-error", role: "status" }, saveState.text) : null,
						react.createElement("div", { className: "dsh-sr-btnrow", style: { marginLeft: "auto" } },
							textBtn(t("reload"), () => { flush().then(() => load()); })
						)
					),
					hasOverride ? react.createElement("p", { className: "dsh-sr-warning", role: "status" }, t("overrideWarning")) : null,
					loadError ? react.createElement("p", { className: "dsh-sr-error", role: "alert" }, t("loadError") + ": " + loadError) : null,
					// 页面导航:与官方设置页同一套 tab 视觉
					react.createElement("div", { className: "dsh-sr-tabs", role: "tablist" }, PAGE_TABS.map(tabBtn)),
					// ── 文案:编辑目标 → 语言 × 阶段 → 词库包 → 预设 ──
					tab === "text" ? react.createElement("div", { className: "dsh-sr-panel", role: "tabpanel" },
						// 实时预览:编辑文案时第一屏就能看到状态行与弹幕的实际样子
						react.createElement("section", { className: "dsh-sr-group" },
							react.createElement("div", { className: "dsh-sr-grouphead" },
								react.createElement("h3", null, t("preview")),
								react.createElement("span", { className: "dsh-sr-muted" }, t("preview.hint"))
							),
							badColors.length > 0
								? react.createElement("p", { className: "dsh-sr-error" }, t("gradient.invalidColor") + " " + badColors.join(", "))
								: null,
							react.createElement("div", { className: "dsh-sr-previewRow" },
								react.createElement("span", { className: "dsh-sr-previewText", style: previewStyle }, previewText),
								react.createElement("span", { className: "dsh-sr-previewClock" }, "00:15")
							),
							react.createElement("div", { className: "dsh-sr-previewDanmaku" },
								previewBullets.map((bullet, index) => react.createElement("span", {
									key: index,
									className: "dsh-sr-previewBullet",
									style: bullet.style,
								}, bullet.text)),
								react.createElement("span", { key: "top", className: "dsh-sr-previewTop", style: previewFixedTopStyle }, t("preview.top")),
								react.createElement("span", { key: "bottom", className: "dsh-sr-previewBottom", style: previewFixedBottomStyle }, t("preview.bottom"))
							)
						),
						// 文案来源:轮换短语库(默认)/ 只用宿主原文(0.1.6 观感 —— 位置与样式都照旧版)
						react.createElement("section", { className: "dsh-sr-group" },
							react.createElement("div", { className: "dsh-sr-grouphead" },
								react.createElement("h3", null, t("labelSource"))
							),
							react.createElement("label", { className: "dsh-sr-field" },
								react.createElement("span", { className: "dsh-sr-label" }, t("labelSource")),
								react.createElement("select", {
									className: "dsh-sr-select",
									value: basic.labelSource,
									disabled: locked,
									onChange: (event) => setBasic((prev) => ({ ...prev, labelSource: event.target.value })),
								},
									["phrases", "host"].map((v) =>
										react.createElement("option", { key: v, value: v }, t("labelSource." + v))
									)
								)
							),
							react.createElement("p", { className: "dsh-sr-hint" }, t("labelSource.hint"))
						),
						react.createElement("section", { className: "dsh-sr-group" },
							react.createElement("div", { className: "dsh-sr-grouphead" },
								react.createElement("h3", null, t("library")),
								react.createElement("span", { className: "dsh-sr-muted" },
									t("packs.editing").replace("{name}", targetLabel))
							),
							react.createElement("label", { className: "dsh-sr-field" },
								react.createElement("span", { className: "dsh-sr-label" }, t("packs.editTarget")),
								react.createElement("select", {
									className: "dsh-sr-select",
									value: editTarget,
									disabled: locked,
									onChange: (event) => switchTarget(event.target.value),
								},
									react.createElement("option", { value: "" }, t("packs.target.base")),
									presets.length > 0 ? react.createElement("optgroup", { key: "optgroup-preset", label: t("preset") },
										presets.map((p) => react.createElement("option", { key: p.id, value: "preset:" + p.id }, labelOf(p, editLang) || p.id))
									) : null,
									packs.length > 0 ? react.createElement("optgroup", { key: "optgroup-pack", label: t("packs") },
										packs.map((p) => react.createElement("option", { key: p.id, value: "pack:" + p.id }, labelOf(p, editLang) || p.id))
									) : null
								)
							),
							react.createElement("div", { className: "dsh-sr-tabs dsh-sr-subtabs" },
								SETTINGS_LOCALES.map((code) => react.createElement("button", {
									key: code,
									type: "button",
									className: "dsh-sr-tab" + (lang === code ? " dsh-sr-active" : ""),
									disabled: locked,
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
									disabled: locked,
									onChange: (event) => setDrafts((prev) => ({ ...prev, [loc]: { ...prev[loc], [phase]: event.target.value } })),
								})
							)),
							react.createElement("p", { className: "dsh-sr-foot" }, t("hint"))
						),
						react.createElement("section", { className: "dsh-sr-group" },
							react.createElement("div", { className: "dsh-sr-grouphead" },
								react.createElement("h3", null, t("packs")),
								react.createElement("span", { className: "dsh-sr-muted" },
									t("packs.enabledCount").replace("{n}", String(packs.length)).replace("{m}", String(packEnabled.length)))
							),
							packs.length === 0
								? react.createElement("p", { className: "dsh-sr-hint" }, t("packs.none"))
								: packs.map((pack) => {
									const pid = pack.id;
									const enabled = packEnabled.includes(pid);
									return react.createElement("div", { key: pid, className: "dsh-sr-switchline" },
										toggle(enabled, (next) => setPackEnabled((prev) => (next ? [...new Set([...prev, pid])] : prev.filter((x) => x !== pid))), t("packs.enabled")),
										react.createElement("span", { className: "dsh-sr-label", style: { flex: 1 } }, labelOf(pack, editLang) || pid),
										react.createElement("span", { className: "dsh-sr-muted" }, t("pack.items").replace("{n}", String(packSize(pack))))
									);
								}),
							react.createElement("p", { className: "dsh-sr-hint" }, t("packs.hint"))
						),
						react.createElement("section", { className: "dsh-sr-group" },
							react.createElement("div", { className: "dsh-sr-grouphead" },
								react.createElement("h3", null, t("preset")),
								react.createElement("span", { className: "dsh-sr-muted" }, t("preset.current").replace("{name}", currentLabel))
							),
							react.createElement("div", { className: "dsh-sr-btnrow" },
								presetOptions(targetPreset, (event) => switchTarget(event.target.value ? "preset:" + event.target.value : "")),
								textBtn(t("preset.set"), setCurrent, "", !targetPreset),
								textBtn(t("preset.add"), addPreset),
								textBtn(t("preset.remove"), removePreset, "dsh-sr-btn-danger", !targetPreset)
							),
							targetPreset ? react.createElement("label", { className: "dsh-sr-field" },
								react.createElement("span", { className: "dsh-sr-label" }, t("preset.name")),
								react.createElement("input", {
									className: "dsh-sr-input",
									type: "text",
									value: presetNameDraft,
									spellCheck: false,
									disabled: locked,
									onChange: (event) => setPresetNameDraft(event.target.value),
									onBlur: () => { if (presetNameDraft !== presetName) renamePreset(presetNameDraft); },
								})
							) : null,
							react.createElement("p", { className: "dsh-sr-hint" }, t("preset.hint"))
						)
					) : null,
					// ── 外观:预览 + 字重 + 渐变 + 弹幕 ──
					tab === "appearance" ? react.createElement("div", { className: "dsh-sr-panel", role: "tabpanel" },
						react.createElement("section", { className: "dsh-sr-group" },
							react.createElement("div", { className: "dsh-sr-grouphead" },
								react.createElement("h3", null, t("textStyle"))
							),
							react.createElement("label", { className: "dsh-sr-field" },
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
							)
						),
						react.createElement("section", { className: "dsh-sr-group" },
							react.createElement("div", { className: "dsh-sr-grouphead" },
								react.createElement("h3", null, t("gradient")),
								toggle(gradientDraft.enabled, (next) => setGradientDraft((prev) => ({ ...prev, enabled: next })), t("gradient.enabled"))
							),
							react.createElement("div", { className: "dsh-sr-grid" },
								react.createElement("label", { className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("gradient.mode")),
									react.createElement("select", {
										className: "dsh-sr-select",
										value: gradientDraft.mode,
										disabled: locked,
										onChange: (event) => setGradientDraft((prev) => ({ ...prev, mode: event.target.value })),
									},
										GRADIENT_MODES.map((m) => react.createElement("option", { key: m, value: m }, t("gradient.mode." + m)))
									)
								),
								react.createElement("label", { className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("gradient.direction")),
									react.createElement("select", {
										className: "dsh-sr-select",
										value: gradientDraft.direction,
										disabled: locked,
										onChange: (event) => setGradientDraft((prev) => ({ ...prev, direction: event.target.value })),
									},
										GRADIENT_DIRECTIONS.map((dir) => react.createElement("option", { key: dir, value: dir }, t("gradient.direction." + dir)))
									)
								),
								react.createElement("label", { className: "dsh-sr-field" },
									fieldHead("gradient.speed", gradientDraft.speed, DEFAULT_CONFIG.gradient.speed, (value) => setGradientDraft((prev) => ({ ...prev, speed: value }))),
									react.createElement("input", {
										className: "dsh-sr-input" + (inRange(gradientDraft.speed, [0.5, 120, false]) ? "" : " dsh-sr-input-invalid"),
										type: "number",
										value: gradientDraft.speed,
										min: "0.5",
										step: "0.5",
										disabled: locked,
										onChange: (event) => setGradientDraft((prev) => ({ ...prev, speed: event.target.value })),
									})
								)
							),
							react.createElement("div", { className: "dsh-sr-grid" },
								react.createElement("label", { className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("gradient.colors")),
									react.createElement("input", {
										className: "dsh-sr-input" + (invalidColorList(gradientDraft.colors).length > 0 ? " dsh-sr-input-invalid" : ""),
										type: "text",
										value: gradientDraft.colors,
										spellCheck: false,
										disabled: locked,
										onChange: (event) => setGradientDraft((prev) => ({ ...prev, colors: event.target.value })),
									})
								),
								react.createElement("label", { className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("gradient.dayColors")),
									react.createElement("input", {
										className: "dsh-sr-input" + (invalidColorList(gradientDraft.dayColors).length > 0 ? " dsh-sr-input-invalid" : ""),
										type: "text",
										value: gradientDraft.dayColors,
										spellCheck: false,
										disabled: locked,
										onChange: (event) => setGradientDraft((prev) => ({ ...prev, dayColors: event.target.value })),
									})
								)
							),
							react.createElement("p", { className: "dsh-sr-hint" }, t("gradient.mode.hint")),
							react.createElement("p", { className: "dsh-sr-hint" }, t("gradient.direction.hint"))
						),
						react.createElement("section", { className: "dsh-sr-group" },
							react.createElement("div", { className: "dsh-sr-grouphead" },
								react.createElement("h3", null, t("danmaku")),
								toggle(danmakuDraft.enabled, (next) => setDanmakuDraft((prev) => ({ ...prev, enabled: next })), t("danmaku.enabled"))
							),
							react.createElement("div", { className: "dsh-sr-grid" },
								numField(danmakuDraft, setDanmakuDraft, "intervalMs", "danmaku.intervalMs", DANMAKU_RANGES.intervalMs, DEFAULT_CONFIG.danmaku.intervalMs, "100"),
								numField(danmakuDraft, setDanmakuDraft, "speedMs", "danmaku.speedMs", DANMAKU_RANGES.speedMs, DEFAULT_CONFIG.danmaku.speedMs, "1000"),
								numField(danmakuDraft, setDanmakuDraft, "fontSizeMin", "danmaku.fontSizeMin", DANMAKU_RANGES.fontSizeMin, DEFAULT_CONFIG.danmaku.fontSizeMin, "1"),
								numField(danmakuDraft, setDanmakuDraft, "fontSizeMax", "danmaku.fontSizeMax", DANMAKU_RANGES.fontSizeMax, DEFAULT_CONFIG.danmaku.fontSizeMax, "1"),
								numField(danmakuDraft, setDanmakuDraft, "opacity", "danmaku.opacity", DANMAKU_RANGES.opacity, DEFAULT_CONFIG.danmaku.opacity, "0.05"),
								numField(danmakuDraft, setDanmakuDraft, "maxCount", "danmaku.maxCount", DANMAKU_RANGES.maxCount, DEFAULT_CONFIG.danmaku.maxCount, "1"),
								numField(danmakuDraft, setDanmakuDraft, "zIndex", "danmaku.zIndex", DANMAKU_RANGES.zIndex, DEFAULT_CONFIG.danmaku.zIndex, "1")
							),
							react.createElement("div", { className: "dsh-sr-grid" },
								react.createElement("label", { className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("danmaku.colors")),
									react.createElement("input", {
										className: "dsh-sr-input" + (invalidColorList(danmakuDraft.colors).length > 0 ? " dsh-sr-input-invalid" : ""),
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
							/** ── 类型分发:滚动(原有) / 顶部 / 底部 ── */
							react.createElement("div", { className: "dsh-sr-grouphead" },
								react.createElement("h3", null, t("danmaku.types")),
								react.createElement("span", { className: "dsh-sr-muted" }, t("danmaku.types.hint"))
							),
							react.createElement("div", { className: "dsh-sr-grid" },
								typeField("scroll"),
								typeField("top"),
								typeField("bottom")
							),
							react.createElement("label", { className: "dsh-sr-field" },
								react.createElement("span", { className: "dsh-sr-label" }, t("danmaku.mode")),
								react.createElement("select", {
									className: "dsh-sr-select",
									value: danmakuDraft.mode,
									disabled: locked,
									onChange: (event) => setDanmakuDraft((prev) => ({ ...prev, mode: event.target.value })),
								},
									["", "scroll", "top", "bottom"].map((m) => react.createElement("option", { key: m === "" ? "auto" : m, value: m }, m === "" ? t("danmaku.mode.auto") : t("danmaku.type." + m)))
								)
							),
							/** ── 顶部 / 底部弹幕样式(集中默认值 DANMAKU_FIXED_DEFAULTS,数值 [待确认]) ── */
							react.createElement("div", { className: "dsh-sr-grouphead" },
								react.createElement("h3", null, t("danmaku.fixed")),
								react.createElement("span", { className: "dsh-sr-muted" }, t("danmaku.fixed.hint"))
							),
							react.createElement("div", { className: "dsh-sr-grid" },
								numField(danmakuDraft, setDanmakuDraft, "fixedFontSize", "danmaku.fixed.fontSize", DANMAKU_RANGES.fixedFontSize, DANMAKU_FIXED_DEFAULTS.fontSize, "1"),
								numField(danmakuDraft, setDanmakuDraft, "fixedMarginTop", "danmaku.fixed.marginTop", DANMAKU_RANGES.fixedMarginTop, DANMAKU_FIXED_DEFAULTS.marginTop, "1"),
								numField(danmakuDraft, setDanmakuDraft, "fixedMarginBottom", "danmaku.fixed.marginBottom", DANMAKU_RANGES.fixedMarginBottom, DANMAKU_FIXED_DEFAULTS.marginBottom, "1"),
								numField(danmakuDraft, setDanmakuDraft, "fixedGap", "danmaku.fixed.gap", DANMAKU_RANGES.fixedGap, DANMAKU_FIXED_DEFAULTS.gap, "1"),
								numField(danmakuDraft, setDanmakuDraft, "fixedDurationMs", "danmaku.fixed.durationMs", DANMAKU_RANGES.fixedDurationMs, DANMAKU_FIXED_DEFAULTS.durationMs, "100"),
								numField(danmakuDraft, setDanmakuDraft, "fixedMaxCount", "danmaku.fixed.maxCount", DANMAKU_RANGES.fixedMaxCount, DANMAKU_FIXED_DEFAULTS.maxCount, "1"),
								numField(danmakuDraft, setDanmakuDraft, "fixedZIndex", "danmaku.fixed.zIndex", DANMAKU_RANGES.fixedZIndex, DANMAKU_FIXED_DEFAULTS.zIndex, "1")
							),
							react.createElement("div", { className: "dsh-sr-grid" },
								react.createElement("label", { className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("danmaku.fixed.color")),
									react.createElement("input", {
										className: "dsh-sr-input" + (isSafeColorToken(danmakuDraft.fixedColor) ? "" : " dsh-sr-input-invalid"),
										type: "text",
										value: danmakuDraft.fixedColor,
										spellCheck: false,
										disabled: locked,
										onChange: (event) => setDanmakuDraft((prev) => ({ ...prev, fixedColor: event.target.value })),
									})
								),
								react.createElement("label", { className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("danmaku.fixed.shadow")),
									react.createElement("input", {
										className: "dsh-sr-input" + (isSafeShadow(danmakuDraft.fixedShadow) ? "" : " dsh-sr-input-invalid"),
										type: "text",
										value: danmakuDraft.fixedShadow,
										spellCheck: false,
										disabled: locked,
										onChange: (event) => setDanmakuDraft((prev) => ({ ...prev, fixedShadow: event.target.value })),
									})
								)
							),
							react.createElement("div", { className: "dsh-sr-switchline" },
								toggle(danmakuDraft.fixedReserveBands, (next) => setDanmakuDraft((prev) => ({ ...prev, fixedReserveBands: next })), t("danmaku.fixed.reserveBands")),
								react.createElement("span", { className: "dsh-sr-label" }, t("danmaku.fixed.reserveBands"))
							),
							react.createElement("div", { className: "dsh-sr-switchline" },
								toggle(danmakuDraft.fixedAnchorBottom, (next) => setDanmakuDraft((prev) => ({ ...prev, fixedAnchorBottom: next })), t("danmaku.fixed.anchorBottom")),
								react.createElement("span", { className: "dsh-sr-label" }, t("danmaku.fixed.anchorBottom"))
							),
							react.createElement("div", { className: "dsh-sr-switchline" },
								toggle(danmakuDraft.pauseBehindMask !== false, (next) => setDanmakuDraft((prev) => ({ ...prev, pauseBehindMask: next })), t("danmaku.pauseBehindMask")),
								react.createElement("span", { className: "dsh-sr-label" }, t("danmaku.pauseBehindMask"))
							),
							react.createElement("p", { className: "dsh-sr-hint" }, t("danmaku.hint"))
						)
					) : null,
					// ── 行为:轮换与输出 ──
					tab === "behavior" ? react.createElement("div", { className: "dsh-sr-panel", role: "tabpanel" },
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
								react.createElement("label", { key: "weightedRandom", className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("basic.weightedRandom")),
									react.createElement("div", { className: "dsh-sr-switchline" },
										toggle(weighted, setWeighted, t("basic.weightedRandom")),
										react.createElement("span", { className: "dsh-sr-hint" }, t("basic.weightedRandomHint"))
									)
								)
							)
						),
						// ── 标签页标题:可开关 / 可改文案(默认关闭;关着时插件完全不碰 document.title) ──
						react.createElement("section", { className: "dsh-sr-group" },
							react.createElement("div", { className: "dsh-sr-grouphead" },
								react.createElement("h3", null, t("title")),
								react.createElement("span", { className: "dsh-sr-muted" }, t("titleDesc"))
							),
							react.createElement("div", { className: "dsh-sr-grid" },
								react.createElement("label", { key: "titleEnabled", className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("title.enabled")),
									react.createElement("div", { className: "dsh-sr-switchline" },
										toggle(titleDraft.enabled, (next) => setTitleDraft((prev) => ({ ...prev, enabled: next })), t("title.enabled")),
										react.createElement("span", { className: "dsh-sr-hint" }, t("title.enabledHint"))
									)
								),
								react.createElement("label", { key: "titleIntervalMs", className: "dsh-sr-field" },
									fieldHead("title.intervalMs", titleDraft.intervalMs, String(DEFAULT_CONFIG.title.intervalMs), (value) => setTitleDraft((prev) => ({ ...prev, intervalMs: value }))),
									react.createElement("input", {
										className: "dsh-sr-input" + (Number(titleDraft.intervalMs) > 0 ? "" : " dsh-sr-input-invalid"),
										type: "number",
										value: titleDraft.intervalMs,
										disabled: locked || !titleDraft.enabled,
										onChange: (event) => setTitleDraft((prev) => ({ ...prev, intervalMs: event.target.value })),
									})
								)
							),
							react.createElement("div", { key: "titleTemplates", className: "dsh-sr-field" },
								react.createElement("div", { className: "dsh-sr-grouphead" },
									react.createElement("span", { className: "dsh-sr-label" }, t("title.templates")),
									react.createElement("span", { className: "dsh-sr-muted" }, t("count").replace("{n}", String(parseLines(titleDraft.templates).length)))
								),
								react.createElement("textarea", {
									className: "dsh-sr-textarea",
									value: titleDraft.templates,
									spellCheck: false,
									disabled: locked || !titleDraft.enabled,
									onChange: (event) => setTitleDraft((prev) => ({ ...prev, templates: event.target.value })),
								})
							),
							react.createElement("label", { key: "titleIdleTemplate", className: "dsh-sr-field" },
								react.createElement("span", { className: "dsh-sr-label" }, t("title.idleTemplate")),
								react.createElement("input", {
									className: "dsh-sr-input",
									type: "text",
									value: titleDraft.idleTemplate,
									disabled: locked || !titleDraft.enabled,
									placeholder: t("title.idlePlaceholder"),
									onChange: (event) => setTitleDraft((prev) => ({ ...prev, idleTemplate: event.target.value })),
								})
							),
							react.createElement("p", { className: "dsh-sr-foot" }, t("title.hint"))
						)
					) : null,
					// ── 自动化:时段调度 ──
					tab === "schedule" ? react.createElement("div", { className: "dsh-sr-panel", role: "tabpanel" },
						react.createElement("section", { className: "dsh-sr-group" },
							react.createElement("div", { className: "dsh-sr-grouphead" },
								react.createElement("h3", null, t("schedule")),
								textBtn(t("schedule.add"), addRule, "", presets.length === 0)
							),
							scheduleDrafts.length === 0
								? react.createElement("p", { className: "dsh-sr-empty" }, presets.length === 0 ? t("schedule.noPreset") : t("schedule.none"))
								: scheduleDrafts.map((row, idx) => react.createElement("div", { key: idx, className: "dsh-sr-rule" },
									presetOptions(row.preset, (event) => updateRow(idx, { preset: event.target.value }), false),
									react.createElement("div", { className: "dsh-sr-chips" },
										SCHEDULE_DAYS.map((day) => react.createElement("button", {
											key: day,
											type: "button",
											className: "dsh-sr-chip" + (row.days.includes(day) ? " dsh-sr-on" : ""),
											disabled: locked,
											"aria-pressed": row.days.includes(day),
											"aria-label": t("schedule.days") + " " + t("day." + day),
											onClick: () => updateRow(idx, { days: row.days.includes(day) ? row.days.filter((x) => x !== day) : [...row.days, day] }),
										}, t("day." + day)))
									),
									react.createElement("div", { className: "dsh-sr-ruleTime" },
										react.createElement("input", {
											className: "dsh-sr-input",
											type: "time",
											value: row.from,
											disabled: locked,
											"aria-label": t("schedule.from"),
											onChange: (event) => updateRow(idx, { from: event.target.value }),
										}),
										react.createElement("span", { className: "dsh-sr-muted" }, "-"),
										react.createElement("input", {
											className: "dsh-sr-input",
											type: "time",
											value: row.to,
											disabled: locked,
											"aria-label": t("schedule.to"),
											onChange: (event) => updateRow(idx, { to: event.target.value }),
										})
									),
									textBtn(t("schedule.remove"), () => setScheduleDrafts((prev) => prev.filter((_, i) => i !== idx)), "dsh-sr-btn-danger")
								)),
							react.createElement("p", { className: "dsh-sr-hint" }, t("schedule.hint"))
						)
					) : null,
					// 页脚:仓库链接(设置页最底部)
					react.createElement("footer", { className: "dsh-sr-footer" },
						react.createElement("a", {
							className: "dsh-sr-repolink",
							href: REPO_URL,
							target: "_blank",
							rel: "noreferrer noopener"
						}, t("footer.repo"))
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

			// dsh 的 ctx.effect 会「立即执行」回调,并把回调的「返回值」当作卸载时的
			// 清理函数注册。因此清理逻辑必须包在返回的函数里,否则 apply 一结束
			// 观察器和定时器就被立刻拆掉,文本替换永远不会生效。
			ctx.effect(() => {
				return () => {
					unsubscribe();
					document.removeEventListener("visibilitychange", onVisibility);
					window.removeEventListener("pageshow", onPageShow);
					observer.disconnect();
					sourceObserver.disconnect();
					if (timer !== null) clearInterval(timer);
					if (rescanner !== null) clearInterval(rescanner);
					if (reloadTimer !== null) clearInterval(reloadTimer);
					if (titleTimer !== null) clearInterval(titleTimer);
					if (titleLiveTimer !== null) clearInterval(titleLiveTimer);
					if (scheduleTimer !== null) clearInterval(scheduleTimer);
					if (liveEngineTimer !== null) clearInterval(liveEngineTimer);
					if (liveSessionUnsub) { try { liveSessionUnsub(); } catch (error) { /* ignore */ } }
					if (liveEventsUnsub) { try { liveEventsUnsub(); } catch (error) { /* ignore */ } }
					if (liveListUnsub) { try { liveListUnsub(); } catch (error) { /* ignore */ } }
					if (pendingUnsub) { try { pendingUnsub(); } catch (error) { /* ignore */ } }
					for (const state of typists.values()) {
						if (state.timer !== null) clearInterval(state.timer);
					}
					for (const live of liveTimers.values()) clearInterval(live);
					if (danmakuMaskProbeTimer !== null) {
						clearTimeout(danmakuMaskProbeTimer);
						danmakuMaskProbeTimer = null;
					}
					// 卸载时只交还「我们自己写上去的」标题;没持有过就别碰(见 updateTitle)
					if (titleOwned) {
						titleOwned = false;
						if (origTitle && document.title !== origTitle) document.title = origTitle;
					}
					teardownDanmaku();
					if (styleEl !== null && styleEl.isConnected) styleEl.remove();
					if (settingsStyleEl !== null && settingsStyleEl.isConnected) settingsStyleEl.remove();
					if (danmakuStyleEl !== null && danmakuStyleEl.isConnected) danmakuStyleEl.remove();
					// 0.1.7 状态行:撤掉插件那行、把折叠头放出来
					for (const line of Array.from(lineButtons.keys())) releaseStatusLine(line);
					for (const el of adopted) {
						try {
							el.style.removeProperty("min-width");
							el.classList.remove(HOST_CLASS, HOST_GRADIENT_CLASS);
							unwrapText(el);
						} catch (error) { /* ignore */ }
					}
					if (layoutStyleEl.isConnected) layoutStyleEl.remove();
					adopted.clear();
					typists.clear();
					lastPicks.clear();
					liveTimers.clear();
					liveTemplates.clear();
				};
			}, "status-rotator: label rotation");
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		// 仅供 smoke test(scripts/smoke-test.cjs)引用的纯函数;运行时无副作用
		exports.__test = {
			interpolate,
			DEFAULT_CONFIG,
			isDynamicTemplate,
			titleWritePlan,
			normalizeEntry,
			entryText,
			entryWeight,
			pickWeighted,
			uniformPick,
			parseWeightedLines,
			LABEL_SOURCES,
			normalizeLabelSource,
			labelPlanFor,
			phraseLines,
			normalizeGroups,
			normalizeTable,
			normalizeConfig,
			normalizePresets,
			normalizePacks,
			mergeGroups,
			mergePackChain,
			normalizeSchedule,
			matchSchedule,
			formatElapsed,
			parseClock,
			parseExternal,
			extractModel,
			pickModel,
			extractSnapshot,
			pendingCountOf,
			formatPending,
			parseColorList,
			splitColorList,
			invalidColorList,
			isSafeColorToken,
			GRADIENT_MODES,
			normalizeGradientMode,
			resolveGradientColors,
			GRADIENT_DIRECTIONS,
			normalizeGradientDirection,
			gradientAnimationDirection,
			gradientTextCss,
			CONFIG_LIMITS,
			DANMAKU_LIMITS,
			danmakuPool,
			danmakuMountPlan,
			danmakuNeedsRemount,
			isOpaqueBackgroundColor,
			danmakuPanelFits,
			hasBackdropFilter,
			danmakuMaskOverlayHit,
			DANMAKU_MASK_PROBE_MS,
			randInt,
			danmakuFontSpan,
			danmakuModeToken,
			normalizeDanmakuMode,
			pickDanmakuMode,
			danmakuFreeLane,
			danmakuLaneOffset,
			danmakuScrollBand,
			danmakuStackFits,
			isSafeShadow,
			DANMAKU_MODES,
			DANMAKU_FIXED_DEFAULTS,
			DANMAKU_FIXED_LIMITS,
			resolveDiveLabel,
			matchesDiveText,
			resolveDiveDurationPrefix,
			matchDiveLabel,
			retryStateFromEntries,
			retryBadgeText,
			safeObservationToken,
		};
		return module.exports;
	}
});
