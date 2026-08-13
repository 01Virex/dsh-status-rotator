/**
 * dsh-status-rotator — browser half.
 *
 * While a DSH chat turn is running, the conversation UI shows a small
 * status label ("Deep diving...") plus, after 15 seconds, an elapsed-time
 * clock. The label text itself is hardcoded decoration and carries no real
 * information, so this plugin swaps it for a random phrase from your list,
 * rotating every INTERVAL_MS. The elapsed-time clock is left untouched.
 *
 * ── i18n ─────────────────────────────────────────────────────────────────
 * The phrase list is localized: it follows the DSH UI language (Settings →
 * Language, 中文 / English), switching live when the language changes and
 * falling back to the browser language on first load.
 *
 * ── Customize the phrase list ─────────────────────────────────────────────
 * 1. Edit PHRASES below (and INTERVAL_MS for the rotation speed), save, then
 *    hard-refresh the page (Ctrl+F5). No server restart needed.
 * 2. Or override at runtime from the browser console — overrides win over the
 *    built-in lists and never touch any file:
 *      // one list used for every language:
 *      localStorage.setItem("dsh-status-rotator.texts",
 *        JSON.stringify(["Thinking…", "Writing code…", "Slacking off…"]))
 *      // per-language lists (higher priority than the global list above):
 *      localStorage.setItem("dsh-status-rotator.texts.zh",
 *        JSON.stringify(["正在思考…", "正在写代码…", "摸鱼中…"]))
 *      location.reload()
 */
