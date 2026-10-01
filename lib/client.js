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
			/**
			 * 反重复(洗牌袋):同一「语言 + 相位」下,袋里的句子抽完之前不会重复;
			 * 袋子抽空重开时先剔掉最近 recentLimit 条,保证跨袋也不撞上一句。
			 *   recentLimit  0~50(0 = 只靠袋子,不做跨袋记忆)
			 *   persist      true = 把记忆写进 localStorage,刷新页面后也不立刻重复
			 */
			antiRepeat: {
				recentLimit: 3,
				persist: false,
			},
			/**
			 * 外观(视觉主题化)。**默认值全是"什么都不改"**:没有这个块的旧配置升级后
			 * 观感与之前完全一致;主题包画廊(设置页「外观」)一次改写这里的几个值 + gradient。
			 */
			appearance: {
				fontFamily: "",
				fontSize: 0,
				glow: false,
				glowColor: "",
				animation: "none",
				spinner: "none",
			},
			/** 诊断日志开关 */
			debug: false,
			/**
			 * 保留宿主的「鲸鱼尾巴」(dsh 0.2.0 运行行里那个 14px 的 DeepSeek 尾巴图标)并让它跟着炫彩。
			 * false(默认)= 插件接管时把整行(含尾巴)藏掉,只显示自己的文案行;
			 * true = 尾巴留着,和插件文案同一行,并用 gradient 的色板做流光(尾巴 SVG 的 stroke 是
			 * currentColor,所以动画 color 即可);gradient 关着时尾巴保持宿主原色。
			 */
			whaleTail: false,
			/** Wagging is opt-in so existing installs keep their current appearance. */
			whaleTailMotion: {
				enabled: false,
				mode: "tps",
				/** wag / sway / twist / random; existing installs retain the original wag. */
				animation: "wag",
				toolSwitchEnabled: false,
				toolSwitchChance: 0.35,
				/** Full back-and-forth cycles per second when mode is fixed. */
				fixedSpeed: 1.5,
			},
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
				/**
				 * ── V4 交互增强:这五项默认全关 ──
				 * 前两项会让弹幕层从「不拦截指针」变成「拦截指针」,与 README 的承诺相反,
				 * 所以必须显式打开;后三项只影响观感,默认关 = 升级后观感与之前一致。
				 */
				/** 鼠标悬停在某颗弹幕上时把它冻住(移开继续飞) */
				hoverPause: false,
				/** 点击弹幕复制它的文案 */
				clickCopy: false,
				/** 按相位分色:{ thinking, running, long } → 颜色;null = 不用 */
				phaseColors: null,
				/** 密度自适应:同屏越接近上限发得越稀,页面不可见时几乎不发 */
				adaptDensity: false,
				/** 鼠标避让:落点避开指针所在的高度带 */
				avoidPointer: false,
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

		/**
		 * 样式归属 id:与包名一致。宿主自带的客户端插件也是用包名声明归属
		 * (例如 `dataset.plugin = "@deepseek-ai/dsh-client-locale"`)。
		 */
		const STYLE_OWNER_ID = "dsh-status-rotator";
		/**
		 * 建一个**已声明归属**的 `<style>`(issue #94)。
		 *
		 * 为什么要建完就声明:宿主模块系统在**工厂体跑完之后**才认领样式 ——
		 * `@deepseek-ai/dsh-client-modules` 的 `claimStyles(id)` 会把当下所有没有 `data-plugin`
		 * 的 `<style>` 统统标成自己的,并在**自己 revision 变化**时用 `removeOwnedStyles(id)`
		 * 删掉名下的标签。于是归属由时间顺序决定:谁后物化谁把这些无主标签认走,之后它一变更,
		 * 插件的样式就跟着消失(症状:设置页整套样式没了,重启有时又好 —— 间歇性)。
		 * 打了标记的标签不会被任何模块认领(宿主注释里写明「pre-tagged 的标签不会被认领」),
		 * 所以每个 `<style>` 都必须建完立刻打上。
		 */
		const createOwnedStyle = (id) => {
			const el = document.createElement("style");
			if (id) el.id = id;
			el.setAttribute("data-plugin", STYLE_OWNER_ID);
			return el;
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
/** N1:服务端推送通道(SSE)。老宿主没有这条路由时 EventSource 连不上,自动回落轮询。 */
const EVENTS_URL = "/plugins/dsh-status-rotator/events";
		/** 仓库地址(设置页最底部的链接) */
		const REPO_URL = "https://github.com/01Virex/dsh-status-rotator";

		const PHASE_THINKING = "thinking";
		const PHASE_RUNNING = "running";
		const PHASE_LONG = "long";

		

		// ══ 纯工具函数 ══

		/** `when` 规则里允许的键(全部可选;同时给出时必须**全部**成立) */
		const WHEN_KEYS = ["tool", "retry", "pending", "phase", "hour", "firstTurn"];
		/** tool 条件的通配:任意工具在跑 */
		const WHEN_ANY_TOOL = "*";
		/** 相位取值(含 idle,便于写「空闲时才出」的彩蛋句) */
		const WHEN_PHASES = [PHASE_THINKING, PHASE_RUNNING, PHASE_LONG, "idle"];

		/**
		 * 归一化一条 `when` 规则:未知键与非法值一律丢弃;一条可用条件都不剩时返回 null
		 * (调用方据此把条目当成无条件条目,而不是当成「永远不成立」把整句藏起来)。
		 *
		 *   tool      "bash" | ["bash","web_search"] | "*"(任意工具在跑)
		 *   retry     true / false            有重试在进行
		 *   pending   true / false / 数字      等人作答(数字 = 至少这么多)
		 *   phase     "thinking"|"running"|"long"|"idle" 或它们的数组
		 *   hour      [from, to]              本地小时区间,可跨午夜(22 → 6)
		 *   firstTurn true / false            会话的第一次回合
		 */
		function normalizeWhen(value) {
			if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
			const out = {};
			if (value.tool !== undefined) {
				const clean = (t) => typeof t === "string" && t.length > 0 && t.length <= 64;
				if (clean(value.tool)) out.tool = value.tool;
				else if (Array.isArray(value.tool)) {
					const tools = value.tool.filter(clean);
					if (tools.length > 0) out.tool = tools;
				}
			}
			for (const key of ["retry", "firstTurn"]) {
				if (typeof value[key] === "boolean") out[key] = value[key];
			}
			if (typeof value.pending === "boolean") out.pending = value.pending;
			else if (typeof value.pending === "number" && Number.isFinite(value.pending) && value.pending >= 0) {
				out.pending = Math.floor(value.pending);
			}
			if (value.phase !== undefined) {
				if (WHEN_PHASES.includes(value.phase)) out.phase = value.phase;
				else if (Array.isArray(value.phase)) {
					const phases = value.phase.filter((p) => WHEN_PHASES.includes(p));
					if (phases.length > 0) out.phase = phases;
				}
			}
			if (Array.isArray(value.hour) && value.hour.length === 2
				&& value.hour.every((h) => Number.isInteger(h) && h >= 0 && h <= 23)) {
				out.hour = [value.hour[0], value.hour[1]];
			}
			return Object.keys(out).length > 0 ? out : null;
		}

		/** 归一化 rarity:0 < r <= 1 才有效(1 = 每次都参与);非法返回 undefined */
		function normalizeRarity(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
			if (value <= 0 || value > 1) return undefined;
			return value;
		}

		/**
		 * 归一化一条文案:字符串 → { text, weight:1 };对象 → 校验 text / weight /
		 * when / rarity;非法返回 null。weight 缺省/非法按 1,上限 1000。
		 * when / rarity 缺省时**不写入**字段,纯文本词库的对象形状保持原样(零破坏)。
		 */
		function normalizeEntry(item) {
			if (typeof item === "string") {
				return item.length > 0 ? { text: item, weight: 1 } : null;
			}
			if (item !== null && typeof item === "object" && !Array.isArray(item)
				&& typeof item.text === "string" && item.text.length > 0) {
				const w = typeof item.weight === "number" ? item.weight : 1;
				const entry = { text: item.text, weight: Number.isFinite(w) && w > 0 ? Math.min(w, 1000) : 1 };
				const when = normalizeWhen(item.when);
				if (when !== null) entry.when = when;
				const rarity = normalizeRarity(item.rarity);
				if (rarity !== undefined) entry.rarity = rarity;
				return entry;
			}
			return null;
		}

		/** 条目 → `when` 规则(null = 无条件条目) */
		function entryWhen(entry) {
			return entry !== null && typeof entry === "object" && !Array.isArray(entry) && entry.when !== undefined
				? normalizeWhen(entry.when) : null;
		}

		/** 条目 → rarity(null = 每次都参与) */
		function entryRarity(entry) {
			if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
			const r = normalizeRarity(entry.rarity);
			return r === undefined ? null : r;
		}

		/** 裸条目 = 既不加权、也不带条件/稀有度 → 归一化时可以还原成纯字符串 */
		function isBareEntry(entry) {
			return entry.weight === 1 && entry.when === undefined && entry.rarity === undefined;
		}

		/**
		 * 一条 `when` 规则在当前状态下是否成立(纯函数)。ctx 缺字段时按「该条件不成立」处理,
		 * 因此拿不到实时状态的宿主只会让条件句不出现,不会让状态行空掉(还有无条件句兜底)。
		 */
		function matchWhen(when, ctx) {
			const rule = when === undefined ? null : normalizeWhen(when);
			if (rule === null) return false;
			const c = ctx !== null && typeof ctx === "object" ? ctx : {};
			if (rule.tool !== undefined) {
				const running = Array.isArray(c.tools) ? c.tools.filter((t) => typeof t === "string" && t.length > 0) : [];
				if (running.length === 0) return false;
				if (rule.tool !== WHEN_ANY_TOOL) {
					const want = Array.isArray(rule.tool) ? rule.tool : [rule.tool];
					if (!running.some((t) => want.includes(t))) return false;
				}
			}
			if (rule.retry !== undefined && rule.retry !== !!c.retry) return false;
			if (rule.pending !== undefined) {
				const n = typeof c.pending === "number" && Number.isFinite(c.pending) ? c.pending : 0;
				if (typeof rule.pending === "boolean") {
					if (rule.pending !== (n > 0)) return false;
				} else if (!(n >= rule.pending)) return false;
			}
			if (rule.phase !== undefined) {
				const want = Array.isArray(rule.phase) ? rule.phase : [rule.phase];
				if (!want.includes(c.phase)) return false;
			}
			if (rule.hour !== undefined) {
				const hour = typeof c.hour === "number" && Number.isFinite(c.hour) ? c.hour : new Date().getHours();
				const from = rule.hour[0], to = rule.hour[1];
				// from === to 视为整天;from > to 表示跨午夜
				const inside = from === to ? true : (from < to ? (hour >= from && hour < to) : (hour >= from || hour < to));
				if (!inside) return false;
			}
			if (rule.firstTurn !== undefined && rule.firstTurn !== !!c.firstTurn) return false;
			return true;
		}

		/** 稀有度掷骰:没有 rarity 或 rarity>=1 直接通过;否则每次抽取按概率放行 */
		function rarityPass(entry, rand) {
			const r = entryRarity(entry);
			if (r === null || r >= 1) return true;
			const rnd = typeof rand === "function" ? rand : Math.random;
			return rnd() < r;
		}

		/**
		 * E2 的选句策略(纯函数):先按 rarity 掷骰,再按 when 筛选。
		 *   · 有**命中条件**的条目 → 只从它们里选(条件句是「此刻该说的话」,不该被
		 *     上千条无条件句按权重淹没);
		 *   · 一条都没命中 → 退回无条件条目;
		 *   · 全是有条件句且都没命中 / rarity 把整池筛空 → 退回全体,保证状态行不会空。
		 */
		function selectPhrasePool(list, ctx, rand) {
			if (!Array.isArray(list) || list.length === 0) return [];
			const rnd = typeof rand === "function" ? rand : Math.random;
			const rolled = list.filter((e) => rarityPass(e, rnd));
			const eligible = rolled.length > 0 ? rolled : list;
			const conditional = [];
			const plain = [];
			for (const e of eligible) {
				const when = entryWhen(e);
				if (when === null) plain.push(e);
				else if (matchWhen(when, ctx)) conditional.push(e);
			}
			if (conditional.length > 0) return conditional;
			return plain.length > 0 ? plain : eligible;
		}

		/**
		 * E1 的选句记忆(纯函数工厂):按 key(语言|相位|权重模式)维护一个**洗牌袋** ——
		 * 袋里的句子抽完之前不会重复;袋子抽空重开时先从候选里剔掉「最近 N 条」,
		 * 保证跨袋也不会立刻撞上一句。recentLimit 可配(0 = 只靠袋子)。
		 *
		 * rand 可注入(测试);snapshot()/load() 供可选跨刷新持久化。
		 */
		function createShuffleBag(options) {
			const opts = options !== null && typeof options === "object" ? options : {};
			let recentLimit = Number.isInteger(opts.recentLimit) && opts.recentLimit >= 0 ? opts.recentLimit : 3;
			const bags = new Map();
			const recent = new Map();
			const textsOf = (entries) => {
				const out = [];
				for (const e of entries) {
					const t = entryText(e);
					if (t && out.indexOf(t) < 0) out.push(t);
				}
				return out;
			};
			/** 重开一袋:池子够大时先剔掉最近 N 条,避免跨袋撞句 */
			const refill = (key, texts) => {
				if (recentLimit > 0) {
					const rec = recent.get(key) || [];
					const filtered = texts.filter((t) => rec.indexOf(t) < 0);
					if (filtered.length > 0) return filtered;
				}
				return texts.slice();
			};
			return {
				get recentLimit() { return recentLimit; },
				/** 配置变更时就地生效(不重开袋子:已抽过的部分不该因为改配置而失效) */
				configure(next) {
					if (next === null || typeof next !== "object") return;
					if (Number.isInteger(next.recentLimit) && next.recentLimit >= 0) recentLimit = next.recentLimit;
					for (const [key, list] of recent) recent.set(key, list.slice(0, recentLimit));
				},
				/** 从 entries 里抽一条文本;weighted=false 走均匀。池子为空返回 null */
				next(entries, key, weighted, rand) {
					if (!Array.isArray(entries) || entries.length === 0) return null;
					const texts = textsOf(entries);
					if (texts.length === 0) return null;
					let bag = bags.get(key);
					// 池子换了(相位 / 语言 / 条件切换)就重开,免得袋里留着已经不成立的句子
					if (!Array.isArray(bag) || bag.length === 0 || bag.some((t) => texts.indexOf(t) < 0)) {
						bag = refill(key, texts);
					}
					const remain = new Set(bag);
					const pool = entries.filter((e) => remain.has(entryText(e)));
					const target = pool.length > 0 ? pool : entries;
					const picked = weighted === false ? uniformPick(target, null, rand) : pickWeighted(target, null, rand);
					if (picked === null) return null;
					bag = bag.filter((t) => t !== picked);
					bags.set(key, bag);
					const rec = (recent.get(key) || []).filter((t) => t !== picked);
					rec.unshift(picked);
					recent.set(key, rec.slice(0, recentLimit));
					return picked;
				},
				reset() { bags.clear(); recent.clear(); },
				/** 导出全部记忆(供可选持久化);键数受语言 × 相位限制,体量有界 */
				snapshot() {
					const out = {};
					for (const key of new Set([...bags.keys(), ...recent.keys()])) {
						out[key] = { bag: (bags.get(key) || []).slice(), recent: (recent.get(key) || []).slice() };
					}
					return out;
				},
				/** 载入记忆;结构非法一律忽略(损坏的存档不该拦住插件启动) */
				load(data) {
					if (data === null || typeof data !== "object" || Array.isArray(data)) return;
					for (const [key, value] of Object.entries(data)) {
						if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
						if (Array.isArray(value.bag)) bags.set(key, value.bag.filter((t) => typeof t === "string"));
						if (Array.isArray(value.recent)) {
							recent.set(key, value.recent.filter((t) => typeof t === "string").slice(0, recentLimit));
						}
					}
				}
			};
		}

		/** 内置占位符名。外部注册不得占用:重名会让内置字段静默变成别人的值。 */
		const BUILTIN_PLACEHOLDERS = [
			"elapsed", "phase", "phaseLabel", "locale", "date", "time",
			"model", "provider", "tps", "pending", "tools", "running",
			"detail", "retry", "retryMax", "retryProvider", "retryCode", "retryStarted",
		];
		/** 外部占位符名:字母开头,1~32 位字母/数字/下划线/连字符 */
		const PLACEHOLDER_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
		/** 外部 provider 返回值里允许的相位键 */
		const PROVIDER_PHASES = [PHASE_THINKING, PHASE_RUNNING, PHASE_LONG];

		/**
		 * E4 对外注册接口 / 外部 provider 返回值的归一化。
		 *
		 * 返回 { ok, groups } 而不是「空就当成非法」:provider 此刻没有内容(`[]`)是**合法**的,
		 * 结构错了才是非法 —— 两者必须分开,否则第三方写错类型会被当成「暂时没内容」静默吞掉。
		 */
		function normalizeProviderGroups(value) {
			const empty = { thinking: [], running: [], long: [] };
			if (Array.isArray(value)) {
				const items = [];
				for (const item of value) {
					const entry = normalizeEntry(item);
					if (entry === null) return { ok: false };
					items.push(isBareEntry(entry) ? entry.text : entry);
				}
				return { ok: true, groups: items.length > 0 ? { ...empty, thinking: items } : empty };
			}
			if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false };
			for (const key of Object.keys(value)) {
				if (PROVIDER_PHASES.indexOf(key) < 0) return { ok: false };
			}
			const out = { thinking: [], running: [], long: [] };
			for (const phase of PROVIDER_PHASES) {
				if (value[phase] === undefined) continue;
				if (!Array.isArray(value[phase])) return { ok: false };
				for (const item of value[phase]) {
					const entry = normalizeEntry(item);
					if (entry === null) return { ok: false };
					out[phase].push(isBareEntry(entry) ? entry.text : entry);
				}
			}
			return { ok: true, groups: out };
		}

		/**
		 * E4:对外开放的注册表。第三方插件不改本插件源码,通过宿主上下文拿到这个 API
		 * (`apply` 里 `ctx.provide("statusRotator", api)`)就能把自己的内容送进来:
		 *
		 *   registerPlaceholder(name, resolve, { live }?)  → 自带占位符,如 {myState}
		 *   registerPhraseProvider(fn | { id, provide })  → 动态文案来源
		 *   registerPack({ id, label?, phrases })         → 具名词库包(与随包同一个形状)
		 *
		 * 三个都返回**注销函数**(第三方插件卸载时调用)。校验与降级口径和随包内容一致,
		 * 但**失败是显式的**:注册期参数不对 / provider 第一次就抛错 / 包归一化后为空 —— 一律抛错;
		 * 运行期 provider 抛错或返回结构不对 —— 记进 status().failures 并 console.warn 一次,
		 * 同时跳过这一家让状态行继续跑(不静默,也不拖垮别人)。
		 *
		 * 工厂是模块级的:不依赖 apply 的闭包,可独立实例化、独立断言(见 scripts/external-api-test.html)。
		 *
		 * @param {object} [options]
		 * @param {Function} [options.onChange] 注册表变化时回调(apply 用它重算词库并刷新)
		 * @param {Function} [options.warn] 运行期失败的告警通道(默认 console.warn)
		 * @returns {{api: object, internals: object}}
		 */
		function createStatusRotatorApi(options) {
			const opts = options !== null && typeof options === "object" ? options : {};
			const warn = typeof opts.warn === "function" ? opts.warn : () => {};
			const onChange = typeof opts.onChange === "function" ? opts.onChange : () => {};
			const placeholders = new Map();
			const providers = new Map();
			const packs = new Map();
			/** 运行期失败(key → { count, message }):只留计数与最后一条消息,不会随 tick 无限增长 */
			const failures = new Map();
			let providerSeq = 0;

			const noteFailure = (key, error, label) => {
				const message = error && error.message ? String(error.message) : String(error);
				const seen = failures.get(key);
				if (seen) {
					seen.count++;
					seen.message = message;
					return;
				}
				failures.set(key, { count: 1, message });
				// 第一次就吼一声:第三方的错不该只躺在 status() 里等人来查
				warn(`${label} 运行失败,已跳过这一次:${message}`);
			};

			const requireName = (name, what) => {
				if (typeof name !== "string" || !PLACEHOLDER_NAME_RE.test(name)) {
					throw new TypeError(`registerPlaceholder: ${what}必须是 1~32 位、字母开头的名字,收到 ${JSON.stringify(name)}`);
				}
				if (BUILTIN_PLACEHOLDERS.indexOf(name) >= 0) {
					throw new Error(`registerPlaceholder: "${name}" 是内置占位符,不能占用`);
				}
			};

			const api = {
				/** 接口版本:破坏性改动时递增,第三方据此判断兼容性 */
				version: 1,
				/** 插件名(便于第三方在诊断里打印) */
				name: "status-rotator",

				registerPlaceholder(name, resolve, placeholderOptions) {
					requireName(name, "占位符名");
					if (typeof resolve !== "function") {
						throw new TypeError("registerPlaceholder: 第二个参数必须是 () => string 形式的函数");
					}
					if (placeholders.has(name)) {
						throw new Error(`registerPlaceholder: "${name}" 已被注册(先调用上一次返回的注销函数)`);
					}
					placeholders.set(name, {
						name,
						resolve,
						// 默认按动态占位符对待:每秒刷新一次,第三方不必自己起定时器
						live: !(placeholderOptions && placeholderOptions.live === false),
					});
					onChange();
					return () => { if (placeholders.delete(name)) onChange(); };
				},

				registerPhraseProvider(provider, providerOptions) {
					const explicitId = providerOptions && typeof providerOptions.id === "string" ? providerOptions.id : "";
					const ownId = provider !== null && typeof provider === "object" && typeof provider.id === "string" ? provider.id : "";
					const id = explicitId || ownId || `provider-${++providerSeq}`;
					const provide = typeof provider === "function"
						? provider
						: (provider !== null && typeof provider === "object" && typeof provider.provide === "function" ? provider.provide.bind(provider) : null);
					if (typeof provide !== "function") {
						throw new TypeError("registerPhraseProvider: 需要函数,或带 provide() 方法的对象");
					}
					if (providers.has(id)) {
						throw new Error(`registerPhraseProvider: id "${id}" 已被注册(先调用上一次返回的注销函数)`);
					}
					// 注册即试跑一次:坏 provider 当场抛错,而不是等到某次轮换才静默不出内容
					let probe;
					try {
						probe = provide({ locale: null, phase: PHASE_RUNNING, live: null, probe: true });
					} catch (error) {
						throw new Error(`registerPhraseProvider("${id}"): 第一次调用就抛错 —— ${error && error.message ? error.message : error}`);
					}
					const checked = normalizeProviderGroups(probe);
					if (!checked.ok) {
						throw new TypeError(`registerPhraseProvider("${id}"): 返回值必须是文案条目数组,或 { thinking, running, long } 分组(空数组表示此刻没有内容)`);
					}
					providers.set(id, { id, provide });
					onChange();
					return () => { if (providers.delete(id)) onChange(); };
				},

				registerPack(pack) {
					// 与文档里的 packs 走**同一个** normalizePacks:形状、去重、非法字段的口径完全一致
					const normalized = normalizePacks([pack]);
					if (!normalized || normalized.length === 0) {
						throw new TypeError("registerPack: 需要 { id, label?, phrases? },且 id 是非空字符串");
					}
					const one = normalized[0];
					if (packs.has(one.id)) {
						throw new Error(`registerPack: 包 id "${one.id}" 已被注册(先调用上一次返回的注销函数)`);
					}
					packs.set(one.id, { pack: one });
					onChange();
					return () => { if (packs.delete(one.id)) onChange(); };
				},

				/**
				 *「自己发一条」:立刻发一条自己的滚动弹幕。这是**加法式**扩展,api.version 不变。
				 * 层被宿主全屏遮罩挡住时先排队,遮罩关掉后自动补发。
				 * @returns {boolean} 是否当场发出(排队 / 弹幕关着 / 文案为空 → false)
				 */
				sendDanmaku(text) {
					if (typeof opts.sendDanmaku !== "function") {
						throw new Error("sendDanmaku 不可用:本插件的 apply 没有挂接弹幕发送");
					}
					return opts.sendDanmaku(text) === true;
				},

				/** 已注册的占位符名 */
				placeholderNames() { return Array.from(placeholders.keys()); },
				/** 已注册的 provider id */
				providerIds() { return Array.from(providers.keys()); },
				/** 已注册的包 id */
				packIds() { return Array.from(packs.keys()); },
				/**
				 * 诊断快照:注册了什么、哪家运行期出过问题(第三方与用户都能查)。
				 * failures 里的 key 形如 `provider:<id>` / `placeholder:<name>`。
				 */
				status() {
					return {
						version: 1,
						placeholders: Array.from(placeholders.keys()),
						providers: Array.from(providers.keys()),
						packs: Array.from(packs.keys()),
						failures: Array.from(failures.entries()).map(([key, value]) => ({ key, count: value.count, message: value.message })),
					};
				},
			};

			/** apply 侧用的内部接口(不挂到公共 api 上) */
			const internals = {
				/** 需要按 liveTickMs 刷新的外部占位符名(供 isDynamicTemplate 判断) */
				livePlaceholderNames() {
					const out = new Set();
					for (const entry of placeholders.values()) if (entry.live) out.add(entry.name);
					return out;
				},
				/** 把外部占位符的当前值并进渲染字段;单个失败只让该字段变空串 */
				decorate(fields, context) {
					if (placeholders.size === 0) return fields;
					const site = { el: context ? context.el : null, phase: context ? context.phase : undefined, fields };
					const out = { ...fields };
					for (const entry of placeholders.values()) {
						try {
							const value = entry.resolve(site);
							out[entry.name] = value === null || value === undefined ? "" : String(value);
						} catch (error) {
							noteFailure("placeholder:" + entry.name, error, `外部占位符 {${entry.name}}`);
							out[entry.name] = "";
						}
					}
					return out;
				},
				/** 外部包并进语言表:复用包链同一套 mergeGroups(同文本去重) */
				applyPacks(table) {
					if (packs.size === 0) return table;
					let out = table;
					for (const entry of packs.values()) {
						if (entry.pack.phrases) out = mergeGroups(out, entry.pack.phrases);
					}
					return out;
				},
				/** 现算某阶段的外部条目(空数组 = 这一拍没有);运行期失败记账并跳过该家 */
				providerEntries(phase, locale) {
					if (providers.size === 0) return [];
					const out = [];
					for (const provider of providers.values()) {
						let value;
						try {
							value = provider.provide({ locale, phase, live: null, probe: false });
						} catch (error) {
							noteFailure("provider:" + provider.id, error, `外部文案来源 "${provider.id}"`);
							continue;
						}
						const checked = normalizeProviderGroups(value);
						if (!checked.ok) {
							noteFailure("provider:" + provider.id, new TypeError("返回值必须是文案条目数组,或 { thinking, running, long } 分组"), `外部文案来源 "${provider.id}"`);
							continue;
						}
						// 与 textsForPhase 同一套回落:本相位没有就用 running → thinking
						const groups = checked.groups;
						const list = groups[phase] && groups[phase].length > 0
							? groups[phase]
							: (groups[PHASE_RUNNING] && groups[PHASE_RUNNING].length > 0 ? groups[PHASE_RUNNING]
								: (groups[PHASE_THINKING] && groups[PHASE_THINKING].length > 0 ? groups[PHASE_THINKING] : []));
						for (const entry of list) out.push(entry);
					}
					return out;
				},
				/** 卸载时清空:不让第三方的注册活过本插件 */
				reset() {
					placeholders.clear();
					providers.clear();
					packs.clear();
					failures.clear();
				},
			};

			return { api, internals };
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
					.map((v) => (isBareEntry(v) ? v.text : v));
				return arr.length > 0 ? { thinking: arr, running: [], long: [] } : null;
			}
			if (list !== null && typeof list === "object") {
				const out = { thinking: [], running: [], long: [] };
				for (const phase of [PHASE_THINKING, PHASE_RUNNING, PHASE_LONG]) {
					const arr = Array.isArray(list[phase])
						? list[phase]
							.map((s) => normalizeEntry(s))
							.filter((v) => v !== null)
							.map((v) => (isBareEntry(v) ? v.text : v))
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

		// ══ V3 外观(视觉主题化) ══

		/** 文字动画:none 静止 / breathe 呼吸 / glitch 故障风 */
		const APPEARANCE_ANIMATIONS = ["none", "breathe", "glitch"];
		/** 状态行活动指示:none / ring 环形 / bar 条形(宿主不暴露回合进度,都是"在动"的示意而非百分比) */
		const APPEARANCE_SPINNERS = ["none", "ring", "bar"];
		/**
		 * 字体族白名单:字母 / 数字 / 空格 / 下划线 / 逗号 / 引号 / 连字符。
		 * 值会进注入的 CSS,所以这里刻意不含 `;` `{` `}` `(` `)` `\` `/` —— 没有这些字符就没有注入面,
		 * 而 `"Segoe UI", system-ui, sans-serif` 这类正常写法全部通过。
		 */
		const FONT_FAMILY_RE = /^[A-Za-z0-9 _,'"-]{1,120}$/;
		/** 外观数值范围 */
		const APPEARANCE_LIMITS = { fontSize: [8, 96] };
		/** 环形 / 条形指示占的宽度(px):打字机锁宽要把这部分算进去,否则文字尾巴会被截 */
		const SPINNER_WIDTH = { none: 0, ring: 18, bar: 40 };

		/** 归一化字体族:"" = 跟随宿主;非法(含注入面)返回 undefined,由调用方丢弃 */
		function normalizeFontFamily(value) {
			if (typeof value !== "string") return undefined;
			const text = value.trim();
			if (text.length === 0) return "";
			return FONT_FAMILY_RE.test(text) ? text : undefined;
		}

		/**
		 * 归一化 appearance 配置块。缺省值全部是"什么都不改",所以老配置(没有这个块)
		 * 升级后观感与之前**完全一致** —— 这是这个块最重要的性质。
		 */
		function normalizeAppearance(raw) {
			if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
			const out = {};
			const family = normalizeFontFamily(raw.fontFamily);
			if (family !== undefined) out.fontFamily = family;
			if (typeof raw.fontSize === "number" && Number.isFinite(raw.fontSize)) {
				out.fontSize = raw.fontSize === 0 ? 0 : Math.round(clampNumber(raw.fontSize, APPEARANCE_LIMITS.fontSize[0], APPEARANCE_LIMITS.fontSize[1]));
			}
			if (typeof raw.glow === "boolean") out.glow = raw.glow;
			if (typeof raw.glowColor === "string" && isSafeColorToken(raw.glowColor)) out.glowColor = raw.glowColor;
			if (APPEARANCE_ANIMATIONS.indexOf(raw.animation) >= 0) out.animation = raw.animation;
			if (APPEARANCE_SPINNERS.indexOf(raw.spinner) >= 0) out.spinner = raw.spinner;
			return Object.keys(out).length > 0 ? out : null;
		}

		/**
		 * 主题包画廊(V3 的"一键切换"):每个主题一次设定外观 + 渐变色板。
		 * 值都是上面归一化器认识的形状,所以「选主题」与「手改字段」走的是同一条写盘路径 ——
		 * 选完主题还能继续手调,不必回到"自定义"。
		 */
		const APPEARANCE_THEMES = [
			{
				id: "classic",
				label: { zh: "经典(默认)", en: "Classic (default)" },
				appearance: { fontFamily: "", fontSize: 0, glow: false, glowColor: "", animation: "none", spinner: "none" },
				gradient: { enabled: true, mode: "auto", direction: "rtl", colors: ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"], dayColors: ["#d92b4b", "#c2410c", "#a16207", "#15803d", "#0e7490", "#6d28d9", "#be185d"], speed: 4 },
			},
			{
				id: "neon",
				label: { zh: "霓虹", en: "Neon" },
				appearance: { glow: true, glowColor: "#5fd4ff", animation: "breathe", spinner: "ring", fontSize: 15, fontFamily: "" },
				gradient: { enabled: true, mode: "night", direction: "rtl", colors: ["#22d3ee", "#a78bfa", "#f472b6"], speed: 3 },
			},
			{
				id: "terminal",
				label: { zh: "终端", en: "Terminal" },
				appearance: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13, glow: true, glowColor: "#4ade80", animation: "none", spinner: "bar" },
				gradient: { enabled: true, mode: "night", direction: "ltr", colors: ["#4ade80", "#86efac"], speed: 6 },
			},
			{
				id: "candy",
				label: { zh: "糖果", en: "Candy" },
				appearance: { fontFamily: "", fontSize: 16, glow: false, animation: "breathe", spinner: "none" },
				gradient: { enabled: true, mode: "auto", direction: "rtl", colors: ["#fb7185", "#fbbf24", "#f472b6"], dayColors: ["#be123c", "#b45309", "#be185d"], speed: 5 },
			},
			{
				id: "glitch",
				label: { zh: "故障", en: "Glitch" },
				appearance: { fontFamily: "", fontSize: 15, glow: false, glowColor: "", animation: "glitch", spinner: "none" },
				gradient: { enabled: true, mode: "night", direction: "ltr", colors: ["#ff5f6d", "#5fd4ff"], speed: 2 },
			},
		];

		/**
		 * matrix(a,b,c,d,tx,ty) → tx;拿不到返回 null。
		 * V4 悬停冻结要用它把「过渡进行到哪了」读出来,所以放在模块级(纯函数,可单测)。
		 */
		function matrixTranslateX(transform) {
			const m = /matrix\(([^)]+)\)/.exec(String(transform || ""));
			if (!m) return null;
			const parts = m[1].split(",").map((v) => Number(v.trim()));
			return parts.length === 6 && Number.isFinite(parts[4]) ? parts[4] : null;
		}

		/** 按 id 取主题;查不到返回 null(设置页据此回落到"当前自定义") */
		function themeById(id) {
			for (const theme of APPEARANCE_THEMES) if (theme.id === id) return theme;
			return null;
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
		 * 词库行解析(设置页):每行一条。
		 *
		 *   `文本`                                    纯字符串
		 *   `文本 | 3`                                加权(旧语法,原样支持)
		 *   `文本 | when:tool=bash`                   条件句
		 *   `文本 | 3 | when:tool=bash,phase=long`    加权 + 多条件(逗号 = 全部成立)
		 *   `文本 | rarity:0.01`                      稀有句(每次抽取 1% 概率参与)
		 *
		 * 修饰段只从**行尾**连续识别,所以正文里的 `|` 不会被吃掉(与旧行为一致):
		 * `a | b | 3` 仍然是 `a | b` 加权重 3。
		 */
		function parseWeightedLines(text) {
			return String(text || "")
				.split(/\r?\n/)
				.map((s) => s.trim())
				.filter((s) => s.length > 0)
				.map((line) => parsePhraseLine(line));
		}

		/** 一行是不是修饰段(正权重 / when: / rarity:);非正数的数字段不算修饰,整行按原文保留 */
		function isPhraseModifier(segment) {
			const s = segment.trim();
			if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s) > 0;
			return /^when\s*:/i.test(s) || /^rarity\s*:/i.test(s);
		}

		/** `when:tool=bash,retry,pending` → when 对象(交给 normalizeWhen 收口) */
		function parseWhenSpec(spec) {
			const when = {};
			// 单值收敛成字符串:与手写 JSON 的规范形态一致,whenSpecOf 也就能原样回写
			const oneOrMany = (list) => (list.length === 1 ? list[0] : list);
			for (const clause of String(spec).split(",")) {
				const part = clause.trim();
				if (part.length === 0) continue;
				const eq = part.indexOf("=");
				if (eq < 0) {
					// 不带值的写法:retry / pending / firstTurn;tool 单独写 = 任意工具
					const key = part.toLowerCase();
					if (key === "tool") when.tool = WHEN_ANY_TOOL;
					else if (key === "retry") when.retry = true;
					else if (key === "pending") when.pending = true;
					else if (key === "firstturn") when.firstTurn = true;
					continue;
				}
				const key = part.slice(0, eq).trim().toLowerCase();
				const raw = part.slice(eq + 1).trim();
				if (raw.length === 0) continue;
				if (key === "tool") when.tool = raw === WHEN_ANY_TOOL ? WHEN_ANY_TOOL : oneOrMany(raw.split("+").map((s) => s.trim()).filter(Boolean));
				else if (key === "phase") {
					const phases = raw.split("+").map((s) => s.trim()).filter(Boolean);
					if (phases.length > 0) when.phase = oneOrMany(phases);
				} else if (key === "hour") {
					const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(raw);
					if (m) when.hour = [Number(m[1]), Number(m[2])];
				} else if (key === "pending") {
					when.pending = /^\d+$/.test(raw) ? Number(raw) : raw !== "false";
				} else if (key === "retry") when.retry = raw !== "false";
				else if (key === "firstturn") when.firstTurn = raw !== "false";
			}
			return when;
		}

		/** 单个设置页词库行 → 条目 */
		function parsePhraseLine(line) {
			const segments = String(line).split("|");
			let end = segments.length;
			let weight = null;
			let when = null;
			let rarity = null;
			while (end > 1) {
				const seg = segments[end - 1].trim();
				if (/^\d+(?:\.\d+)?$/.test(seg)) {
					// 旧语义:只认**最靠右**的一个权重段;已经是非正数则整行保留原文
					if (weight !== null || !(Number(seg) > 0)) break;
					weight = Math.min(Number(seg), 1000);
					end--;
					continue;
				}
				const whenMatch = /^when\s*:(.*)$/i.exec(seg);
				if (whenMatch) {
					when = { ...(when || {}), ...parseWhenSpec(whenMatch[1]) };
					end--;
					continue;
				}
				const rarityMatch = /^rarity\s*:(.*)$/i.exec(seg);
				if (rarityMatch) {
					const normalized = normalizeRarity(Number(rarityMatch[1].trim()));
					if (normalized !== undefined) rarity = normalized;
					end--;
					continue;
				}
				break;
			}
			const body = segments.slice(0, end).join("|").trim();
			if (body.length === 0) return String(line).trim();
			const cleanWhen = when === null ? null : normalizeWhen(when);
			const bare = (weight === null || weight === 1) && cleanWhen === null && rarity === null;
			if (bare) return body;
			const entry = { text: body, weight: weight === null ? 1 : weight };
			if (cleanWhen !== null) entry.when = cleanWhen;
			if (rarity !== null) entry.rarity = rarity;
			return entry;
		}

		/** 条目 → `when:…` 修饰段(phraseLines 的回写侧,与 parseWhenSpec 互为逆) */
		function whenSpecOf(when) {
			const parts = [];
			if (when.tool !== undefined) parts.push("tool=" + (Array.isArray(when.tool) ? when.tool.join("+") : when.tool));
			if (when.retry !== undefined) parts.push(when.retry ? "retry" : "retry=false");
			if (when.pending !== undefined) {
				parts.push(typeof when.pending === "boolean" ? (when.pending ? "pending" : "pending=false") : "pending=" + when.pending);
			}
			if (when.phase !== undefined) parts.push("phase=" + (Array.isArray(when.phase) ? when.phase.join("+") : when.phase));
			if (when.hour !== undefined) parts.push("hour=" + when.hour[0] + "-" + when.hour[1]);
			if (when.firstTurn !== undefined) parts.push(when.firstTurn ? "firstTurn" : "firstTurn=false");
			return parts.length > 0 ? "when:" + parts.join(",") : "";
		}

		/**
		 * 词库行渲染(设置页):条目回写为每行一条,与 parsePhraseLine 双向可逆 ——
		 * 不可逆就意味着「设置页保存一次,手写的 when / rarity 就没了」。
		 * weight>1 写 `| 权重`;有条件写 `| when:…`;有稀有度写 `| rarity:…`。
		 */
		function phraseLines(list) {
			if (!Array.isArray(list)) return "";
			return list
				.map((e) => {
					if (typeof e === "string") return e;
					if (e !== null && typeof e === "object" && typeof e.text === "string") {
						const parts = [e.text];
						const w = entryWeight(e);
						if (w !== 1) parts.push(String(w));
						const when = entryWhen(e);
						if (when !== null) parts.push(whenSpecOf(when));
						const rarity = entryRarity(e);
						if (rarity !== null) parts.push("rarity:" + rarity);
						return parts.join(" | ");
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
		/** 反重复记忆的数值范围(与 lib/index.js 的 ANTI_REPEAT_LIMITS 同口径) */
		const ANTI_REPEAT_LIMITS = {
			recentLimit: [0, 50],
		};
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
		const WHALE_TAIL_MOTION_MODES = ["tps", "fixed"];
		const WHALE_TAIL_ANIMATIONS = ["wag", "sway", "twist", "random"];
		const WHALE_TAIL_WAG_SPEED_RANGE = [0.25, 6];
		const WHALE_TAIL_TPS_MIN_SPEED = 2;
		/** Keep the reference animation's pace while waiting; faster output accelerates it. */
		function whaleTailWagFrequency(motion, tps) {
			if (!motion || motion.enabled !== true) return 0;
			if (motion.mode === "fixed") {
				const speed = Number(motion.fixedSpeed);
				return Number.isFinite(speed)
					? clampNumber(speed, WHALE_TAIL_WAG_SPEED_RANGE[0], WHALE_TAIL_WAG_SPEED_RANGE[1])
					: 1.5;
			}
			const rate = Number(tps);
			return clampNumber(Number.isFinite(rate) ? rate / 16 : 0, WHALE_TAIL_TPS_MIN_SPEED, WHALE_TAIL_WAG_SPEED_RANGE[1]);
		}

		/** Random selection excludes the current action, so every switch is visible. */
		function pickWhaleTailAnimation(selection, previous, random = Math.random) {
			if (selection !== "random") return WHALE_TAIL_ANIMATIONS.includes(selection) ? selection : "wag";
			const candidates = WHALE_TAIL_ANIMATIONS.filter((name) => name !== "random" && name !== previous);
			return candidates[Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)))];
		}
		function shouldSwitchWhaleTailOnTool(motion, random = Math.random) {
			if (!motion || motion.enabled !== true || motion.toolSwitchEnabled !== true) return false;
			const chance = typeof motion.toolSwitchChance === "number" && Number.isFinite(motion.toolSwitchChance)
				? clampNumber(motion.toolSwitchChance, 0, 1) : DEFAULT_CONFIG.whaleTailMotion.toolSwitchChance;
			return chance > 0 && (chance === 1 || random() < chance);
		}

		/**
		 * Six discrete bridge frames between the matched, single-contour junction poses.
		 * Resample and align the closed outlines before blending, keeping the exact
		 * source/target endpoints. Unlike a fade, this keeps the tail solid throughout.
		 */
		function whaleTailBridgeFrames(from, to) {
			const sample = (pose) => {
				const values = pose.match(/-?\d+(?:\.\d+)?/g).map(Number);
				const points = [];
				for (let i = 0; i < values.length; i += 2) points.push([values[i], values[i + 1]]);
				const lengths = points.map((p, i) => Math.hypot(p[0] - points[(i + 1) % points.length][0], p[1] - points[(i + 1) % points.length][1]));
				const perimeter = lengths.reduce((sum, n) => sum + n, 0);
				const sampled = [];
				let edge = 0, travelled = 0;
				for (let i = 0; i < 128; i++) {
					const distance = i * perimeter / 128;
					while (edge < points.length - 1 && travelled + lengths[edge] < distance) travelled += lengths[edge++];
					const a = points[edge], b = points[(edge + 1) % points.length];
					const ratio = lengths[edge] > 0 ? (distance - travelled) / lengths[edge] : 0;
					sampled.push([a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio]);
				}
				return sampled;
			};
			const a = sample(from), b = sample(to);
			const area = (points) => points.reduce((sum, p, i) => {
				const q = points[(i + 1) % points.length];
				return sum + p[0] * q[1] - q[0] * p[1];
			}, 0);
			if (area(a) * area(b) < 0) b.reverse();
			let shift = 0, best = Infinity;
			for (let offset = 0; offset < b.length; offset++) {
				const score = a.reduce((sum, p, i) => {
					const q = b[(i + offset) % b.length];
					return sum + (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
				}, 0);
				if (score < best) { best = score; shift = offset; }
			}
			const frames = [from];
			for (let frame = 1; frame < 5; frame++) {
				const ratio = frame / 5;
				frames.push("M" + a.map((p, i) => {
					const q = b[(i + shift) % b.length];
					return p.map((n, axis) => (n + (q[axis] - n) * ratio).toFixed(1)).join(" ");
				}).join(" L") + " Z");
			}
			return frames.concat(to);
		}

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
			// 外观:字体族 / 字号 / 发光 / 动画 / 活动指示;非法值丢弃(保持"什么都不改")
			if (raw.appearance !== undefined) {
				const appearance = normalizeAppearance(raw.appearance);
				if (appearance !== null) out.appearance = appearance;
			}
			// 反重复(洗牌袋)记忆:recentLimit 必须是整数并钳制,persist 是布尔
			if (raw.antiRepeat !== undefined && raw.antiRepeat !== null
				&& typeof raw.antiRepeat === "object" && !Array.isArray(raw.antiRepeat)) {
				const src = raw.antiRepeat;
				const anti = {};
				if (typeof src.recentLimit === "number" && Number.isFinite(src.recentLimit)) {
					anti.recentLimit = Math.round(clampNumber(src.recentLimit, ANTI_REPEAT_LIMITS.recentLimit[0], ANTI_REPEAT_LIMITS.recentLimit[1]));
				}
				if (typeof src.persist === "boolean") anti.persist = src.persist;
				if (Object.keys(anti).length > 0) out.antiRepeat = anti;
			}
			// 保留鲸鱼尾巴 + 尾巴炫彩(布尔;非法值丢弃,保持默认 false)
			if (typeof raw.whaleTail === "boolean") out.whaleTail = raw.whaleTail;
			if (raw.whaleTailMotion !== undefined && raw.whaleTailMotion !== null && typeof raw.whaleTailMotion === "object" && !Array.isArray(raw.whaleTailMotion)) {
				const src = raw.whaleTailMotion;
				const motion = {};
				if (typeof src.enabled === "boolean") motion.enabled = src.enabled;
				if (WHALE_TAIL_MOTION_MODES.includes(src.mode)) motion.mode = src.mode;
				if (WHALE_TAIL_ANIMATIONS.includes(src.animation)) motion.animation = src.animation;
				if (typeof src.toolSwitchEnabled === "boolean") motion.toolSwitchEnabled = src.toolSwitchEnabled;
				if (typeof src.toolSwitchChance === "number" && Number.isFinite(src.toolSwitchChance)) motion.toolSwitchChance = clampNumber(src.toolSwitchChance, 0, 1);
				if (typeof src.fixedSpeed === "number" && Number.isFinite(src.fixedSpeed)) {
					motion.fixedSpeed = clampNumber(src.fixedSpeed, WHALE_TAIL_WAG_SPEED_RANGE[0], WHALE_TAIL_WAG_SPEED_RANGE[1]);
				}
				if (Object.keys(motion).length > 0) out.whaleTailMotion = motion;
			}
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
					// V4:交互与观感开关(默认关,这里只是让显式 true/false 能落下来)
					for (const key of ["hoverPause", "clickCopy", "adaptDensity", "avoidPointer"]) {
						if (typeof d[key] === "boolean") dd[key] = d[key];
					}
					// 按相位分色:只收白名单颜色,认不出的相位键丢弃
					if (d.phaseColors !== undefined && d.phaseColors !== null && typeof d.phaseColors === "object" && !Array.isArray(d.phaseColors)) {
						const pc = {};
						for (const phase of [PHASE_THINKING, PHASE_RUNNING, PHASE_LONG]) {
							if (typeof d.phaseColors[phase] === "string" && isSafeColorToken(d.phaseColors[phase])) pc[phase] = d.phaseColors[phase];
						}
						if (Object.keys(pc).length > 0) dd.phaseColors = pc;
					}
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
				if ((key === "gradient" || key === "title" || key === "danmaku" || key === "whaleTailMotion" || key === "antiRepeat" || key === "appearance") && over[key] !== null && typeof over[key] === "object") {
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
		/**
		 * 模板是否含随时间变化的占位符(需要 live tick 刷新)。
		 * extraNames 是 E4 第三方注册的**动态**占位符名 —— 别人注入的字段同样要按 liveTickMs 刷新,
		 * 否则第三方得自己起定时器才能让值动起来。
		 */
		function isDynamicTemplate(template, extraNames) {
			const text = String(template || "");
			if (/\{(elapsed|date|time|tps|pending|tools|model|provider)\}/.test(text)) return true;
			if (!extraNames) return false;
			for (const name of extraNames) {
				if (text.indexOf("{" + name + "}") >= 0) return true;
			}
			return false;
		}

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

		/** Count only newly observed live deltas; window replays/history are not generation. */
		function createStreamCharCounter() {
			let cursor = -Infinity;
			let initialized = false;
			let chars = 0;
			return (entries) => {
				for (const entry of entries) {
					const event = entry && entry.event;
					if (!event || !Number.isFinite(event.seq) || event.seq <= cursor) continue;
					cursor = event.seq;
					if (!initialized || entry.type !== "transient" || event.type !== "assistant/live-chunk") continue;
					const chunk = event.data && event.data.chunk;
					if (!chunk) continue;
					if ((chunk.type === "text-delta" || chunk.type === "reasoning-delta") && typeof chunk.text === "string") chars += chunk.text.length;
					else if (chunk.type === "tool-call-delta" && typeof chunk.argumentsDelta === "string") chars += chunk.argumentsDelta.length;
				}
				initialized = true;
				return chars;
			};
		}

		/** Count only new committed calls, ignoring initial history, paging and replays. */
		function createToolCallTracker(onCall) {
			let cursor = -Infinity, initialized = false;
			return (snapshot) => {
				if (!snapshot || !Array.isArray(snapshot.entries)) return 0;
				const entries = snapshot && Array.isArray(snapshot.entries) ? snapshot.entries : [];
				const kind = snapshot && snapshot.change && snapshot.change.kind;
				const calls = new Map();
				const previous = cursor;
				for (const entry of entries) {
					const event = entry && entry.type === "event" && entry.event;
					if (!event || !Number.isFinite(event.seq)) continue;
					cursor = Math.max(cursor, event.seq);
					if (!initialized || (kind && kind !== "append") || event.seq <= previous || event.type !== "tool/call") continue;
					const data = event.data;
					if (data && typeof data.callId === "string" && data.callId.length > 0 && typeof data.name === "string" && data.name.length > 0) calls.set(event.seq, event);
				}
				initialized = true;
				if (typeof onCall === "function") for (const event of calls.values()) onCall(event);
				return calls.size;
			};
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
			/**
			 * 反重复记忆:按「语言|相位|权重模式」维护的洗牌袋,不再是「每个元素记上一句」——
			 * 元素会被宿主回收,挂在元素上的记忆既会漏也会丢。见 createShuffleBag。
			 */
			const phraseBag = createShuffleBag({ recentLimit: 3 });
			/** 跨刷新持久化(antiRepeat.persist)用的存档键 */
			const PICK_MEMORY_KEY = "dsh-status-rotator.pickMemory";
			/** 是否已在本会话看到过回合结束(「首次会话」条件的依据) */
			let sawTurnEnd = false;
			/** 上面那个标记属于哪个会话;换会话就重算 */
			let sawTurnEndSession = null;
			/** 跨刷新存档是否已读过(只读一次,免得每拍 applyConfig 都覆盖内存里的袋子) */
			let pickMemoryLoaded = false;
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

			/**
			 * E4:第三方注册表。必须在 recomputeEffective 之前建好 —— 它内部会调
			 * internals.applyPacks 把外部包并进词库。
			 * onChange 里的 recomputeEffective / refreshAll 都是「注册发生时」才执行的闭包调用,
			 * 而注册只可能发生在本插件 apply 完成之后(第三方要先拿到 ctx 上的服务),
			 * 所以这里不存在暂时性死区。
			 */
			let externalReady = false;
			let externalDirty = false;
			/** ctx.provide 返回的注销函数(宿主若返回的话);卸载时再兜一次底 */
			let externalApiDisposer = null;
			const externalRegistry = createStatusRotatorApi({
				warn: (message) => { try { console.warn("[status-rotator] " + message); } catch (error) { /* ignore */ } },
				// 弹幕发送在下面才定义(apply 后半段),这里用闭包晚绑定 —— 服务只会在 apply 结束后被调用
				sendDanmaku: (text) => sendDanmaku(text),
				onChange: () => {
					// 注册期间(本插件自己的 apply 还没跑完)先记账,跑完再补一次刷新
					if (!externalReady) { externalDirty = true; return; }
					recomputeEffective();
					refreshAll();
				},
			});
			const externalApi = externalRegistry.api;
			const external = externalRegistry.internals;

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
				// E4:第三方注册的包并进来,走的是同一套 mergeGroups(同文本去重)。
				// 外部包**不进文档**,所以设置页整份 PUT 也不会把别人的内容写进用户配置。
				externalTable = external.applyPacks(externalTable);
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
			 * dsh 0.2.0 起,「运行中」不再是折叠头按钮里的一段文本,而是会话流里独立的一行:
			 *   div[data-chat-running]
			 *     ├─ span(visuallyHidden, role=status, aria-live=polite)  ← 读屏公告,别动
			 *     ├─ span(class*=runningDivider)
			 *     └─ span(class*=runningContent)
			 *          ├─ span(class*=runningIcon)   ← **鲸鱼尾巴**(svg,stroke=currentColor)
			 *          └─ span(class*=runningText)   ← shimmer 文案("Deep diving for 12s")
			 * 折叠头按钮(button[data-turn-process])在 0.2.0 只在**回合结束后**才渲染(收起态摘要),
			 * 所以运行期间插件必须认得这一行,否则整条状态行都不会被接管(0.2.0 兼容的核心)。
			 */
			const RUNNING_ROW_SELECTOR = "[data-chat-running]";
			const RUNNING_TEXT_SELECTOR = '[class*="runningText"]';
			const RUNNING_ICON_SELECTOR = '[class*="runningIcon"]';
			/** 插件给宿主鲸鱼尾巴加的类:样式表据此给它上炫彩流光 */
			const TAIL_CLASS = "dsh-status-rotator-whale-tail";
			const TAIL_WAG_CLASS = "dsh-status-rotator-whale-wag";
			const TAIL_MORPH_CLASS = "dsh-status-rotator-tail-morph";
			// Traced from the supplied 24-frame GIF (20 ms/frame). Preserve its one-sided
			// bend, fin turnover and timing; discrete contours avoid invented in-between poses.
			const TAIL_POSES = [
				"M56 97 L51 103 L51 105 L50 106 L50 113 L51 114 L51 117 L54 123 L64 134 L65 134 L72 140 L77 142 L81 145 L83 145 L92 150 L94 150 L102 154 L107 155 L110 157 L115 158 L118 160 L123 161 L126 163 L128 163 L134 166 L143 174 L145 178 L145 186 L144 187 L144 190 L140 198 L140 200 L138 203 L138 205 L136 208 L134 215 L132 218 L132 220 L129 227 L127 238 L126 239 L126 244 L125 245 L125 251 L124 252 L123 263 L125 267 L126 267 L128 269 L134 269 L136 267 L137 267 L139 263 L139 260 L140 259 L140 253 L141 252 L141 246 L142 245 L142 240 L143 239 L144 232 L145 231 L145 229 L148 223 L149 218 L154 208 L154 206 L156 203 L156 201 L158 198 L158 196 L160 192 L160 188 L161 187 L161 177 L160 176 L159 170 L155 163 L145 154 L131 147 L129 147 L128 146 L123 145 L120 143 L115 142 L112 140 L110 140 L107 138 L105 138 L102 136 L95 134 L83 128 L77 123 L76 123 L68 115 L66 110 L67 109 L70 109 L71 108 L91 108 L92 107 L108 107 L109 106 L122 106 L123 107 L131 107 L132 108 L136 108 L137 109 L143 110 L154 116 L168 127 L172 128 L173 129 L176 129 L177 130 L184 130 L185 129 L189 129 L190 128 L193 128 L194 127 L197 127 L198 126 L201 126 L202 125 L207 125 L208 124 L240 124 L241 123 L245 123 L249 121 L251 121 L252 122 L252 132 L251 133 L251 136 L244 150 L233 161 L232 161 L227 165 L221 168 L219 168 L216 170 L211 171 L208 173 L200 175 L191 180 L185 186 L180 196 L180 200 L179 201 L179 216 L180 217 L180 222 L181 223 L181 228 L182 229 L182 236 L183 237 L183 245 L184 246 L184 261 L185 262 L185 264 L190 268 L195 268 L197 267 L200 263 L200 245 L199 244 L198 228 L197 227 L197 222 L196 221 L196 216 L195 215 L195 202 L196 201 L196 199 L202 192 L208 189 L210 189 L211 188 L219 186 L222 184 L224 184 L238 177 L244 172 L245 172 L258 158 L259 155 L261 153 L263 149 L263 147 L265 144 L265 142 L267 138 L267 134 L268 133 L268 118 L265 111 L260 106 L258 106 L257 105 L248 105 L247 106 L244 106 L243 107 L240 107 L239 108 L207 108 L206 109 L201 109 L200 110 L197 110 L196 111 L193 111 L192 112 L188 112 L187 113 L184 113 L183 114 L178 114 L173 111 L165 104 L151 96 L149 96 L142 93 L139 93 L138 92 L133 92 L132 91 L124 91 L123 90 L91 91 L90 92 L70 92 L69 93 L65 93 L64 94 L62 94 Z",
				"M77 81 L71 87 L71 89 L70 90 L70 99 L76 112 L80 116 L80 117 L87 124 L88 124 L95 130 L96 130 L104 136 L107 137 L109 139 L112 140 L117 144 L120 145 L122 147 L127 149 L129 151 L132 152 L134 154 L140 157 L149 165 L151 169 L151 177 L150 178 L149 183 L146 189 L144 191 L138 203 L138 205 L134 212 L134 214 L131 220 L131 222 L129 226 L129 229 L127 233 L127 237 L126 238 L126 242 L125 243 L125 248 L124 249 L124 254 L123 255 L123 259 L122 261 L123 262 L124 266 L130 269 L134 268 L138 264 L139 256 L140 255 L140 250 L141 249 L141 244 L142 243 L142 239 L143 238 L143 235 L145 231 L145 228 L147 225 L147 223 L150 217 L150 215 L166 183 L166 179 L167 178 L167 167 L164 161 L164 159 L156 149 L155 149 L148 143 L145 142 L143 140 L140 139 L133 134 L123 129 L121 127 L115 124 L110 120 L107 119 L100 113 L99 113 L88 101 L86 96 L88 94 L97 94 L98 95 L106 95 L107 96 L113 96 L114 97 L123 97 L124 98 L139 99 L140 100 L143 100 L144 101 L147 101 L148 102 L156 104 L162 107 L168 112 L169 112 L184 128 L192 133 L195 133 L196 134 L230 134 L231 135 L236 135 L237 136 L241 136 L242 137 L245 137 L246 138 L252 138 L253 139 L260 139 L261 138 L266 138 L267 139 L267 145 L266 146 L265 151 L262 155 L261 158 L259 160 L259 161 L247 172 L239 176 L237 176 L230 179 L225 179 L224 180 L219 180 L218 181 L205 182 L204 183 L196 185 L191 189 L190 189 L184 196 L181 202 L181 205 L180 206 L180 212 L179 213 L179 216 L180 217 L180 226 L181 227 L181 233 L182 234 L182 240 L183 241 L184 263 L188 268 L190 268 L191 269 L197 267 L200 262 L199 240 L198 239 L198 233 L197 232 L197 226 L196 225 L196 216 L195 215 L197 205 L202 200 L206 199 L207 198 L211 198 L212 197 L219 197 L220 196 L225 196 L226 195 L231 195 L232 194 L235 194 L236 193 L242 192 L245 190 L247 190 L253 187 L255 185 L259 183 L263 179 L264 179 L273 169 L280 156 L280 154 L282 150 L282 147 L283 146 L283 133 L282 132 L282 130 L277 124 L273 122 L260 122 L259 123 L254 123 L253 122 L247 122 L246 121 L238 120 L237 119 L232 119 L231 118 L198 118 L196 117 L191 112 L191 111 L176 97 L161 89 L159 89 L156 87 L150 86 L149 85 L145 85 L144 84 L141 84 L140 83 L134 83 L133 82 L124 82 L123 81 L115 81 L114 80 L108 80 L107 79 L99 79 L98 78 L87 78 L86 79 L82 79 L81 80 Z",
				"M105 66 L98 70 L94 78 L94 85 L95 86 L96 93 L100 101 L102 103 L103 106 L106 109 L106 110 L128 132 L129 132 L138 141 L139 141 L146 148 L147 148 L154 155 L154 156 L158 161 L158 170 L154 178 L141 197 L136 207 L136 209 L134 212 L134 214 L132 217 L132 219 L130 222 L130 224 L128 228 L128 231 L127 232 L127 235 L126 236 L126 239 L125 240 L125 244 L124 245 L123 256 L122 257 L122 263 L125 267 L127 268 L132 268 L134 267 L138 262 L138 258 L139 257 L139 252 L140 251 L141 241 L142 240 L142 237 L143 236 L146 225 L148 222 L150 215 L156 203 L166 189 L167 186 L169 184 L172 178 L172 176 L174 172 L174 159 L173 158 L172 153 L170 151 L169 148 L165 144 L165 143 L143 123 L142 123 L130 111 L129 111 L117 98 L114 92 L112 90 L112 88 L110 84 L110 82 L111 81 L113 81 L114 82 L118 82 L119 83 L122 83 L123 84 L126 84 L129 86 L132 86 L133 87 L135 87 L139 89 L142 89 L143 90 L145 90 L152 93 L155 93 L161 96 L163 96 L166 98 L168 98 L170 100 L175 102 L177 104 L181 106 L191 116 L200 131 L207 138 L211 140 L217 141 L218 142 L222 142 L223 143 L229 143 L230 144 L235 144 L236 145 L243 146 L246 148 L253 150 L260 154 L262 154 L266 156 L269 156 L270 157 L277 157 L280 159 L279 164 L275 171 L265 181 L254 187 L252 187 L251 188 L247 188 L246 189 L240 189 L239 190 L207 188 L206 189 L201 189 L200 190 L195 191 L187 197 L187 198 L184 201 L180 210 L179 222 L180 223 L180 231 L181 232 L182 244 L183 245 L183 262 L184 263 L184 265 L187 268 L193 269 L195 268 L199 263 L199 244 L198 243 L198 237 L197 236 L197 231 L196 230 L196 222 L195 221 L195 218 L196 217 L196 212 L197 210 L201 206 L203 205 L206 205 L207 204 L213 204 L214 205 L229 205 L230 206 L240 206 L241 205 L247 205 L248 204 L256 203 L268 198 L270 196 L273 195 L276 192 L277 192 L286 183 L286 182 L290 177 L291 174 L293 172 L293 170 L296 163 L296 152 L294 148 L288 143 L286 143 L285 142 L279 142 L278 141 L272 141 L271 140 L263 138 L256 134 L254 134 L251 132 L249 132 L245 130 L237 129 L236 128 L231 128 L230 127 L224 127 L223 126 L219 126 L215 124 L211 119 L210 116 L208 114 L205 108 L194 96 L193 96 L189 92 L188 92 L183 88 L171 82 L169 82 L166 80 L164 80 L163 79 L161 79 L154 76 L151 76 L147 74 L144 74 L143 73 L141 73 L140 72 L138 72 L137 71 L135 71 L128 68 L121 67 L120 66 L115 66 L114 65 Z",
				"M130 57 L124 60 L122 62 L119 68 L119 73 L118 74 L118 76 L119 77 L119 84 L121 88 L121 91 L123 94 L123 96 L127 104 L131 109 L132 112 L135 115 L140 123 L150 135 L153 140 L161 149 L165 157 L165 163 L164 164 L163 168 L161 170 L159 174 L145 191 L142 197 L140 199 L135 209 L135 211 L133 214 L131 221 L129 224 L129 227 L128 228 L127 234 L126 235 L126 238 L125 239 L125 243 L124 244 L124 248 L123 249 L122 258 L121 259 L122 263 L124 266 L130 268 L131 267 L133 267 L137 263 L137 260 L138 259 L138 256 L139 255 L140 245 L141 244 L141 240 L143 236 L143 233 L144 232 L145 227 L147 224 L147 222 L151 214 L151 212 L153 210 L155 205 L157 203 L159 199 L163 195 L163 194 L167 190 L167 189 L175 179 L180 169 L180 165 L181 164 L181 155 L180 154 L180 151 L176 143 L168 133 L168 132 L160 123 L158 119 L154 115 L152 111 L142 98 L137 88 L137 86 L135 82 L135 77 L134 76 L134 74 L135 73 L139 73 L144 76 L146 76 L148 78 L177 92 L179 94 L184 96 L187 99 L191 101 L202 112 L202 113 L204 115 L205 118 L208 122 L208 124 L210 127 L210 129 L212 132 L212 134 L214 138 L219 144 L228 149 L230 149 L236 152 L239 152 L245 155 L247 155 L255 159 L269 169 L281 175 L287 176 L289 178 L287 182 L281 189 L280 189 L274 194 L262 199 L257 199 L256 200 L244 200 L243 199 L238 199 L237 198 L229 197 L225 195 L217 194 L216 193 L212 193 L211 192 L203 192 L202 193 L198 193 L197 194 L193 195 L190 198 L189 198 L185 202 L181 209 L180 217 L179 218 L179 228 L180 229 L181 239 L182 240 L182 247 L183 248 L183 264 L186 268 L188 269 L193 269 L197 266 L199 262 L199 247 L198 246 L198 239 L197 238 L197 233 L196 232 L196 228 L195 227 L195 218 L196 217 L197 213 L201 209 L203 209 L204 208 L210 208 L211 209 L215 209 L216 210 L219 210 L220 211 L223 211 L224 212 L227 212 L228 213 L232 213 L233 214 L237 214 L238 215 L242 215 L243 216 L257 216 L258 215 L263 215 L264 214 L268 214 L269 213 L274 212 L282 208 L288 203 L289 203 L299 193 L300 190 L303 186 L303 184 L305 180 L305 173 L304 172 L303 168 L299 164 L280 157 L263 145 L255 141 L253 141 L250 139 L236 135 L230 132 L228 130 L226 126 L226 124 L224 121 L224 119 L216 104 L204 91 L203 91 L199 87 L198 87 L190 81 L179 76 L175 73 L173 73 L169 71 L167 69 L147 59 L145 59 L141 57 Z",
				"M152 52 L151 53 L147 54 L142 59 L140 63 L139 69 L138 70 L138 84 L139 85 L139 89 L140 90 L140 93 L141 94 L144 105 L158 133 L160 135 L162 140 L164 142 L169 152 L170 158 L165 168 L146 190 L146 191 L140 199 L134 211 L134 213 L130 221 L130 223 L127 230 L126 237 L125 238 L124 247 L123 248 L122 256 L121 257 L121 262 L122 264 L126 267 L132 267 L136 264 L137 262 L137 259 L138 258 L138 253 L139 252 L139 249 L140 248 L140 244 L141 243 L142 236 L143 235 L146 224 L148 221 L148 219 L151 214 L151 212 L160 198 L173 184 L173 183 L179 176 L180 173 L182 171 L184 167 L184 165 L185 164 L185 160 L186 159 L186 154 L185 153 L185 149 L183 146 L183 144 L179 136 L177 134 L175 129 L173 127 L170 120 L168 118 L161 104 L161 102 L158 97 L158 95 L155 88 L155 84 L154 83 L154 71 L156 68 L161 70 L163 72 L167 74 L179 84 L183 86 L186 89 L187 89 L197 97 L198 97 L209 108 L216 119 L216 121 L218 124 L218 127 L219 128 L221 139 L224 145 L228 150 L229 150 L232 153 L255 164 L261 169 L262 169 L277 183 L278 183 L284 188 L291 191 L293 193 L293 194 L285 202 L277 206 L275 206 L271 208 L265 208 L264 209 L247 207 L243 205 L240 205 L232 201 L227 200 L224 198 L222 198 L215 195 L211 195 L210 194 L201 194 L200 195 L197 195 L194 197 L192 197 L189 200 L188 200 L183 206 L180 213 L180 217 L179 218 L179 230 L180 231 L181 241 L182 242 L182 262 L183 263 L183 265 L188 269 L193 269 L195 268 L198 264 L198 241 L197 240 L197 235 L196 234 L196 230 L195 229 L195 219 L196 218 L197 214 L200 211 L202 210 L209 210 L210 211 L213 211 L214 212 L219 213 L222 215 L224 215 L227 217 L232 218 L235 220 L237 220 L241 222 L244 222 L245 223 L249 223 L250 224 L258 224 L259 225 L272 224 L273 223 L277 223 L283 220 L285 220 L297 213 L305 205 L309 197 L309 193 L310 191 L309 190 L309 187 L305 181 L289 172 L274 158 L273 158 L270 155 L269 155 L261 149 L240 139 L237 136 L236 134 L236 131 L235 130 L234 122 L233 121 L232 116 L227 106 L220 97 L220 96 L211 87 L210 87 L201 79 L200 79 L187 69 L183 67 L175 60 L169 57 L167 55 L160 53 L159 52 Z",
				"M171 50 L165 51 L161 53 L156 58 L152 66 L151 74 L150 75 L150 92 L151 93 L151 98 L152 99 L153 106 L154 107 L154 109 L155 110 L159 124 L161 127 L163 134 L168 143 L168 145 L171 151 L171 159 L164 170 L156 178 L156 179 L149 186 L149 187 L143 194 L134 211 L134 213 L132 216 L132 218 L130 221 L130 223 L127 230 L127 233 L126 234 L126 237 L125 238 L125 241 L124 242 L124 246 L123 247 L123 250 L122 251 L122 255 L121 256 L121 262 L122 264 L126 267 L131 267 L136 263 L137 261 L137 258 L138 257 L139 247 L140 246 L141 239 L143 235 L143 232 L145 229 L146 224 L151 214 L151 212 L160 198 L179 177 L182 171 L184 169 L186 162 L187 161 L187 149 L186 148 L184 140 L180 133 L180 131 L174 119 L174 117 L173 116 L173 114 L172 113 L172 111 L169 104 L169 101 L168 100 L168 97 L167 96 L167 92 L166 91 L166 76 L167 75 L168 69 L170 67 L172 67 L174 69 L175 69 L191 85 L192 85 L198 91 L199 91 L216 109 L222 120 L222 123 L223 124 L223 127 L224 128 L224 134 L225 135 L225 140 L226 141 L226 144 L230 151 L233 154 L234 154 L242 160 L247 162 L249 164 L257 168 L262 173 L263 173 L283 194 L284 194 L288 198 L292 200 L295 203 L289 209 L285 211 L277 213 L276 214 L261 214 L260 213 L256 213 L255 212 L252 212 L251 211 L246 210 L226 200 L224 200 L221 198 L219 198 L212 195 L203 194 L202 195 L198 195 L191 198 L183 206 L182 210 L180 213 L180 216 L179 217 L179 230 L180 231 L180 237 L181 238 L181 241 L182 242 L182 263 L186 268 L188 269 L193 269 L195 268 L198 264 L198 241 L197 240 L196 230 L195 229 L195 219 L198 213 L201 211 L206 210 L207 211 L213 212 L223 217 L225 217 L238 224 L240 224 L241 225 L243 225 L250 228 L253 228 L254 229 L259 229 L260 230 L277 230 L278 229 L285 228 L291 225 L293 225 L301 220 L308 213 L311 206 L311 198 L309 194 L304 189 L296 184 L281 169 L281 168 L270 158 L269 158 L260 151 L245 143 L242 140 L241 138 L241 134 L240 133 L239 122 L238 121 L238 118 L235 112 L235 110 L227 97 L222 92 L222 91 L212 81 L211 81 L204 74 L203 74 L186 57 L178 52 L172 51 Z",
				"M181 50 L175 50 L168 53 L163 58 L157 70 L157 73 L156 74 L156 77 L155 78 L155 85 L154 86 L155 103 L156 104 L156 108 L157 109 L157 113 L158 114 L158 117 L160 121 L160 124 L161 125 L164 136 L166 139 L166 141 L168 144 L168 146 L170 150 L170 158 L169 159 L168 163 L166 165 L164 169 L153 181 L153 182 L143 194 L134 211 L133 216 L130 221 L130 223 L127 230 L127 233 L126 234 L126 237 L125 238 L125 241 L124 242 L124 246 L123 247 L123 250 L122 251 L122 255 L121 256 L121 262 L122 264 L126 267 L131 267 L136 263 L137 261 L137 258 L138 257 L139 247 L140 246 L141 239 L143 235 L143 232 L145 229 L146 224 L151 214 L151 212 L160 198 L178 177 L178 176 L182 171 L182 169 L185 164 L185 161 L186 160 L186 149 L185 148 L185 145 L184 144 L183 139 L181 136 L180 131 L178 128 L178 126 L175 119 L175 116 L174 115 L174 112 L173 111 L173 108 L172 107 L172 103 L171 102 L171 95 L170 94 L170 86 L171 85 L171 80 L172 79 L172 76 L175 69 L178 66 L179 66 L187 74 L187 75 L192 80 L192 81 L213 102 L213 103 L219 110 L223 118 L224 124 L225 125 L226 142 L231 152 L234 155 L235 155 L240 159 L243 160 L245 162 L248 163 L250 165 L257 169 L261 173 L262 173 L269 180 L269 181 L276 188 L276 189 L291 204 L292 204 L295 207 L295 209 L293 211 L285 215 L282 215 L281 216 L263 216 L262 215 L256 214 L250 211 L248 211 L225 199 L223 199 L220 197 L218 197 L214 195 L211 195 L210 194 L200 194 L199 195 L196 195 L192 197 L190 199 L189 199 L183 206 L181 210 L181 212 L180 213 L180 217 L179 218 L179 230 L180 231 L181 241 L182 242 L182 263 L183 265 L188 269 L193 269 L195 268 L198 264 L198 241 L197 240 L196 230 L195 229 L195 219 L196 218 L197 214 L202 210 L208 210 L209 211 L212 211 L240 225 L242 225 L250 229 L253 229 L254 230 L257 230 L258 231 L262 231 L263 232 L282 232 L283 231 L287 231 L288 230 L293 229 L299 226 L305 221 L306 221 L306 220 L309 217 L312 210 L312 206 L311 205 L311 202 L310 200 L305 194 L304 194 L292 183 L292 182 L286 176 L286 175 L280 169 L280 168 L265 155 L264 155 L259 151 L256 150 L254 148 L251 147 L243 141 L242 139 L242 135 L241 134 L241 125 L240 124 L240 119 L239 118 L238 113 L236 110 L236 108 L228 95 L224 91 L224 90 L203 69 L203 68 L191 55 Z",
				"M183 50 L177 50 L176 51 L174 51 L170 53 L164 59 L158 70 L158 72 L155 79 L155 83 L154 84 L154 107 L155 108 L156 118 L157 119 L159 130 L160 131 L161 136 L163 139 L164 144 L167 150 L167 160 L161 171 L141 197 L135 209 L133 216 L130 221 L130 223 L127 230 L126 237 L125 238 L125 242 L124 243 L124 247 L123 248 L122 255 L121 256 L121 262 L122 264 L126 267 L131 267 L136 263 L137 261 L137 258 L138 257 L138 253 L139 252 L140 243 L141 242 L142 236 L143 235 L146 224 L148 221 L148 219 L155 205 L157 203 L159 199 L175 179 L176 176 L178 174 L181 168 L181 166 L183 162 L183 148 L182 147 L179 136 L177 133 L177 131 L174 124 L174 121 L173 120 L173 118 L172 117 L172 113 L171 112 L171 107 L170 106 L170 84 L171 83 L171 81 L172 80 L172 78 L174 75 L175 71 L180 66 L181 66 L186 71 L188 75 L196 84 L196 85 L210 99 L210 100 L217 108 L223 122 L223 129 L224 130 L224 140 L228 149 L233 154 L239 157 L241 159 L246 161 L248 163 L258 169 L273 184 L273 185 L277 189 L277 190 L295 208 L295 209 L290 213 L288 213 L284 215 L277 215 L276 216 L273 216 L272 215 L265 215 L264 214 L261 214 L260 213 L252 211 L226 198 L224 198 L221 196 L219 196 L215 194 L212 194 L211 193 L199 193 L192 196 L190 198 L189 198 L183 205 L181 212 L180 213 L180 217 L179 218 L179 229 L180 230 L180 235 L181 236 L181 241 L182 242 L182 263 L183 265 L188 269 L193 269 L195 268 L198 264 L198 241 L197 240 L197 235 L196 234 L196 229 L195 228 L195 219 L196 218 L196 215 L197 213 L201 209 L210 209 L211 210 L216 211 L225 216 L227 216 L231 218 L233 220 L237 221 L244 225 L246 225 L247 226 L249 226 L256 229 L259 229 L260 230 L263 230 L264 231 L271 231 L272 232 L277 232 L278 231 L285 231 L286 230 L290 230 L291 229 L293 229 L300 226 L309 218 L312 211 L312 206 L309 199 L288 178 L288 177 L283 172 L283 171 L270 158 L269 158 L266 155 L265 155 L257 149 L247 144 L240 138 L240 130 L239 129 L239 122 L238 121 L238 117 L237 116 L235 108 L233 104 L231 102 L230 99 L225 93 L225 92 L219 86 L219 85 L202 67 L202 66 L196 59 L196 58 L190 53 Z",
				"M181 50 L175 50 L168 53 L159 63 L158 66 L156 68 L156 70 L152 78 L151 86 L150 87 L150 110 L151 111 L151 115 L152 116 L152 121 L153 122 L154 129 L155 130 L156 135 L158 138 L158 140 L160 143 L160 145 L163 152 L163 156 L164 157 L163 158 L163 162 L162 163 L162 165 L158 173 L156 175 L152 182 L149 185 L149 186 L143 194 L142 197 L140 199 L135 209 L135 211 L133 214 L131 221 L129 224 L128 230 L127 231 L126 237 L125 238 L125 242 L124 243 L123 252 L122 253 L122 256 L121 257 L121 262 L122 264 L126 267 L132 267 L136 264 L137 262 L137 259 L138 258 L138 253 L139 252 L139 249 L140 248 L140 244 L141 243 L142 236 L143 235 L145 227 L147 224 L147 222 L149 219 L149 217 L155 205 L173 179 L176 173 L176 171 L178 168 L178 165 L179 164 L179 159 L180 158 L180 156 L179 155 L179 150 L178 149 L177 143 L175 140 L175 138 L171 130 L171 127 L170 126 L169 120 L168 119 L168 116 L167 115 L167 110 L166 109 L166 88 L167 87 L167 84 L172 72 L178 66 L181 68 L181 69 L184 72 L184 73 L187 76 L190 81 L194 85 L194 86 L208 100 L208 101 L214 108 L219 120 L219 125 L220 126 L220 136 L221 137 L221 140 L224 146 L232 153 L243 158 L245 160 L250 162 L259 169 L260 169 L271 180 L271 181 L278 188 L278 189 L295 206 L295 207 L293 209 L289 211 L286 211 L285 212 L266 212 L265 211 L262 211 L261 210 L250 207 L236 200 L234 200 L229 197 L227 197 L224 195 L222 195 L215 192 L211 192 L210 191 L201 191 L200 192 L197 192 L191 195 L188 198 L187 198 L187 199 L184 202 L182 206 L182 208 L180 212 L180 216 L179 217 L179 227 L180 228 L180 234 L181 235 L181 240 L182 241 L182 251 L183 252 L183 258 L182 259 L183 265 L188 269 L193 269 L195 268 L198 264 L198 260 L199 259 L199 251 L198 250 L198 240 L197 239 L196 227 L195 226 L195 218 L196 217 L196 214 L198 210 L202 207 L209 207 L210 208 L213 208 L214 209 L219 210 L224 213 L226 213 L235 218 L237 218 L247 223 L249 223 L253 225 L256 225 L260 227 L264 227 L265 228 L286 228 L287 227 L291 227 L292 226 L294 226 L305 220 L308 217 L311 212 L312 205 L311 204 L311 201 L309 197 L288 176 L288 175 L281 168 L281 167 L274 160 L273 160 L264 152 L258 149 L256 147 L240 139 L236 135 L236 126 L235 125 L235 119 L234 118 L234 115 L233 114 L232 109 L227 99 L225 97 L223 93 L218 88 L218 87 L204 73 L204 72 L200 68 L196 61 L188 53 Z",
				"M176 50 L171 50 L170 51 L168 51 L162 54 L157 59 L150 70 L150 72 L147 77 L146 83 L145 84 L145 90 L144 91 L144 108 L145 109 L145 115 L146 116 L146 120 L147 121 L147 124 L148 125 L148 128 L149 129 L150 134 L152 137 L152 139 L155 144 L155 146 L157 149 L157 151 L159 155 L159 165 L154 177 L152 179 L145 192 L141 197 L136 207 L136 209 L131 219 L131 221 L130 222 L130 224 L127 231 L127 234 L126 235 L126 238 L125 239 L125 243 L124 244 L124 248 L123 249 L123 252 L122 253 L122 256 L121 257 L121 262 L122 264 L126 267 L132 267 L136 264 L137 262 L137 259 L138 258 L138 255 L139 254 L139 250 L140 249 L141 240 L142 239 L143 233 L146 227 L147 222 L149 219 L149 217 L155 205 L157 203 L158 200 L160 198 L161 195 L166 188 L174 171 L174 167 L175 166 L175 152 L174 151 L173 146 L171 143 L171 141 L168 136 L168 134 L165 129 L165 127 L163 123 L163 120 L162 119 L162 115 L161 114 L161 108 L160 107 L160 91 L161 90 L161 86 L166 74 L173 66 L179 72 L183 79 L188 84 L188 85 L206 103 L206 104 L210 109 L212 113 L213 118 L214 119 L214 124 L215 125 L215 132 L216 133 L216 136 L217 137 L218 141 L221 144 L221 145 L222 145 L225 148 L250 160 L252 162 L256 164 L260 168 L261 168 L274 181 L274 182 L295 202 L292 205 L288 206 L287 207 L283 207 L282 208 L269 208 L268 207 L263 207 L262 206 L259 206 L258 205 L247 202 L244 200 L239 199 L229 194 L227 194 L223 192 L220 192 L216 190 L212 190 L211 189 L201 189 L200 190 L194 191 L192 193 L191 193 L183 202 L181 209 L180 210 L180 216 L179 217 L180 232 L181 233 L182 247 L183 248 L183 264 L184 266 L188 269 L193 269 L198 265 L198 263 L199 262 L199 247 L198 246 L198 239 L197 238 L197 232 L196 231 L195 218 L196 217 L196 212 L198 208 L202 205 L210 205 L211 206 L214 206 L215 207 L226 210 L229 212 L231 212 L239 216 L241 216 L242 217 L244 217 L245 218 L247 218 L254 221 L257 221 L258 222 L261 222 L262 223 L267 223 L268 224 L283 224 L284 223 L293 222 L303 217 L308 212 L311 206 L311 198 L308 192 L298 182 L297 182 L273 157 L272 157 L267 152 L266 152 L261 148 L258 147 L256 145 L244 139 L242 139 L232 133 L231 131 L230 117 L229 116 L227 108 L220 95 L217 92 L217 91 L198 72 L198 71 L194 67 L190 60 L183 53 Z",
				"M163 51 L155 55 L150 60 L142 74 L142 76 L139 83 L139 87 L138 88 L138 93 L137 94 L137 105 L138 106 L138 113 L139 114 L139 118 L140 119 L140 122 L141 123 L141 126 L142 127 L144 135 L155 157 L155 169 L154 170 L154 173 L152 176 L152 178 L148 186 L146 188 L143 195 L141 197 L136 207 L136 209 L134 212 L132 219 L130 222 L130 224 L127 231 L126 239 L125 240 L125 243 L124 244 L124 249 L123 250 L123 253 L122 254 L122 257 L121 258 L121 261 L123 265 L126 267 L130 268 L131 267 L133 267 L136 264 L137 260 L138 259 L138 256 L139 255 L140 245 L141 244 L143 233 L145 230 L145 228 L148 222 L148 220 L150 217 L150 215 L167 183 L167 181 L169 178 L170 171 L171 170 L171 156 L170 155 L170 152 L158 127 L158 125 L156 121 L156 118 L155 117 L155 113 L154 112 L154 105 L153 104 L153 95 L154 94 L154 89 L155 88 L156 82 L161 72 L166 67 L167 67 L172 72 L172 73 L178 80 L178 81 L188 91 L189 91 L203 106 L208 117 L208 120 L209 121 L209 127 L210 128 L210 132 L211 133 L211 135 L215 140 L215 141 L222 146 L226 147 L229 149 L231 149 L234 151 L236 151 L241 154 L243 154 L255 161 L267 172 L268 172 L282 186 L283 186 L294 196 L294 197 L292 199 L288 201 L285 201 L284 202 L278 202 L277 203 L271 203 L270 202 L262 202 L261 201 L254 200 L253 199 L251 199 L244 196 L241 196 L238 194 L236 194 L235 193 L233 193 L226 190 L223 190 L222 189 L219 189 L218 188 L214 188 L213 187 L200 187 L199 188 L192 190 L187 194 L182 202 L182 204 L180 208 L180 215 L179 216 L179 220 L180 221 L180 231 L181 232 L182 245 L183 246 L183 264 L185 266 L185 267 L189 269 L193 269 L198 265 L198 263 L199 262 L199 245 L198 244 L198 237 L197 236 L197 231 L196 230 L196 220 L195 219 L195 217 L196 216 L196 210 L198 206 L200 204 L202 203 L212 203 L213 204 L220 205 L221 206 L223 206 L224 207 L226 207 L227 208 L229 208 L230 209 L232 209 L233 210 L235 210 L236 211 L238 211 L245 214 L248 214 L252 216 L256 216 L257 217 L261 217 L262 218 L269 218 L270 219 L278 219 L279 218 L286 218 L287 217 L290 217 L291 216 L296 215 L303 211 L309 204 L309 202 L310 201 L310 192 L308 188 L302 181 L301 181 L297 177 L296 177 L267 150 L263 148 L260 145 L244 137 L242 137 L239 135 L234 134 L228 131 L226 129 L226 127 L225 126 L225 121 L224 120 L224 115 L223 114 L223 111 L220 106 L220 104 L218 100 L216 98 L214 94 L208 88 L208 87 L189 69 L189 68 L186 65 L183 60 L176 53 L172 51 Z",
				"M155 52 L154 53 L150 54 L141 63 L140 66 L138 68 L136 72 L136 74 L134 77 L133 82 L132 83 L131 93 L130 94 L130 106 L131 107 L131 113 L132 114 L132 117 L133 118 L133 122 L134 123 L137 134 L143 146 L145 148 L147 153 L149 155 L149 157 L151 160 L152 169 L151 170 L151 175 L150 176 L149 182 L137 205 L137 207 L135 210 L135 212 L132 217 L131 222 L129 225 L129 228 L128 229 L127 235 L126 236 L126 239 L125 240 L125 244 L124 245 L123 254 L122 255 L122 258 L121 259 L123 265 L128 268 L131 268 L135 266 L135 265 L137 263 L138 257 L139 256 L139 251 L140 250 L141 241 L142 240 L142 237 L143 236 L145 228 L147 225 L147 223 L150 217 L150 215 L162 192 L162 190 L164 187 L164 185 L166 181 L166 177 L167 176 L167 171 L168 170 L167 158 L166 157 L165 152 L160 142 L158 140 L156 135 L154 133 L154 131 L151 126 L151 124 L149 120 L149 117 L148 116 L148 113 L147 112 L147 106 L146 105 L146 95 L147 94 L147 89 L148 88 L148 85 L153 74 L158 68 L160 68 L164 72 L166 76 L172 82 L172 83 L180 90 L181 90 L187 96 L188 96 L197 106 L203 120 L204 129 L207 135 L213 141 L219 144 L237 149 L251 156 L253 158 L257 160 L261 164 L262 164 L269 171 L270 171 L275 176 L276 176 L293 190 L293 191 L289 194 L287 194 L283 196 L278 196 L277 197 L265 197 L264 196 L258 196 L257 195 L253 195 L252 194 L241 192 L237 190 L234 190 L233 189 L227 188 L226 187 L223 187 L222 186 L218 186 L217 185 L209 185 L208 184 L205 184 L204 185 L199 185 L190 189 L186 193 L181 202 L179 218 L180 219 L180 229 L181 230 L181 235 L182 236 L182 244 L183 245 L183 263 L187 268 L189 269 L193 269 L195 268 L199 263 L199 244 L198 243 L198 236 L197 235 L197 229 L196 228 L196 218 L195 216 L196 215 L196 208 L197 207 L197 205 L201 201 L205 201 L206 200 L208 201 L216 201 L217 202 L228 204 L232 206 L235 206 L239 208 L242 208 L243 209 L246 209 L247 210 L251 210 L252 211 L256 211 L257 212 L263 212 L264 213 L278 213 L279 212 L284 212 L285 211 L292 210 L300 206 L303 203 L304 203 L304 202 L307 199 L308 195 L309 194 L309 187 L308 186 L307 182 L303 178 L303 177 L302 177 L297 172 L296 172 L289 166 L288 166 L274 153 L273 153 L265 146 L247 136 L245 136 L242 134 L240 134 L239 133 L237 133 L236 132 L234 132 L233 131 L231 131 L230 130 L228 130 L221 127 L219 123 L219 119 L218 118 L218 114 L217 113 L216 108 L212 100 L210 98 L208 94 L202 88 L202 87 L201 87 L193 79 L192 79 L187 74 L186 74 L181 69 L181 68 L178 65 L175 60 L170 55 L164 52 Z",
				"M147 53 L141 56 L132 66 L127 76 L127 78 L125 82 L125 85 L124 86 L124 91 L123 92 L123 110 L124 111 L124 115 L125 116 L126 123 L133 140 L135 142 L137 147 L142 153 L143 156 L145 158 L147 162 L147 164 L148 165 L148 170 L149 171 L148 173 L148 180 L147 181 L146 187 L138 203 L138 205 L134 212 L133 217 L131 220 L131 222 L128 229 L128 232 L127 233 L127 236 L126 237 L126 241 L125 242 L125 246 L124 247 L123 255 L122 256 L122 263 L125 267 L127 268 L132 268 L136 265 L138 261 L138 258 L139 257 L139 252 L140 251 L140 247 L141 246 L141 242 L142 241 L143 234 L146 228 L146 226 L147 225 L148 220 L150 217 L150 215 L160 195 L160 193 L163 186 L163 182 L164 181 L164 174 L165 173 L165 170 L164 169 L164 163 L163 162 L163 159 L160 154 L160 152 L149 136 L144 126 L144 124 L142 121 L140 110 L139 109 L139 92 L140 91 L141 84 L143 81 L144 77 L151 69 L168 87 L169 87 L181 97 L182 97 L189 104 L195 114 L198 127 L201 133 L204 136 L214 141 L217 141 L218 142 L221 142 L222 143 L225 143 L229 145 L235 146 L252 154 L271 169 L275 171 L278 174 L282 176 L291 183 L291 184 L286 188 L280 189 L279 190 L273 190 L272 191 L253 190 L252 189 L247 189 L246 188 L243 188 L242 187 L238 187 L237 186 L234 186 L233 185 L228 185 L227 184 L224 184 L223 183 L217 183 L216 182 L201 182 L200 183 L194 184 L192 186 L188 188 L184 193 L181 199 L181 202 L180 203 L180 209 L179 210 L179 216 L180 217 L180 227 L181 228 L181 234 L182 235 L182 241 L183 242 L183 262 L184 263 L184 265 L187 268 L193 269 L195 268 L199 263 L199 242 L198 241 L198 234 L197 233 L197 227 L196 226 L196 216 L195 215 L195 211 L196 210 L196 204 L200 199 L202 199 L203 198 L215 198 L216 199 L222 199 L223 200 L231 201 L232 202 L240 203 L241 204 L245 204 L246 205 L260 206 L261 207 L273 207 L274 206 L280 206 L281 205 L285 205 L286 204 L291 203 L300 198 L304 194 L307 189 L307 179 L305 175 L297 167 L287 161 L270 147 L269 147 L258 139 L243 132 L241 132 L234 129 L223 127 L222 126 L215 124 L213 122 L210 109 L205 99 L199 92 L199 91 L194 86 L193 86 L184 78 L180 76 L175 71 L174 71 L168 64 L168 63 L161 56 L155 53 Z",
				"M138 55 L137 56 L133 57 L123 68 L120 74 L120 76 L118 79 L118 82 L117 83 L117 85 L116 86 L116 90 L115 91 L115 110 L116 111 L116 115 L117 116 L117 119 L118 120 L120 128 L128 144 L133 150 L133 151 L137 155 L137 156 L143 164 L144 168 L145 169 L145 172 L146 173 L146 182 L145 183 L145 187 L144 188 L143 193 L141 196 L141 198 L138 203 L138 205 L133 215 L133 217 L130 223 L129 229 L127 233 L127 237 L126 238 L126 241 L125 242 L124 252 L123 253 L123 256 L122 257 L122 262 L124 266 L125 266 L127 268 L133 268 L135 266 L136 266 L138 262 L138 259 L139 258 L139 253 L140 252 L140 249 L141 248 L141 243 L142 242 L143 235 L144 234 L147 223 L151 215 L151 213 L155 206 L155 204 L159 196 L159 193 L160 192 L160 189 L161 188 L161 184 L162 183 L162 172 L161 171 L161 167 L160 166 L159 161 L153 150 L150 147 L150 146 L140 133 L135 123 L135 121 L132 114 L132 110 L131 109 L131 92 L132 91 L132 88 L137 76 L141 71 L142 71 L153 83 L154 83 L161 89 L164 90 L170 95 L174 97 L184 107 L188 114 L188 116 L189 117 L189 119 L190 120 L192 127 L198 134 L207 138 L211 138 L212 139 L217 139 L218 140 L227 141 L228 142 L231 142 L232 143 L237 144 L240 146 L242 146 L248 149 L250 151 L253 152 L255 154 L256 154 L273 166 L276 167 L281 171 L284 172 L289 176 L283 181 L281 181 L277 183 L273 183 L272 184 L249 184 L248 183 L240 183 L239 182 L227 181 L226 180 L218 180 L217 179 L203 179 L202 180 L198 180 L197 181 L195 181 L188 185 L183 191 L180 198 L180 203 L179 204 L179 215 L180 216 L180 225 L181 226 L182 240 L183 241 L183 261 L186 267 L190 269 L193 269 L197 267 L197 266 L199 264 L199 240 L198 239 L198 232 L197 231 L196 216 L195 215 L195 205 L196 204 L196 201 L199 197 L203 196 L204 195 L216 195 L217 196 L226 196 L227 197 L232 197 L233 198 L238 198 L239 199 L247 199 L248 200 L273 200 L274 199 L278 199 L279 198 L282 198 L283 197 L288 196 L297 191 L302 186 L305 180 L305 173 L304 172 L303 168 L295 160 L292 159 L287 155 L284 154 L282 152 L281 152 L273 146 L270 145 L267 142 L259 138 L257 136 L245 130 L243 130 L242 129 L240 129 L233 126 L229 126 L228 125 L224 125 L223 124 L219 124 L218 123 L213 123 L212 122 L209 122 L205 117 L203 109 L198 99 L186 86 L185 86 L182 83 L165 72 L152 58 L146 55 Z",
				"M126 58 L122 60 L117 65 L117 66 L113 71 L108 83 L108 87 L107 88 L107 92 L106 93 L106 110 L107 111 L108 119 L109 120 L110 125 L112 128 L112 130 L121 146 L133 159 L133 160 L140 168 L143 175 L143 180 L144 181 L143 191 L142 192 L140 200 L138 203 L138 205 L136 208 L136 210 L134 213 L134 215 L132 218 L131 223 L129 226 L129 229 L128 230 L128 233 L127 234 L127 237 L126 238 L125 248 L124 249 L124 254 L123 255 L123 258 L122 259 L122 262 L124 266 L125 266 L127 268 L133 268 L135 267 L138 263 L139 255 L140 254 L140 250 L141 249 L142 239 L144 235 L144 232 L145 231 L147 223 L149 220 L151 213 L156 203 L157 197 L159 193 L159 187 L160 186 L159 173 L158 172 L157 167 L152 157 L135 138 L135 137 L131 132 L125 120 L125 118 L123 114 L123 110 L122 109 L122 94 L123 93 L123 89 L124 88 L125 83 L128 77 L131 74 L132 74 L146 87 L154 91 L156 93 L161 95 L170 102 L171 102 L178 110 L185 126 L191 132 L198 134 L199 135 L204 135 L205 136 L214 136 L215 137 L221 137 L222 138 L227 138 L228 139 L234 140 L237 142 L239 142 L242 144 L244 144 L248 146 L250 148 L257 151 L259 153 L264 155 L266 157 L279 163 L285 168 L281 172 L277 173 L271 176 L268 176 L267 177 L246 178 L245 177 L231 177 L230 176 L203 176 L202 177 L198 177 L197 178 L195 178 L189 181 L183 187 L180 193 L180 196 L179 197 L179 216 L180 217 L181 231 L182 232 L182 238 L183 239 L184 264 L188 268 L192 269 L193 268 L197 267 L200 261 L199 238 L198 237 L197 223 L196 222 L196 216 L195 215 L195 199 L198 194 L202 193 L203 192 L229 192 L230 193 L245 193 L246 194 L257 194 L258 193 L267 193 L268 192 L276 191 L277 190 L285 188 L289 185 L292 184 L299 177 L302 170 L302 165 L301 164 L301 162 L299 160 L297 156 L296 156 L292 152 L281 147 L279 145 L277 145 L275 143 L270 141 L268 139 L263 137 L261 135 L247 128 L245 128 L242 126 L240 126 L236 124 L229 123 L228 122 L223 122 L222 121 L215 121 L214 120 L206 120 L205 119 L201 119 L197 115 L195 108 L189 98 L185 94 L185 93 L178 87 L154 73 L143 62 L142 62 L140 60 L136 58 Z",
				"M112 63 L106 68 L106 69 L102 74 L100 78 L99 83 L98 84 L97 92 L96 93 L96 111 L97 112 L97 116 L98 117 L98 120 L101 126 L101 128 L106 138 L108 140 L112 147 L137 172 L140 177 L141 183 L142 184 L142 192 L141 193 L141 196 L140 197 L138 205 L136 208 L136 210 L134 213 L134 215 L132 218 L132 220 L131 221 L131 223 L128 230 L128 233 L127 234 L127 238 L126 239 L126 243 L125 244 L125 249 L124 250 L124 254 L123 255 L123 259 L122 260 L123 264 L125 267 L129 269 L132 269 L136 267 L136 266 L138 264 L138 262 L139 261 L139 257 L140 256 L140 251 L141 250 L141 245 L142 244 L142 240 L143 239 L144 232 L145 231 L146 226 L148 223 L149 218 L154 208 L154 206 L156 202 L156 199 L157 198 L157 194 L158 193 L158 183 L157 182 L157 178 L156 177 L155 172 L152 166 L150 164 L149 161 L133 145 L132 145 L123 135 L120 129 L118 127 L116 123 L116 121 L114 118 L114 115 L113 114 L113 111 L112 110 L112 94 L113 93 L114 86 L117 80 L119 78 L120 78 L129 86 L130 86 L135 90 L139 91 L148 96 L150 96 L163 104 L168 109 L177 125 L181 129 L185 131 L187 131 L188 132 L193 132 L194 133 L217 133 L218 134 L224 134 L225 135 L232 136 L233 137 L238 138 L243 141 L245 141 L258 148 L260 148 L265 151 L267 151 L272 154 L274 154 L281 158 L276 163 L270 166 L268 166 L265 168 L262 168 L261 169 L257 169 L256 170 L249 170 L248 171 L215 171 L214 172 L204 172 L203 173 L199 173 L198 174 L193 175 L189 177 L184 181 L179 190 L179 194 L178 195 L178 208 L179 209 L179 215 L180 216 L180 222 L181 223 L182 236 L183 237 L183 247 L184 248 L184 263 L185 265 L189 268 L195 268 L197 267 L200 263 L200 247 L199 246 L199 236 L198 235 L198 228 L197 227 L196 215 L195 214 L195 209 L194 208 L194 195 L195 193 L197 191 L201 189 L204 189 L205 188 L215 188 L216 187 L249 187 L250 186 L257 186 L258 185 L262 185 L263 184 L266 184 L267 183 L270 183 L271 182 L276 181 L287 175 L294 168 L297 161 L297 154 L295 150 L286 142 L282 141 L277 138 L275 138 L268 134 L266 134 L257 129 L255 129 L243 123 L241 123 L234 120 L231 120 L230 119 L218 118 L217 117 L195 117 L194 116 L191 116 L188 113 L184 104 L178 97 L178 96 L167 87 L151 79 L149 79 L143 76 L137 71 L136 71 L131 66 L126 63 L124 63 L123 62 L115 62 L114 63 Z",
				"M101 68 L93 73 L88 82 L88 84 L86 88 L86 92 L85 93 L85 115 L86 116 L87 123 L89 126 L89 128 L93 136 L95 138 L99 145 L103 149 L103 150 L115 161 L116 161 L126 169 L127 169 L136 178 L140 186 L140 198 L139 199 L138 205 L134 213 L132 221 L130 224 L130 227 L129 228 L128 234 L127 235 L126 244 L125 245 L124 256 L123 257 L123 264 L125 266 L125 267 L129 269 L133 269 L135 268 L138 265 L138 263 L139 262 L139 259 L140 258 L140 252 L141 251 L141 246 L142 245 L142 241 L143 240 L143 236 L144 235 L148 221 L152 213 L152 211 L155 204 L155 201 L156 200 L156 184 L155 183 L154 178 L150 170 L147 167 L147 166 L140 159 L139 159 L135 155 L134 155 L131 152 L130 152 L127 149 L122 146 L114 138 L114 137 L108 130 L103 120 L102 114 L101 113 L101 94 L102 93 L103 87 L106 84 L109 85 L115 90 L125 95 L127 95 L128 96 L142 100 L145 102 L147 102 L149 104 L153 106 L161 114 L165 121 L171 127 L177 130 L196 130 L197 129 L217 129 L218 130 L223 130 L224 131 L228 131 L235 134 L238 134 L244 137 L246 137 L247 138 L249 138 L250 139 L252 139 L253 140 L255 140 L256 141 L270 145 L274 148 L274 149 L267 155 L253 161 L250 161 L249 162 L246 162 L245 163 L240 163 L239 164 L233 164 L232 165 L224 165 L223 166 L208 167 L207 168 L203 168 L202 169 L198 169 L197 170 L195 170 L187 174 L179 183 L178 185 L178 188 L177 189 L177 204 L178 205 L178 210 L179 211 L179 215 L180 216 L180 220 L181 221 L181 227 L182 228 L182 233 L183 234 L183 244 L184 245 L184 262 L188 267 L190 268 L195 268 L197 267 L200 263 L200 244 L199 243 L199 233 L198 232 L198 227 L197 226 L197 220 L196 219 L196 215 L195 214 L195 210 L194 209 L194 204 L193 203 L193 191 L200 185 L208 184 L209 183 L215 183 L216 182 L224 182 L225 181 L233 181 L234 180 L239 180 L240 179 L246 179 L247 178 L255 177 L256 176 L264 174 L269 171 L271 171 L273 169 L276 168 L282 163 L283 163 L288 157 L291 150 L291 145 L290 144 L290 142 L288 138 L284 134 L278 131 L276 131 L273 129 L252 123 L249 121 L247 121 L246 120 L244 120 L237 117 L234 117 L233 116 L230 116 L229 115 L226 115 L225 114 L219 114 L218 113 L196 113 L195 114 L181 114 L177 110 L173 103 L165 95 L164 95 L158 90 L150 86 L148 86 L145 84 L143 84 L142 83 L131 80 L128 78 L126 78 L117 71 L111 68 L108 68 L107 67 Z",
				"M82 78 L77 83 L75 87 L75 89 L73 93 L73 98 L72 99 L72 112 L73 113 L73 119 L74 120 L75 126 L77 129 L77 131 L81 139 L84 142 L86 146 L98 158 L99 158 L108 165 L120 171 L122 173 L129 177 L135 183 L139 190 L139 202 L138 203 L137 208 L135 211 L135 213 L133 216 L133 218 L132 219 L132 221 L129 228 L129 231 L128 232 L128 235 L127 236 L126 246 L125 247 L124 258 L123 259 L123 263 L125 267 L126 267 L128 269 L134 269 L136 267 L137 267 L139 263 L139 261 L140 260 L140 254 L141 253 L141 247 L142 246 L142 242 L143 241 L143 237 L144 236 L145 230 L146 229 L147 224 L149 221 L149 219 L151 216 L151 214 L154 207 L154 204 L155 203 L155 189 L154 188 L154 185 L151 178 L146 172 L146 171 L142 167 L141 167 L137 163 L136 163 L131 159 L119 153 L117 151 L114 150 L111 147 L110 147 L97 134 L97 133 L95 131 L90 121 L89 113 L88 112 L88 99 L89 98 L89 95 L91 92 L94 92 L102 97 L104 97 L111 100 L119 101 L120 102 L124 102 L125 103 L129 103 L130 104 L135 105 L138 107 L140 107 L142 109 L146 111 L159 125 L167 129 L177 129 L178 128 L183 128 L184 127 L187 127 L188 126 L193 126 L194 125 L204 125 L205 124 L210 124 L211 125 L220 125 L221 126 L225 126 L226 127 L234 128 L235 129 L238 129 L239 130 L243 130 L244 131 L247 131 L248 132 L252 132 L253 133 L262 134 L266 136 L265 139 L260 144 L244 153 L242 153 L235 156 L232 156 L231 157 L228 157 L227 158 L224 158 L223 159 L219 159 L218 160 L215 160 L214 161 L211 161 L210 162 L206 162 L202 164 L199 164 L198 165 L193 166 L184 171 L179 177 L176 183 L176 187 L175 188 L175 196 L176 197 L176 202 L177 203 L177 206 L178 207 L178 210 L179 211 L179 215 L180 216 L180 219 L181 220 L181 224 L182 225 L182 231 L183 232 L183 242 L184 243 L184 256 L185 257 L185 263 L186 265 L190 268 L195 268 L197 267 L200 264 L200 262 L201 261 L201 256 L200 255 L200 242 L199 241 L199 231 L198 230 L198 224 L197 223 L196 214 L195 213 L195 210 L194 209 L194 206 L193 205 L193 201 L192 200 L192 196 L191 195 L191 188 L192 186 L195 183 L199 181 L201 181 L208 178 L215 177 L216 176 L225 175 L226 174 L233 173 L237 171 L240 171 L241 170 L249 168 L252 166 L254 166 L265 160 L275 152 L275 151 L279 147 L282 141 L282 131 L280 127 L276 123 L268 119 L260 118 L259 117 L254 117 L253 116 L249 116 L248 115 L245 115 L244 114 L241 114 L240 113 L236 113 L235 112 L232 112 L231 111 L228 111 L227 110 L222 110 L221 109 L204 108 L203 109 L193 109 L192 110 L182 111 L181 112 L177 112 L176 113 L170 113 L159 101 L158 101 L151 95 L143 91 L141 91 L134 88 L131 88 L130 87 L126 87 L125 86 L116 85 L115 84 L110 83 L97 76 L94 76 L93 75 L89 75 Z",
				"M67 88 L62 94 L61 98 L60 99 L60 103 L59 104 L59 116 L60 117 L60 122 L61 123 L62 129 L64 132 L64 134 L67 140 L69 142 L71 146 L84 159 L85 159 L88 162 L91 163 L96 167 L104 171 L106 171 L109 173 L116 175 L128 181 L136 189 L138 193 L138 196 L139 197 L139 199 L138 200 L138 204 L137 205 L136 211 L134 214 L134 216 L132 219 L132 221 L130 225 L130 228 L129 229 L129 232 L128 233 L128 236 L127 237 L127 241 L126 242 L126 248 L125 249 L124 260 L123 261 L125 267 L131 270 L135 269 L139 265 L140 257 L141 256 L141 250 L142 249 L142 243 L143 242 L143 238 L144 237 L145 230 L148 224 L148 222 L151 216 L151 214 L153 210 L153 207 L154 206 L155 196 L154 195 L153 187 L148 178 L140 170 L139 170 L134 166 L122 160 L120 160 L117 158 L115 158 L112 156 L110 156 L102 152 L100 150 L96 148 L92 144 L91 144 L86 139 L86 138 L82 134 L77 124 L77 121 L76 120 L76 117 L75 116 L75 105 L76 104 L76 102 L78 101 L85 104 L88 104 L89 105 L91 105 L92 106 L96 106 L97 107 L108 107 L109 108 L118 108 L119 109 L124 109 L125 110 L127 110 L134 113 L150 126 L154 128 L159 128 L160 129 L162 128 L167 128 L168 127 L171 127 L172 126 L178 125 L185 122 L188 122 L189 121 L194 121 L195 120 L218 120 L219 121 L227 121 L228 122 L251 123 L252 124 L255 124 L256 125 L253 131 L246 138 L245 138 L239 143 L225 150 L223 150 L220 152 L215 153 L212 155 L209 155 L206 157 L201 158 L198 160 L196 160 L191 163 L187 164 L178 172 L175 177 L175 179 L174 180 L174 184 L173 185 L173 190 L174 191 L174 196 L175 197 L175 200 L177 204 L178 211 L180 215 L181 223 L182 224 L182 229 L183 230 L183 238 L184 239 L184 251 L185 252 L185 263 L187 265 L187 266 L191 268 L195 268 L197 267 L200 264 L200 262 L201 261 L200 238 L199 237 L199 229 L198 228 L198 224 L197 223 L197 218 L196 217 L196 214 L195 213 L195 210 L194 209 L194 206 L192 202 L192 199 L191 198 L191 195 L190 194 L190 190 L189 189 L190 183 L195 178 L199 176 L201 176 L206 173 L217 170 L220 168 L223 168 L226 166 L233 164 L247 157 L253 152 L254 152 L258 148 L259 148 L264 143 L271 132 L271 129 L272 128 L272 121 L271 120 L270 116 L265 111 L258 108 L252 108 L251 107 L239 107 L238 106 L229 106 L228 105 L220 105 L219 104 L194 104 L193 105 L189 105 L188 106 L183 106 L182 107 L176 108 L175 109 L173 109 L169 111 L166 111 L165 112 L158 112 L145 101 L135 96 L133 96 L129 94 L126 94 L125 93 L120 93 L119 92 L110 92 L109 91 L98 91 L97 90 L94 90 L93 89 L91 89 L84 86 L81 86 L80 85 L74 85 Z",
				"M54 99 L51 102 L48 107 L48 110 L47 111 L47 122 L48 123 L48 128 L49 129 L50 134 L59 150 L67 158 L68 158 L72 162 L78 165 L80 167 L88 171 L90 171 L93 173 L95 173 L102 176 L113 178 L119 181 L121 181 L124 183 L126 183 L128 185 L132 187 L137 193 L137 195 L138 196 L138 204 L137 205 L136 211 L134 214 L134 216 L132 219 L132 221 L130 225 L130 228 L129 229 L129 232 L128 233 L128 237 L127 238 L127 242 L126 243 L125 256 L124 257 L124 265 L126 267 L126 268 L130 270 L133 270 L137 268 L140 263 L140 258 L141 257 L141 251 L142 250 L143 239 L144 238 L145 231 L146 230 L148 222 L150 219 L150 217 L153 210 L153 206 L154 205 L154 194 L153 193 L153 190 L149 182 L140 173 L139 173 L137 171 L129 167 L127 167 L124 165 L98 158 L86 152 L84 150 L80 148 L70 138 L69 135 L66 131 L66 129 L64 126 L64 123 L63 122 L63 113 L64 112 L69 112 L70 113 L75 113 L76 114 L101 114 L102 113 L117 114 L118 115 L124 116 L130 119 L138 125 L144 128 L147 128 L148 129 L154 129 L155 128 L158 128 L164 125 L166 125 L171 122 L176 121 L182 118 L189 117 L190 116 L197 116 L198 115 L231 115 L232 114 L244 114 L245 115 L243 122 L234 133 L233 133 L228 138 L227 138 L224 141 L221 142 L219 144 L187 160 L185 162 L181 164 L175 171 L173 175 L173 178 L172 179 L172 190 L173 191 L173 195 L174 196 L174 198 L175 199 L175 201 L176 202 L176 204 L179 211 L179 214 L180 215 L180 218 L181 219 L181 222 L182 223 L183 236 L184 237 L185 261 L186 262 L186 264 L189 267 L191 267 L192 268 L195 268 L197 267 L201 262 L200 236 L199 235 L199 228 L198 227 L198 222 L197 221 L197 217 L196 216 L195 209 L194 208 L194 206 L193 205 L193 203 L192 202 L192 200 L189 193 L189 190 L188 189 L188 181 L193 175 L227 158 L229 156 L239 150 L252 137 L252 136 L255 133 L260 123 L260 120 L261 119 L261 111 L257 103 L247 98 L232 98 L231 99 L197 99 L196 100 L189 100 L188 101 L184 101 L180 103 L177 103 L176 104 L171 105 L168 107 L166 107 L163 109 L161 109 L158 111 L156 111 L152 113 L149 113 L136 104 L134 104 L129 101 L127 101 L123 99 L119 99 L118 98 L111 98 L110 97 L102 97 L101 98 L77 98 L76 97 L71 97 L70 96 L61 96 Z",
				"M245 94 L239 91 L228 91 L227 92 L217 93 L216 94 L210 94 L209 95 L200 95 L199 96 L186 97 L185 98 L182 98 L181 99 L178 99 L177 100 L169 102 L148 113 L141 113 L139 111 L129 106 L127 106 L124 104 L117 103 L116 102 L93 102 L92 103 L86 103 L85 104 L81 104 L80 105 L72 105 L71 106 L51 106 L44 109 L40 113 L39 117 L38 118 L38 121 L37 122 L37 127 L38 128 L38 132 L39 133 L40 138 L46 149 L57 161 L58 161 L64 166 L79 173 L81 173 L85 175 L88 175 L92 177 L96 177 L97 178 L101 178 L102 179 L107 179 L108 180 L113 180 L117 182 L123 183 L131 187 L137 194 L137 196 L138 197 L138 204 L137 205 L137 208 L134 214 L134 216 L133 217 L133 219 L132 220 L132 222 L129 229 L128 237 L127 238 L127 243 L126 244 L126 250 L125 251 L125 257 L124 258 L124 265 L126 267 L126 268 L130 270 L134 270 L136 269 L140 264 L140 260 L141 259 L141 252 L142 251 L142 245 L143 244 L143 239 L144 238 L144 235 L145 234 L145 231 L146 230 L148 222 L152 214 L153 206 L154 205 L154 195 L153 194 L153 191 L151 188 L151 186 L143 176 L131 169 L129 169 L122 166 L115 165 L114 164 L102 163 L101 162 L94 161 L90 159 L87 159 L72 152 L70 150 L69 150 L60 141 L60 140 L58 138 L54 130 L53 123 L54 122 L72 122 L73 121 L81 121 L82 120 L93 119 L94 118 L115 118 L116 119 L121 120 L139 129 L150 129 L156 126 L158 126 L162 123 L168 120 L170 120 L177 116 L183 115 L187 113 L199 112 L200 111 L210 111 L211 110 L223 109 L224 108 L228 108 L229 107 L234 107 L235 108 L235 114 L227 128 L211 143 L210 143 L199 151 L191 155 L182 162 L181 162 L175 169 L172 176 L172 179 L171 180 L171 186 L172 187 L173 196 L174 197 L174 199 L175 200 L175 202 L176 203 L176 205 L177 206 L177 208 L180 215 L180 218 L181 219 L181 221 L182 222 L182 226 L183 227 L183 234 L184 235 L184 248 L185 249 L185 260 L188 266 L194 268 L195 267 L197 267 L201 263 L200 235 L199 234 L199 227 L198 226 L197 217 L196 216 L196 213 L195 212 L195 210 L194 209 L194 207 L193 206 L193 204 L192 203 L192 201 L189 194 L188 186 L187 185 L187 181 L188 180 L188 178 L193 173 L194 173 L205 165 L213 161 L219 156 L223 154 L227 150 L228 150 L241 136 L249 122 L250 116 L251 115 L251 103 L250 102 L249 98 Z",
				"M238 89 L234 88 L233 87 L225 87 L224 88 L221 88 L220 89 L214 90 L210 92 L206 92 L205 93 L201 93 L200 94 L194 94 L193 95 L189 95 L188 96 L180 97 L179 98 L174 99 L171 101 L169 101 L155 108 L153 110 L144 114 L140 113 L135 110 L133 110 L128 107 L126 107 L122 105 L119 105 L118 104 L113 104 L112 103 L99 103 L98 104 L91 104 L90 105 L86 105 L85 106 L77 107 L76 108 L68 109 L67 110 L61 110 L60 111 L51 111 L50 112 L46 112 L38 116 L35 119 L32 125 L32 134 L33 135 L33 138 L40 151 L51 162 L54 163 L56 165 L63 169 L65 169 L68 171 L70 171 L74 173 L77 173 L81 175 L89 176 L90 177 L94 177 L95 178 L110 179 L111 180 L115 180 L116 181 L123 182 L131 186 L137 192 L138 194 L138 204 L137 205 L137 208 L134 214 L134 216 L132 219 L131 225 L129 229 L128 237 L127 238 L127 243 L126 244 L126 250 L125 251 L125 258 L124 259 L124 264 L128 269 L130 270 L134 270 L136 269 L140 264 L140 260 L141 259 L141 252 L142 251 L142 245 L143 244 L143 239 L144 238 L144 235 L145 234 L145 231 L146 230 L148 222 L150 219 L150 217 L153 210 L153 206 L154 205 L154 193 L153 192 L153 189 L149 181 L142 174 L131 168 L129 168 L125 166 L122 166 L121 165 L112 164 L111 163 L104 163 L103 162 L96 162 L95 161 L91 161 L90 160 L83 159 L79 157 L76 157 L73 155 L71 155 L65 152 L63 150 L62 150 L52 140 L48 133 L48 129 L52 127 L68 126 L69 125 L78 124 L79 123 L82 123 L83 122 L86 122 L87 121 L91 121 L92 120 L99 120 L100 119 L111 119 L112 120 L120 121 L137 129 L145 130 L146 129 L149 129 L155 126 L157 126 L159 124 L166 121 L168 119 L182 113 L185 113 L186 112 L189 112 L190 111 L194 111 L195 110 L201 110 L202 109 L211 108 L212 107 L215 107 L216 106 L219 106 L223 104 L229 103 L230 104 L230 112 L229 113 L228 118 L221 131 L207 145 L206 145 L199 151 L198 151 L185 161 L184 161 L177 168 L173 176 L173 180 L172 181 L172 188 L173 189 L173 194 L174 195 L174 198 L175 199 L176 205 L177 206 L177 208 L180 215 L180 218 L181 219 L181 222 L182 223 L182 227 L183 228 L184 248 L185 249 L185 260 L188 266 L194 268 L195 267 L197 267 L201 263 L201 248 L200 247 L200 236 L199 235 L198 222 L197 221 L197 217 L196 216 L195 209 L193 206 L192 200 L190 196 L190 193 L189 192 L189 189 L188 188 L188 182 L189 181 L189 179 L196 172 L197 172 L200 169 L204 167 L207 164 L208 164 L210 162 L214 160 L218 156 L219 156 L232 143 L232 142 L237 136 L244 121 L245 113 L246 112 L246 102 L245 101 L245 98 L243 94 Z",
				"M238 89 L229 87 L228 88 L221 89 L218 91 L216 91 L212 93 L209 93 L208 94 L205 94 L204 95 L198 95 L197 96 L192 96 L191 97 L180 99 L177 101 L170 103 L162 107 L160 109 L151 113 L147 113 L130 105 L124 104 L123 103 L119 103 L118 102 L96 102 L95 103 L86 104 L85 105 L82 105 L81 106 L78 106 L77 107 L74 107 L73 108 L70 108 L69 109 L64 109 L63 110 L51 111 L50 112 L44 113 L38 116 L35 119 L35 120 L33 122 L32 128 L31 129 L32 130 L32 135 L38 147 L48 157 L62 165 L64 165 L67 167 L69 167 L73 169 L84 171 L85 172 L89 172 L90 173 L94 173 L95 174 L101 174 L102 175 L108 175 L109 176 L115 176 L116 177 L119 177 L131 182 L137 187 L139 191 L139 201 L138 202 L138 205 L137 206 L136 211 L134 214 L134 216 L132 219 L132 221 L130 225 L130 228 L129 229 L129 232 L128 233 L128 237 L127 238 L127 242 L126 243 L125 256 L124 257 L124 264 L125 266 L128 269 L130 270 L133 270 L134 269 L136 269 L140 264 L140 259 L141 258 L141 251 L142 250 L143 239 L144 238 L146 227 L148 224 L149 219 L151 216 L151 214 L153 210 L153 207 L154 206 L154 203 L155 202 L155 190 L154 189 L154 186 L153 185 L152 181 L142 170 L133 165 L131 165 L124 162 L121 162 L120 161 L116 161 L115 160 L110 160 L109 159 L102 159 L101 158 L91 157 L90 156 L87 156 L86 155 L75 153 L67 149 L65 149 L63 147 L60 146 L50 136 L50 135 L48 133 L48 129 L49 128 L57 127 L58 126 L64 126 L65 125 L69 125 L70 124 L75 124 L76 123 L79 123 L80 122 L83 122 L84 121 L87 121 L88 120 L91 120 L92 119 L96 119 L97 118 L118 118 L119 119 L127 121 L132 124 L134 124 L141 128 L144 128 L145 129 L152 129 L153 128 L157 128 L180 116 L182 116 L189 113 L192 113 L193 112 L198 112 L199 111 L205 111 L206 110 L209 110 L210 109 L218 108 L221 106 L223 106 L227 104 L230 104 L231 105 L231 116 L230 117 L229 123 L222 136 L207 151 L206 151 L203 154 L200 155 L197 158 L186 165 L178 174 L178 176 L175 182 L175 198 L176 199 L177 207 L178 208 L179 215 L181 219 L182 229 L183 230 L183 237 L184 238 L184 249 L185 250 L185 261 L186 262 L186 264 L189 267 L195 268 L197 267 L201 262 L201 249 L200 248 L200 237 L199 236 L198 223 L197 222 L197 218 L196 217 L196 214 L195 213 L195 210 L194 209 L194 206 L193 205 L193 202 L192 201 L192 198 L191 197 L191 184 L192 182 L198 176 L215 165 L233 148 L233 147 L238 141 L243 131 L243 129 L245 125 L245 122 L246 121 L246 118 L247 117 L247 104 L246 103 L246 100 L245 99 L244 95 Z",
				"M247 95 L243 94 L242 93 L235 93 L234 94 L232 94 L231 95 L229 95 L222 98 L219 98 L218 99 L211 99 L210 100 L202 100 L201 101 L191 102 L190 103 L179 106 L176 108 L174 108 L166 112 L158 112 L145 104 L143 104 L138 101 L132 100 L131 99 L128 99 L127 98 L121 98 L120 97 L105 97 L104 98 L96 98 L95 99 L85 100 L84 101 L80 101 L79 102 L73 102 L72 103 L66 103 L65 104 L59 104 L58 105 L50 106 L43 110 L40 113 L37 120 L37 125 L38 126 L38 129 L43 138 L57 151 L69 157 L71 157 L74 159 L76 159 L83 162 L86 162 L90 164 L93 164 L94 165 L97 165 L98 166 L101 166 L102 167 L105 167 L106 168 L115 169 L119 171 L125 172 L133 176 L140 183 L141 185 L141 195 L140 196 L140 199 L139 200 L138 205 L136 208 L135 213 L133 216 L133 218 L132 219 L132 221 L129 228 L128 236 L127 237 L127 241 L126 242 L126 247 L125 248 L125 255 L124 256 L124 260 L123 261 L125 267 L128 269 L132 270 L133 269 L135 269 L139 265 L139 262 L140 261 L140 256 L141 255 L141 249 L142 248 L142 243 L143 242 L143 238 L144 237 L145 230 L146 229 L147 224 L149 221 L150 216 L152 213 L152 211 L153 210 L153 208 L156 201 L156 198 L157 197 L157 184 L156 183 L156 180 L155 179 L154 175 L144 164 L133 158 L131 158 L124 155 L121 155 L120 154 L117 154 L116 153 L112 153 L111 152 L108 152 L107 151 L103 151 L99 149 L96 149 L95 148 L92 148 L88 146 L85 146 L68 139 L57 130 L53 123 L56 121 L59 121 L60 120 L73 119 L74 118 L80 118 L81 117 L91 116 L92 115 L96 115 L97 114 L105 114 L106 113 L120 113 L121 114 L125 114 L126 115 L129 115 L130 116 L135 117 L155 128 L161 128 L162 129 L163 128 L168 128 L169 127 L174 126 L177 124 L179 124 L182 122 L184 122 L187 120 L189 120 L193 118 L196 118 L197 117 L202 117 L203 116 L211 116 L212 115 L219 115 L220 114 L224 114 L225 113 L228 113 L229 112 L234 111 L237 109 L239 111 L239 122 L238 123 L238 126 L237 127 L236 132 L229 144 L216 156 L215 156 L210 160 L205 162 L203 164 L196 167 L194 169 L191 170 L188 173 L187 173 L182 179 L179 185 L178 193 L177 194 L177 202 L178 203 L178 210 L179 211 L179 215 L180 216 L180 220 L181 221 L181 225 L182 226 L182 232 L183 233 L183 240 L184 241 L184 252 L185 253 L185 263 L187 265 L187 266 L191 268 L195 268 L200 264 L200 262 L201 261 L201 252 L200 251 L200 241 L199 240 L198 225 L197 224 L196 214 L195 213 L195 210 L194 209 L194 202 L193 201 L193 195 L194 194 L194 191 L196 187 L199 184 L207 180 L209 178 L216 175 L218 173 L221 172 L227 167 L228 167 L232 163 L233 163 L243 152 L246 146 L248 144 L249 140 L251 137 L251 135 L253 132 L253 129 L254 128 L254 125 L255 124 L255 109 L254 108 L254 105 L251 99 Z"
			];
			// Foreground contours traced from the two supplied 360px GIFs; simplified to 1.1px.
			const TAIL_SWAY_POSES = [
				"M88 84 L92 74 L101 68 L115 69 L125 74 L159 84 L181 97 L197 118 L232 120 L247 124 L263 131 L285 136 L290 140 L293 146 L292 159 L282 174 L280 174 L276 179 L264 186 L244 192 L206 195 L198 200 L196 205 L196 218 L199 232 L201 263 L198 268 L189 269 L184 264 L184 248 L179 214 L180 201 L185 189 L193 182 L201 179 L240 176 L257 171 L268 164 L274 158 L276 151 L259 147 L232 137 L217 135 L197 135 L190 133 L182 127 L176 116 L164 105 L152 99 L132 94 L106 84 L104 89 L105 99 L112 115 L126 131 L128 131 L134 138 L136 138 L139 142 L141 142 L150 151 L153 152 L153 154 L159 160 L163 170 L163 186 L161 194 L144 234 L139 264 L135 269 L127 269 L123 265 L126 238 L132 218 L144 192 L147 175 L142 165 L132 156 L126 153 L122 148 L120 148 L98 124 L90 107 L88 98 Z",
				"M100 81 L104 69 L110 63 L117 61 L128 63 L140 69 L141 71 L167 81 L182 90 L194 102 L195 106 L197 107 L202 118 L205 121 L238 126 L249 130 L267 140 L288 147 L294 154 L294 168 L291 174 L282 184 L265 194 L240 199 L204 198 L199 200 L195 207 L195 222 L199 239 L201 263 L196 269 L187 268 L184 264 L183 244 L178 219 L178 207 L181 196 L185 192 L185 190 L190 186 L200 182 L244 182 L255 180 L269 173 L277 165 L278 161 L260 155 L234 142 L198 136 L190 130 L182 114 L170 102 L153 93 L140 89 L121 78 L118 78 L117 96 L124 113 L131 121 L131 123 L136 127 L136 129 L157 149 L163 159 L165 166 L165 183 L162 192 L157 200 L157 203 L155 204 L154 209 L150 215 L144 232 L139 264 L135 269 L127 269 L123 265 L126 236 L132 215 L147 185 L149 170 L146 162 L121 137 L121 135 L117 132 L117 130 L109 120 L101 101 Z",
				"M112 80 L115 68 L120 61 L129 57 L142 60 L158 72 L170 77 L171 79 L177 81 L185 88 L187 88 L201 105 L209 123 L243 132 L254 138 L258 142 L262 143 L266 147 L283 154 L288 158 L290 162 L291 173 L286 183 L281 189 L265 199 L249 203 L226 203 L205 200 L199 201 L196 204 L194 210 L194 220 L201 258 L201 263 L196 269 L189 269 L184 264 L183 247 L178 226 L178 205 L184 192 L190 187 L198 184 L215 184 L233 187 L255 185 L268 178 L273 173 L274 168 L259 162 L258 160 L254 159 L253 157 L236 147 L224 143 L206 140 L200 137 L192 128 L186 112 L174 99 L164 94 L163 92 L160 92 L159 90 L151 87 L150 85 L146 84 L145 82 L131 74 L129 78 L129 94 L132 105 L142 123 L164 150 L168 160 L169 174 L164 191 L162 192 L157 204 L155 205 L147 223 L142 240 L139 264 L135 269 L127 269 L123 265 L126 235 L133 213 L150 181 L152 175 L152 164 L146 153 L130 135 L117 112 L112 93 Z",
				"M121 76 L123 68 L129 59 L135 56 L148 58 L162 70 L184 83 L193 91 L193 93 L201 102 L205 110 L207 119 L211 125 L225 128 L244 136 L265 152 L278 158 L282 163 L284 174 L279 186 L270 195 L260 201 L245 205 L227 205 L207 201 L200 201 L196 204 L194 210 L194 221 L201 258 L201 263 L196 269 L189 269 L184 264 L183 248 L178 227 L178 206 L182 195 L189 188 L196 185 L213 185 L226 188 L250 187 L261 181 L265 177 L267 171 L253 164 L237 151 L221 144 L206 141 L198 136 L193 129 L189 115 L183 105 L168 92 L159 88 L139 73 L137 83 L139 100 L148 121 L150 122 L151 126 L160 137 L170 154 L172 162 L172 173 L169 185 L156 209 L154 210 L146 228 L142 242 L139 264 L135 269 L127 269 L123 265 L123 255 L127 233 L135 211 L153 180 L155 174 L155 162 L151 153 L148 151 L148 149 L134 130 L125 111 L121 95 Z",
				"M123 256 L127 236 L132 222 L142 202 L150 191 L157 175 L157 161 L149 147 L144 142 L140 133 L138 132 L128 110 L125 97 L125 76 L127 68 L134 59 L143 57 L153 61 L161 69 L182 82 L187 88 L191 90 L191 92 L194 94 L199 104 L201 105 L208 124 L226 128 L235 132 L250 144 L252 144 L254 147 L271 156 L275 163 L275 174 L269 186 L261 194 L251 200 L240 203 L220 203 L203 200 L197 203 L195 208 L195 225 L200 248 L201 263 L196 269 L187 268 L184 264 L184 254 L178 222 L179 204 L185 191 L197 184 L211 184 L227 187 L240 186 L246 184 L252 178 L254 178 L259 168 L241 158 L231 149 L221 144 L206 141 L198 137 L193 132 L186 112 L184 111 L181 104 L170 94 L153 84 L144 75 L142 75 L141 91 L143 102 L156 130 L170 149 L174 161 L174 175 L171 186 L158 210 L156 211 L145 234 L138 266 L135 269 L127 269 L123 265 Z",
				"M123 256 L131 228 L144 203 L149 197 L152 189 L154 188 L158 178 L157 162 L137 133 L129 117 L124 97 L124 79 L126 71 L131 64 L141 61 L151 65 L157 71 L181 85 L195 101 L203 121 L226 126 L236 131 L247 140 L261 146 L267 153 L268 166 L261 181 L252 190 L245 193 L244 195 L227 199 L202 198 L198 201 L196 208 L196 225 L200 246 L201 263 L196 269 L187 268 L184 264 L184 252 L179 221 L180 203 L184 192 L189 186 L197 182 L229 182 L236 180 L246 173 L251 165 L251 160 L238 154 L230 147 L219 141 L195 136 L189 130 L183 114 L176 103 L165 94 L159 92 L158 90 L154 89 L146 82 L141 80 L141 99 L145 112 L154 129 L171 152 L175 166 L175 177 L171 191 L146 235 L138 266 L135 269 L127 269 L123 265 Z",
				"M119 82 L122 74 L127 69 L141 69 L154 76 L155 78 L163 80 L180 90 L189 100 L199 119 L216 119 L226 122 L244 132 L257 136 L263 144 L264 153 L262 162 L254 176 L247 183 L232 191 L206 194 L200 197 L197 205 L197 222 L200 240 L201 263 L196 269 L189 269 L184 264 L184 247 L180 216 L183 193 L188 185 L195 180 L208 177 L224 176 L235 171 L243 163 L247 155 L247 150 L234 146 L216 136 L195 135 L188 132 L182 125 L175 109 L167 101 L158 96 L150 94 L136 86 L135 94 L138 110 L152 135 L163 146 L172 160 L174 167 L174 183 L172 191 L164 208 L162 209 L146 238 L138 266 L135 269 L127 269 L123 265 L125 248 L137 219 L139 218 L141 212 L143 211 L154 191 L157 183 L158 172 L155 163 L136 141 L124 120 L119 101 Z",
				"M110 88 L113 81 L117 77 L123 75 L132 76 L141 81 L156 84 L172 91 L183 101 L192 116 L218 115 L240 123 L253 125 L257 127 L261 132 L261 152 L251 170 L240 180 L224 187 L205 191 L199 197 L198 220 L200 230 L201 263 L196 269 L189 269 L184 264 L184 237 L181 215 L181 204 L184 190 L189 182 L194 178 L207 173 L223 170 L232 165 L241 156 L245 148 L246 141 L235 139 L217 132 L186 132 L179 127 L172 114 L163 105 L151 100 L134 96 L129 93 L126 94 L127 106 L133 122 L140 130 L140 132 L145 136 L145 138 L165 156 L170 164 L173 177 L172 189 L169 199 L146 240 L139 264 L135 269 L127 269 L123 265 L123 256 L125 249 L136 223 L138 222 L141 214 L143 213 L154 192 L156 175 L154 169 L150 166 L150 164 L148 164 L128 144 L128 142 L119 131 L111 111 Z",
				"M98 98 L100 90 L105 84 L112 81 L117 81 L133 86 L146 87 L161 91 L173 98 L187 115 L193 115 L203 112 L219 112 L238 117 L251 117 L257 119 L263 125 L264 142 L262 149 L254 163 L243 174 L223 184 L207 188 L202 191 L199 196 L198 211 L201 233 L201 263 L198 268 L189 269 L184 264 L184 228 L182 218 L182 197 L184 189 L194 176 L221 167 L236 158 L244 148 L248 134 L233 133 L213 128 L197 130 L193 132 L184 132 L176 128 L172 124 L170 119 L156 107 L147 104 L128 102 L115 98 L116 111 L124 128 L141 145 L153 152 L162 160 L168 170 L170 177 L170 191 L166 204 L146 240 L139 264 L135 269 L127 269 L123 265 L123 256 L131 233 L151 197 L153 190 L153 177 L144 166 L127 155 L110 137 L101 119 Z",
				"M87 99 L89 92 L93 87 L99 84 L111 84 L126 88 L144 89 L161 94 L162 96 L173 102 L184 115 L204 111 L224 111 L241 115 L258 115 L263 117 L267 121 L270 128 L269 142 L263 155 L257 161 L257 163 L242 175 L227 182 L206 188 L200 193 L198 208 L201 230 L201 263 L198 268 L189 269 L184 264 L185 240 L182 215 L182 196 L185 186 L187 185 L189 180 L197 174 L225 165 L239 157 L249 146 L253 137 L253 131 L235 131 L230 129 L211 127 L183 132 L173 128 L160 113 L151 108 L138 105 L121 104 L107 100 L104 101 L105 113 L113 128 L132 145 L153 157 L162 166 L167 179 L166 198 L162 209 L144 244 L139 264 L135 269 L127 269 L123 265 L123 256 L131 232 L150 194 L151 184 L149 177 L144 171 L120 157 L117 153 L110 149 L99 137 L89 117 Z",
				"M80 97 L82 90 L86 85 L92 82 L101 81 L120 86 L142 88 L161 94 L162 96 L169 99 L172 103 L174 103 L184 115 L193 115 L206 112 L225 112 L248 117 L263 117 L274 122 L278 130 L277 143 L271 156 L258 170 L240 180 L207 189 L200 194 L198 200 L198 214 L201 233 L201 263 L198 268 L189 269 L184 264 L184 229 L181 207 L183 191 L189 181 L194 177 L205 172 L233 165 L246 158 L259 144 L261 134 L242 133 L217 128 L183 132 L175 129 L160 113 L149 107 L97 98 L98 110 L105 124 L126 143 L151 157 L160 167 L164 177 L165 189 L163 199 L158 213 L156 214 L156 217 L145 239 L139 264 L135 269 L127 269 L123 265 L123 256 L130 232 L145 201 L148 190 L148 181 L146 176 L139 169 L113 154 L94 137 L83 118 L80 106 Z",
				"M80 93 L83 83 L88 78 L96 75 L107 76 L124 82 L152 87 L172 97 L179 103 L179 105 L189 116 L227 115 L248 121 L276 125 L285 132 L287 139 L285 152 L279 162 L262 177 L243 185 L209 191 L203 193 L199 197 L197 203 L197 214 L200 231 L201 263 L198 268 L189 269 L184 264 L184 238 L181 220 L181 198 L185 188 L190 182 L201 176 L231 171 L253 163 L264 154 L270 144 L270 141 L253 139 L228 132 L216 131 L188 133 L180 130 L164 112 L162 112 L155 106 L140 101 L120 98 L103 92 L98 92 L98 106 L107 122 L124 138 L148 153 L159 165 L163 176 L163 190 L161 198 L147 230 L143 242 L139 264 L135 269 L127 269 L123 265 L124 251 L130 228 L145 194 L147 183 L146 177 L140 168 L111 149 L92 130 L84 116 L81 107 Z",
				"M88 84 L92 74 L101 68 L115 69 L125 74 L159 84 L181 97 L197 118 L232 120 L247 124 L263 131 L285 136 L290 140 L293 146 L292 159 L282 174 L280 174 L276 179 L264 186 L244 192 L206 195 L198 200 L196 205 L196 218 L199 232 L201 263 L198 268 L189 269 L184 264 L184 248 L179 214 L180 201 L185 189 L193 182 L201 179 L240 176 L257 171 L268 164 L274 158 L276 151 L259 147 L232 137 L217 135 L197 135 L190 133 L182 127 L176 116 L164 105 L152 99 L132 94 L106 84 L104 89 L105 99 L112 115 L126 131 L128 131 L134 138 L136 138 L139 142 L141 142 L150 151 L153 152 L153 154 L159 160 L163 170 L163 186 L161 194 L144 234 L139 264 L135 269 L127 269 L123 265 L126 238 L132 218 L144 192 L147 175 L142 165 L132 156 L126 153 L122 148 L120 148 L98 124 L90 107 L88 98 Z",
				"M100 81 L104 69 L110 63 L117 61 L128 63 L140 69 L141 71 L167 81 L182 90 L194 102 L195 106 L197 107 L202 118 L205 121 L238 126 L249 130 L267 140 L288 147 L294 154 L294 168 L291 174 L282 184 L265 194 L240 199 L204 198 L199 200 L195 207 L195 222 L199 239 L201 263 L196 269 L187 268 L184 264 L183 244 L178 219 L178 207 L181 196 L185 192 L185 190 L190 186 L200 182 L244 182 L255 180 L269 173 L277 165 L278 161 L260 155 L234 142 L198 136 L190 130 L182 114 L170 102 L153 93 L140 89 L121 78 L118 78 L117 96 L124 113 L131 121 L131 123 L136 127 L136 129 L157 149 L163 159 L165 166 L165 183 L162 192 L157 200 L157 203 L155 204 L154 209 L150 215 L144 232 L139 264 L135 269 L127 269 L123 265 L126 236 L132 215 L147 185 L149 170 L146 162 L121 137 L121 135 L117 132 L117 130 L109 120 L101 101 Z",
				"M112 80 L115 68 L120 61 L129 57 L142 60 L158 72 L170 77 L171 79 L177 81 L185 88 L187 88 L201 105 L209 123 L243 132 L254 138 L258 142 L262 143 L266 147 L283 154 L288 158 L290 162 L291 173 L286 183 L281 189 L265 199 L249 203 L226 203 L205 200 L199 201 L196 204 L194 210 L194 220 L201 258 L201 263 L196 269 L189 269 L184 264 L183 247 L178 226 L178 205 L184 192 L190 187 L198 184 L215 184 L233 187 L255 185 L268 178 L273 173 L274 168 L259 162 L258 160 L254 159 L253 157 L236 147 L224 143 L206 140 L200 137 L192 128 L186 112 L174 99 L164 94 L163 92 L160 92 L159 90 L151 87 L150 85 L146 84 L145 82 L131 74 L129 78 L129 94 L132 105 L142 123 L164 150 L168 160 L169 174 L164 191 L162 192 L157 204 L155 205 L147 223 L142 240 L139 264 L135 269 L127 269 L123 265 L126 235 L133 213 L150 181 L152 175 L152 164 L146 153 L130 135 L117 112 L112 93 Z",
				"M121 76 L123 68 L129 59 L135 56 L148 58 L162 70 L184 83 L193 91 L193 93 L201 102 L205 110 L207 119 L211 125 L225 128 L244 136 L265 152 L278 158 L282 163 L284 174 L279 186 L270 195 L260 201 L245 205 L227 205 L207 201 L200 201 L196 204 L194 210 L194 221 L201 258 L201 263 L196 269 L189 269 L184 264 L183 248 L178 227 L178 206 L182 195 L189 188 L196 185 L213 185 L226 188 L250 187 L261 181 L265 177 L267 171 L253 164 L237 151 L221 144 L206 141 L198 136 L193 129 L189 115 L183 105 L168 92 L159 88 L139 73 L137 83 L139 100 L148 121 L150 122 L151 126 L160 137 L170 154 L172 162 L172 173 L169 185 L156 209 L154 210 L146 228 L142 242 L139 264 L135 269 L127 269 L123 265 L123 255 L127 233 L135 211 L153 180 L155 174 L155 162 L151 153 L148 151 L148 149 L134 130 L125 111 L121 95 Z",
				"M123 256 L127 236 L132 222 L142 202 L150 191 L157 175 L157 161 L149 147 L144 142 L140 133 L138 132 L128 110 L125 97 L125 76 L127 68 L134 59 L143 57 L153 61 L161 69 L182 82 L187 88 L191 90 L191 92 L194 94 L199 104 L201 105 L208 124 L226 128 L235 132 L250 144 L252 144 L254 147 L271 156 L275 163 L275 174 L269 186 L261 194 L251 200 L240 203 L220 203 L203 200 L197 203 L195 208 L195 225 L200 248 L201 263 L196 269 L187 268 L184 264 L184 254 L178 222 L179 204 L185 191 L197 184 L211 184 L227 187 L240 186 L246 184 L252 178 L254 178 L259 168 L241 158 L231 149 L221 144 L206 141 L198 137 L193 132 L186 112 L184 111 L181 104 L170 94 L153 84 L144 75 L142 75 L141 91 L143 102 L156 130 L170 149 L174 161 L174 175 L171 186 L158 210 L156 211 L145 234 L138 266 L135 269 L127 269 L123 265 Z",
				"M123 256 L131 228 L144 203 L149 197 L152 189 L154 188 L158 178 L157 162 L137 133 L129 117 L124 97 L124 79 L126 71 L131 64 L141 61 L151 65 L157 71 L181 85 L195 101 L203 121 L226 126 L236 131 L247 140 L261 146 L267 153 L268 166 L261 181 L252 190 L245 193 L244 195 L227 199 L202 198 L198 201 L196 208 L196 225 L200 246 L201 263 L196 269 L187 268 L184 264 L184 252 L179 221 L180 203 L184 192 L189 186 L197 182 L229 182 L236 180 L246 173 L251 165 L251 160 L238 154 L230 147 L219 141 L195 136 L189 130 L183 114 L176 103 L165 94 L159 92 L158 90 L154 89 L146 82 L141 80 L141 99 L145 112 L154 129 L171 152 L175 166 L175 177 L171 191 L146 235 L138 266 L135 269 L127 269 L123 265 Z",
				"M119 82 L122 74 L127 69 L141 69 L154 76 L155 78 L163 80 L180 90 L189 100 L199 119 L216 119 L226 122 L244 132 L257 136 L263 144 L264 153 L262 162 L254 176 L247 183 L232 191 L206 194 L200 197 L197 205 L197 222 L200 240 L201 263 L196 269 L189 269 L184 264 L184 247 L180 216 L183 193 L188 185 L195 180 L208 177 L224 176 L235 171 L243 163 L247 155 L247 150 L234 146 L216 136 L195 135 L188 132 L182 125 L175 109 L167 101 L158 96 L150 94 L136 86 L135 94 L138 110 L152 135 L163 146 L172 160 L174 167 L174 183 L172 191 L164 208 L162 209 L146 238 L138 266 L135 269 L127 269 L123 265 L125 248 L137 219 L139 218 L141 212 L143 211 L154 191 L157 183 L158 172 L155 163 L136 141 L124 120 L119 101 Z",
				"M110 88 L113 81 L117 77 L123 75 L132 76 L141 81 L156 84 L172 91 L183 101 L192 116 L218 115 L240 123 L253 125 L257 127 L261 132 L261 152 L251 170 L240 180 L224 187 L205 191 L199 197 L198 220 L200 230 L201 263 L196 269 L189 269 L184 264 L184 237 L181 215 L181 204 L184 190 L189 182 L194 178 L207 173 L223 170 L232 165 L241 156 L245 148 L246 141 L235 139 L217 132 L186 132 L179 127 L172 114 L163 105 L151 100 L134 96 L129 93 L126 94 L127 106 L133 122 L140 130 L140 132 L145 136 L145 138 L165 156 L170 164 L173 177 L172 189 L169 199 L146 240 L139 264 L135 269 L127 269 L123 265 L123 256 L125 249 L136 223 L138 222 L141 214 L143 213 L154 192 L156 175 L154 169 L150 166 L150 164 L148 164 L128 144 L128 142 L119 131 L111 111 Z",
				"M98 98 L100 90 L105 84 L112 81 L117 81 L133 86 L146 87 L161 91 L173 98 L187 115 L193 115 L203 112 L219 112 L238 117 L251 117 L257 119 L263 125 L264 142 L262 149 L254 163 L243 174 L223 184 L207 188 L202 191 L199 196 L198 211 L201 233 L201 263 L198 268 L189 269 L184 264 L184 228 L182 218 L182 197 L184 189 L194 176 L221 167 L236 158 L244 148 L248 134 L233 133 L213 128 L197 130 L193 132 L184 132 L176 128 L172 124 L170 119 L156 107 L147 104 L128 102 L115 98 L116 111 L124 128 L141 145 L153 152 L162 160 L168 170 L170 177 L170 191 L166 204 L146 240 L139 264 L135 269 L127 269 L123 265 L123 256 L131 233 L151 197 L153 190 L153 177 L144 166 L127 155 L110 137 L101 119 Z",
				"M87 99 L89 92 L93 87 L99 84 L111 84 L126 88 L144 89 L161 94 L162 96 L173 102 L184 115 L204 111 L224 111 L241 115 L258 115 L263 117 L267 121 L270 128 L269 142 L263 155 L257 161 L257 163 L242 175 L227 182 L206 188 L200 193 L198 208 L201 230 L201 263 L198 268 L189 269 L184 264 L185 240 L182 215 L182 196 L185 186 L187 185 L189 180 L197 174 L225 165 L239 157 L249 146 L253 137 L253 131 L235 131 L230 129 L211 127 L183 132 L173 128 L160 113 L151 108 L138 105 L121 104 L107 100 L104 101 L105 113 L113 128 L132 145 L153 157 L162 166 L167 179 L166 198 L162 209 L144 244 L139 264 L135 269 L127 269 L123 265 L123 256 L131 232 L150 194 L151 184 L149 177 L144 171 L120 157 L117 153 L110 149 L99 137 L89 117 Z",
				"M80 97 L82 90 L86 85 L92 82 L101 81 L120 86 L142 88 L161 94 L162 96 L169 99 L172 103 L174 103 L184 115 L193 115 L206 112 L225 112 L248 117 L263 117 L274 122 L278 130 L277 143 L271 156 L258 170 L240 180 L207 189 L200 194 L198 200 L198 214 L201 233 L201 263 L198 268 L189 269 L184 264 L184 229 L181 207 L183 191 L189 181 L194 177 L205 172 L233 165 L246 158 L259 144 L261 134 L242 133 L217 128 L183 132 L175 129 L160 113 L149 107 L97 98 L98 110 L105 124 L126 143 L151 157 L160 167 L164 177 L165 189 L163 199 L158 213 L156 214 L156 217 L145 239 L139 264 L135 269 L127 269 L123 265 L123 256 L130 232 L145 201 L148 190 L148 181 L146 176 L139 169 L113 154 L94 137 L83 118 L80 106 Z",
				"M80 93 L83 83 L88 78 L96 75 L107 76 L124 82 L152 87 L172 97 L179 103 L179 105 L189 116 L227 115 L248 121 L276 125 L285 132 L287 139 L285 152 L279 162 L262 177 L243 185 L209 191 L203 193 L199 197 L197 203 L197 214 L200 231 L201 263 L198 268 L189 269 L184 264 L184 238 L181 220 L181 198 L185 188 L190 182 L201 176 L231 171 L253 163 L264 154 L270 144 L270 141 L253 139 L228 132 L216 131 L188 133 L180 130 L164 112 L162 112 L155 106 L140 101 L120 98 L103 92 L98 92 L98 106 L107 122 L124 138 L148 153 L159 165 L163 176 L163 190 L161 198 L147 230 L143 242 L139 264 L135 269 L127 269 L123 265 L124 251 L130 228 L145 194 L147 183 L146 177 L140 168 L111 149 L92 130 L84 116 L81 107 Z",
			];
			const TAIL_TWIST_POSES = [
				"M138 94 L139 80 L142 73 L148 68 L156 68 L168 78 L179 84 L186 91 L193 105 L196 119 L206 119 L215 123 L223 131 L232 135 L238 142 L239 152 L232 172 L223 180 L205 186 L204 180 L194 172 L216 165 L220 159 L222 149 L214 145 L204 136 L190 135 L184 132 L180 125 L174 103 L167 96 L156 90 L155 105 L157 119 L164 139 L172 153 L176 172 L178 176 L189 187 L191 187 L204 199 L207 205 L207 212 L204 218 L198 223 L192 215 L185 212 L189 209 L189 207 L182 201 L180 201 L177 197 L175 197 L167 189 L161 179 L156 158 L149 146 L141 124 Z M148 206 L153 196 L156 195 L156 198 L162 204 L166 205 L166 208 L164 210 L166 215 L180 224 L194 236 L194 238 L198 242 L201 253 L201 262 L196 269 L189 269 L185 266 L182 248 L174 240 L163 234 L151 223 L148 217 Z M122 260 L127 243 L135 234 L142 230 L143 234 L153 243 L148 245 L141 252 L138 266 L132 270 L127 269 L124 267 Z",
				"M169 159 L173 113 L177 91 L177 74 L182 68 L189 68 L193 71 L195 76 L196 86 L198 90 L198 102 L195 115 L190 117 L187 148 L193 146 L196 143 L197 139 L199 140 L199 148 L196 160 L194 155 L189 150 L187 150 L185 171 L187 177 L203 194 L207 203 L207 208 L204 215 L197 221 L190 212 L184 210 L189 206 L189 203 L176 190 L170 179 Z M148 207 L151 195 L153 193 L153 191 L150 189 L149 183 L150 180 L154 176 L156 176 L156 184 L159 189 L169 195 L165 206 L167 213 L180 224 L182 224 L185 228 L187 228 L194 235 L199 244 L201 262 L196 269 L189 269 L185 266 L182 247 L152 221 Z M122 260 L125 247 L130 238 L135 233 L143 229 L144 233 L153 242 L147 245 L142 250 L138 266 L132 270 L127 269 L124 267 Z",
				"M125 179 L127 175 L135 168 L134 157 L138 141 L144 135 L153 131 L161 123 L170 119 L178 119 L188 99 L202 83 L208 80 L218 69 L229 69 L233 73 L235 78 L235 98 L221 132 L219 133 L209 151 L202 159 L196 171 L197 180 L200 183 L206 196 L206 206 L203 212 L197 218 L195 218 L193 213 L189 209 L184 207 L189 203 L189 198 L181 184 L179 170 L186 153 L195 142 L195 140 L203 130 L206 122 L208 121 L215 106 L219 92 L215 94 L204 105 L193 127 L188 133 L170 137 L159 147 L153 149 L151 157 L152 172 L149 178 L154 178 L162 182 L166 189 L166 205 L168 210 L196 237 L201 253 L200 265 L196 269 L189 269 L185 266 L182 246 L174 237 L167 233 L152 216 L149 205 L149 194 L131 192 L125 185 Z M122 260 L126 244 L131 236 L142 227 L145 227 L146 232 L155 240 L148 243 L142 249 L138 266 L132 270 L127 269 L124 267 Z",
				"M94 151 L97 143 L104 136 L107 136 L109 134 L126 130 L149 120 L177 118 L185 110 L185 108 L202 92 L223 81 L234 78 L250 69 L262 68 L266 70 L272 78 L274 93 L268 108 L266 109 L259 122 L236 146 L234 146 L226 154 L215 161 L206 171 L204 176 L206 198 L202 208 L196 215 L194 215 L193 211 L186 204 L184 204 L184 202 L189 197 L187 182 L189 168 L195 158 L206 147 L208 147 L211 143 L222 136 L244 114 L256 94 L256 85 L239 94 L230 96 L214 104 L200 116 L200 118 L189 130 L182 134 L147 138 L128 147 L114 150 L111 153 L111 160 L115 168 L116 175 L147 178 L156 181 L162 186 L166 193 L170 208 L191 229 L198 240 L201 252 L201 262 L196 269 L189 269 L185 266 L182 245 L177 240 L177 238 L159 221 L153 211 L150 198 L148 196 L141 194 L114 192 L105 188 L101 184 L99 180 L98 170 L94 161 Z M122 260 L124 250 L129 238 L136 230 L146 224 L148 230 L155 236 L155 238 L153 238 L143 247 L138 266 L132 270 L127 269 L124 267 Z",
				"M71 154 L72 148 L76 141 L85 135 L110 130 L118 126 L139 120 L176 118 L189 105 L191 105 L196 99 L198 99 L205 93 L219 86 L247 78 L271 68 L281 68 L286 70 L291 75 L294 82 L295 93 L293 99 L282 117 L261 137 L259 137 L257 140 L255 140 L253 143 L251 143 L249 146 L247 146 L234 156 L222 162 L211 172 L206 183 L203 198 L194 210 L188 203 L188 201 L183 197 L188 190 L190 179 L196 165 L209 151 L236 135 L238 132 L251 124 L258 116 L260 116 L276 96 L278 91 L277 85 L272 85 L260 91 L231 99 L212 108 L207 113 L205 113 L192 127 L190 127 L183 133 L176 135 L140 137 L114 146 L89 152 L89 161 L95 167 L95 169 L102 173 L114 176 L147 178 L158 182 L165 188 L175 209 L189 224 L198 239 L201 252 L201 262 L196 269 L189 269 L185 266 L184 252 L180 240 L163 221 L162 217 L156 209 L153 200 L149 196 L108 192 L89 185 L80 177 L80 175 L75 170 L72 163 Z M122 260 L125 246 L129 237 L140 225 L148 220 L151 228 L157 234 L149 239 L143 246 L138 266 L132 270 L127 269 L124 267 Z",
				"M77 151 L80 143 L90 135 L114 130 L142 120 L176 118 L193 101 L195 101 L198 97 L208 92 L209 90 L233 80 L249 76 L263 69 L279 69 L286 75 L288 79 L290 93 L284 107 L282 108 L278 116 L262 133 L260 133 L250 143 L220 162 L209 173 L198 196 L193 202 L189 193 L183 187 L198 160 L210 149 L233 135 L245 124 L247 124 L264 107 L273 91 L272 85 L267 85 L254 92 L229 99 L223 103 L216 105 L208 112 L206 112 L200 119 L198 119 L191 128 L181 134 L142 137 L115 147 L98 150 L94 153 L94 160 L96 164 L106 171 L124 176 L153 178 L163 182 L170 188 L181 211 L193 227 L199 241 L201 262 L196 269 L189 269 L185 266 L182 242 L178 234 L164 215 L164 212 L158 200 L154 196 L119 192 L97 185 L82 173 L77 161 Z M122 260 L126 242 L130 234 L144 219 L150 216 L153 224 L158 230 L154 234 L152 234 L144 243 L138 266 L132 270 L127 269 L124 267 Z",
				"M113 153 L115 145 L121 137 L126 134 L135 132 L155 121 L178 118 L184 108 L190 102 L190 100 L199 91 L201 91 L211 83 L223 78 L233 70 L238 68 L245 68 L252 73 L256 85 L256 94 L247 116 L245 117 L244 121 L237 129 L237 131 L234 133 L234 135 L229 139 L229 141 L205 165 L193 188 L189 179 L184 176 L182 172 L194 152 L214 133 L214 131 L226 118 L237 98 L239 87 L212 102 L201 113 L194 125 L186 133 L181 135 L171 135 L157 138 L140 148 L132 150 L130 153 L130 162 L133 168 L150 176 L166 178 L172 181 L178 188 L183 205 L189 218 L192 221 L200 243 L201 262 L196 269 L189 269 L185 266 L182 240 L170 217 L163 196 L161 194 L154 194 L139 190 L124 182 L115 171 L113 163 Z M122 260 L126 241 L130 232 L138 223 L138 221 L151 209 L153 209 L154 216 L160 224 L145 239 L142 246 L138 266 L132 270 L127 269 L124 267 Z",
				"M169 164 L184 94 L185 74 L190 68 L197 68 L202 74 L202 95 L200 107 L197 111 L195 127 L189 147 L189 149 L192 148 L191 155 L190 157 L188 156 L186 164 L186 172 L191 180 L191 188 L188 191 L188 202 L191 215 L197 229 L201 251 L201 262 L196 269 L189 269 L185 266 L184 263 L182 237 L173 213 L171 202 L171 187 L173 181 L171 180 L169 174 Z M122 260 L126 240 L133 224 L157 195 L157 205 L163 214 L151 227 L144 239 L138 266 L132 270 L127 269 L124 267 Z",
				"M122 260 L130 227 L142 204 L149 195 L156 179 L155 163 L139 137 L130 110 L130 82 L132 75 L140 68 L148 68 L157 73 L162 78 L177 85 L186 94 L197 119 L213 120 L220 123 L228 130 L241 135 L248 144 L248 156 L241 172 L237 176 L236 180 L228 188 L215 193 L200 194 L195 196 L193 207 L200 241 L201 262 L196 269 L187 268 L184 263 L183 240 L177 216 L178 193 L181 187 L191 179 L199 177 L209 177 L219 174 L231 155 L231 149 L221 145 L208 136 L191 135 L185 132 L180 125 L178 115 L172 103 L165 97 L147 88 L146 98 L149 117 L158 138 L167 150 L172 161 L173 179 L167 197 L165 198 L163 204 L153 218 L145 234 L138 266 L132 270 L127 269 L124 267 Z",
				"M94 83 L101 71 L107 68 L117 68 L137 77 L164 85 L165 87 L173 90 L188 104 L197 118 L224 119 L234 121 L255 130 L277 135 L285 142 L287 147 L287 155 L284 163 L282 164 L281 168 L263 184 L241 192 L205 195 L201 196 L197 200 L196 218 L200 239 L201 262 L196 269 L189 269 L185 266 L184 263 L183 239 L179 219 L179 202 L183 191 L192 182 L200 179 L235 176 L250 172 L261 165 L267 159 L270 151 L251 146 L229 137 L195 135 L189 133 L182 127 L174 113 L164 104 L152 98 L127 91 L116 85 L111 85 L111 99 L117 115 L136 137 L138 137 L142 142 L144 142 L150 149 L155 152 L162 163 L165 173 L165 182 L161 197 L156 205 L156 208 L145 231 L139 264 L135 269 L127 269 L124 267 L122 262 L126 238 L133 216 L145 192 L148 182 L148 173 L144 165 L130 152 L128 152 L105 127 L95 105 Z",
				"M91 85 L93 78 L98 71 L104 68 L115 68 L130 75 L149 80 L169 88 L187 103 L187 105 L190 107 L197 118 L225 119 L239 122 L257 130 L277 134 L283 137 L288 142 L290 153 L285 166 L274 178 L272 178 L267 183 L257 188 L243 192 L205 195 L198 199 L196 204 L196 218 L200 239 L201 262 L196 269 L189 269 L185 266 L184 263 L183 239 L179 218 L179 204 L184 190 L191 183 L200 179 L237 176 L252 172 L265 164 L271 157 L273 151 L259 148 L230 137 L192 134 L185 130 L176 116 L173 114 L173 112 L160 102 L155 101 L151 98 L125 91 L114 85 L109 85 L108 97 L113 112 L121 121 L121 123 L138 140 L140 140 L154 152 L154 154 L160 160 L164 171 L164 185 L162 193 L145 231 L139 264 L135 269 L127 269 L124 267 L122 262 L126 238 L134 213 L136 212 L138 204 L147 185 L147 172 L144 166 L135 157 L129 154 L110 136 L110 134 L106 131 L106 129 L99 121 L92 103 Z",
				"M122 87 L123 80 L128 71 L133 68 L144 69 L152 75 L177 87 L188 99 L196 118 L212 119 L224 123 L232 129 L250 136 L256 145 L256 155 L253 164 L244 178 L235 187 L224 192 L198 195 L195 198 L194 212 L201 251 L201 262 L196 269 L189 269 L185 266 L184 263 L183 240 L177 213 L177 200 L180 190 L187 182 L193 179 L219 176 L226 173 L236 161 L239 154 L239 149 L233 148 L218 140 L217 138 L211 136 L192 135 L187 133 L182 128 L177 114 L169 102 L167 102 L162 97 L152 94 L142 87 L139 87 L139 101 L143 118 L153 137 L156 139 L156 141 L159 143 L168 157 L171 166 L171 181 L167 194 L145 233 L138 266 L132 270 L125 268 L122 260 L127 235 L134 217 L136 216 L139 208 L141 207 L143 201 L145 200 L152 187 L154 181 L154 167 L130 130 L123 109 Z",
				"M122 260 L126 240 L134 222 L148 205 L148 203 L156 195 L166 178 L169 163 L170 128 L175 92 L175 75 L179 69 L187 68 L192 72 L197 89 L197 112 L194 116 L188 118 L186 148 L191 147 L196 142 L198 133 L200 136 L201 148 L196 168 L198 186 L193 191 L196 184 L196 174 L189 165 L185 164 L184 176 L176 195 L163 211 L163 213 L158 217 L155 223 L151 226 L145 236 L138 266 L132 270 L127 269 L124 267 Z M174 213 L180 212 L187 205 L188 199 L190 201 L190 208 L197 228 L201 251 L201 262 L196 269 L189 269 L185 266 L182 237 Z",
				"M122 260 L126 241 L132 228 L139 221 L139 219 L145 213 L147 213 L160 199 L162 199 L165 194 L171 189 L188 155 L205 136 L207 131 L216 120 L228 94 L228 90 L226 90 L224 93 L220 94 L212 101 L210 101 L198 116 L193 127 L187 133 L165 137 L156 144 L142 151 L142 167 L152 174 L161 176 L161 178 L155 184 L153 191 L147 190 L135 183 L126 172 L124 158 L126 146 L129 140 L133 136 L149 129 L151 126 L160 121 L179 118 L188 101 L202 86 L216 78 L228 68 L238 69 L242 73 L245 81 L245 95 L240 110 L230 129 L221 140 L219 145 L202 164 L190 190 L188 191 L184 199 L148 234 L142 246 L138 266 L132 270 L127 269 L124 267 Z M176 224 L181 223 L188 216 L188 214 L192 220 L199 239 L201 251 L201 262 L196 269 L189 269 L185 266 L182 239 L176 228 Z",
				"M84 151 L87 143 L93 137 L99 134 L119 130 L126 126 L145 120 L176 118 L204 92 L230 80 L234 80 L236 78 L247 75 L258 69 L271 68 L279 74 L282 80 L283 94 L276 110 L269 118 L269 120 L242 146 L219 161 L208 172 L195 197 L186 206 L186 208 L184 208 L179 214 L177 214 L170 221 L158 228 L153 234 L148 237 L142 247 L139 264 L135 269 L130 270 L125 268 L122 262 L125 245 L133 229 L144 218 L161 207 L178 192 L178 190 L183 185 L187 175 L189 174 L192 166 L205 151 L207 151 L210 147 L229 135 L255 111 L266 93 L266 85 L262 85 L247 93 L229 98 L213 106 L207 112 L205 112 L190 129 L188 129 L184 133 L178 135 L146 137 L117 148 L102 151 L102 163 L107 168 L115 172 L130 176 L156 178 L167 183 L161 189 L159 189 L155 195 L124 192 L113 189 L98 182 L90 175 L86 168 L84 162 Z M177 231 L183 229 L189 222 L193 226 L200 244 L201 252 L201 262 L196 269 L189 269 L185 266 L183 246 L181 239 L177 234 Z",
				"M70 150 L73 143 L78 138 L86 134 L109 130 L117 126 L139 120 L175 118 L179 116 L187 107 L189 107 L196 99 L206 94 L207 92 L222 85 L259 74 L272 68 L283 68 L289 71 L296 83 L295 98 L291 106 L284 114 L284 116 L279 120 L279 122 L261 138 L256 140 L241 152 L237 153 L233 157 L220 164 L211 173 L206 182 L203 194 L195 207 L182 218 L178 219 L174 223 L170 224 L166 228 L153 235 L144 244 L141 251 L139 264 L135 269 L132 270 L125 268 L122 262 L125 246 L132 232 L144 221 L177 201 L185 193 L192 173 L199 161 L214 148 L234 137 L250 124 L252 124 L255 120 L257 120 L275 100 L276 96 L279 93 L279 85 L273 85 L265 88 L264 90 L222 103 L203 115 L192 127 L190 127 L183 133 L176 135 L139 137 L106 148 L91 150 L87 152 L88 162 L92 167 L100 172 L116 176 L148 178 L161 183 L168 191 L158 195 L155 200 L147 195 L110 192 L89 185 L88 183 L83 181 L73 169 L70 161 Z M178 236 L185 233 L190 227 L195 232 L201 252 L201 262 L196 269 L189 269 L185 266 L183 246 Z",
				"M82 151 L85 143 L95 135 L114 131 L144 120 L176 118 L196 98 L198 98 L208 90 L231 80 L246 76 L262 68 L272 68 L278 71 L283 78 L285 85 L285 94 L279 108 L277 109 L273 117 L254 137 L252 137 L249 141 L247 141 L243 146 L234 151 L232 154 L221 160 L209 171 L206 178 L205 198 L200 208 L189 218 L167 229 L166 231 L160 233 L159 235 L148 241 L141 251 L140 261 L135 269 L130 270 L125 268 L122 262 L125 246 L130 236 L140 226 L144 225 L151 219 L163 214 L164 212 L172 209 L186 199 L189 193 L190 173 L196 161 L208 149 L213 147 L215 144 L226 138 L238 127 L240 127 L259 108 L268 92 L268 86 L264 85 L253 91 L230 98 L215 105 L206 113 L204 113 L196 121 L196 123 L184 133 L178 135 L145 137 L115 148 L102 150 L99 152 L99 160 L106 173 L115 176 L146 178 L160 184 L165 190 L167 197 L160 198 L153 204 L151 202 L151 199 L145 195 L115 193 L97 187 L91 181 L83 165 Z M178 239 L185 237 L191 231 L194 232 L198 240 L201 252 L201 262 L196 269 L189 269 L185 266 L183 247 Z",
				"M112 177 L115 172 L113 161 L114 149 L121 137 L135 132 L155 121 L178 118 L184 108 L190 102 L190 100 L199 91 L201 91 L211 83 L226 76 L228 73 L237 68 L245 68 L252 73 L255 80 L256 93 L245 119 L243 120 L237 131 L233 134 L233 136 L228 140 L228 142 L208 161 L208 163 L201 171 L201 182 L206 194 L206 202 L204 208 L192 220 L163 235 L158 236 L157 238 L146 244 L141 251 L140 261 L135 269 L130 270 L125 268 L122 262 L124 250 L128 240 L138 229 L140 229 L144 225 L178 209 L189 201 L188 191 L184 182 L184 170 L186 164 L194 154 L194 152 L214 133 L214 131 L219 127 L219 125 L228 115 L238 95 L239 87 L237 87 L230 93 L218 98 L208 107 L206 107 L206 109 L200 114 L191 129 L186 133 L181 135 L163 136 L140 148 L131 151 L131 176 L150 178 L159 182 L165 190 L166 201 L160 201 L150 207 L148 195 L122 192 L113 185 Z M179 241 L183 241 L189 238 L192 234 L195 235 L199 243 L201 252 L201 262 L196 269 L189 269 L185 266 L183 248 Z",
				"M122 260 L125 247 L129 239 L137 231 L157 220 L180 211 L190 203 L177 184 L174 169 L181 148 L193 148 L197 146 L204 135 L206 129 L206 119 L200 112 L198 112 L192 131 L187 135 L183 135 L179 143 L174 147 L171 172 L169 176 L165 180 L163 180 L168 188 L166 204 L157 204 L149 209 L149 200 L151 194 L141 192 L137 188 L136 182 L140 175 L155 166 L155 155 L158 142 L167 131 L168 127 L175 120 L179 119 L186 96 L191 89 L191 86 L193 85 L198 72 L203 68 L210 68 L216 76 L216 97 L204 138 L202 140 L191 170 L193 179 L205 195 L205 211 L194 222 L167 235 L164 235 L145 246 L141 252 L139 264 L135 269 L130 270 L125 268 Z M179 243 L184 243 L190 240 L193 236 L195 236 L195 238 L197 239 L200 247 L201 262 L196 269 L189 269 L185 266 L183 249 Z",
				"M148 205 L152 195 L159 186 L160 180 L163 177 L197 165 L201 154 L201 146 L197 143 L194 136 L185 134 L180 128 L178 105 L176 97 L174 96 L174 128 L180 158 L169 159 L163 162 L157 128 L158 79 L160 73 L165 68 L172 68 L177 71 L181 79 L188 85 L192 92 L195 104 L196 119 L202 121 L208 127 L212 135 L214 135 L217 139 L218 155 L214 169 L209 177 L191 186 L176 190 L166 206 L158 206 L148 211 Z M122 260 L128 241 L137 232 L149 225 L157 223 L161 220 L164 220 L186 210 L190 207 L186 202 L196 199 L200 194 L204 197 L207 204 L207 210 L205 215 L197 223 L171 235 L165 236 L146 246 L141 252 L139 264 L135 269 L130 270 L125 268 Z M180 245 L187 244 L194 238 L197 240 L201 253 L201 262 L196 269 L189 269 L185 266 L184 253 Z",
				"M133 87 L137 73 L143 68 L151 68 L166 79 L178 85 L186 93 L193 107 L196 119 L208 119 L214 121 L225 128 L227 131 L239 136 L244 143 L244 156 L236 174 L230 179 L221 183 L179 194 L167 205 L166 208 L155 208 L147 212 L150 201 L163 185 L176 177 L197 173 L221 165 L226 158 L227 149 L218 145 L216 142 L206 136 L191 135 L186 133 L180 125 L176 109 L172 102 L168 98 L150 88 L150 105 L152 117 L156 129 L165 146 L167 147 L173 161 L173 165 L168 165 L157 172 L155 160 L142 138 L135 118 L133 105 Z M122 260 L126 245 L135 234 L151 225 L187 211 L189 209 L188 206 L196 205 L202 200 L205 201 L207 206 L207 213 L199 223 L147 246 L141 252 L139 264 L135 269 L130 270 L125 268 Z M180 246 L190 244 L194 239 L196 239 L201 253 L201 262 L196 269 L189 269 L185 266 L184 254 Z",
				"M148 206 L151 196 L155 190 L155 179 L163 174 L177 170 L187 165 L190 154 L191 145 L188 141 L187 135 L183 134 L179 128 L179 108 L172 110 L167 117 L167 136 L169 140 L175 145 L183 146 L183 154 L172 155 L169 158 L167 158 L166 154 L166 105 L168 96 L168 80 L170 72 L173 69 L182 68 L187 73 L188 78 L195 91 L196 121 L200 123 L204 136 L207 140 L206 159 L201 174 L195 180 L174 188 L169 200 L167 201 L166 206 L156 206 L149 211 Z M122 260 L125 247 L134 234 L151 224 L154 224 L167 217 L173 216 L188 208 L190 205 L184 199 L190 198 L196 195 L198 192 L203 195 L207 203 L207 209 L201 219 L184 229 L164 236 L146 246 L141 252 L139 264 L135 269 L130 270 L125 268 Z M180 245 L191 241 L194 237 L196 238 L201 253 L201 262 L196 269 L189 269 L185 266 L184 253 Z",
				"M122 260 L125 247 L129 239 L137 231 L161 218 L167 217 L183 209 L190 203 L177 183 L175 176 L175 167 L183 146 L194 147 L198 145 L204 137 L206 131 L206 121 L200 114 L197 115 L193 129 L188 134 L182 135 L178 142 L171 149 L169 171 L166 177 L162 180 L166 184 L168 189 L166 204 L157 204 L149 209 L150 194 L140 192 L135 186 L135 181 L141 173 L152 167 L153 152 L157 139 L164 133 L166 128 L174 120 L179 119 L186 97 L192 86 L196 82 L200 72 L205 68 L212 68 L215 70 L218 76 L219 93 L210 126 L192 169 L192 176 L205 195 L206 208 L203 214 L192 223 L169 234 L166 234 L146 245 L141 252 L139 264 L135 269 L130 270 L125 268 Z M180 243 L184 243 L190 240 L193 235 L197 239 L200 247 L201 262 L196 269 L189 269 L185 266 L184 253 Z",
				"M117 177 L122 170 L121 150 L124 142 L128 137 L143 131 L144 129 L158 121 L178 118 L189 100 L201 88 L220 77 L227 70 L232 68 L239 68 L244 71 L248 79 L249 94 L243 111 L226 139 L208 158 L199 172 L200 182 L204 188 L206 195 L206 203 L204 209 L193 220 L149 242 L142 249 L139 264 L135 269 L130 270 L125 268 L122 262 L124 250 L128 240 L137 230 L139 230 L143 226 L179 209 L189 201 L189 196 L182 179 L182 171 L185 162 L187 161 L193 150 L207 136 L207 134 L219 120 L220 116 L227 106 L232 93 L232 89 L210 102 L203 109 L196 122 L188 132 L182 135 L166 136 L151 144 L150 146 L138 151 L137 159 L139 173 L137 177 L151 178 L160 182 L163 185 L166 193 L166 201 L158 202 L150 207 L149 195 L129 193 L121 190 L117 184 Z M179 242 L188 239 L193 234 L196 237 L201 252 L201 262 L196 269 L189 269 L185 266 L183 248 Z",
				"M92 150 L96 141 L104 135 L127 129 L131 126 L148 120 L177 118 L185 110 L185 108 L204 91 L224 81 L242 75 L243 73 L252 69 L264 68 L268 70 L274 78 L276 93 L270 108 L268 109 L261 122 L244 140 L242 140 L236 147 L234 147 L231 151 L229 151 L218 161 L216 161 L206 172 L206 197 L201 209 L190 219 L150 240 L143 247 L139 264 L135 269 L130 270 L125 268 L122 262 L125 246 L131 235 L141 226 L165 214 L166 212 L171 211 L187 200 L187 198 L189 197 L188 173 L192 163 L207 147 L221 138 L246 114 L246 112 L249 110 L254 100 L256 99 L256 96 L259 92 L259 86 L256 85 L247 91 L226 98 L213 105 L200 116 L200 118 L189 130 L182 134 L154 136 L109 152 L109 161 L115 175 L147 178 L159 183 L162 186 L167 198 L158 200 L153 205 L151 205 L150 198 L146 195 L118 193 L105 189 L103 186 L101 186 L92 163 Z M179 240 L187 237 L192 232 L196 236 L201 252 L201 262 L196 269 L189 269 L185 266 L183 248 Z",
				"M72 149 L75 143 L81 137 L88 134 L110 130 L118 126 L139 120 L176 118 L189 105 L191 105 L196 99 L198 99 L205 93 L224 84 L258 74 L259 72 L268 70 L270 68 L281 68 L287 71 L293 79 L295 89 L294 96 L288 108 L280 117 L280 119 L261 137 L259 137 L257 140 L255 140 L253 143 L251 143 L249 146 L247 146 L237 154 L222 162 L211 172 L206 183 L203 198 L199 205 L189 215 L149 239 L142 248 L138 266 L132 270 L125 268 L122 262 L125 246 L131 234 L144 222 L173 206 L186 195 L192 173 L198 162 L209 151 L236 135 L251 122 L253 122 L259 115 L261 115 L274 99 L278 91 L277 85 L271 85 L260 91 L231 99 L212 108 L207 113 L205 113 L192 127 L190 127 L183 133 L176 135 L140 137 L111 147 L90 151 L89 160 L91 164 L102 173 L114 176 L147 178 L161 184 L167 191 L167 194 L159 196 L155 201 L153 201 L149 196 L146 195 L108 192 L89 185 L80 177 L73 165 Z M178 237 L184 235 L190 229 L194 231 L198 239 L201 252 L201 262 L196 269 L189 269 L185 266 L183 247 Z",
				"M80 150 L85 140 L93 135 L116 130 L123 126 L143 120 L176 118 L195 99 L197 99 L205 92 L224 83 L250 75 L261 69 L274 68 L280 71 L286 80 L287 94 L281 108 L279 109 L275 117 L252 140 L250 140 L236 152 L219 162 L207 175 L197 196 L192 201 L192 203 L183 212 L181 212 L171 221 L159 228 L145 241 L142 247 L139 264 L135 269 L130 270 L125 268 L122 262 L126 242 L134 228 L145 218 L147 218 L149 215 L151 215 L153 212 L158 210 L160 207 L162 207 L177 195 L177 193 L181 190 L185 181 L187 180 L192 168 L203 154 L205 154 L209 149 L234 133 L260 109 L260 107 L268 97 L268 94 L270 92 L270 85 L265 85 L257 90 L231 98 L214 106 L204 115 L202 115 L191 128 L181 134 L144 137 L114 148 L98 151 L98 163 L103 168 L109 171 L127 176 L154 178 L167 184 L167 186 L159 190 L155 196 L121 192 L104 187 L91 180 L82 168 L80 162 Z M177 232 L183 230 L189 223 L192 225 L197 235 L201 252 L201 262 L196 269 L189 269 L185 266 L183 246 Z",
				"M122 260 L126 241 L131 229 L139 220 L139 218 L164 194 L164 192 L170 186 L178 171 L179 165 L185 152 L187 151 L191 142 L194 140 L207 115 L207 112 L209 111 L212 98 L214 96 L212 95 L203 105 L192 129 L188 133 L173 137 L164 146 L158 149 L156 156 L156 168 L162 173 L157 177 L153 186 L151 186 L142 177 L139 169 L139 155 L144 139 L148 135 L155 132 L165 122 L172 119 L178 119 L185 103 L187 102 L192 92 L198 87 L201 82 L203 82 L208 77 L208 75 L214 69 L225 69 L229 73 L231 80 L230 100 L218 131 L216 132 L206 152 L200 159 L188 188 L186 189 L185 193 L178 201 L178 203 L170 210 L167 215 L165 215 L157 223 L157 225 L149 232 L149 234 L145 238 L138 266 L132 270 L127 269 L124 267 Z M175 222 L180 221 L187 214 L187 212 L189 212 L191 216 L199 238 L201 251 L201 262 L196 269 L189 269 L185 266 L183 243 Z",
				"M122 260 L127 235 L132 222 L142 204 L146 200 L147 196 L149 195 L156 178 L156 168 L154 161 L143 146 L137 134 L129 108 L130 78 L134 71 L136 71 L137 69 L147 68 L160 77 L175 84 L185 93 L192 105 L192 109 L197 119 L210 119 L216 121 L229 130 L242 135 L248 142 L249 155 L243 170 L241 171 L236 181 L230 187 L220 192 L200 194 L195 196 L194 215 L200 241 L201 262 L196 269 L187 268 L184 263 L183 240 L177 216 L178 193 L181 187 L189 180 L200 177 L215 176 L219 174 L229 161 L232 154 L232 149 L225 147 L211 137 L191 135 L185 132 L180 125 L176 110 L173 105 L166 98 L154 93 L146 87 L146 107 L148 117 L157 137 L165 147 L170 157 L173 167 L173 178 L169 192 L145 234 L138 266 L132 270 L127 269 L124 267 Z",
				"M88 84 L93 73 L101 68 L112 68 L125 74 L159 84 L163 87 L168 88 L169 90 L176 93 L179 97 L181 97 L197 118 L233 120 L247 124 L260 130 L285 136 L290 140 L293 146 L292 159 L287 168 L277 178 L262 187 L238 193 L206 195 L202 196 L198 200 L196 205 L196 217 L200 239 L201 262 L196 269 L189 269 L185 266 L184 263 L183 239 L179 217 L180 200 L185 189 L190 184 L201 179 L239 176 L257 171 L267 165 L273 159 L276 151 L262 148 L232 137 L192 134 L184 129 L175 115 L167 107 L160 104 L159 102 L123 91 L111 85 L105 85 L105 98 L112 115 L125 130 L127 130 L135 139 L140 141 L156 156 L163 171 L162 191 L145 231 L139 264 L135 269 L127 269 L124 267 L122 262 L126 238 L132 218 L143 195 L147 176 L143 166 L122 148 L120 148 L104 132 L104 130 L95 119 L89 104 Z",
				"M122 260 L128 232 L137 213 L152 191 L157 178 L157 166 L140 133 L135 117 L133 102 L134 80 L137 73 L144 68 L151 68 L160 73 L166 79 L174 82 L186 93 L193 107 L196 119 L208 119 L214 121 L227 131 L239 136 L244 145 L244 155 L239 169 L237 170 L231 182 L225 188 L213 193 L195 195 L193 201 L193 210 L200 241 L201 262 L196 269 L187 268 L184 263 L183 241 L176 209 L178 192 L181 186 L190 179 L207 177 L216 174 L226 157 L227 149 L221 147 L206 136 L190 135 L186 133 L180 125 L176 109 L172 102 L168 98 L150 88 L150 103 L153 120 L158 133 L172 158 L174 165 L174 178 L166 200 L162 204 L161 208 L154 217 L145 234 L138 266 L132 270 L127 269 L124 267 Z",
				"M136 151 L140 140 L145 135 L155 130 L160 124 L164 123 L165 121 L179 118 L191 94 L204 81 L206 81 L214 71 L219 68 L226 68 L232 73 L234 78 L235 94 L229 113 L219 134 L199 163 L193 179 L185 169 L180 168 L180 165 L187 151 L205 125 L212 111 L217 93 L212 96 L203 106 L192 129 L188 133 L171 137 L164 144 L154 149 L153 152 L153 168 L157 172 L175 179 L182 188 L185 204 L196 228 L200 243 L201 262 L196 269 L189 269 L185 266 L182 239 L172 217 L166 194 L159 192 L147 185 L137 174 Z M122 260 L126 241 L130 231 L132 230 L136 222 L141 218 L141 216 L154 204 L156 214 L161 219 L161 221 L150 231 L150 233 L145 238 L138 266 L132 270 L127 269 L124 267 Z",
				"M77 154 L78 148 L82 141 L93 134 L114 130 L142 120 L176 118 L193 101 L195 101 L198 97 L208 92 L209 90 L233 80 L249 76 L263 69 L276 68 L282 71 L288 80 L289 95 L283 108 L278 113 L276 118 L252 141 L250 141 L243 148 L241 148 L213 168 L213 170 L209 173 L206 180 L204 181 L200 192 L193 202 L189 193 L183 188 L183 186 L185 185 L197 161 L207 151 L238 131 L261 110 L261 108 L265 105 L271 95 L272 85 L267 85 L251 93 L229 99 L216 105 L208 112 L206 112 L200 119 L198 119 L191 128 L181 134 L143 137 L112 148 L98 150 L94 154 L96 163 L101 168 L109 172 L125 176 L157 179 L165 183 L171 189 L180 209 L193 227 L199 241 L201 262 L196 269 L189 269 L185 266 L182 242 L178 234 L166 218 L156 197 L146 194 L119 192 L102 187 L92 182 L82 172 L78 163 Z M122 260 L126 242 L130 234 L145 218 L150 216 L153 224 L158 228 L158 230 L154 234 L152 234 L144 243 L138 266 L132 270 L127 269 L124 267 Z",
				"M76 149 L82 139 L92 134 L113 130 L141 120 L176 118 L192 102 L194 102 L204 93 L220 85 L250 76 L267 68 L278 68 L284 71 L290 81 L291 94 L282 112 L263 133 L261 133 L247 146 L222 161 L210 172 L207 178 L203 201 L194 212 L192 207 L184 200 L184 198 L188 193 L190 178 L195 165 L208 151 L231 137 L234 133 L243 128 L256 115 L260 113 L260 111 L266 106 L274 92 L273 85 L269 85 L255 92 L230 99 L213 107 L208 112 L206 112 L192 127 L181 134 L142 137 L120 145 L93 152 L93 161 L101 172 L114 176 L150 179 L159 183 L165 189 L173 208 L190 226 L199 242 L201 262 L196 269 L189 269 L185 266 L182 244 L174 235 L174 233 L162 221 L153 205 L151 198 L139 194 L108 192 L94 187 L84 178 L78 168 L78 165 L76 163 Z M122 260 L126 243 L132 233 L145 222 L148 222 L150 228 L157 235 L151 238 L143 246 L138 266 L132 270 L127 269 L124 267 Z",
				"M113 176 L116 172 L114 160 L115 149 L122 137 L136 132 L155 121 L178 118 L184 108 L190 102 L190 100 L200 90 L202 90 L212 82 L227 75 L234 69 L244 68 L251 73 L254 80 L255 93 L248 112 L246 113 L243 121 L230 137 L230 139 L206 163 L201 171 L200 178 L205 190 L206 202 L203 210 L196 217 L186 206 L184 206 L184 204 L189 201 L189 195 L184 183 L184 169 L192 154 L215 131 L215 129 L220 125 L220 123 L229 112 L237 95 L238 87 L233 91 L219 97 L217 100 L208 105 L200 114 L191 129 L186 133 L181 135 L164 136 L152 141 L151 143 L141 148 L132 151 L132 176 L150 178 L158 181 L165 190 L167 205 L171 212 L180 221 L182 221 L195 235 L199 243 L201 252 L201 262 L196 269 L189 269 L185 266 L184 253 L181 244 L157 221 L151 210 L149 196 L144 194 L126 193 L118 190 L113 183 Z M122 260 L128 240 L137 230 L145 225 L147 230 L153 237 L155 237 L155 239 L150 241 L142 249 L138 266 L132 270 L127 269 L124 267 Z",
				"M170 148 L171 143 L176 146 L178 138 L182 119 L181 106 L185 92 L187 72 L191 68 L198 68 L203 73 L204 93 L194 144 L190 157 L188 174 L191 180 L203 193 L207 203 L206 210 L204 214 L198 220 L196 220 L188 210 L184 209 L190 204 L178 190 L173 181 L171 167 L175 150 L170 152 Z M144 180 L150 174 L158 171 L157 178 L159 184 L165 190 L169 191 L169 196 L166 202 L167 212 L174 219 L184 225 L194 235 L199 244 L201 262 L196 269 L189 269 L185 266 L184 253 L180 244 L167 233 L165 233 L161 228 L159 228 L151 218 L149 213 L149 201 L152 193 L148 192 L144 188 Z M122 260 L128 241 L136 232 L143 228 L145 233 L154 241 L148 244 L142 250 L138 266 L132 270 L127 269 L124 267 Z",
			];
			// Matched junctions (zero-based): original wag 15, sway 0, twist 29.
			// Rotate complete loops so every animationiteration lands on its junction.
			const TAIL_ANIMATION_POSES = {
				wag: TAIL_POSES.slice(15).concat(TAIL_POSES.slice(0, 15)),
				sway: TAIL_SWAY_POSES,
				twist: TAIL_TWIST_POSES.slice(29).concat(TAIL_TWIST_POSES.slice(0, 29)),
			};
			const TAIL_WAG_DURATION = "--dsh-status-rotator-whale-wag-duration";
			let tailMotionTps = 0;
			const activeWhaleTails = new Set();
			const whaleTailMotionStates = new Map();
			const whaleTailPlaybackByRow = new Map();
			let pendingToolSwitch = false;
			let pendingToolTurn = null;
			const toolMotionCounts = { calls: 0, matches: 0, switches: 0 };
			const toolMotionListeners = new Set();
			const toolMotionStatus = () => ({ ...toolMotionCounts,
				channel: !liveSessionId || !liveSessionBinding ? "waiting" : liveEventsUnsub ? "ready" : "unavailable",
				activeTails: whaleTailMotionStates.size,
				pendingSwitch: pendingToolSwitch || Array.from(whaleTailMotionStates.values()).some(state => state.toolPending) });
			const publishToolMotionStatus = () => {
				for (const listener of toolMotionListeners) listener(toolMotionStatus());
			};
			exports.__debugWhaleTail = toolMotionStatus;
			/**
			 * 轮廓关键帧只加载当前动作及用到的衔接方向,缓存到最后一条尾巴停下。
			 * 默认关闭、以及关掉摇动之后,这段 CSS 都不存在,不占页面解析开销。
			 */
			let whaleWagStyleEl = null;
			const whaleTailLoadedKeyframes = new Set();
			const ensureWhaleWagStyle = (type = "wag", from = null) => {
				if (!whaleWagStyleEl || !whaleWagStyleEl.isConnected) {
					whaleWagStyleEl = createOwnedStyle("dsh-status-rotator-whale-wag-style");
					whaleTailLoadedKeyframes.clear();
					(document.head || document.documentElement).appendChild(whaleWagStyleEl);
				}
				const name = from ? `dsh-status-rotator-whale-bridge-${from}-${type}` : `dsh-status-rotator-whale-${type}`;
				if (!whaleTailLoadedKeyframes.has(name)) {
					const poses = from ? whaleTailBridgeFrames(TAIL_ANIMATION_POSES[from][0], TAIL_ANIMATION_POSES[type][0]) : TAIL_ANIMATION_POSES[type];
					const divisor = from ? poses.length - 1 : poses.length;
					whaleWagStyleEl.sheet.insertRule(`@keyframes ${name}{` +
						poses.map((pose, i) => `${i * 100 / divisor}%{d:path('${pose}')}`).join("") +
						(from ? "}" : `100%{d:path('${poses[0]}')}}`), whaleWagStyleEl.sheet.cssRules.length);
					whaleTailLoadedKeyframes.add(name);
				}
				return name;
			};
			/** 没有尾巴还在摇时撤掉关键帧样式(关掉开关 / 回合结束 / 卸载都走这里) */
			const releaseWhaleWagStyle = () => {
				if (!whaleWagStyleEl) return;
				for (const tail of activeWhaleTails) {
					if (tail.isConnected && tail.classList.contains(TAIL_WAG_CLASS)) return;
				}
				if (whaleWagStyleEl.isConnected) whaleWagStyleEl.remove();
				whaleWagStyleEl = null;
				whaleTailLoadedKeyframes.clear();
			};

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
			const layoutStyleEl = createOwnedStyle("dsh-status-rotator-layout-style");
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
				// 24 帧摇动关键帧(约 50KB 的 d:path)不在这里:交给下面的 ensureWhaleWagStyle 按需注入,默认零开销
				// 宿主 0.2.0-rc.2 的 runningIcon 里真正可见的是 span.runningWhaleAnimated(APNG mask),
				// svg.runningWhaleStill 只是被宿主 @supports/@media 关掉的静态回退。原先只藏 >svg,
				// 命中的正是那个已被 display:none 的死元素,APNG 照旧可见 → 与插件的 morph 轮廓重合。
				// 这里藏掉除 morph 外的全部直接子级(visibility 可继承,子树一并隐藏)。
				`.${TAIL_WAG_CLASS}{position:relative}.${TAIL_WAG_CLASS}>*:not(.${TAIL_MORPH_CLASS}){visibility:hidden}` +
				`.${TAIL_MORPH_CLASS}{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}.${TAIL_MORPH_CLASS}>path{animation:dsh-status-rotator-whale-wag var(${TAIL_WAG_DURATION},1s) steps(1,end) infinite}` +
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
			/**
			 * V3 外观样式表:动画 / 发光 / 活动指示全部用**挂在文本 span 上的类**实现 ——
			 * 不新增 DOM 节点,于是也不需要新的清理路径。发光色与强调色用 CSS 变量从行内给,
			 * 所以同一份样式表能服务任意配色。`currentColor` 在这里不能用:渐变文字是
			 * `-webkit-text-fill-color:transparent`,currentColor 会跟着变透明。
			 */
			const appearanceStyleEl = createOwnedStyle("dsh-status-rotator-appearance-style");
			appearanceStyleEl.textContent =
				"@keyframes dsh-sr-breathe{0%,100%{opacity:1}50%{opacity:.55}}" +
				"@keyframes dsh-sr-glitch{0%,90%,100%{text-shadow:none}" +
				"91%{text-shadow:2px 0 #ff5f6d,-2px 0 #5fd4ff}94%{text-shadow:-2px 0 #ff5f6d,2px 0 #5fd4ff}" +
				"97%{text-shadow:1px 0 #5fd4ff,-1px 0 #ff5f6d}}" +
				"@keyframes dsh-sr-spin{to{transform:rotate(360deg)}}" +
				"@keyframes dsh-sr-bar{0%{opacity:.25}50%{opacity:.75}100%{opacity:.25}}" +
				".dsh-status-rotator-anim-breathe{animation:dsh-sr-breathe 3s ease-in-out infinite}" +
				".dsh-status-rotator-anim-glitch{animation:dsh-sr-glitch 4s steps(1,end) infinite}" +
				".dsh-status-rotator-glow{filter:drop-shadow(0 0 6px var(--dsh-sr-glow,#5fd4ff))}" +
				".dsh-status-rotator-spin-ring::before{content:\"\";display:inline-block;width:10px;height:10px;" +
				"margin-right:6px;border:2px solid var(--dsh-sr-accent,#5fd4ff);border-top-color:transparent;" +
				"border-radius:50%;vertical-align:-1px;animation:dsh-sr-spin .8s linear infinite}" +
				".dsh-status-rotator-spin-bar::after{content:\"\";display:inline-block;width:32px;height:3px;" +
				"margin-left:6px;border-radius:2px;background:var(--dsh-sr-accent,#5fd4ff);" +
				"vertical-align:1px;animation:dsh-sr-bar 1.4s ease-in-out infinite}" +
				// 系统要求减少动效时,呼吸 / 故障停掉(活动指示保留:它表达"在跑",不是装饰)
				"@media (prefers-reduced-motion: reduce){" +
				".dsh-status-rotator-anim-breathe,.dsh-status-rotator-anim-glitch{animation:none}}";
			(document.head || document.documentElement).appendChild(appearanceStyleEl);
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
					styleEl = createOwnedStyle("dsh-status-rotator-style");
					document.head.appendChild(styleEl);
				}
				// 尾巴去留跟着配置走(设置页一改即时生效,不用等下一个回合)
				refreshTailPreference();
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
				let css = gradientTextCss(colors, speed, g.direction);
				// 鲸鱼尾巴跟着炫彩:0.2.0 的尾巴是 stroke=currentColor 的 svg,所以动画 color 就能流光。
				// 只在「保留尾巴」打开且渐变可用时生效;减少动态效果时停流光配色,摇动由独立开关控制。
				if (config.whaleTail) {
					const seq = colors.concat([colors[0]]);
					const stops = seq.map((c, i) => `${Math.round((i / (seq.length - 1)) * 100)}%{color:${c}}`).join("");
					css += `@keyframes dsh-status-rotator-tail-rainbow{${stops}}` +
						`.${TAIL_CLASS}{animation:dsh-status-rotator-tail-rainbow ${speed}s linear infinite}` +
						`@media (prefers-reduced-motion:reduce){.${TAIL_CLASS}{animation:none!important;color:${colors[0]}}}`;
				}
				styleEl.textContent = css;
				gradientCssActive = true;
			};

			/** 配置变化时把「尾巴去留」即时应用到正在接管的运行行(设置页开关不用等下一个回合) */
			const refreshTailPreference = () => {
				for (const row of Array.from(runningLines.keys())) {
					applyTailPreference(row, runningTails.get(row) || tailOf(row));
				}
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

			/**
			 * E2 的条件上下文:选句时用到的实时状态。取不到的字段一律给「不成立」的安全值,
			 * 于是没有实时能力的宿主只是不出条件句,状态行仍有无条件句兜底。
			 */
			const conditionContext = (phase) => ({
				tools: Array.isArray(liveState.tools) ? liveState.tools : [],
				retry: liveState.retry !== null && liveState.retry !== undefined,
				pending: typeof liveState.pending === "number" ? liveState.pending : 0,
				phase: typeof phase === "string" ? phase : liveState.phase,
				hour: new Date().getHours(),
				// 「首次会话」= 还没看到过任何回合结束
				firstTurn: !sawTurnEnd,
			});

			/**
			 * E1 + E2 的选句入口:先按 when / rarity 选出这一次可用的池子,再从洗牌袋里抽一条。
			 * 袋子的 key 是「语言|相位|权重模式」—— 换语言或换相位各记各的,不互相污染。
			 */
			const pickFrom = (list, phase) => {
				const pool = selectPhrasePool(list, conditionContext(phase), Math.random);
				if (pool.length === 0) return null;
				const weighted = config.weightedRandom !== false;
				const key = lastLocale + "|" + (phase || "-") + "|" + (weighted ? "w" : "u");
				const next = phraseBag.next(pool, key, weighted, Math.random);
				if (next !== null && config.antiRepeat && config.antiRepeat.persist) savePickMemory();
				return next;
			};

			/** 反重复记忆落盘(只有 antiRepeat.persist 打开时才会被调用) */
			const savePickMemory = () => {
				try {
					localStorage.setItem(PICK_MEMORY_KEY, JSON.stringify({ version: 1, keys: phraseBag.snapshot() }));
				} catch (error) { /* 隐私模式 / 配额满:记忆不落盘不影响轮换 */ }
			};

			/** 载入反重复记忆(结构非法 / 存档过期一律忽略) */
			const loadPickMemory = () => {
				try {
					const raw = localStorage.getItem(PICK_MEMORY_KEY);
					if (!raw) return;
					const data = JSON.parse(raw);
					if (!data || data.version !== 1) return;
					phraseBag.load(data.keys);
				} catch (error) { /* ignore */ }
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
				// 活动指示(::before / ::after)会占宽,锁宽必须算进去,否则文字尾巴被截
				const fullWidth = measureText(text, el) + spinnerWidth();
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
					const fields = {
						...base,
						elapsed: formatElapsed(liveState.elapsed, lastLocale),
						phase,
						phaseLabel: labels[phase] ?? phase,
					};
					// E4:第三方注册的占位符最后并入(内置名注册时已被拒,这里不会覆盖内置字段)
					return external.decorate(fields, { el, phase });
				}
				const phase = phaseOf(el);
				const clock = clockEl(el);
				const fields = {
					...base,
					elapsed: formatElapsed(clock ? parseClock(clock.textContent) : 0, lastLocale),
					phase,
					phaseLabel: labels[phase] ?? phase,
				};
				return external.decorate(fields, { el, phase });
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
				if (!(config.liveTickMs > 0) || !isDynamicTemplate(template, external.livePlaceholderNames())) return;
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

			/**
			 * V3:把 appearance 落到状态行上。字体族与字号设在**元素**上(它们要影响整行、
			 * 含时钟的度量);动画 / 发光 / 活动指示的类挂在**文本 span** 上 —— 那是插件自己
			 * 包出来的节点,宿主原文与时钟不受影响。默认值全是"什么都不改",所以没有
			 * appearance 块的旧配置这条路径等于空转。
			 */
			const syncAppearance = (el) => {
				const a = config.appearance || DEFAULT_CONFIG.appearance;
				try {
					if (typeof a.fontFamily === "string" && a.fontFamily.length > 0) el.style.fontFamily = a.fontFamily;
					else el.style.removeProperty("font-family");
					if (typeof a.fontSize === "number" && a.fontSize > 0) el.style.fontSize = a.fontSize + "px";
					else el.style.removeProperty("font-size");
				} catch (error) { /* ignore */ }
				const span = el.querySelector(":scope > ." + TEXT_SPAN_CLASS);
				if (!span) return;
				const animation = APPEARANCE_ANIMATIONS.indexOf(a.animation) >= 0 ? a.animation : "none";
				const spinner = APPEARANCE_SPINNERS.indexOf(a.spinner) >= 0 ? a.spinner : "none";
				span.classList.toggle("dsh-status-rotator-anim-breathe", animation === "breathe");
				span.classList.toggle("dsh-status-rotator-anim-glitch", animation === "glitch");
				span.classList.toggle("dsh-status-rotator-spin-ring", spinner === "ring");
				span.classList.toggle("dsh-status-rotator-spin-bar", spinner === "bar");
				const glow = a.glow === true;
				span.classList.toggle("dsh-status-rotator-glow", glow);
				// 发光色 / 强调色:外观里指定的优先,否则取渐变色板首色,再否则内置默认。
				// 不能用 currentColor —— 渐变文字是 transparent 填充,会跟着透明。
				let accent = typeof a.glowColor === "string" && a.glowColor.length > 0 ? a.glowColor : "";
				if (accent.length === 0) {
					const palette = resolveGradientColors(config.gradient, isDarkTheme());
					if (Array.isArray(palette) && palette.length > 0) accent = palette[0];
				}
				if (accent.length === 0) accent = "#5fd4ff";
				try {
					if (glow) span.style.setProperty("--dsh-sr-glow", accent);
					else span.style.removeProperty("--dsh-sr-glow");
					if (spinner !== "none") span.style.setProperty("--dsh-sr-accent", accent);
					else span.style.removeProperty("--dsh-sr-accent");
				} catch (error) { /* ignore */ }
			};

			/** 当前活动指示占的宽度(打字机锁宽用) */
			const spinnerWidth = () => {
				const a = config.appearance || DEFAULT_CONFIG.appearance;
				return SPINNER_WIDTH[a.spinner] || 0;
			};

			/** 按当前阶段重新选文案并打字(文案与当前相同则跳过) */
			/**
			 * E4:本次可用文案池 = 文档词库(含外部包) + 第三方 provider 现算的条目。
			 * 去重口径与包链一致(同文本只留先来的那个),所以第三方内容与随包内容
			 * 之后走的是**同一条**选句管线(条件 / 稀有度 / 洗牌袋一个都不少)。
			 */
			const poolFor = (phase) => {
				const base = textsForPhase(groups, phase);
				const extra = external.providerEntries(phase, lastLocale);
				if (extra.length === 0) return base;
				if (!base) return extra;
				const seen = new Set(base.map(entryText).filter(Boolean));
				const merged = base.slice();
				for (const entry of extra) {
					const text = entryText(entry);
					if (text.length > 0 && !seen.has(text)) {
						seen.add(text);
						merged.push(entry);
					}
				}
				return merged;
			};

			const refresh = (el) => {
				syncBadge(el);
				// 本次该显示什么:轮换短语 / 宿主原文 / 保持现状(见 labelPlanFor)。
				// 关键修复:短语库为空时不再直接 return —— 0.1.7 上插件把宿主那行藏了,
				// 自己这条线要是也空着,界面上就再没有「Deep diving…」了。
				const phase = phaseOf(el);
				const list = config.labelSource === "host" ? null : poolFor(phase);
				const plan = labelPlanFor(config.labelSource, list !== null, isOwnLine(el));
				if (plan === "keep") {
					// 旧宿主(≤0.1.6)的 TurnStatus 本来就写着宿主原文 —— 不接管、也不给它
					// 套插件渐变(保持既有行为)。只有当前文本已经不是原文了(刚从 phrases
					// 切到 host、或短语库被清空)才把它擦回原文。
					const hostText = resolveDiveLabel(chatT(), lastLocale);
					if (hostText && !matchesDiveText(currentText(el), hostText)) setTextNow(el, hostText);
					return;
				}
				const next = plan === "host" ? resolveDiveLabel(chatT(), lastLocale) : pickFrom(list, phase);
				if (!next) return;
				syncGradient(el);
				syncWeight(el);
				syncAppearance(el);
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
			let liveSessionBinding = null;
			let liveEventsGeneration = 0;
			let liveSessionUnsub = null;
			let liveEventsUnsub = null;
			let liveListUnsub = null;
			let liveModelToken = 0;
			let liveEngineTimer = null;
			let lastChars = 0;
			let lastCharsTime = 0;
			let eventStreamChars = 0;

			// 重渲染合并到微任务:一次 engineTick 会连着 setLive 好几次
			// (phase / elapsed / running / tps / pending),逐次重渲染会让「已接管」
			// 元素每秒画两三遍。合并后每拍最多一次。
			// (v0.15.0 的 Pill 下线、其监听者机制随 v0.17.3 删除后,这里不再需要
			//   监听者集合:唯一的消费者就是 renderLiveNow 自己。)
			let liveRenderQueued = false;
			const whaleMotionNow = () => typeof performance !== "undefined" ? performance.now() : Date.now();
			/** Read the live clock, or advance a detached icon's last recorded clock. */
			const readWhalePlayback = (state) => {
				if (!state || !state.clock) return null;
				const now = whaleMotionNow(), clock = state.clock, animation = state.animation;
				const time = animation && animation.currentTime;
				const duration = animation && animation.effect && animation.effect.getComputedTiming().duration;
				if (typeof time === "number" && Number.isFinite(time) && typeof duration === "number" && duration > 0 && animation.playState !== "idle") {
					return { position: time / duration, duration, at: now, paused: animation.playState === "paused" };
				}
				return { ...clock, position: clock.position + (clock.paused ? 0 : Math.max(0, now - clock.at) / clock.duration), at: now };
			};
			const rememberWhalePlayback = (state) => {
				const clock = readWhalePlayback(state);
				if (clock) state.clock = clock;
			};
			const bindWhalePlayback = (state, position = 0, paused = document.visibilityState === "hidden") => {
				state.path.style.animationPlayState = paused ? "paused" : "running";
				state.animation = state.path.getAnimations().find(animation => animation.animationName === state.path.style.animationName) || null;
				const duration = parseFloat(getComputedStyle(state.path).animationDuration) * 1000 || 1000;
				if (state.animation) state.animation.currentTime = position * duration;
				state.clock = { position, duration, at: whaleMotionNow(), paused };
			};
			const snapshotWhaleMotion = (state) => state && ({
				type: state.type, target: state.target, selection: state.selection, nextSwitchAt: state.nextSwitchAt,
				toolPending: state.toolPending, toolOverride: state.toolOverride, clock: readWhalePlayback(state),
			});
			const stopWhaleTailMotion = (tail) => {
				const state = whaleTailMotionStates.get(tail);
				if (state) {
					state.path.removeEventListener("animationiteration", state.onIteration);
					state.path.removeEventListener("animationend", state.onEnd);
					state.path.removeEventListener("animationstart", state.onStart);
					whaleTailMotionStates.delete(tail);
				}
				tail.classList.remove(TAIL_WAG_CLASS);
				tail.style.removeProperty(TAIL_WAG_DURATION);
				tail.removeAttribute("data-dsh-tail-animation");
				tail.removeAttribute("data-dsh-tail-transition");
				tail.removeAttribute("data-dsh-tail-tool-pending");
				tail.querySelector("." + TAIL_MORPH_CLASS)?.remove();
				releaseWhaleWagStyle();
			};
			const playWhaleTailAnimation = (tail, state, type, playback = null) => {
				state.type = type;
				state.target = null;
				state.nextSwitchAt = Date.now() + 4000 + Math.random() * 4000;
				state.path.style.animationName = ensureWhaleWagStyle(type);
				state.path.style.removeProperty("animation-duration");
				state.path.style.removeProperty("animation-iteration-count");
				state.path.style.removeProperty("animation-fill-mode");
				state.path.setAttribute("d", TAIL_ANIMATION_POSES[type][0]);
				tail.setAttribute("data-dsh-tail-animation", type);
				tail.removeAttribute("data-dsh-tail-transition");
				// A new CSS animation needs only the within-cycle phase. Seeking whole
				// completed cycles could manufacture an animationiteration at a non-junction.
				bindWhalePlayback(state, playback ? playback.position % 1 : 0, playback ? playback.paused : document.visibilityState === "hidden");
			};
			const beginWhaleTailBridge = (tail, state, next, playback = null) => {
				if (playback && playback.position >= 1) {
					const duration = parseFloat(tail.style.getPropertyValue(TAIL_WAG_DURATION)) * 1000;
					playWhaleTailAnimation(tail, state, next, { ...playback, position: (playback.position - 1) * playback.duration / duration });
					return;
				}
				state.target = next;
				tail.setAttribute("data-dsh-tail-transition", state.type + ":" + next);
				state.path.setAttribute("d", TAIL_ANIMATION_POSES[state.type][0]);
				// At least 120ms leaves time to display all six poses at maximum speed.
				state.path.style.animationDuration = playback ? (playback.duration / 1000).toFixed(3) + "s"
					: Math.min(0.48, Math.max(0.12, parseFloat(tail.style.getPropertyValue(TAIL_WAG_DURATION)) * 0.24)).toFixed(3) + "s";
				state.path.style.animationIterationCount = "1";
				state.path.style.animationFillMode = "forwards";
				state.path.style.animationName = ensureWhaleWagStyle(next, state.type);
				bindWhalePlayback(state, playback ? playback.position : 0, playback ? playback.paused : document.visibilityState === "hidden");
			};
			const clearPendingToolSwitch = (resetOverride = false) => {
				pendingToolSwitch = false;
				pendingToolTurn = null;
				for (const [tail, state] of whaleTailMotionStates) {
					state.toolPending = false;
					if (resetOverride) state.toolOverride = false;
					tail.removeAttribute("data-dsh-tail-tool-pending");
				}
				for (const saved of whaleTailPlaybackByRow.values()) {
					saved.toolPending = false;
					if (resetOverride) saved.toolOverride = false;
				}
			};
			const requestToolWhaleTailSwitch = (turn) => {
				// Hidden pages pause motion, but a live tool hit stays queued until return.
				if (!config.whaleTail || !shouldSwitchWhaleTailOnTool(config.whaleTailMotion)) return;
				toolMotionCounts.matches++;
				pendingToolSwitch = true;
				pendingToolTurn = Number.isFinite(turn) ? turn : null;
				for (const [tail, state] of whaleTailMotionStates) {
					if (!tail.isConnected) continue;
					state.toolPending = true;
					tail.setAttribute("data-dsh-tail-tool-pending", "true");
				}
			};
			const syncWhaleTailMotion = (tail, previousState = null) => {
				if (!tail) return;
				try {
					const frequency = config.whaleTail && config.whaleTailMotion && config.whaleTailMotion.enabled === true
						? whaleTailWagFrequency(config.whaleTailMotion, tailMotionTps)
						: 0;
					if (frequency <= 0) {
						stopWhaleTailMotion(tail);
						return;
					}
					const selection = WHALE_TAIL_ANIMATIONS.includes(config.whaleTailMotion.animation) ? config.whaleTailMotion.animation : "wag";
					let state = whaleTailMotionStates.get(tail);
					if (state && !state.path.isConnected) { previousState = snapshotWhaleMotion(state); stopWhaleTailMotion(tail); state = null; }
					if (!tail.querySelector("." + TAIL_MORPH_CLASS)) {
						const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
						svg.setAttribute("class", TAIL_MORPH_CLASS);
						svg.setAttribute("viewBox", "20 40 300 240");
						svg.setAttribute("aria-hidden", "true");
						svg.setAttribute("focusable", "false");
						const path = document.createElementNS(svg.namespaceURI, "path");
						path.setAttribute("d", TAIL_ANIMATION_POSES.wag[0]);
						path.setAttribute("fill", "currentColor");
						path.setAttribute("fill-rule", "evenodd");
						svg.appendChild(path);
						tail.appendChild(svg);
					}
					const nextDuration = (1 / frequency).toFixed(3) + "s";
					if (tail.style.getPropertyValue(TAIL_WAG_DURATION) !== nextDuration) {
						// Phase continuity was inspired by dsh-whale-sway's integrated timeline.
						// Keep our CSS contour renderer, carrying both completed cycles and the
						// within-cycle position into the new duration; bridge timing is independent.
						const motion = state && !state.target ? state.path.getAnimations().find(animation => animation.animationName === `dsh-status-rotator-whale-${state.type}`) : null;
						const oldTime = motion && motion.currentTime;
						const oldDuration = motion && motion.effect.getComputedTiming().duration;
						tail.style.setProperty(TAIL_WAG_DURATION, nextDuration);
						if (typeof oldTime === "number" && Number.isFinite(oldTime) && typeof oldDuration === "number" && oldDuration > 0) {
							// Reading computed style flushes the CSS variable change before seeking.
							const duration = parseFloat(getComputedStyle(state.path).animationDuration) * 1000;
							if (typeof duration === "number" && duration > 0) motion.currentTime = oldTime / oldDuration * duration;
							rememberWhalePlayback(state);
						}
					}
					if (!state) {
						state = { path: tail.querySelector("." + TAIL_MORPH_CLASS + " > path"), selection, type: null, target: null, nextSwitchAt: 0, toolPending: false, toolOverride: false };
						state.onIteration = (event) => {
							if (event.target !== state.path || state.target || event.animationName !== `dsh-status-rotator-whale-${state.type}`) return;
							if (!tail.isConnected) { stopWhaleTailMotion(tail); activeWhaleTails.delete(tail); return; }
							if (document.visibilityState === "hidden") return;
							const toolRequested = state.toolPending;
							if (!toolRequested && state.selection === "random" && Date.now() < state.nextSwitchAt) return;
							if (!toolRequested && state.selection !== "random" && state.toolOverride) return;
							const next = pickWhaleTailAnimation(toolRequested ? "random" : state.selection, state.type);
							if (toolRequested) {
								pendingToolSwitch = false;
								state.toolPending = false;
								state.toolOverride = true;
								tail.removeAttribute("data-dsh-tail-tool-pending");
							}
							if (next === state.type) return;
							// At this iteration boundary the source is exactly its matched junction.
							if (toolRequested) { toolMotionCounts.switches++; publishToolMotionStatus(); }
							beginWhaleTailBridge(tail, state, next);
						};
						state.onEnd = (event) => {
							if (event.target !== state.path || !state.target || event.animationName !== `dsh-status-rotator-whale-bridge-${state.type}-${state.target}`) return;
							if (!tail.isConnected) { stopWhaleTailMotion(tail); activeWhaleTails.delete(tail); return; }
							playWhaleTailAnimation(tail, state, state.target);
						};
						state.path.addEventListener("animationiteration", state.onIteration);
						state.path.addEventListener("animationend", state.onEnd);
						state.onStart = (event) => {
							if (event.target === state.path && event.animationName === state.path.style.animationName) rememberWhalePlayback(state);
						};
						state.path.addEventListener("animationstart", state.onStart);
						whaleTailMotionStates.set(tail, state);
						const carry = previousState && previousState.selection === selection;
						if (carry && config.whaleTailMotion.toolSwitchEnabled === true) {
							state.toolPending = previousState.toolPending;
							state.toolOverride = previousState.toolOverride;
							if (state.toolPending) tail.setAttribute("data-dsh-tail-tool-pending", "true");
						}
						const playback = carry ? readWhalePlayback(previousState) : null;
						if (carry && previousState.target && playback) {
							state.type = previousState.type;
							beginWhaleTailBridge(tail, state, previousState.target, playback);
						} else {
							playWhaleTailAnimation(tail, state, carry ? previousState.type : pickWhaleTailAnimation(selection), playback);
							if (carry) state.nextSwitchAt = previousState.nextSwitchAt;
						}
					} else if (state.selection !== selection) {
						state.selection = selection;
						state.toolPending = false;
						state.toolOverride = false;
						tail.removeAttribute("data-dsh-tail-tool-pending");
						state.nextSwitchAt = Date.now() + 4000 + Math.random() * 4000;
					}
					if (config.whaleTailMotion.toolSwitchEnabled !== true) {
						state.toolPending = false;
						state.toolOverride = false;
						tail.removeAttribute("data-dsh-tail-tool-pending");
					}
					if (pendingToolSwitch && config.whaleTailMotion.toolSwitchEnabled === true) {
						state.toolPending = true;
						tail.setAttribute("data-dsh-tail-tool-pending", "true");
					}
					tail.classList.add(TAIL_WAG_CLASS);
					rememberWhalePlayback(state);
				} catch (error) { /* ignore */ }
			};
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
				for (const tail of activeWhaleTails) {
					if (tail.isConnected) syncWhaleTailMotion(tail);
					else {
						stopWhaleTailMotion(tail);
						activeWhaleTails.delete(tail);
					}
				}
				updateTitle();
			};
			const setLive = (patch) => {
				let changed = false;
				for (const k of Object.keys(patch)) {
					if (k === "tps") tailMotionTps = Number.isFinite(patch[k]) ? Math.max(0, patch[k]) : 0;
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
				const generation = ++liveEventsGeneration;
				if (liveEventsUnsub) { try { liveEventsUnsub(); } catch (error) { /* ignore */ } liveEventsUnsub = null; }
				setLive({ retry: null });
				const source = binding && binding.eventSource;
				if (!source || typeof source.subscribe !== "function" || typeof source.getSnapshot !== "function") {
					publishToolMotionStatus();
					log("observation channel unavailable(宿主没有会话事件窗口)→ 观测徽标保持隐藏");
					return;
				}
				let logged = false;
				const countStreamChars = createStreamCharCounter();
				const countToolCalls = createToolCallTracker(event => {
					toolMotionCounts.calls++;
					requestToolWhaleTailSwitch(event.data.turn);
				});
				const eventSessionId = liveSessionId;
				const refresh = () => {
					if (liveSessionId !== eventSessionId || generation !== liveEventsGeneration) return;
					try {
						const win = source.getSnapshot();
						const entries = win && Array.isArray(win.entries) ? win.entries : [];
						// 「首次会话」条件(when.firstTurn)的依据:这个会话还没出现过 turn/end。
						// 会话一变就重算 —— 换会话不该继承上一个会话已经跑过回合的状态。
						if (sawTurnEndSession !== liveSessionId) {
							sawTurnEndSession = liveSessionId;
							sawTurnEnd = false;
						}
						if (!sawTurnEnd && entries.some(entry => entry && entry.type === "event" && entry.event && entry.event.type === "turn/end")) {
							sawTurnEnd = true;
						}
						const newToolCalls = countToolCalls(win);
						// A queued request belongs to its accepted turn, even across reconnection.
						if ((pendingToolSwitch || pendingToolTurn !== null) && entries.some(entry => entry && entry.type === "event" && entry.event && entry.event.type === "turn/end" && entry.event.data && (pendingToolTurn === null || entry.event.data.turn === pendingToolTurn))) clearPendingToolSwitch();
						if (newToolCalls > 0) publishToolMotionStatus();
						eventStreamChars = countStreamChars(entries);
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
				publishToolMotionStatus();
			};

			/** 绑定当前会话:订阅快照 + 拉取模型名 */
			const connectSession = (id) => {
				const sessions = access("sessions");
				if (!sessions) return;
				let binding = null;
				try { binding = typeof sessions.binding === "function" ? sessions.binding(id) || null : null; } catch (error) { /* retry on rescan */ }
				const face = binding && binding.session, source = binding && binding.eventSource;
				const needsFace = face && typeof face.subscribe === "function" && typeof face.getSnapshot === "function";
				const needsEvents = source && typeof source.subscribe === "function" && typeof source.getSnapshot === "function";
				if (id === liveSessionId && binding === liveSessionBinding && (!needsFace || liveSessionUnsub) && (!needsEvents || liveEventsUnsub)) return;
				if (id !== liveSessionId) {
					Object.assign(toolMotionCounts, { calls: 0, matches: 0, switches: 0 });
					clearPendingToolSwitch(true);
					whaleTailPlaybackByRow.clear();
				}
				liveSessionId = id;
				liveSessionBinding = binding;
				eventStreamChars = 0;
				lastChars = 0;
				lastCharsTime = 0;
				setLive({ tps: 0, streamChars: 0 });
				if (liveSessionUnsub) { liveSessionUnsub(); liveSessionUnsub = null; }
				if (liveEventsUnsub) { try { liveEventsUnsub(); } catch (error) { /* ignore */ } liveEventsUnsub = null; }
				setLive({ model: "", provider: "", retry: null });
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
				// 0.2.0 navigation belongs to the view owner, not sessions.list.current.
				// Its main conversation marker also works with the right sidebar closed.
				try {
					for (const row of document.querySelectorAll(RUNNING_ROW_SELECTOR)) {
						const owner = row.closest("[data-conversation-session]");
						const id = owner && owner.getAttribute("data-conversation-session");
						if (id && owner.getClientRects().length > 0) return id;
					}
					for (const owner of document.querySelectorAll("[data-conversation-session]")) {
						const id = owner.getAttribute("data-conversation-session");
						if (id && owner.getClientRects().length > 0) return id;
					}
				} catch (error) { /* older hosts use the fallbacks below */ }
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
				}
				syncCurrentSession();
				// {pending} 这类事件驱动的占位符:订阅待作答交互表,值一变就重渲染
				// (文案/标题里的动态占位符由 setLive 自己调度重渲染,见 renderLiveNow)。
				wirePendingInteractions();
			};

			/** 引擎心跳:TPS 平滑 + 阶段/时长(会话快照优先,DOM 兜底) + 驱动实时重渲染 */
			let turnStartTs = null;
			const engineTick = () => {
				const now = Date.now();
				// 0.2.0 streams live deltas through eventSource, older hosts use partial.blocks.
				const streamChars = eventStreamChars > 0 ? eventStreamChars : liveState.streamChars;
				if (lastCharsTime > 0 && now > lastCharsTime) {
					const dt = (now - lastCharsTime) / 1000;
					const delta = streamChars - lastChars;
					// 粗略 tok 估算:4 字符 ≈ 1 token
					const tps = dt >= 0.2 && delta > 0 ? Math.round((delta / 4) / dt) : 0;
					if (tps !== liveState.tps) setLive({ tps });
				}
				lastChars = streamChars;
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
			/** 0.2.0 宿主:运行行 → 它的文案元素(时长来源)/ 插件那条线 / 鲸鱼尾巴 */
			const runningLabels = new Map();
			const runningLines = new Map();
			const runningTails = new Map();

			/**
			 * 仅供浏览器回归页读取:每回合临时容器的规模(scripts/turn-process-017-test.html
			 * 的 `?case=leak` 用它断言回合结束后不留残渣)。只在 debug 打开时挂上,运行时不读写 ——
			 * issue #87(turnLabels 只增不减)就是这类容器漏了清理路径造成的。
			 */
			if (config.debug) {
				exports.__debugTurnContainers = () => ({
					turnLabels: turnLabels.size,
					turnLines: turnLines.size,
					lineButtons: lineButtons.size,
					turnPhases: turnPhases.size,
					runningLabels: runningLabels.size,
					runningLines: runningLines.size,
					runningTails: runningTails.size,
					whaleTailMotions: whaleTailMotionStates.size,
					whaleTailPlayback: whaleTailPlaybackByRow.size,
					typists: typists.size,
					adopted: adopted.size,
				});
			}

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

			// ══ dsh 0.2.0:运行中那一行(会话流里,含鲸鱼尾巴)══

			/** 取运行行里 React 那个 shimmer 文案元素(插件读它拿时长;视觉上由插件接管) */
			const runningLabelOf = (row) => {
				const tracked = runningLabels.get(row);
				if (tracked && tracked.isConnected) return tracked;
				let el = null;
				try { el = row.querySelector(RUNNING_TEXT_SELECTOR); } catch (error) { el = null; }
				if (!el) return null;
				runningLabels.set(row, el);
				return el;
			};

			/** 运行行里的鲸鱼尾巴图标(0.2.0 才有;缺了也不影响接管) */
			const tailOf = (row) => {
				try { return row.querySelector(RUNNING_ICON_SELECTOR); } catch (error) { return null; }
			};

			/**
			 * 建插件那条线并**挂进宿主那一行**(鲸鱼尾巴之后)——
			 * 与 0.1.7 的 buildStatusLine 同构,只是不插进输入框座位、也不需要 align:
			 * 0.2.0 的这一行本来就在输入框上方,位置天然正确,插进去还能保住行里那个
			 * 读屏公告 span(它和文案同父母,藏整行会把它一起弄没)。
			 */
			const buildRunningLine = (container) => {
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
				container.appendChild(line);
				return line;
			};

			/** 按 config.whaleTail 决定尾巴的去留:保留 → 打类上炫彩;不保留 → 藏起来 */
			const applyTailPreference = (row, tail, previousState = null) => {
				if (!tail) return;
				activeWhaleTails.add(tail);
				try {
					if (config.whaleTail) {
						tail.classList.add(TAIL_CLASS);
						tail.style.removeProperty("display");
					} else {
						tail.classList.remove(TAIL_CLASS);
						tail.style.display = "none";
					}
				} catch (error) { /* ignore */ }
				syncWhaleTailMotion(tail, previousState);
			};
			/** The host can rebuild just its icon while keeping the running row alive. */
			const syncRunningTail = (row) => {
				const current = tailOf(row), previous = runningTails.get(row);
				let previousState = null;
				if (previous !== current) {
					previousState = snapshotWhaleMotion(whaleTailMotionStates.get(previous)) || whaleTailPlaybackByRow.get(row) || null;
					if (previousState) whaleTailPlaybackByRow.set(row, previousState);
				}
				if (previous && previous !== current) {
					activeWhaleTails.delete(previous);
					stopWhaleTailMotion(previous);
					previous.classList.remove(TAIL_CLASS);
					previous.style.removeProperty("display");
				}
				if (current) runningTails.set(row, current);
				else runningTails.delete(row);
				applyTailPreference(row, current, previousState);
				if (current && whaleTailMotionStates.has(current)) whaleTailPlaybackByRow.delete(row);
			};

			/** 接管 0.2.0 的运行行:藏掉宿主自己的 shimmer 文案,把插件那条线挂进去 */
			const adoptRunningRow = (row, labelEl) => {
				runningLabels.set(row, labelEl);
				const existing = runningLines.get(row);
				if (existing && existing.isConnected) {
					syncRunningRow(row);
					return;
				}
				let content = null;
				try { content = labelEl.parentElement && labelEl.parentElement.isConnected ? labelEl.parentElement : row; } catch (error) { content = row; }
				const line = buildRunningLine(content);
				runningLines.set(row, line);
				adopted.add(line);
				turnPhases.set(line, undefined);
				const tail = tailOf(row);
				if (tail) runningTails.set(row, tail);
				applyTailPreference(row, tail);
				// 宿主自己的文案藏起来(它的文本仍是我们读时长的来源,只是不显示)
				try { labelEl.style.display = "none"; } catch (error) { /* ignore */ }
				log("adopted 0.2.0 running row, 宿主文本:", JSON.stringify((labelEl.textContent || "").slice(0, 40)));
				syncRunningRow(row);
				if (adopted.has(line)) {
					refresh(line);
					updateTitle();
				}
			};

			/** 同步运行行(读宿主文案里的时长);行没了 / 文案不再匹配 → 释放 */
			const syncRunningRow = (row) => {
				const line = runningLines.get(row);
				if (!line) return;
				if (!row.isConnected || !line.isConnected) { releaseRunningRow(row); return; }
				const labelEl = runningLabels.get(row);
				if (!labelEl || !labelEl.isConnected) { releaseRunningRow(row); return; }
				const label = resolveDiveLabel(chatT(), lastLocale);
				const prefix = resolveDiveDurationPrefix(chatT(), lastLocale);
				const duration = matchDiveLabel(labelEl.textContent || "", label, prefix);
				if (duration === null) { releaseRunningRow(row); return; }
				syncRunningTail(row);
				syncLineDuration(line, duration);
			};

			/** 释放运行行:撤掉插件那条线,把宿主文案与尾巴还原 */
			const releaseRunningRow = (row) => {
				whaleTailPlaybackByRow.delete(row);
				const line = runningLines.get(row);
				if (line) {
					try { if (line.isConnected) line.remove(); } catch (error) { /* ignore */ }
					clearLive(line);
					typists.delete(line);
					liveTemplates.delete(line);
					turnPhases.delete(line);
					adopted.delete(line);
				}
				const labelEl = runningLabels.get(row);
				try { if (labelEl) labelEl.style.removeProperty("display"); } catch (error) { /* ignore */ }
				const tail = runningTails.get(row);
				try {
					if (tail) {
						activeWhaleTails.delete(tail);
						stopWhaleTailMotion(tail);
						tail.classList.remove(TAIL_CLASS);
						tail.style.removeProperty("display");
					}
				} catch (error) { /* ignore */ }
				runningLines.delete(row);
				runningLabels.delete(row);
				runningTails.delete(row);
			};

			/** 扫描 0.2.0 的运行行(root 自身可能是它,也可能是祖先);行消失即释放 */
			const scanRunningRows = (root) => {
				if (!(root instanceof Element)) return;
				const rows = [];
				try {
					if (typeof root.matches === "function" && root.matches(RUNNING_ROW_SELECTOR)) rows.push(root);
					for (const row of root.querySelectorAll(RUNNING_ROW_SELECTOR)) rows.push(row);
				} catch (error) { return; }
				const label = resolveDiveLabel(chatT(), lastLocale);
				const prefix = resolveDiveDurationPrefix(chatT(), lastLocale);
				for (const row of rows) {
					const labelEl = runningLabelOf(row);
					if (!labelEl) continue;
					if (matchDiveLabel(labelEl.textContent || "", label, prefix) === null) continue;
					adoptRunningRow(row, labelEl);
				}
				for (const row of Array.from(runningLines.keys())) {
					if (!row.isConnected) releaseRunningRow(row);
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
				liveTemplates.delete(line);
				turnPhases.delete(line);
				lineButtons.delete(line);
				if (button) turnLines.delete(button);
				// 与上一行对称:turnLabels 曾经漏了这一句 —— 每个回合留下一个已脱离 DOM 的
				// 标签元素(issue #87 的慢性泄漏),回合数越多占得越多。
				if (button) turnLabels.delete(button);
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
				syncLineDuration(line, duration);
			};

			/**
			 * 把宿主文案里的时长同步到插件那条线(时钟 + 阶段判定)。
			 * 0.1.7 的折叠头与 0.2.0 的运行行共用这段 —— 两者都从宿主文本里读时长。
			 */
			const syncLineDuration = (line, duration) => {
				const clock = clockEl(line);
				if (clock) {
					if (clock.textContent !== duration) clock.textContent = duration;
					// 「只用宿主原文」= 纯 0.1.6 观感,连时钟的出现时机也照旧版:
					// 0.1.6 的 TurnStatus 是 elapsedMs >= 15s 才渲染时钟子元素
					// (showClock = elapsedMs >= 15e3),这里照做。默认(轮换短语)模式下
					// 时钟一直显示 —— 新宿主自己从第一秒就把时长写进标签里。
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
				scanRunningRows(root);
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
				scanRunningRows(document.body);
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
				// A replaced icon can be deep inside an already-adopted row. Scanning
				// just the added icon misses its ancestor; recover immediately on its row.
				for (const record of records) {
					const target = record.target instanceof Element ? record.target : record.target.parentElement;
					const row = target && target.closest(RUNNING_ROW_SELECTOR);
					if (row && runningLines.has(row)) syncRunningRow(row);
				}
				for (const record of records) {
					// 深浅色主题切换(body[data-ds-dark-theme] 增删)→ 重算渐变 CSS 并刷新已接管元素
					if (record.type === "attributes" && record.attributeName === "data-conversation-session") {
						syncCurrentSession();
						continue;
					}
					if (record.type === "attributes" && record.attributeName === "data-ds-dark-theme") {
						updateStyle();
						for (const el of adopted) if (el.isConnected) { syncGradient(el); syncAppearance(el); }
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
					// N2:带上上次拿到的 ETag,内容没变时服务端回 304 —— 轮询兜底路径的主要开销就在这里
					const res = await fetch(url, { cache: "no-store", headers: configEtag.length > 0 ? { "if-none-match": configEtag } : undefined });
					if (res.status === 304) {
						log("external JSON unchanged (304)");
						warnIfLocalOverrides();
						return;
					}
					if (!res.ok) throw new Error("HTTP " + res.status);
					const responseEtag = res.headers && typeof res.headers.get === "function" ? (res.headers.get("etag") || "") : "";
					if (responseEtag.length > 0) configEtag = responseEtag;
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
			/** N2:当前已生效配置的 ETag(与 If-None-Match / If-Match 同一套) */
			let configEtag = "";

			/**
			 * N1 推送通道。连上就把轮询停掉(页面开着时近乎零开销);断开期间恢复轮询兜底。
			 * 断线由 EventSource 自己重连,而服务端在每次连上时都会先推一条 hello(带当前 ETag),
			 * 所以断线期间错过的变更会在重连那一刻补上 —— 那一端不会停在一个没人再推的旧值上。
			 */
			let eventSource = null;
			let sseConnected = false;
			/** 轮询兜底定时器:只在「间隔 > 0」且「推送没连上」时跑 */
			const syncReloadTimer = () => {
				const want = config.reloadIntervalMs > 0 && !sseConnected;
				const current = reloadTimer === null ? null : activeReloadMs;
				if (want && current === config.reloadIntervalMs) return;
				if (reloadTimer !== null) { clearInterval(reloadTimer); reloadTimer = null; }
				activeReloadMs = config.reloadIntervalMs;
				if (want) reloadTimer = setInterval(loadExternal, config.reloadIntervalMs);
			};
			/** 推送说配置变了:立刻拉一次(带 If-None-Match,没变就是一次 304) */
			const onPushPayload = (payload) => {
				if (!payload || typeof payload !== "object") return;
				if (typeof payload.etag === "string" && payload.etag.length > 0 && payload.etag === configEtag) return;
				log("config push:", payload.type || "?", payload.reason || "");
				loadExternal();
			};
			const openEventStream = () => {
				if (eventSource !== null) return;
				if (typeof EventSource !== "function") { log("no EventSource in this host → polling fallback stays"); return; }
				try {
					eventSource = new EventSource(EVENTS_URL);
				} catch (error) {
					eventSource = null;
					return;
				}
				eventSource.addEventListener("open", () => {
					sseConnected = true;
					syncReloadTimer();
					log("config push channel connected; polling suspended");
				});
				eventSource.addEventListener("error", () => {
					// EventSource 会自己重连;这里只把轮询兜底放回去,别让页面停在一个不动的值上
					if (sseConnected) log("config push channel dropped → polling fallback resumed");
					sseConnected = false;
					syncReloadTimer();
				});
				eventSource.addEventListener("message", (event) => {
					let payload = null;
					try { payload = JSON.parse(event.data); } catch (error) { return; }
					onPushPayload(payload);
				});
			};
			const closeEventStream = () => {
				if (eventSource === null) return;
				try { eventSource.close(); } catch (error) { /* ignore */ }
				eventSource = null;
				sseConnected = false;
			};
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
				// 反重复记忆跟随配置:recentLimit 变了就地生效,persist 打开时把存档读进来
				const anti = config.antiRepeat || DEFAULT_CONFIG.antiRepeat;
				phraseBag.configure({ recentLimit: anti.recentLimit });
				if (anti.persist && !pickMemoryLoaded) {
					pickMemoryLoaded = true;
					loadPickMemory();
				}
				if (!config.whaleTail || !config.whaleTailMotion.enabled || !config.whaleTailMotion.toolSwitchEnabled) clearPendingToolSwitch(true);
				if (!config.whaleTail || !config.whaleTailMotion.enabled) whaleTailPlaybackByRow.clear();
				if (config.intervalMs !== activeIntervalMs) {
					activeIntervalMs = config.intervalMs;
					if (timer !== null) clearInterval(timer);
					timer = setInterval(rotate, config.intervalMs);
				}
				// N1:间隔变化与推送通道的连接状态都由 syncReloadTimer 一处决定
				syncReloadTimer();
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
				// TPS motion needs its sampler even when text live refresh is disabled.
				const tailNeedsTps = config.whaleTail && config.whaleTailMotion && config.whaleTailMotion.enabled && config.whaleTailMotion.mode !== "fixed";
				const engineMs = tailNeedsTps ? 1000 : config.liveTickMs > 0 ? Math.max(500, config.liveTickMs) : 0;
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
			/** V4:显式打开 hoverPause / clickCopy 时给层加的类(条目这才接指针) */
			const DANMAKU_POINTER_CLASS = "dsh-status-rotator-danmaku-pointer";
			/** V4:点击复制成功后的短暂反馈类 */
			const DANMAKU_COPIED_CLASS = "dsh-status-rotator-danmaku-copied";
			/** V4:指针在层内的 y(避让用);不在层上时为 null */
			let danmakuPointerY = null;
			/** V4:「自己发一条」在层被遮罩暂停期间先排队,层回来再发 */
			const danmakuQueue = [];
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
				danmakuStyleEl = createOwnedStyle("dsh-status-rotator-danmaku-style");
				danmakuStyleEl.textContent =
					"." + DANMAKU_LAYER_CLASS + "{" +
						"inset:0;overflow:hidden;pointer-events:none;" +
					"}" +
					"." + DANMAKU_ITEM_CLASS + "{" +
						"position:absolute;left:-200vw;top:0;white-space:nowrap;pointer-events:none;" +
						"will-change:transform;line-height:1.35;font-weight:600;user-select:none;" +
						"text-shadow:0 0 4px rgba(0,0,0,.40),0 1px 3px rgba(0,0,0,.45);" +
					"}" +
					// V4:只有显式打开 hoverPause / clickCopy 时才让弹幕接指针 ——
					// 默认的 pointer-events:none(层与条目两级)是 README 里「永不拦截指针」的兑现。
					"." + DANMAKU_POINTER_CLASS + " ." + DANMAKU_ITEM_CLASS + "{pointer-events:auto}" +
					"." + DANMAKU_POINTER_CLASS + " ." + DANMAKU_ITEM_CLASS + "{cursor:pointer}" +
					"." + DANMAKU_COPIED_CLASS + "{outline:1px solid currentColor;outline-offset:2px;opacity:1!important}" +
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
				// V4:指针交互(按配置决定加不加类)与排队的手动弹幕补发
				syncDanmakuPointerClass(layer);
				wireDanmakuPointer(layer);
				flushDanmakuQueue();
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
				syncDanmakuPointerClass(layer);
				wireDanmakuPointer(layer);
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
			
			/** V4 密度自适应:越接近同屏上限发得越稀;页面不可见时几乎不发(只减少,不越过上限) */
			const densityAllows = (d) => {
				if (typeof document !== "undefined" && document.visibilityState === "hidden") return Math.random() < 0.15;
				const cap = Math.max(1, Number(d.maxCount) || 12);
				return Math.random() < Math.max(0.15, 1 - danmakuInFlight.length / cap);
			};

			/** V4 落点:可用带里随机;开了避让时躲开指针所在的高度带 */
			const pickDanmakuTop = (start, usable, size, d) => {
				const pick = () => start + Math.round(Math.random() * usable);
				let top = pick();
				if (d.avoidPointer !== true || danmakuPointerY === null) return top;
				for (let attempt = 0; attempt < 4; attempt++) {
					if (Math.abs(top + size * 0.8 - danmakuPointerY) > 48) break;
					top = pick();
				}
				return top;
			};

			/** V4:层要不要接指针。默认不接 —— README 承诺「永不拦截指针」,要改必须显式开开关 */
			const danmakuPointerWanted = () => {
				const d = dcfg();
				return d.enabled !== false && (d.hoverPause === true || d.clickCopy === true);
			};
			const syncDanmakuPointerClass = (layer) => {
				if (!layer || !layer.classList) return;
				try { layer.classList.toggle(DANMAKU_POINTER_CLASS, danmakuPointerWanted()); } catch (error) { /* ignore */ }
			};

			/** 元素 → 在途条目 */
			const danmakuItemOf = (el) => {
				for (const item of danmakuInFlight) if (item.el === el) return item;
				return null;
			};

			/** V4 悬停冻结:按住这一颗,记下还剩多少飞行时间(清理超时也一并挂起) */
			const freezeDanmakuItem = (item) => {
				if (!item || item.done || item.paused || item.mode !== "scroll") return;
				const el = item.el;
				try {
					const x = matrixTranslateX(getComputedStyle(el).transform);
					if (x === null || !Number.isFinite(item.total) || item.total <= 0) return;
					const progress = Math.min(0.98, Math.max(0, x / -item.total));
					item.remainingMs = Math.max(300, Math.round(item.duration * (1 - progress)));
					el.style.transition = "none";
					el.style.transform = "translateX(" + x + "px)";
					if (item.timer !== null) { clearTimeout(item.timer); item.timer = null; }
					item.paused = true;
				} catch (error) { /* ignore */ }
			};
			/** V4 移开恢复:从冻住的位置继续飞到终点,时长按剩余距离折算 */
			const resumeDanmakuItem = (item) => {
				if (!item || item.done || !item.paused) return;
				const el = item.el;
				try {
					el.style.transition = "transform " + item.remainingMs + "ms linear";
					el.style.transform = "translateX(" + (-item.total) + "px)";
					if (item.timer !== null) clearTimeout(item.timer);
					item.timer = setTimeout(item.cleanup, item.remainingMs + 2000);
					item.paused = false;
				} catch (error) { /* ignore */ }
			};

			/** 点击复制的短暂反馈 */
			const flashDanmakuCopied = (el) => {
				try {
					el.classList.add(DANMAKU_COPIED_CLASS);
					setTimeout(() => { try { el.classList.remove(DANMAKU_COPIED_CLASS); } catch (error) { /* ignore */ } }, 600);
				} catch (error) { /* ignore */ }
			};
			/**
			 * 复制一条弹幕的文案。剪贴板 API 不可用(老宿主 / 非安全上下文)时**不做假反馈** ——
			 * 标一个「已复制」却没复制,比什么都不做更糟;这里只记一条日志。
			 */
			const copyDanmakuText = (el) => {
				const text = String(el.textContent || "");
				try {
					if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
						navigator.clipboard.writeText(text).then(() => flashDanmakuCopied(el), () => { log("clipboard rejected"); });
						return;
					}
				} catch (error) { /* ignore */ }
				log("clipboard unavailable; click-to-copy skipped");
			};

			/** V4:给弹幕层挂一次指针交互(悬停冻结 / 点击复制),是否生效由当前配置决定 */
			const wireDanmakuPointer = (layer) => {
				if (!layer || !layer.addEventListener || layer.dataset.statusRotatorPointer === "1") return;
				layer.dataset.statusRotatorPointer = "1";
				const itemOf = (event) => (event.target && event.target.classList && event.target.classList.contains(DANMAKU_ITEM_CLASS) ? event.target : null);
				layer.addEventListener("pointerover", (event) => {
					const el = itemOf(event);
					if (el && dcfg().hoverPause === true) freezeDanmakuItem(danmakuItemOf(el));
				});
				layer.addEventListener("pointerout", (event) => {
					const el = itemOf(event);
					if (el && dcfg().hoverPause === true) resumeDanmakuItem(danmakuItemOf(el));
				});
				layer.addEventListener("click", (event) => {
					const el = itemOf(event);
					if (el && dcfg().clickCopy === true) copyDanmakuText(el);
				});
			};

			/**
			 * V4「自己发一条」:立刻把一句话作为滚动弹幕发出去。
			 * 层被宿主全屏遮罩挡住(设置弹窗开着)时先排队 —— 否则用户点了却什么都看不到。
			 * @returns {boolean} 是否当场发出(排队返回 false)
			 */
			const sendDanmaku = (text) => {
				const body = String(text === null || text === undefined ? "" : text).trim();
				if (body.length === 0) return false;
				const d = dcfg();
				if (d.enabled === false) return false;
				const rendered = interpolate(body, ctxFor(null));
				if (!rendered) return false;
				if (danmakuLayer === null || danmakuMasked) {
					danmakuQueue.push(rendered);
					if (danmakuQueue.length > 20) danmakuQueue.shift();
					return false;
				}
				return emitScroll(rendered, d);
			};
			/** V4:记录指针在弹幕层内的高度(鼠标避让用);不在层上就是 null */
			const onDanmakuPointerMove = (event) => {
				if (dcfg().avoidPointer !== true || danmakuLayer === null || !danmakuLayer.isConnected) { danmakuPointerY = null; return; }
				try {
					const rect = danmakuLayer.getBoundingClientRect();
					const y = event.clientY - rect.top;
					danmakuPointerY = y >= 0 && y <= rect.height ? y : null;
				} catch (error) { danmakuPointerY = null; }
			};

			/** 层回来后把排队的手动弹幕补发 */
			const flushDanmakuQueue = () => {
				if (danmakuQueue.length === 0 || danmakuLayer === null || danmakuMasked) return;
				const pending = danmakuQueue.splice(0, danmakuQueue.length);
				for (const rendered of pending) emitScroll(rendered, dcfg());
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
				// 密度自适应(V4):越接近上限发得越稀,页面不可见时几乎不发(只减少,不越过上面的上限)
				if (d.adaptDensity === true && !densityAllows(d)) return;
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
				emitScroll(rendered, d);
			};

			/**
			 * 把一句**已渲染好**的文案作为滚动弹幕发出去。
			 * 选词与发射分开之后,V4 的「自己发一条」与轮换抽到的句子走的是同一条渲染路径。
			 * @returns {boolean} 是否真的发出去了(层不可用 / 渲染为空返回 false)
			 */
			const emitScroll = (rendered, d) => {
				if (!rendered || danmakuLayer === null) return false;
				const span = danmakuFontSpan(d.fontSizeMin, d.fontSizeMax);
				const size = randInt(span.min, span.max);
				const palette = Array.isArray(d.colors) && d.colors.length > 0 ? d.colors : DEFAULT_CONFIG.danmaku.colors;
				// 按相位分色(V4):配了就用相位色,否则走原来的炫彩 / 单色
				const phaseColor = d.phaseColors && typeof d.phaseColors === "object" ? d.phaseColors[danmakuPhase()] : null;
				const color = typeof phaseColor === "string" && phaseColor.length > 0
					? phaseColor
					: (d.rainbow !== false
						? palette[randInt(0, palette.length - 1)]
						: (typeof d.color === "string" && d.color.length > 0 ? d.color : "#ffffff"));
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
				el.style.top = pickDanmakuTop(band.start, usable, size, d) + "px";
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
				const item = { el, timer: null, done: false, mode: "scroll", height: el.offsetHeight, total, duration, cleanup: null, paused: false, remainingMs: 0 };
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
				item.cleanup = cleanup;   // 悬停冻结会清掉超时,恢复时要重新挂上同一个清理
				el.addEventListener("transitionend", cleanup, { once: true });
				item.timer = setTimeout(cleanup, duration + 2000);
				danmakuInFlight.push(item);
				el.style.transition = "transform " + duration + "ms linear";
				el.style.transform = "translateX(" + (-total) + "px)";
				log("danmaku:", JSON.stringify(rendered.slice(0, 30)), "size", size, "color", color);
				return true;
			};

			const start = () => {
				document.documentElement.dataset.statusRotator = "active";
				origTitle = document.title;
				observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-ds-dark-theme", "data-conversation-session"] });
				updateStyle();
				scan(document.body);
				rescanAll();
				// loadExternal 可能已在 visibilitychange/pageshow 里提前跑过并建好
				// 轮换定时器;applyConfig 只在数值变化时重建,不会双倍速度轮换。
				applyConfig();
				wireLiveEngine();
				// V4 鼠标避让:只在开了避让且指针落在层内时才记 y(其余时候为 null,不参与判定)
				document.addEventListener("pointermove", onDanmakuPointerMove, { passive: true });
				rescanner = setInterval(rescanAll, 2000);
				loadExternal();
				// N1:配置 HTTP 路由就位后连推送通道(连不上就一直是轮询兜底)
				openEventStream();
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
				// 记忆按「语言|相位」分键，换语言自然是另一袋，不必清空
				log("locale →", active);
				refreshAll();
			});

			// 页面重新可见(切回标签页 / 从 bfcache 恢复)时重读 config.json,
			// 这样改完配置文件不用重启 dsh,切回来就生效。
			const onVisibility = () => {
				for (const state of whaleTailMotionStates.values()) {
					rememberWhalePlayback(state);
					state.path.style.animationPlayState = document.visibilityState === "hidden" ? "paused" : "running";
					state.clock.paused = document.visibilityState === "hidden";
					state.clock.at = whaleMotionNow();
					if (document.visibilityState === "visible") state.nextSwitchAt = Date.now() + 4000 + Math.random() * 4000;
				}
				for (const saved of whaleTailPlaybackByRow.values()) {
					saved.clock = readWhalePlayback(saved);
					if (saved.clock) { saved.clock.paused = document.visibilityState === "hidden"; saved.clock.at = whaleMotionNow(); }
				}
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
			// 组件本体在模块级的 createSettingsPage 工厂里(见文件末尾「设置页(词库编辑器)工厂」),
			// 依赖显式传入 —— 它不再从 apply 闭包隐式捕获任何东西。这里只把运行时的几个句柄接上,
			// 并照旧把页面注册到 settings.section 槽位(见下方 ctx.slots.inject)。
			const settingsPage = createSettingsPage({
				locale,
				effect: (cb, label) => ctx.effect(cb, label),
				toolMotionStatus,
				toolMotionListeners,
				getRuntimePreset: () => runtimePreset,
				getLastLocale: () => lastLocale,
				isDarkTheme,
				// V4「自己发一条」:设置页直接调 apply 里的发送函数(遮罩期间它在内部排队)
				sendDanmaku: (text) => sendDanmaku(text),
				onSaved: (parsed) => {
					remoteDoc = parsed;
					recomputeEffective();
					applyConfig();
				}
			});
			const { SETTINGS_NS, SettingsPanel, st } = settingsPage;

			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "status-rotator",
				order: 50,
				label: () => st("nav.label"),
				locale: SETTINGS_NS
			}, SettingsPanel));

			// ── E4:把注册接口挂到宿主上下文上,供第三方插件接入 ──
			// 走 cordis 的 ctx.provide(与内置 locale 服务同一个机制):消费方 inject: ["statusRotator"]
			// 或 ctx.get("statusRotator") 即可拿到。provide 返回的注销函数在 fiber 卸载时自动生效,
			// 这里再留一份是为了宿主只支持老式 provide 时的兜底。
			if (typeof ctx.provide === "function") {
				try {
					externalApiDisposer = ctx.provide("statusRotator", externalApi);
					log("statusRotator 注册接口已提供(registerPlaceholder / registerPhraseProvider / registerPack)");
				} catch (error) {
					// 名字被别的插件占了 / 宿主实现不同:明确记一笔,不假装成功
					log("statusRotator 注册接口未能提供:", error && error.message ? error.message : error);
				}
			} else {
				log("宿主没有 ctx.provide → 第三方注册接口不可用(插件其余功能不受影响)");
			}
			// 本插件自己的 apply 到此结束,之后第三方的注册才会发生;把期间攒下的变化补刷一次
			externalReady = true;
			if (externalDirty) {
				externalDirty = false;
				recomputeEffective();
				refreshAll();
			}

			// dsh 的 ctx.effect 会「立即执行」回调,并把回调的「返回值」当作卸载时的
			// 清理函数注册。因此清理逻辑必须包在返回的函数里,否则 apply 一结束
			// 观察器和定时器就被立刻拆掉,文本替换永远不会生效。
			ctx.effect(() => {
				return () => {
					unsubscribe();
					document.removeEventListener("visibilitychange", onVisibility);
					window.removeEventListener("pageshow", onPageShow);
					document.removeEventListener("pointermove", onDanmakuPointerMove);
					observer.disconnect();
					sourceObserver.disconnect();
					if (timer !== null) clearInterval(timer);
					if (rescanner !== null) clearInterval(rescanner);
					if (reloadTimer !== null) clearInterval(reloadTimer);
					closeEventStream();
					if (titleTimer !== null) clearInterval(titleTimer);
					if (titleLiveTimer !== null) clearInterval(titleLiveTimer);
					if (scheduleTimer !== null) clearInterval(scheduleTimer);
					if (liveEngineTimer !== null) clearInterval(liveEngineTimer);
					if (liveSessionUnsub) { try { liveSessionUnsub(); } catch (error) { /* ignore */ } }
					if (liveEventsUnsub) { try { liveEventsUnsub(); } catch (error) { /* ignore */ } }
					liveEventsGeneration++;
					clearPendingToolSwitch(true);
					whaleTailPlaybackByRow.clear();
					toolMotionListeners.clear();
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
					for (const tail of Array.from(whaleTailMotionStates.keys())) stopWhaleTailMotion(tail);
					if (styleEl !== null && styleEl.isConnected) styleEl.remove();
					settingsPage.dispose();
					if (danmakuStyleEl !== null && danmakuStyleEl.isConnected) danmakuStyleEl.remove();
					if (whaleWagStyleEl !== null && whaleWagStyleEl.isConnected) whaleWagStyleEl.remove();
					whaleWagStyleEl = null;
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
					if (appearanceStyleEl.isConnected) appearanceStyleEl.remove();
					// E4:收回注册接口并清空第三方注册 —— 不让别人的内容活过本插件
					if (typeof externalApiDisposer === "function") {
						try { externalApiDisposer(); } catch (error) { /* ignore */ }
						externalApiDisposer = null;
					}
					external.reset();
					adopted.clear();
					typists.clear();
					phraseBag.reset();
					liveTimers.clear();
					liveTemplates.clear();
					// 0.2.0 的运行行:先把插件那条线撤掉、把宿主文案与尾巴还原,再清容器
					for (const row of Array.from(runningLines.keys())) releaseRunningRow(row);
					// 按「按钮」索引的两个容器:上面那圈 releaseStatusLine 只会清掉还挂着状态行的
					// 那些按钮,卸载时再兜一次底,避免任何残留(issue #87 的卸载路径)。
					turnLabels.clear();
					turnLines.clear();
					lineButtons.clear();
					turnPhases.clear();
					runningLabels.clear();
					runningLines.clear();
					runningTails.clear();
				};
			}, "status-rotator: label rotation");
		}

		/**
		 * 设置页(词库编辑器)工厂 —— 可独立实例化、独立断言。
		 *
		 * 这一段原先长在 apply(ctx) 的闭包里(约 1900 行),隐式捕获了十来个运行时变量。
		 * 现在它落在模块级,依赖由 deps 显式传入,函数体不再引用 apply 作用域的任何绑定;
		 * 宿主里注册的槽位(settings.section)、四个 Tab、字段与读写落盘行为全部保持不变,
		 * 变的只是依赖从隐式变显式。独立回归网:scripts/verify-settings-page.cjs。
		 *
		 * @param {object} deps
		 * @param {object} deps.locale ctx.locale(注册字典 + bind 出 st)
		 * @param {Function} deps.effect ctx.effect(注册字典的清理函数)
		 * @param {Function} deps.toolMotionStatus 鲸鱼尾巴工具诊断快照的 getter
		 * @param {Set} deps.toolMotionListeners 诊断订阅者集合(组件挂载时加入)
		 * @param {Function} deps.getRuntimePreset 当前运行时生效预设 id 的 getter
		 * @param {Function} deps.getLastLocale 最近一次界面语言的 getter
		 * @param {Function} deps.isDarkTheme 宿主当前是否深色主题
		 * @param {Function} deps.onSaved 保存成功后把新文档应用回运行时
		 * @param {Function} deps.sendDanmaku 立刻发一条自己的弹幕(V4「自己发一条」)
		 * @returns {{SETTINGS_NS: string, SETTINGS_DICTS: object, SettingsPanel: Function, st: Function, dispose: Function}}
		 */
		function createSettingsPage(deps) {
			const {
				locale,
				effect,
				toolMotionStatus,
				toolMotionListeners,
				getRuntimePreset,
				getLastLocale,
				isDarkTheme,
				onSaved,
				sendDanmaku
			} = deps;

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
					"whaleTail": "鲸鱼尾巴",
					"whaleTail.enabled": "保留鲸鱼尾巴(跟随炫彩)",
					"whaleTail.hint": "dsh 0.2.0 起运行中那一行左侧有个 DeepSeek 鲸鱼尾巴图标:打开后插件接管文案时把它留下,并让它按「炫彩渐变」的色板做流光;关掉 = 整行(含尾巴)由插件文案替代。尾巴的配色/速度跟「炫彩渐变」那一组走。",
					"whaleTail.motion": "尾巴摇动",
					"whaleTail.motion.enabled": "启用鲸鱼尾巴摇动",
					"whaleTail.motion.mode": "摇速来源",
					"whaleTail.motion.mode.tps": "跟随 tok/s",
					"whaleTail.motion.mode.fixed": "固定速度",
					"whaleTail.motion.animation": "尾巴动作",
					"whaleTail.motion.animation.wag": "原版翻摆",
					"whaleTail.motion.animation.sway": "左右摆尾",
					"whaleTail.motion.animation.twist": "扭转摆尾",
					"whaleTail.motion.animation.random": "随机切换三种动作",
					"whaleTail.motion.toolSwitch": "工具调用时随机切换动作",
					"whaleTail.motion.toolChance": "每次工具调用的触发概率(%)",
					"whaleTail.motion.toolHint": "仅新的工具调用参与判定,历史记录和重复通知不触发。命中后在衔接姿态处切换到另一种动作;连续命中会合并待切换请求。固定动作也可启用,关闭此项后回到所选动作。",
					"whaleTail.motion.toolChance.invalid": "触发概率须在 0–100% 之间。",
					"whaleTail.motion.toolStatus.waiting": "正在等待当前会话连接…",
					"whaleTail.motion.toolStatus.unavailable": "当前会话暂时没有可用的工具活动数据。",
					"whaleTail.motion.toolStatus.counts": "实时检测：{calls} 次新工具调用，命中 {matches} 次，开始切换 {switches} 次。",
					"whaleTail.motion.animation.hint": "随机模式每 4–8 秒选择另一种动作,在衔接姿态处用 6 帧过渡后切换。三种动作都沿用下方的速度设置。",
					"whaleTail.motion.fixedSpeed": "固定摇速(次/秒)",
					"whaleTail.motion.hint": "需要同时开启「保留鲸鱼尾巴」。跟随估算 tok/s 时,按 tok/s ÷ 16 调速,最低 2 次/秒(等待时也保持),最高 6 次/秒;固定模式可设置 0.25–6 次/秒。此开关是明确的动效选择,系统减少动态效果不会覆盖它。",
					"whaleTail.motion.invalid": "固定摇速须在 0.25–6 次/秒之间。",
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
					"appearance": "外观主题",
					"appearance.desc": "字体、发光、文字动画与状态行活动指示。",
					"appearance.theme": "主题包",
					"appearance.theme.custom": "自定义(不改)",
					"appearance.themeHint": "选一个主题会同时设定外观与渐变色板;选完仍可继续手调下面每一项。",
					"appearance.fontFamily": "字体",
					"appearance.fontFamily.placeholder": "留空 = 跟随界面,如 \"Segoe UI\", system-ui",
					"appearance.fontFamily.hint": "只允许字母 / 数字 / 空格 / 逗号 / 引号 / 连字符 —— 这个值会写进 CSS,其余字符会被拒。",
					"appearance.fontSize": "字号(px)",
					"appearance.fontSizeHint": "0 = 跟随宿主(默认)。",
					"appearance.glow": "发光",
					"appearance.glowHint": "给文字加一层柔光(用下面的颜色,留空则用渐变色板首色)。",
					"appearance.glowColor": "发光颜色",
					"appearance.glowColor.placeholder": "留空 = 用渐变色板首色",
					"appearance.animation": "文字动画",
					"appearance.animation.none": "无",
					"appearance.animation.breathe": "呼吸",
					"appearance.animation.glitch": "故障风",
					"appearance.spinner": "活动指示",
					"appearance.spinner.none": "无",
					"appearance.spinner.ring": "环形",
					"appearance.spinner.bar": "条形",
					"appearance.spinnerHint": "宿主不暴露回合进度,所以它是「正在跑」的示意,不是百分比。",
					"danmaku.hoverPause": "悬停暂停",
					"danmaku.interactHint": "打开后弹幕层开始接收鼠标事件(默认不拦截指针)。",
					"danmaku.clickCopy": "点击复制",
					"danmaku.clickCopyHint": "点一颗弹幕即复制它的文案(用浏览器剪贴板,不可用时不做假反馈)。",
					"danmaku.adaptDensity": "密度自适应",
					"danmaku.adaptDensityHint": "同屏越接近上限发得越稀;页面不可见时几乎不发。",
					"danmaku.avoidPointer": "鼠标避让",
					"danmaku.avoidPointerHint": "落点躲开指针所在的高度带。",
					"danmaku.phaseColors.thinking": "思考相位色",
					"danmaku.phaseColors.running": "运行相位色",
					"danmaku.phaseColors.long": "长任务相位色",
					"danmaku.phaseColors.placeholder": "留空 = 用炫彩色板",
					"danmaku.send": "自己发一条",
					"danmaku.sendPlaceholder": "输入一句话…",
					"danmaku.sendButton": "发一条",
					"danmaku.sendHint": "立刻作为滚动弹幕发出;设置弹窗遮罩期间会排队,关掉后补发。",
					"antiRepeat": "反重复",
					"antiRepeat.desc": "同一语言 + 相位下的抽句记忆。",
					"antiRepeat.recentLimit": "跨袋记忆条数",
					"antiRepeat.recentHint": "洗牌袋里的句子抽完之前不会重复;袋子抽空重开时先剔掉最近这么多条,保证跨袋也不撞上一句。0 = 只靠袋子,不做跨袋记忆(0~50)。",
					"antiRepeat.persist": "刷新后继续记",
					"antiRepeat.persistHint": "把记忆写进浏览器本地存储:刷新页面后不会立刻又看到同一句。",
					"hint": "每行一句,空行自动忽略;保存后立即生效。",
					"hint.weight": "`文案 | 权重` 加权,如 `正在写代码 | 3`。",
					"hint.when": "`文案 | when:tool=bash` 条件句:只在对应状态出现。可用条件 tool(工具名,`*` = 任意工具;多个用 `+`)、retry(有重试)、pending(有人等你回答)、phase(thinking/running/long/idle)、hour=22-6(本地时段,可跨午夜)、firstTurn(本会话第一回合)。写成 `when:tool=bash,phase=long` 表示**同时**满足。",
					"hint.rarity": "`文案 | rarity:0.01` 稀有句:每次抽取只有 1% 概率参与(彩蛋用)。",
					"hint.order": "修饰段写在行尾、顺序随意:`文案 | 3 | when:tool=bash | rarity:0.05`。正文里的 `|` 不会被当成修饰。",
					"footer.repo": "GitHub 仓库 · 01Virex/dsh-status-rotator ↗",
					"reload": "重新读取",
					"loadError": "读取配置失败",
					"saveError": "保存失败",
					"saveConflict": "配置在别处已经变更,这次保存被拒绝。已重新读取最新配置,请确认后再改一次。",
					"saveConflict": "配置在别处已经变更,这次保存被拒绝。已重新读取最新配置,请确认后再改一次。",
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
					"whaleTail": "Whale tail",
					"whaleTail.enabled": "Keep the whale tail (follow the gradient)",
					"whaleTail.hint": "Since dsh 0.2.0 the running row shows a small DeepSeek whale-tail icon: turn this on and the plugin keeps it next to its own phrase and animates it with the rainbow gradient palette. Off = the plugin's line replaces the whole row (tail included). The tail follows the colours/speed of the Rainbow gradient group.",
					"whaleTail.motion": "Tail motion",
					"whaleTail.motion.enabled": "Wag the whale tail",
					"whaleTail.motion.mode": "Wag speed",
					"whaleTail.motion.mode.tps": "Follow tok/s",
					"whaleTail.motion.mode.fixed": "Fixed speed",
					"whaleTail.motion.animation": "Tail action",
					"whaleTail.motion.animation.wag": "Original wag",
					"whaleTail.motion.animation.sway": "Side-to-side sway",
					"whaleTail.motion.animation.twist": "Twisting tail",
					"whaleTail.motion.animation.random": "Randomly switch all three",
					"whaleTail.motion.toolSwitch": "Randomly switch on tool calls",
					"whaleTail.motion.toolChance": "Trigger chance per tool call (%)",
					"whaleTail.motion.toolHint": "Only new tool calls participate; history and repeated notifications do not trigger. A hit switches to another action at its junction. Consecutive hits share one pending request. This also works with a fixed action; disabling it restores the selected action.",
					"whaleTail.motion.toolChance.invalid": "Trigger chance must be between 0 and 100%.",
					"whaleTail.motion.toolStatus.waiting": "Waiting for the current session to connect…",
					"whaleTail.motion.toolStatus.unavailable": "Tool activity is temporarily unavailable for this session.",
					"whaleTail.motion.toolStatus.counts": "Live activity: {calls} new tool calls, {matches} hits, {switches} switches started.",
					"whaleTail.motion.animation.hint": "Random mode selects a different action every 4–8 seconds, then switches at the matched pose through six bridge frames. All three actions use the speed settings below.",
					"whaleTail.motion.fixedSpeed": "Fixed speed (cycles/s)",
					"whaleTail.motion.hint": "Also enable “Keep the whale tail”. In estimated tok/s mode, speed follows tok/s ÷ 16 with a floor of 2 cycles/s (including while waiting) and a cap of 6 cycles/s. Fixed mode accepts 0.25–6 cycles/s. This explicit motion toggle also works when the system requests reduced motion.",
					"whaleTail.motion.invalid": "Fixed speed must be between 0.25 and 6 cycles/s.",
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
					"appearance": "Appearance theme",
					"appearance.desc": "Font, glow, text animation and the status-line activity indicator.",
					"appearance.theme": "Theme pack",
					"appearance.theme.custom": "Custom (leave as is)",
					"appearance.themeHint": "Picking a theme sets both the appearance and the gradient palette in one go; every field below stays editable afterwards.",
					"appearance.fontFamily": "Font",
					"appearance.fontFamily.placeholder": "empty = follow the interface, e.g. \"Segoe UI\", system-ui",
					"appearance.fontFamily.hint": "Letters, digits, spaces, commas, quotes and hyphens only — this value is written into CSS, anything else is rejected.",
					"appearance.fontSize": "Font size (px)",
					"appearance.fontSizeHint": "0 = follow the host (default).",
					"appearance.glow": "Glow",
					"appearance.glowHint": "Adds a soft halo around the text (uses the colour below, or the first gradient colour when empty).",
					"appearance.glowColor": "Glow colour",
					"appearance.glowColor.placeholder": "empty = first gradient colour",
					"appearance.animation": "Text animation",
					"appearance.animation.none": "None",
					"appearance.animation.breathe": "Breathe",
					"appearance.animation.glitch": "Glitch",
					"appearance.spinner": "Activity indicator",
					"appearance.spinner.none": "None",
					"appearance.spinner.ring": "Ring",
					"appearance.spinner.bar": "Bar",
					"appearance.spinnerHint": "The host exposes no turn progress, so this shows \\u201crunning\\u201d rather than a percentage.",
					"danmaku.hoverPause": "Pause on hover",
					"danmaku.interactHint": "Turns the danmaku layer into a pointer target (by default it never intercepts the pointer).",
					"danmaku.clickCopy": "Click to copy",
					"danmaku.clickCopyHint": "Clicking a bullet copies its text (via the browser clipboard; no fake feedback when unavailable).",
					"danmaku.adaptDensity": "Adaptive density",
					"danmaku.adaptDensityHint": "Spawns get sparser as the on-screen count approaches the cap, and almost stop while the page is hidden.",
					"danmaku.avoidPointer": "Avoid the pointer",
					"danmaku.avoidPointerHint": "Bullets land away from the pointer's height band.",
					"danmaku.phaseColors.thinking": "Thinking colour",
					"danmaku.phaseColors.running": "Running colour",
					"danmaku.phaseColors.long": "Long-task colour",
					"danmaku.phaseColors.placeholder": "empty = rainbow palette",
					"danmaku.send": "Send your own",
					"danmaku.sendPlaceholder": "Type a line…",
					"danmaku.sendButton": "Send",
					"danmaku.sendHint": "Flies across immediately as a scrolling bullet; while the settings dialog mask is up it queues and is sent once the mask goes away.",
					"antiRepeat": "Anti-repeat",
					"antiRepeat.desc": "How phrases are remembered per language + phase.",
					"antiRepeat.recentLimit": "Cross-cycle memory",
					"antiRepeat.recentHint": "A phrase never repeats until the shuffle bag is empty; when the bag is refilled, the last N phrases are held back so a cycle boundary cannot repeat one either. 0 = bag only (0~50).",
					"antiRepeat.persist": "Remember across reloads",
					"antiRepeat.persistHint": "Keep the memory in browser storage so a page reload does not immediately show the same phrase again.",
					"hint": "One phrase per line; empty lines are ignored. Saved changes apply immediately.",
					"hint.weight": "`text | weight` weights a phrase (e.g. `coding hard | 3`).",
					"hint.when": "`text | when:tool=bash` makes it conditional: the phrase only appears in that state. Conditions: tool (name, `*` = any tool, join several with `+`), retry, pending, phase (thinking/running/long/idle), hour=22-6 (local hours, may cross midnight), firstTurn. `when:tool=bash,phase=long` requires **all** of them.",
					"hint.rarity": "`text | rarity:0.01` is an easter egg: it only takes part in 1% of draws.",
					"hint.order": "Modifiers go at the end of the line in any order: `text | 3 | when:tool=bash | rarity:0.05`. A `|` inside the phrase itself is kept.",
					"footer.repo": "GitHub repository · 01Virex/dsh-status-rotator ↗",
					"reload": "Reload",
					"loadError": "Could not load config",
					"saveError": "Save failed",
					"saveConflict": "This config changed elsewhere, so the save was rejected. The latest config has been reloaded - check it and apply your edit again.",
					"noDocument": "Config has not loaded yet — hit Reload first",
					"invalidNumber": "Invalid number — check basic settings",
					"overrideWarning": "⚠ A localStorage override is active. This page edits the local config.json, so the UI may still show the overridden phrases.",
					"count": "{n} phrases"
				}
			};
			effect(() => locale.register(SETTINGS_NS, SETTINGS_DICTS), "status-rotator: settings dictionaries");
			const st = locale.bind(SETTINGS_NS);

			/** 设置页专用读写:目标固定为本插件的本地 config.json 路由 */
			/**
			 * N2:设置页读到的配置 ETag,写回时作为 If-Match。
			 * 刻意用普通闭包变量而不是 useRef:这一段是**工厂体**(在组件外),在那里调 hook 会直接抛错。
			 * 它不参与渲染,所以也不需要 React 状态。
			 */
			let docEtag = "";
			const readConfigDocument = async () => {
				const res = await fetch(LOCAL_CONFIG_URL, { cache: "no-store" });
				if (!res.ok) throw new Error("HTTP " + res.status);
				const etag = res.headers && typeof res.headers.get === "function" ? (res.headers.get("etag") || "") : "";
				if (etag.length > 0) docEtag = etag;
				return await res.json();
			};

			const writeConfigDocument = async (next) => {
				const headers = { "content-type": "application/json" };
				// N2:带上读取时的 ETag。服务端据此拒绝「基于旧版本的后写」,而不是让它覆盖掉对方。
				if (docEtag.length > 0) headers["if-match"] = docEtag;
				const res = await fetch(LOCAL_CONFIG_URL, {
					method: "PUT",
					headers,
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
					// 409 冲突 / 428 缺前提:显式抛给设置页(它会重读并提示),不静默覆盖
					const conflict = new Error(payload && payload.error ? payload.error : "HTTP " + res.status);
					conflict.status = res.status;
					conflict.code = payload && payload.code ? payload.code : "";
					// 服务端把当前 ETag 一起回给我们了,先记住,便于重读后直接续写
					if (payload && typeof payload.etag === "string" && payload.etag.length > 0) docEtag = payload.etag;
					throw conflict;
				}
				// 保存成功后服务端会回新的 ETag:记住它,下一次写才不会误判成冲突
				const savedEtag = res.headers && typeof res.headers.get === "function" ? (res.headers.get("etag") || "") : "";
				if (savedEtag.length > 0) docEtag = savedEtag;
				// 保存成功后立刻把新配置应用到正在运行的轮换逻辑,
				// 不用等下一次 15 秒自动重读。
				const parsed = parseExternal(next);
				if (parsed) onSaved(parsed);
				return payload;
			};

			const SETTINGS_LOCALES = ["zh", "en"];
			const SETTINGS_PHASES = [PHASE_THINKING, PHASE_RUNNING, PHASE_LONG];
			const parseLines = (text) => String(text || "").split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);

			/** 编辑器草稿签名:用于判断是否有未保存改动(键顺序固定,只比较内容) */
			const editorSignature = (state) => JSON.stringify([
				state.basic, state.weighted, state.gradientDraft, state.danmakuDraft, state.appearanceDraft, state.titleDraft, state.whaleTail, state.whaleTailMotion,
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
			const settingsStyleEl = createOwnedStyle("dsh-status-rotator-settings-style");
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
				const [toolDiagnostics, setToolDiagnostics] = react.useState(toolMotionStatus);
				react.useEffect(() => {
					setToolDiagnostics(toolMotionStatus());
					toolMotionListeners.add(setToolDiagnostics);
					return () => toolMotionListeners.delete(setToolDiagnostics);
				}, []);
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
				/** N2:写盘撞上 409/428 时自增,驱动一次「重读最新配置」 */
				const [conflictTick, setConflictTick] = react.useState(0);
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
				/**
				 * 保留鲸鱼尾巴(0.2.0 运行行里那个图标)并让它跟着炫彩。
				 * 放在「外观」页,和渐变/弹幕一组 —— 它跟的是 gradient 的色板。
				 */
				const [whaleTail, setWhaleTail] = react.useState(false);
				const [whaleTailMotionDraft, setWhaleTailMotionDraft] = react.useState({
					enabled: DEFAULT_CONFIG.whaleTailMotion.enabled,
					mode: DEFAULT_CONFIG.whaleTailMotion.mode,
					animation: DEFAULT_CONFIG.whaleTailMotion.animation,
					toolSwitchEnabled: DEFAULT_CONFIG.whaleTailMotion.toolSwitchEnabled,
					toolSwitchChance: String(DEFAULT_CONFIG.whaleTailMotion.toolSwitchChance * 100),
					fixedSpeed: String(DEFAULT_CONFIG.whaleTailMotion.fixedSpeed),
				});
				const [titleDraft, setTitleDraft] = react.useState({
					enabled: false,
					templates: DEFAULT_CONFIG.title.templates.join("\n"),
					idleTemplate: DEFAULT_CONFIG.title.idleTemplate,
					intervalMs: String(DEFAULT_CONFIG.title.intervalMs),
				});
				/** V3 外观草稿;fontSize 用字符串承载输入框,提交时再转数字 */
				const [appearanceDraft, setAppearanceDraft] = react.useState({
					fontFamily: "", fontSize: "0", glow: false, glowColor: "", animation: "none", spinner: "none",
				});
				/** V4「自己发一条」的输入框 */
				const [danmakuSendDraft, setDanmakuSendDraft] = react.useState("");
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
				/**
				 * 「草稿签名」的单一来源:所有会触发自动落盘的状态集中在这一处。
				 * 新增一个草稿字段时**只改这里** —— 签名实参、依赖数组、dirty 全跟着走,
				 * 不会再出现 issue #96 那种「新设置组漏进签名 / 依赖 → 改了什么都不写盘」。
				 */
				const editorState = { basic, weighted, gradientDraft, danmakuDraft, appearanceDraft, titleDraft, whaleTail, whaleTailMotion: whaleTailMotionDraft, drafts, scheduleDrafts, packEnabled };
				const dirty = baseline !== "" && editorSignature(editorState) !== baseline;

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
						// 反重复(洗牌袋):跨袋记忆条数 + 是否跨刷新持久化
						recentLimit: String((cfg.antiRepeat && cfg.antiRepeat.recentLimit) ?? DEFAULT_CONFIG.antiRepeat.recentLimit),
						antiPersist: cfg.antiRepeat ? cfg.antiRepeat.persist === true : DEFAULT_CONFIG.antiRepeat.persist === true,
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
					const wm = cfg && cfg.whaleTailMotion && typeof cfg.whaleTailMotion === "object" ? cfg.whaleTailMotion : {};
					const nextWhaleTailMotion = {
						enabled: wm.enabled === true,
						mode: WHALE_TAIL_MOTION_MODES.includes(wm.mode) ? wm.mode : DEFAULT_CONFIG.whaleTailMotion.mode,
						animation: WHALE_TAIL_ANIMATIONS.includes(wm.animation) ? wm.animation : DEFAULT_CONFIG.whaleTailMotion.animation,
						toolSwitchEnabled: wm.toolSwitchEnabled === true,
						toolSwitchChance: String((typeof wm.toolSwitchChance === "number" && Number.isFinite(wm.toolSwitchChance) ? clampNumber(wm.toolSwitchChance, 0, 1) : DEFAULT_CONFIG.whaleTailMotion.toolSwitchChance) * 100),
						fixedSpeed: String(typeof wm.fixedSpeed === "number"
							? clampNumber(wm.fixedSpeed, WHALE_TAIL_WAG_SPEED_RANGE[0], WHALE_TAIL_WAG_SPEED_RANGE[1])
							: DEFAULT_CONFIG.whaleTailMotion.fixedSpeed),
					};
					const dm = cfg && typeof cfg.danmaku === "object" ? cfg.danmaku : {};
					/** 顶部 / 底部弹幕样式块(用户只写几项时其余按集中默认值回填) */
					const dmFixed = dm && typeof dm.fixed === "object" && dm.fixed !== null ? dm.fixed : {};
					const nextDanmaku = {
						hoverPause: dm.hoverPause === true,
						clickCopy: dm.clickCopy === true,
						adaptDensity: dm.adaptDensity === true,
						avoidPointer: dm.avoidPointer === true,
						phaseThinking: dm.phaseColors && typeof dm.phaseColors.thinking === "string" ? dm.phaseColors.thinking : "",
						phaseRunning: dm.phaseColors && typeof dm.phaseColors.running === "string" ? dm.phaseColors.running : "",
						phaseLong: dm.phaseColors && typeof dm.phaseColors.long === "string" ? dm.phaseColors.long : "",
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
					const ap = cfg.appearance && typeof cfg.appearance === "object" ? cfg.appearance : {};
					const nextAppearance = {
						fontFamily: typeof ap.fontFamily === "string" ? ap.fontFamily : "",
						fontSize: String(typeof ap.fontSize === "number" ? ap.fontSize : 0),
						glow: ap.glow === true,
						glowColor: typeof ap.glowColor === "string" ? ap.glowColor : "",
						animation: APPEARANCE_ANIMATIONS.indexOf(ap.animation) >= 0 ? ap.animation : "none",
						spinner: APPEARANCE_SPINNERS.indexOf(ap.spinner) >= 0 ? ap.spinner : "none",
					};
					setAppearanceDraft(nextAppearance);
					setDanmakuDraft(nextDanmaku);
					setTitleDraft(nextTitle);
					setWhaleTail(cfg.whaleTail === true);
					setWhaleTailMotionDraft(nextWhaleTailMotion);
					setDrafts(nextDrafts);
					return { basic: nextBasic, weighted: nextWeighted, gradientDraft: nextGradient, danmakuDraft: nextDanmaku, appearanceDraft: nextAppearance, titleDraft: nextTitle, whaleTail: cfg.whaleTail === true, whaleTailMotion: nextWhaleTailMotion, drafts: nextDrafts };
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
				const runtimePreset = getRuntimePreset();
				const currentLabel = runtimePreset
					? (labelOf(presets.find((p) => p.id === runtimePreset), editLang) || runtimePreset)
					: t("preset.none");

				/** 当前草稿命中哪个主题(用于选择器显示);都没命中 = 自定义 */
				const currentThemeId = () => {
					for (const theme of APPEARANCE_THEMES) {
						const a = theme.appearance || {};
						const g = theme.gradient || {};
						const sameAppearance =
							(typeof a.fontFamily !== "string" || a.fontFamily === String(appearanceDraft.fontFamily || "").trim()) &&
							(a.fontSize === undefined || String(a.fontSize) === String(Math.max(0, Math.round(Number(appearanceDraft.fontSize) || 0)))) &&
							(a.glow === undefined || a.glow === (appearanceDraft.glow === true)) &&
							(a.animation === undefined || a.animation === appearanceDraft.animation) &&
							(a.spinner === undefined || a.spinner === appearanceDraft.spinner);
						if (sameAppearance && gradientDraft.colors === (g.colors || []).join(", ")) return theme.id;
					}
					return "";
				};
				/** 选主题:外观 + 渐变色板一次写进草稿(写盘交给既有的自动保存;选完仍可手调) */
				const applyTheme = (id) => {
					const theme = themeById(id);
					if (!theme) return;
					const a = theme.appearance || {};
					setAppearanceDraft((prev) => ({
						...prev,
						fontFamily: typeof a.fontFamily === "string" ? a.fontFamily : prev.fontFamily,
						fontSize: a.fontSize === undefined ? prev.fontSize : String(a.fontSize),
						glow: a.glow === undefined ? prev.glow : a.glow === true,
						glowColor: typeof a.glowColor === "string" ? a.glowColor : prev.glowColor,
						animation: APPEARANCE_ANIMATIONS.indexOf(a.animation) >= 0 ? a.animation : prev.animation,
						spinner: APPEARANCE_SPINNERS.indexOf(a.spinner) >= 0 ? a.spinner : prev.spinner,
					}));
					const g = theme.gradient;
					if (g) {
						setGradientDraft((prev) => ({
							...prev,
							enabled: g.enabled !== false,
							mode: normalizeGradientMode(g.mode),
							direction: normalizeGradientDirection(g.direction),
							colors: (g.colors || []).join(", "),
							dayColors: (g.dayColors || g.colors || []).join(", "),
							speed: String(g.speed === undefined ? prev.speed : g.speed),
						}));
					}
				};

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

				/**
				 * 写盘用的基准文档:上一次写过的那份(docRef)→ 本次读到的文档(doc)→ null。
				 * 都不存在时返回 null,由调用方给出「配置还没读到」的提示并拒绝写盘。
				 */
				const writeBase = () => {
					if (docRef.current && typeof docRef.current === "object") return docRef.current;
					if (doc && typeof doc === "object") return doc;
					return null;
				};

				/** 改即写盘:mutate 在最新文档上应用改动,按队列顺序落盘 */
				const persist = react.useCallback((mutate) => {
					// 基准文档 = 上一次写盘的那份(docRef),还没写过就用**读到的文档**(doc)。
					// 不能用空对象:那会提交一份「只有本次动过的键」的残缺文档,而保存是整份替换。
					const base = writeBase();
					if (!base) { setSaveState({ kind: "error", text: t("noDocument") }); return Promise.resolve(null); }
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
							const status = error && typeof error.status === "number" ? error.status : 0;
							if (status === 409 || status === 428) {
								// N2:这次写入被服务端明确拒绝了。界面上的「乐观更新」并不成立,
								// 所以既要说清楚,也要把编辑器拉回服务端的真实内容,别让用户对着幻觉继续改。
								setSaveState({ kind: "error", text: t("saveConflict") });
								setConflictTick((n) => n + 1);
							} else {
								setSaveState({ kind: "error", text: t("saveError") + ": " + String(error && error.message ? error.message : error) });
							}
						}
					});
					writeChain.current = done.catch(() => {});
					return done;
				// doc 必须在依赖里:writeBase() 在还没保存过时会回落到读到的文档
				}, [t, doc]);

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
					// 基准文档:上一次写盘的那份(docRef)优先,否则用**读到的文档**(doc)。
					// 0.27.1 这里只认 docRef —— 而 docRef 只在 persist() 里赋值,于是全新打开的
					// 设置页(还没保存过任何东西)里每一次改动都被拦下:开关看着拨过去了、其实没写盘,
					// 重读又把值拨回存储里的旧值(用户报的「弹幕关不掉」)。只有当**两个都没有**
					// (配置压根没读到)时才拦 —— 那时提交出去的会是「只有本次动过的键」的残缺文档,
					// 而保存是整份替换存储,会把用户其余设置一起抹掉。
					const base = writeBase();
					if (!base) {
						setSaveState({ kind: "error", text: t("noDocument") });
						return null;
					}
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
					const whaleWagSpeed = Number(whaleTailMotionDraft.fixedSpeed);
					const toolSwitchPercent = Number(whaleTailMotionDraft.toolSwitchChance);
					if (String(whaleTailMotionDraft.toolSwitchChance).trim() === "" || !Number.isFinite(toolSwitchPercent) || toolSwitchPercent < 0 || toolSwitchPercent > 100) {
						setSaveState({ kind: "error", text: t("whaleTail.motion.toolChance.invalid") });
						return null;
					}
					if (!WHALE_TAIL_MOTION_MODES.includes(whaleTailMotionDraft.mode) || !WHALE_TAIL_ANIMATIONS.includes(whaleTailMotionDraft.animation) ||
						(whaleTailMotionDraft.mode === "fixed" && (!Number.isFinite(whaleWagSpeed) || whaleWagSpeed < WHALE_TAIL_WAG_SPEED_RANGE[0] || whaleWagSpeed > WHALE_TAIL_WAG_SPEED_RANGE[1]))) {
						setSaveState({ kind: "error", text: t("whaleTail.motion.invalid") });
						return null;
					}
					const fixedWagSpeed = Number.isFinite(whaleWagSpeed)
						? clampNumber(whaleWagSpeed, WHALE_TAIL_WAG_SPEED_RANGE[0], WHALE_TAIL_WAG_SPEED_RANGE[1])
						: DEFAULT_CONFIG.whaleTailMotion.fixedSpeed;
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
						// V3 外观:全部是"什么都不改"的默认值,不选主题也能一直用默认
						appearance: {
							fontFamily: String(appearanceDraft.fontFamily || "").trim(),
							fontSize: Math.max(0, Math.round(Number(appearanceDraft.fontSize) || 0)),
							glow: appearanceDraft.glow === true,
							glowColor: String(appearanceDraft.glowColor || "").trim(),
							animation: APPEARANCE_ANIMATIONS.indexOf(appearanceDraft.animation) >= 0 ? appearanceDraft.animation : "none",
							spinner: APPEARANCE_SPINNERS.indexOf(appearanceDraft.spinner) >= 0 ? appearanceDraft.spinner : "none",
						},
						// 反重复(洗牌袋):钩子只在整份文档里写这两个键,其余键由 normalizeConfig 收口
						antiRepeat: {
							recentLimit: Number.isFinite(Number(basic.recentLimit)) ? Number(basic.recentLimit) : DEFAULT_CONFIG.antiRepeat.recentLimit,
							persist: basic.antiPersist === true,
						},
						// 标签页标题:关着也把模板留着(下次打开不用重写);enabled=false 时插件完全不碰 document.title
						title: {
							enabled: titleDraft.enabled === true,
							templates: titleTemplates,
							idleTemplate: String(titleDraft.idleTemplate || "").trim(),
							intervalMs: titleInterval,
						},
						// 保留鲸鱼尾巴(0.2.0):尾巴留着 + 跟着 gradient 色板做流光
						whaleTail: whaleTail === true,
						whaleTailMotion: {
							enabled: whaleTailMotionDraft.enabled === true,
							mode: whaleTailMotionDraft.mode,
						animation: whaleTailMotionDraft.animation,
							toolSwitchEnabled: whaleTailMotionDraft.toolSwitchEnabled === true,
							toolSwitchChance: toolSwitchPercent / 100,
							fixedSpeed: fixedWagSpeed,
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
							// V4:交互 / 观感开关与按相位分色(空 = 不落盘,保持历史配置形状)
							hoverPause: danmakuDraft.hoverPause === true,
							clickCopy: danmakuDraft.clickCopy === true,
							adaptDensity: danmakuDraft.adaptDensity === true,
							avoidPointer: danmakuDraft.avoidPointer === true,
							phaseColors: (() => {
								const pc = {};
								for (const [phase, key] of [["thinking", "phaseThinking"], ["running", "phaseRunning"], ["long", "phaseLong"]]) {
									const value = String(danmakuDraft[key] || "").trim();
									if (value.length > 0) pc[phase] = value;
								}
								return Object.keys(pc).length > 0 ? pc : undefined;
							})(),
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
					const signature = editorSignature(editorState);
					const done = persist(() => next);
					// 落盘成功才更新基线;失败时保留 dirty,下一次改动会重试
					done.then(() => setBaseline(signature)).catch(() => {});
					return done;
				// editorState 里含全部草稿字段(含 titleDraft):闭包不会捕获旧草稿,保存的是最新值
				}, [editorState, targetPreset, targetPack, persist, t, doc]);

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
					const signature = editorSignature(editorState);
					if (signature === baseline) return undefined;
					const timer = setTimeout(() => { commitDrafts(); }, 400);
					return () => clearTimeout(timer);
				}, [editorState, baseline, commitDrafts]);

				/** N2:冲突后重读一次最新配置(只由 conflictTick 驱动,不会和自动落盘互相触发) */
				react.useEffect(() => {
					if (conflictTick === 0) return;
					load();
				}, [conflictTick, load]);

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
							localStorage.getItem(STORAGE_KEY + "." + getLastLocale()) !== null;
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
				const toggle = (checked, onChange, label, disabled) => react.createElement("button", {
					type: "button",
					role: "switch",
					"aria-checked": checked,
					"aria-label": label,
					className: "dsh-sr-toggle" + (checked ? " dsh-sr-toggleOn" : ""),
					disabled: locked || !!disabled,
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
							react.createElement("p", { className: "dsh-sr-foot" }, t("hint")),
							react.createElement("p", { className: "dsh-sr-hint" }, t("hint.weight")),
							react.createElement("p", { className: "dsh-sr-hint" }, t("hint.when")),
							react.createElement("p", { className: "dsh-sr-hint" }, t("hint.rarity")),
							react.createElement("p", { className: "dsh-sr-hint" }, t("hint.order"))
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
						// ── V3 外观:主题包画廊 + 字体 / 字号 / 发光 / 动画 / 活动指示 ──
						react.createElement("section", { className: "dsh-sr-group" },
							react.createElement("div", { className: "dsh-sr-grouphead" },
								react.createElement("h3", null, t("appearance")),
								react.createElement("span", { className: "dsh-sr-muted" }, t("appearance.desc"))
							),
							react.createElement("label", { className: "dsh-sr-field" },
								react.createElement("span", { className: "dsh-sr-label" }, t("appearance.theme")),
								react.createElement("select", {
									className: "dsh-sr-select",
									value: currentThemeId(),
									disabled: locked,
									onChange: (event) => applyTheme(event.target.value),
								},
									react.createElement("option", { value: "" }, t("appearance.theme.custom")),
									APPEARANCE_THEMES.map((theme) => react.createElement("option", { key: theme.id, value: theme.id }, (theme.label && (theme.label[editLang] || theme.label.zh)) || theme.id))
								)
							),
							react.createElement("p", { className: "dsh-sr-hint" }, t("appearance.themeHint")),
							react.createElement("div", { className: "dsh-sr-grid" },
								react.createElement("label", { key: "fontFamily", className: "dsh-sr-field" },
									fieldHead("appearance.fontFamily", appearanceDraft.fontFamily, DEFAULT_CONFIG.appearance.fontFamily, (v) => setAppearanceDraft((prev) => ({ ...prev, fontFamily: v }))),
									react.createElement("input", {
										className: "dsh-sr-input" + (appearanceDraft.fontFamily === "" || FONT_FAMILY_RE.test(String(appearanceDraft.fontFamily).trim()) ? "" : " dsh-sr-input-invalid"),
										type: "text",
										value: appearanceDraft.fontFamily,
										disabled: locked,
										placeholder: t("appearance.fontFamily.placeholder"),
										onChange: (event) => setAppearanceDraft((prev) => ({ ...prev, fontFamily: event.target.value })),
									}),
									react.createElement("span", { className: "dsh-sr-hint" }, t("appearance.fontFamily.hint"))
								),
								react.createElement("label", { key: "fontSize", className: "dsh-sr-field" },
									fieldHead("appearance.fontSize", appearanceDraft.fontSize, String(DEFAULT_CONFIG.appearance.fontSize), (v) => setAppearanceDraft((prev) => ({ ...prev, fontSize: v }))),
									react.createElement("input", {
										className: "dsh-sr-input",
										type: "number", min: "0", max: "96",
										value: appearanceDraft.fontSize,
										disabled: locked,
										onChange: (event) => setAppearanceDraft((prev) => ({ ...prev, fontSize: event.target.value })),
									}),
									react.createElement("span", { className: "dsh-sr-hint" }, t("appearance.fontSizeHint"))
								),
								react.createElement("label", { key: "glow", className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("appearance.glow")),
									react.createElement("div", { className: "dsh-sr-switchline" },
										toggle(appearanceDraft.glow === true, (next) => setAppearanceDraft((prev) => ({ ...prev, glow: next })), t("appearance.glow")),
										react.createElement("span", { className: "dsh-sr-hint" }, t("appearance.glowHint"))
									)
								),
								react.createElement("label", { key: "glowColor", className: "dsh-sr-field" },
									fieldHead("appearance.glowColor", appearanceDraft.glowColor, DEFAULT_CONFIG.appearance.glowColor, (v) => setAppearanceDraft((prev) => ({ ...prev, glowColor: v }))),
									react.createElement("input", {
										className: "dsh-sr-input",
										type: "text",
										value: appearanceDraft.glowColor,
										disabled: locked,
										placeholder: t("appearance.glowColor.placeholder"),
										onChange: (event) => setAppearanceDraft((prev) => ({ ...prev, glowColor: event.target.value })),
									})
								),
								react.createElement("label", { key: "animation", className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("appearance.animation")),
									react.createElement("select", {
										className: "dsh-sr-select",
										value: appearanceDraft.animation,
										disabled: locked,
										onChange: (event) => setAppearanceDraft((prev) => ({ ...prev, animation: event.target.value })),
									}, APPEARANCE_ANIMATIONS.map((id) => react.createElement("option", { key: id, value: id }, t("appearance.animation." + id))))
								),
								react.createElement("label", { key: "spinner", className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("appearance.spinner")),
									react.createElement("select", {
										className: "dsh-sr-select",
										value: appearanceDraft.spinner,
										disabled: locked,
										onChange: (event) => setAppearanceDraft((prev) => ({ ...prev, spinner: event.target.value })),
									}, APPEARANCE_SPINNERS.map((id) => react.createElement("option", { key: id, value: id }, t("appearance.spinner." + id)))),
									react.createElement("span", { className: "dsh-sr-hint" }, t("appearance.spinnerHint"))
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
								react.createElement("h3", null, t("whaleTail")),
								toggle(whaleTail === true, (next) => setWhaleTail(next), t("whaleTail.enabled"))
							),
							react.createElement("p", { className: "dsh-sr-hint" }, t("whaleTail.hint")),
							react.createElement("div", { className: "dsh-sr-grouphead" },
								react.createElement("span", { className: "dsh-sr-label" }, t("whaleTail.motion")),
								toggle(whaleTailMotionDraft.enabled, (next) => setWhaleTailMotionDraft((prev) => ({ ...prev, enabled: next })), t("whaleTail.motion.enabled"), !whaleTail)
							),
							react.createElement("div", { className: "dsh-sr-grid" },
								react.createElement("label", { className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("whaleTail.motion.animation")),
									react.createElement("select", {
										className: "dsh-sr-select",
										value: whaleTailMotionDraft.animation,
										disabled: locked || !whaleTail,
										onChange: (event) => setWhaleTailMotionDraft((prev) => ({ ...prev, animation: event.target.value })),
									}, WHALE_TAIL_ANIMATIONS.map((name) => react.createElement("option", { key: name, value: name }, t("whaleTail.motion.animation." + name))))
								),
								react.createElement("label", { className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("whaleTail.motion.mode")),
									react.createElement("select", {
										className: "dsh-sr-select",
										value: whaleTailMotionDraft.mode,
										disabled: locked || !whaleTail,
										onChange: (event) => setWhaleTailMotionDraft((prev) => ({ ...prev, mode: event.target.value })),
									},
										["tps", "fixed"].map((mode) => react.createElement("option", { key: mode, value: mode }, t("whaleTail.motion.mode." + mode)))
									)
								),
								whaleTailMotionDraft.mode === "fixed" ? react.createElement("label", { className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("whaleTail.motion.fixedSpeed")),
									react.createElement("input", {
										className: "dsh-sr-input" + (inRange(whaleTailMotionDraft.fixedSpeed, WHALE_TAIL_WAG_SPEED_RANGE) ? "" : " dsh-sr-input-invalid"),
										type: "number",
										value: whaleTailMotionDraft.fixedSpeed,
										min: String(WHALE_TAIL_WAG_SPEED_RANGE[0]),
										max: String(WHALE_TAIL_WAG_SPEED_RANGE[1]),
										step: "0.25",
										disabled: locked || !whaleTail,
										onChange: (event) => setWhaleTailMotionDraft((prev) => ({ ...prev, fixedSpeed: event.target.value })),
									})
								) : null
							),
							react.createElement("p", { className: "dsh-sr-hint" }, t("whaleTail.motion.hint")),
							react.createElement("p", { className: "dsh-sr-hint" }, t("whaleTail.motion.animation.hint")),
							react.createElement("div", { className: "dsh-sr-grouphead" },
								react.createElement("span", { className: "dsh-sr-label" }, t("whaleTail.motion.toolSwitch")),
								toggle(whaleTailMotionDraft.toolSwitchEnabled, (next) => setWhaleTailMotionDraft((prev) => ({ ...prev, toolSwitchEnabled: next })), t("whaleTail.motion.toolSwitch"), !whaleTail)
							),
							react.createElement("label", { className: "dsh-sr-field" },
								react.createElement("span", { className: "dsh-sr-label" }, t("whaleTail.motion.toolChance")),
								react.createElement("input", {
									className: "dsh-sr-input" + (inRange(whaleTailMotionDraft.toolSwitchChance, [0, 100]) ? "" : " dsh-sr-input-invalid"),
									type: "number", min: "0", max: "100", step: "1", value: whaleTailMotionDraft.toolSwitchChance,
									disabled: locked || !whaleTail || !whaleTailMotionDraft.toolSwitchEnabled,
									onChange: (event) => setWhaleTailMotionDraft((prev) => ({ ...prev, toolSwitchChance: event.target.value })),
								})
							),
							react.createElement("p", { className: "dsh-sr-hint" }, t("whaleTail.motion.toolHint")),
							whaleTailMotionDraft.toolSwitchEnabled ? react.createElement("p", { className: "dsh-sr-hint", "data-tail-tool-status": toolDiagnostics.channel, role: "status" },
								toolDiagnostics.channel === "ready" ? t("whaleTail.motion.toolStatus.counts", toolDiagnostics) : t("whaleTail.motion.toolStatus." + toolDiagnostics.channel)) : null
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
								numField(danmakuDraft, setDanmakuDraft, "zIndex", "danmaku.zIndex", DANMAKU_RANGES.zIndex, DEFAULT_CONFIG.danmaku.zIndex, "1"),
								// ── V4 交互与观感(默认全关;前两项会让弹幕层开始接指针) ──
								react.createElement("label", { key: "hoverPause", className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("danmaku.hoverPause")),
									react.createElement("div", { className: "dsh-sr-switchline" },
										toggle(danmakuDraft.hoverPause === true, (next) => setDanmakuDraft((prev) => ({ ...prev, hoverPause: next })), t("danmaku.hoverPause")),
										react.createElement("span", { className: "dsh-sr-hint" }, t("danmaku.interactHint"))
									)
								),
								react.createElement("label", { key: "clickCopy", className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("danmaku.clickCopy")),
									react.createElement("div", { className: "dsh-sr-switchline" },
										toggle(danmakuDraft.clickCopy === true, (next) => setDanmakuDraft((prev) => ({ ...prev, clickCopy: next })), t("danmaku.clickCopy")),
										react.createElement("span", { className: "dsh-sr-hint" }, t("danmaku.clickCopyHint"))
									)
								),
								react.createElement("label", { key: "adaptDensity", className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("danmaku.adaptDensity")),
									react.createElement("div", { className: "dsh-sr-switchline" },
										toggle(danmakuDraft.adaptDensity === true, (next) => setDanmakuDraft((prev) => ({ ...prev, adaptDensity: next })), t("danmaku.adaptDensity")),
										react.createElement("span", { className: "dsh-sr-hint" }, t("danmaku.adaptDensityHint"))
									)
								),
								react.createElement("label", { key: "avoidPointer", className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("danmaku.avoidPointer")),
									react.createElement("div", { className: "dsh-sr-switchline" },
										toggle(danmakuDraft.avoidPointer === true, (next) => setDanmakuDraft((prev) => ({ ...prev, avoidPointer: next })), t("danmaku.avoidPointer")),
										react.createElement("span", { className: "dsh-sr-hint" }, t("danmaku.avoidPointerHint"))
									)
								),
								...[["phaseThinking", "danmaku.phaseColors.thinking"], ["phaseRunning", "danmaku.phaseColors.running"], ["phaseLong", "danmaku.phaseColors.long"]].map(([key, labelKey]) =>
									react.createElement("label", { key, className: "dsh-sr-field" },
										react.createElement("span", { className: "dsh-sr-label" }, t(labelKey)),
										react.createElement("input", {
											className: "dsh-sr-input",
											type: "text",
											value: danmakuDraft[key] || "",
											disabled: locked,
											placeholder: t("danmaku.phaseColors.placeholder"),
											onChange: (event) => setDanmakuDraft((prev) => ({ ...prev, [key]: event.target.value })),
										})
									)
								),
								react.createElement("label", { key: "sendOne", className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("danmaku.send")),
									react.createElement("div", { className: "dsh-sr-btnrow" },
										react.createElement("input", {
											className: "dsh-sr-input",
											type: "text",
											value: danmakuSendDraft,
											disabled: locked,
											placeholder: t("danmaku.sendPlaceholder"),
											onChange: (event) => setDanmakuSendDraft(event.target.value),
										}),
										textBtn(t("danmaku.sendButton"), () => {
											try { sendDanmaku(danmakuSendDraft); } catch (error) { /* 弹幕关着时静默 */ }
											setDanmakuSendDraft("");
										}, "", danmakuSendDraft.trim().length === 0)
									),
									react.createElement("span", { className: "dsh-sr-hint" }, t("danmaku.sendHint"))
								)
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
						// ── 反重复:洗牌袋 + 可选的跨刷新记忆 ──
						react.createElement("section", { className: "dsh-sr-group" },
							react.createElement("div", { className: "dsh-sr-grouphead" },
								react.createElement("h3", null, t("antiRepeat")),
								react.createElement("span", { className: "dsh-sr-muted" }, t("antiRepeat.desc"))
							),
							react.createElement("div", { className: "dsh-sr-grid" },
								react.createElement("label", { key: "recentLimit", className: "dsh-sr-field" },
									fieldHead("antiRepeat.recentLimit", basic.recentLimit, String(DEFAULT_CONFIG.antiRepeat.recentLimit), (value) => setBasic((prev) => ({ ...prev, recentLimit: value }))),
									react.createElement("input", {
										className: "dsh-sr-input" + (Number(basic.recentLimit) >= 0 && Number(basic.recentLimit) <= 50 ? "" : " dsh-sr-input-invalid"),
										type: "number",
										min: "0",
										max: "50",
										value: basic.recentLimit,
										disabled: locked,
										onChange: (event) => setBasic((prev) => ({ ...prev, recentLimit: event.target.value })),
									}),
									react.createElement("span", { className: "dsh-sr-hint" }, t("antiRepeat.recentHint"))
								),
								react.createElement("label", { key: "antiPersist", className: "dsh-sr-field" },
									react.createElement("span", { className: "dsh-sr-label" }, t("antiRepeat.persist")),
									react.createElement("div", { className: "dsh-sr-switchline" },
										toggle(basic.antiPersist === true, (next) => setBasic((prev) => ({ ...prev, antiPersist: next })), t("antiRepeat.persist")),
										react.createElement("span", { className: "dsh-sr-hint" }, t("antiRepeat.persistHint"))
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

			/** 卸载:撤掉设置页样式表(调用方在插件卸载时调用) */
			const dispose = () => {
				if (settingsStyleEl !== null && settingsStyleEl.isConnected) settingsStyleEl.remove();
			};

			return { SETTINGS_NS, SETTINGS_DICTS, SettingsPanel, st, dispose };
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		// 仅供 smoke test / verify 脚本(scripts/*.cjs)引用的内部入口;运行时无副作用。
		// createSettingsPage 是工厂(调用时有副作用:建样式表、注册字典),仅供独立验证。
		exports.__test = {
			createSettingsPage,
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
			// E2:条件选词 + 稀有度
			WHEN_KEYS,
			WHEN_ANY_TOOL,
			WHEN_PHASES,
			normalizeWhen,
			normalizeRarity,
			entryWhen,
			entryRarity,
			isBareEntry,
			matchWhen,
			rarityPass,
			selectPhrasePool,
			parsePhraseLine,
			parseWhenSpec,
			whenSpecOf,
			isPhraseModifier,
			// E1:洗牌袋 + 跨刷新记忆
			createShuffleBag,
			ANTI_REPEAT_LIMITS,
			// V3:外观与主题包
			normalizeAppearance,
			normalizeFontFamily,
			themeById,
			APPEARANCE_THEMES,
			APPEARANCE_ANIMATIONS,
			APPEARANCE_SPINNERS,
			APPEARANCE_LIMITS,
			FONT_FAMILY_RE,
			SPINNER_WIDTH,
			// V4:弹幕增强的纯件
			matrixTranslateX,
			// E4:对外注册接口
			createStatusRotatorApi,
			normalizeProviderGroups,
			BUILTIN_PLACEHOLDERS,
			PLACEHOLDER_NAME_RE,
			LABEL_SOURCES,
			normalizeLabelSource,
			labelPlanFor,
			phraseLines,
			normalizeGroups,
			normalizeTable,
			normalizeConfig,
			mergeConfig,
			normalizePresets,
			normalizePacks,
			mergeGroups,
			mergePackChain,
			normalizeSchedule,
			matchSchedule,
			formatElapsed,
			parseClock,
			whaleTailWagFrequency,
			pickWhaleTailAnimation,
			shouldSwitchWhaleTailOnTool,
			whaleTailBridgeFrames,
			createStreamCharCounter,
			createToolCallTracker,
			WHALE_TAIL_MOTION_MODES,
			WHALE_TAIL_ANIMATIONS,
			WHALE_TAIL_WAG_SPEED_RANGE,
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
