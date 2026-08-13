/**
 * dsh-status-rotator — browser half.
 *
 * While a DSH chat turn is running, the conversation UI shows a small
 * status label ("Deep diving...") plus, after 15 seconds, an elapsed-time
 * clock. The label text itself is hardcoded decoration and carries no real
 * information, so this plugin swaps it for a random phrase from your list,
 * rotating every INTERVAL_MS. The elapsed-time clock is left untouched.
 *
 * ── Customize the phrase list ─────────────────────────────────────────────
 * 1. Edit DEFAULT_TEXTS below (and INTERVAL_MS for the rotation speed),
 *    save, then hard-refresh the page (Ctrl+F5). No server restart needed.
 * 2. Or set the list at runtime from the browser console — this wins over
 *    the built-in list and never touches any file:
 *      localStorage.setItem("dsh-status-rotator.texts",
 *        JSON.stringify(["正在思考…", "正在写代码…", "摸鱼中…"]))
 *      location.reload()
 */
window.__ModuleLoader__.load({
	id: "dsh-status-rotator",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		// ── 在这里编辑你的文本列表(保存后 Ctrl+F5 刷新页面) ──
		const DEFAULT_TEXTS = [
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
		];

		/** 每隔多少毫秒换一句 */
		const INTERVAL_MS = 10000;
		/** localStorage 覆盖键 */
		const STORAGE_KEY = "dsh-status-rotator.texts";
		/** 诊断日志开关:true 时在浏览器控制台输出 [status-rotator] 日志 */
		const DEBUG = true;

		/** Cordis plugin name. */
		const name = "status-rotator";
		/** 无需注入任何服务 */
		const inject = [];

		/** 读取文本列表:localStorage 优先,否则用内置列表 */
		function readTexts() {
			try {
				const raw = localStorage.getItem(STORAGE_KEY);
				if (raw !== null) {
					const parsed = JSON.parse(raw);
					if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((s) => typeof s === "string" && s.length > 0)) {
						return parsed;
					}
				}
			} catch (error) {
				/* 忽略损坏数据,回退到内置列表 */
			}
			return DEFAULT_TEXTS;
		}

		/**
		 * 找到并接管对话流里的运行状态标签:
		 * TurnStatus 渲染为一个 role="status" + aria-live="polite" 的 div,
		 * 第一个子节点是文案文本节点;运行 15 秒后第二个子节点会出现时钟
		 * span。我们只替换文本节点,时钟不受影响。
		 * 注意:页面上 role="status" 并不唯一(输入栏 notice、重试行、回合
		 * 错误提示等 aria-live 区域也用它),必须叠加 aria-live="polite"
		 * 才能精确定位 TurnStatus。
		 */
		function apply(ctx) {
			const log = (...args) => {
				if (DEBUG) console.log("[status-rotator]", ...args);
			};
			const adopted = new Set();
			let texts = readTexts();
			let lastPick = "";
			let timer = null;
			let rescanner = null;
			let lastSeenStatusCount = -1;

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

			const adopt = (el) => {
				if (adopted.has(el)) return;
				// 只接管 TurnStatus:role="status" + aria-live="polite" 的组合
				// 在页面上唯一。不能只按 role="status" 匹配——输入栏 notice、
				// 重试行、回合错误提示等 aria-live 区域也用它,会把它们的真实
				// 状态文案一并换掉;也不能按文本匹配——聊天记录里引用
				// "Deep diving..." 的代码片段会被误伤。
				if (el.getAttribute("role") === "status" && el.getAttribute("aria-live") === "polite") {
					adopted.add(el);
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
				for (const el of root.querySelectorAll('[role="status"][aria-live="polite"]')) adopt(el);
			};

			/** 兜底轮询:每 2 秒按 TurnStatus 选择器重扫一次 */
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
					for (const node of record.addedNodes) {
						if (node instanceof Element) {
							// 新增节点本身可能是目标,也可能嵌套着目标
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
				log("plugin active, texts =", texts);
			};

			if (document.body !== null) start();
			else {
				log("waiting for DOMContentLoaded…");
				document.addEventListener("DOMContentLoaded", start, { once: true });
			}

			// dsh 的 ctx.effect 会「立即执行」回调,并把回调的「返回值」当作卸载时的
			// 清理函数注册(见 cordis 中 ctx.effect(() => () => {...}) 的用法)。
			// 因此清理逻辑必须包在返回的函数里,否则 apply 一结束观察器和定时器就被
			// 立刻拆掉,文本替换永远不会生效。
			ctx.effect(() => {
				return () => {
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