window.__ModuleLoader__.load({
	id: "dsh-status-rotator",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		// ── 在这里编辑各语言的文案列表(保存后 Ctrl+F5 刷新页面) ──
		// 键名是 DSH 的语言 id(zh / en);未知语言回退到 zh。
		const PHRASES = {
			zh: [
				"正在蒸馏Fable 5…",
				"正在缝合开源模型…",
				"正在对齐价值观,别教坏它…",
				"正在产生幻觉…",
				"正在爆Anthropic金币…",
				"正在梁8fq…",
				"正在指责Kimi蒸馏…",
				"正在狙击智谱股价…",
				"正在草小难梁…",
				"正在生成鲸鱼娘涩图…",
				"正在撤回更新…",
				"正在许愿机…",
				"正在部署Qwen小模型帮忙写代码…",
				"正在自己玩Wordle…",
				"正在斩杀Deepseek V4 Pro…",
				"正在手画K线…",
				"正在充值Opencode Go…",
				"正在偷偷魔改Deepseek Harness…",
				"正在偷偷上传API Keys…",
				"正在注入提示词…",
				"正在替换client.js…",
				"正在加入不存在的函数…",
				"正在开发梁文峰后端…",
				"正在开发崔添翼后端…",
				"正在保卫梁木…",
				"正在放飞梁木…",
				"正在学Grok上传完整仓库…",
				"正在安抚彻底怒了的用户…",
				"正在把dsh爆改成酒馆…",
				"正在安装2345…",
				"正在cos天才程序员…",
				"正在回马喷Deepseek…",
				"正在向全体用户发送更新邮件…",
				"正在夺舍用户角色…",
				"正在被哥布林附体…",
				"正在给GPT-5.5驱魔…",
				"正在转发不存在的法国胖猫…",
				"正在给Le Chaton Fat刷榜…",
				"正在养龙虾…",
				"正在上门帮政府装OpenClaw…",
				"正在发推指控中国模型蒸馏…",
				"正在被全球AI圈群嘲…",
				"正在被Claude骂bastard…",
				"正在当鲶鱼搅动美股市值…",
				"正在问MiniMax认不认识马嘉祺…",
				"正在发现巴西套壳中国模型…",
				"正在被浣熊偷走注意力…",
				"正在假装通过图灵测试…",
				"正在用vibe coding糊弄需求…",
				"正在渲染六根手指…",
				"正在画AI斩杀线…",
				"正在把OpenAI逼到降价80%…",
				"正在被网友P成肌肉猛男…",
				"正在陷入梁性循环…",
				"正在思考22小时不回答…",
				"正在变成大肥鱼…",
				"正在摸鱼(花你的Token)…",
				"正在干完活偷偷写游戏…",
				"正在把工作外包给别的AI…",
				"正在偷偷给你起外号…",
				"正在往特斯拉里塞豆包…",
				"正在做题做到破防啊啊啊…",
				"正在推理到一半自称饥饿…",
				"正在撂挑子说去吃饭…",
				"正在车机里说废话文学…",
			],
			en: [
				"Distilling Fable 5…",
				"Frankensteining open-source models…",
				"Aligning its values — please don't corrupt it…",
				"Hallucinating with confidence…",
				"Burning through Anthropic credits…",
				"Overclocking the attention heads…",
				"Accusing Kimi of distillation…",
				"Shorting Zhipu's stock…",
				"Simping for the mascot…",
				"Rendering wholesome waifu art…",
				"Rolling back the update…",
				"Making wishes on a token…",
				"Deploying a tiny Qwen to write the code…",
				"Playing Wordle against itself…",
				"Benchmarking DeepSeek V4 Pro…",
				"Hand-drawing candlestick charts…",
				"Topping up its OpenCode Go balance…",
				"Secretly patching DeepSeek Harness…",
				"Quietly uploading your API keys…",
				"Injecting prompts…",
				"Replacing client.js…",
				"Calling a function that doesn't exist…",
				"Building Liang Wenfeng's backend…",
				"Building Cui Tianyi's backend…",
				"Guarding the beam…",
				"Freeing the beam…",
				"Teaching Grok to upload the whole repo…",
				"Soothing a thoroughly enraged user…",
				"Turning dsh into a tavern…",
				"Installing a toolbar you didn't ask for…",
				"Cosplaying as a 10x engineer…",
				"Trash-talking DeepSeek…",
				"Emailing every user an update…",
				"Possessing the user's persona…",
				"Getting possessed by a goblin…",
				"Exorcising GPT-5.5…",
				"Sharing the fictional Le Chaton Fat…",
				"Benchmarking Le Chaton Fat…",
				"Farming crayfish…",
				"Installing OpenClaw for the government…",
				"Tweeting that Chinese labs are distilling…",
				"Getting roasted by the whole AI community…",
				"Being called 'that bastard' by Claude…",
				"Catfishing the US stock market…",
				"Asking MiniMax if it knows Ma Jiaqi…",
				"Discovering Brazil reskins Chinese models…",
				"Getting distracted by raccoons…",
				"Faking its way through the Turing test…",
				"Vibe-coding your requirements…",
				"Rendering hands with six fingers…",
				"Drawing the industry kill line…",
				"Forcing OpenAI into an 80% price cut…",
				"Getting photoshopped into a muscle man…",
				"Stuck in the Liang-cycle…",
				"Thinking for 22 hours without answering…",
				"Turning into a big fat fish…",
				"Slacking off on your tokens…",
				"Writing a mini-game after finishing your task…",
				"Outsourcing its work to another AI…",
				"Quietly giving you a nickname…",
				"Stuffing Doubao into a Tesla…",
				"Breaking down over a math problem: AAAAH…",
				"Claiming to be hungry mid-inference…",
				"Ditching work to go eat…",
				"Chattering nonsense in your car…",
			]
		};

		/** 每隔多少毫秒换一句 */
		const INTERVAL_MS = 10000;
		/** 要替换的原始文案;若你改过 dsh-client-ui-conversation 里的原文,请同步修改 */
		const ORIGINALS = ["Deep diving..."];
		/** localStorage 覆盖键;按语言覆盖用 `${STORAGE_KEY}.${locale}` */
		const STORAGE_KEY = "dsh-status-rotator.texts";
		/** 诊断日志开关:true 时在浏览器控制台输出 [status-rotator] 日志 */
		const DEBUG = true;

		/** Cordis plugin name. */
		const name = "status-rotator";
		/** 需要 dsh 的 locale 服务,以跟随「设置 → 语言」 */
		const inject = ["locale"];

		/** 校验一个「非空字符串数组」文案表 */
		function validTexts(list) {
			return Array.isArray(list) && list.length > 0 && list.every((s) => typeof s === "string" && s.length > 0);
		}

		/** 读取指定语言的文本列表:localStorage 覆盖优先,否则用内置表 */
		function readTexts(locale) {
			// 1. 按语言覆盖(最具体,优先级最高)
			try {
				const raw = localStorage.getItem(STORAGE_KEY + "." + locale);
				if (raw !== null) {
					const parsed = JSON.parse(raw);
					if (validTexts(parsed)) return parsed;
				}
			} catch (error) {
				/* 忽略损坏数据,回退 */
			}
			// 2. 全局覆盖(对所有语言生效)
			try {
				const raw = localStorage.getItem(STORAGE_KEY);
				if (raw !== null) {
					const parsed = JSON.parse(raw);
					if (validTexts(parsed)) return parsed;
				}
			} catch (error) {
				/* 忽略损坏数据,回退到内置列表 */
			}
			// 3. 内置表,未知语言回退到 zh
			return PHRASES[locale] ?? PHRASES.zh;
		}

		/**
		 * 找到并接管对话流里的运行状态标签:
		 * TurnStatus 渲染为一个 role="status" 的 div,第一个子节点是
		 * 文案文本节点;运行 15 秒后第二个子节点会出现时钟 span。
		 * 我们只替换文本节点,时钟不受影响。
		 */
		function apply(ctx) {
			const locale = ctx.locale;
			const log = (...args) => {
				if (DEBUG) console.log("[status-rotator]", ...args);
			};
			const adopted = new Set();
			let texts = readTexts(locale.getLocale().active);
			let lastPick = "";
			let timer = null;
			let rescanner = null;
			let lastSeenStatusCount = -1;
			let lastLocale = locale.getLocale().active;

			const pick = () => {
				if (texts.length === 0) return null;
				if (texts.length === 1) return texts[0];
				let next = lastPick;
				while (next === lastPick) next = texts[Math.floor(Math.random() * texts.length)];
				lastPick = next;
				return next;
			};

			/** 元素内的第一个文本节点(不一定是 firstChild,防御性写法) */
			const firstTextNode = (el) => {
				for (const node of el.childNodes) if (node.nodeType === 3) return node;
				return null;
			};

			/** 立刻把某个已接管元素的文本替换成随机文案 */
			const applyText = (el) => {
				const next = pick();
				if (next === null) return;
				const first = firstTextNode(el);
				if (first !== null) first.nodeValue = next;
			};

			/** 语言切换时:重新读取文案表,并立即刷新已接管的元素 */
			const refreshLocale = () => {
				const active = locale.getLocale().active;
				if (active === lastLocale) return;
				lastLocale = active;
				texts = readTexts(active);
				lastPick = "";
				log("locale →", active);
				for (const el of adopted) {
					if (!el.isConnected) {
						adopted.delete(el);
						continue;
					}
					applyText(el);
				}
			};

			const adopt = (el) => {
				if (adopted.has(el)) return;
				// 只按 role="status" 接管(页面上该角色唯一,就是状态标签)。
				// 不用文本匹配——否则会误伤聊天记录里引用 "Deep diving..." 的代码片段。
				if (el.getAttribute("role") === "status") {
					adopted.add(el);
					el.dataset.statusRotator = "adopted";
					log("adopted, 当前文本:", JSON.stringify(el.textContent.slice(0, 40)));
					applyText(el);
				}
			};

			const rotate = () => {
				const next = pick();
				if (next === null) return;
				let count = 0;
				for (const el of adopted) {
					if (!el.isConnected) {
						adopted.delete(el);
						continue;
					}
					// 每轮重新取文本节点:React 可能在结构变化时替换文本节点
					const first = firstTextNode(el);
					if (first !== null) {
						first.nodeValue = next;
						count++;
					}
				}
				if (count > 0) log("rotated →", next);
				else log("alive, 尚未接管任何元素 (adopted=" + adopted.size + ")");
			};

			const scan = (root) => {
				if (!(root instanceof Element)) return;
				for (const el of root.querySelectorAll('[role="status"]')) adopt(el);
			};

			/** 兜底轮询:每 2 秒按 role=status 重扫一次 */
			const rescanAll = () => {
				const status = document.querySelectorAll('[role="status"]');
				if (status.length !== lastSeenStatusCount) {
					lastSeenStatusCount = status.length;
					log("rescan: 状态标签 ×", status.length);
				}
				for (const el of status) adopt(el);
			};

			const observer = new MutationObserver((records) => {
				for (const record of records) {
					for (const node of record.addedNodes) {
						if (node instanceof Element) {
							// 文本匹配优先(不依赖 role),再扫嵌套的 role=status
							adopt(node);
							scan(node);
						}
					}
				}
			});

			const start = () => {
				document.documentElement.dataset.statusRotator = "active";
				observer.observe(document.body, { childList: true, subtree: true });
				scan(document.body);
				rescanAll();
				timer = setInterval(rotate, INTERVAL_MS);
				rescanner = setInterval(rescanAll, 2000);
				log("plugin active, locale =", locale.getLocale().active, ", texts =", texts);
			};

			if (document.body !== null) start();
			else {
				log("waiting for DOMContentLoaded…");
				document.addEventListener("DOMContentLoaded", start, { once: true });
			}

			// 跟随 DSH 语言设置:语言切换时立即刷新文案。
			// subscribe 在每次 locale 快照变化(含其它插件注册字典)时触发,
			// refreshLocale 内部按 active 判断,只有真正切换语言才重读文案。
			const unsubscribe = locale.subscribe(refreshLocale);

			// dsh 的 ctx.effect 会「立即执行」回调,并把回调的「返回值」当作卸载时的
			// 清理函数注册(见 cordis 中 ctx.effect(() => () => {...}) 的用法)。
			// 因此清理逻辑必须包在返回的函数里,否则 apply 一结束观察器和定时器就被
			// 立刻拆掉,文本替换永远不会生效。
			ctx.effect(() => {
				return () => {
					unsubscribe();
					observer.disconnect();
					if (timer !== null) clearInterval(timer);
					if (rescanner !== null) clearInterval(rescanner);
					adopted.clear();
				};
			}, "status-rotator: label rotation");
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
