/**
 * 弹幕实时探针(dev-only,不随 npm 包发布)。
 *
 * 用 CDP 驱动无头 Chromium 打开正在运行的 dsh web 界面,把弹幕层的真实状态
 * (挂载点、层级、computed style、活动弹幕数量、命中测试)打回来。
 * 纯函数测试覆盖不到「层建出来了却看不见」这类问题,只能真浏览器看。
 *
 * 用法:
 *   node scripts/probe-danmaku-live.cjs "<http://127.0.0.1:3080/?token=...>"
 *   node scripts/probe-danmaku-live.cjs "<url>" --wait 12000 --browser "C:\...\msedge.exe"
 */
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a));
const waitMs = Number((args.find((a) => a.startsWith("--wait=")) || "--wait=12000").slice(7));
const browser = (args.find((a) => a.startsWith("--browser=")) || "").slice(10)
	|| [
		"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
		"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
		"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	].find((p) => fs.existsSync(p));

if (!url) {
	console.error("usage: node scripts/probe-danmaku-live.cjs <url-with-token> [--wait=ms] [--browser=path]");
	process.exit(2);
}
if (!browser) {
	console.error("no chromium browser found; pass --browser=<path>");
	process.exit(2);
}

const port = 9333 + Math.floor(Math.random() * 400);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-dm-probe-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROBE = `(() => {
	const layer = document.querySelector(".dsh-status-rotator-danmaku-layer");
	const items = Array.from(document.querySelectorAll(".dsh-status-rotator-danmaku-item"));
	const overlay = document.querySelector("[data-shell-overlay]");
	const frame = overlay ? overlay.parentElement : null;
	const cs = (el) => {
		if (!el) return null;
		const s = getComputedStyle(el);
		return {
			position: s.position, zIndex: s.zIndex, isolation: s.isolation, overflow: s.overflow,
			backgroundColor: s.backgroundColor, backgroundImage: (s.backgroundImage || "").slice(0, 60),
			display: s.display, opacity: s.opacity, transform: s.transform, visibility: s.visibility,
			left: s.left, top: s.top, width: s.width, height: s.height, inset: s.inset,
			pointerEvents: s.pointerEvents, animation: s.animationName,
		};
	};
	const rect = (el) => {
		if (!el) return null;
		const b = el.getBoundingClientRect();
		return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
	};
	const item = items[0] || null;
	let hit = null;
	if (item) {
		const b = item.getBoundingClientRect();
		const cx = Math.round(b.x + b.width / 2);
		const cy = Math.round(b.y + b.height / 2);
		const top = document.elementFromPoint(cx, cy);
		hit = {
			point: [cx, cy],
			top: top ? top.tagName + (top.className ? "." + String(top.className).split(" ")[0] : "") : null,
			isItem: top === item || (top !== null && item.contains(top)),
		};
		// 绘制顺序探针:pointer-events:none 的元素不会出现在命中测试里,
		// 临时把它打开,用 elementsFromPoint 的先后顺序判断弹幕到底在
		// 画底色的会话面板之上还是之下(自上而下排列,索引越小越靠上)。
		try {
			const layerPrev = layer ? layer.style.pointerEvents : "";
			const itemPrev = item.style.pointerEvents;
			if (layer) layer.style.pointerEvents = "auto";
			item.style.pointerEvents = "auto";
			const stack = document.elementsFromPoint(cx, cy);
			if (layer) layer.style.pointerEvents = layerPrev;
			item.style.pointerEvents = itemPrev;
			const idxItem = stack.indexOf(item);
			const idxPanel = stack.findIndex((el) => el.classList && el.classList.contains("wSkVaW_root"));
			const idxFrame = stack.findIndex((el) => el.classList && el.classList.contains("pI_x6G_frame"));
			hit.paintOrder = {
				stack: stack.slice(0, 8).map((el) => el.tagName + (el.className ? "." + String(el.className).split(" ")[0] : "")),
				itemIndex: idxItem,
				panelIndex: idxPanel,
				frameIndex: idxFrame,
				abovePanel: idxItem >= 0 && (idxPanel < 0 || idxItem < idxPanel),
			};
		} catch (error) {
			hit.paintOrder = { error: String(error) };
		}
	}
	const layerParent = layer && layer.parentElement;
	const siblingBg = frame
		? Array.from(frame.children).map((c) => ({
			cls: String(c.className || c.tagName).slice(0, 40),
			bg: getComputedStyle(c).backgroundColor,
			z: getComputedStyle(c).zIndex,
			pos: getComputedStyle(c).position,
			rect: rect(c),
		}))
		: null;
	return {
		href: location.href.replace(/token=[^&]+/, "token=***"),
		readyState: document.readyState,
		htmlDataset: { ...document.documentElement.dataset },
		layerCount: document.querySelectorAll(".dsh-status-rotator-danmaku-layer").length,
		itemCount: items.length,
		styleEl: document.getElementById("dsh-status-rotator-danmaku-style") !== null,
		layer: layer ? {
			parent: layerParent ? (layerParent.id || layerParent.tagName + "." + String(layerParent.className || "").split(" ")[0]) : "none",
			parentIsFrame: layerParent === frame,
			inline: { position: layer.style.position, zIndex: layer.style.zIndex },
			computed: cs(layer),
			rect: rect(layer),
		} : null,
		frame: frame ? { tag: frame.tagName, cls: String(frame.className || ""), inlineIsolation: frame.style.isolation, computed: cs(frame), rect: rect(frame) } : null,
		layerHostIsolation: layer && layer.parentElement ? layer.parentElement.style.isolation : null,
		frameChildren: siblingBg,
		item: item ? {
			text: item.textContent.slice(0, 24),
			inline: { top: item.style.top, left: item.style.left, fontSize: item.style.fontSize, color: item.style.color, opacity: item.style.opacity, transition: item.style.transition, transform: item.style.transform },
			computed: cs(item),
			rect: rect(item),
			offsetWidth: item.offsetWidth,
		} : null,
		hit,
		storage: Object.keys(localStorage).filter((k) => k.indexOf("status-rotator") >= 0),
	};
})()`;

(async () => {
	// 浏览器 stderr 写文件(不能用管道:受限沙箱里管道会 EPERM),CDP 起不来时打尾巴
	const logPath = path.join(userDataDir, "browser.log");
	const logFd = fs.openSync(logPath, "a");
	const child = spawn(browser, [
		"--headless=new", "--disable-gpu", "--no-sandbox", "--disable-extensions",
		"--no-first-run", "--disable-features=Translate",
		`--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`,
		"about:blank",
	], { stdio: ["ignore", logFd, logFd], detached: false });

	const cleanup = () => {
		try { child.kill(); } catch (error) { /* ignore */ }
		try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (error) { /* ignore */ }
	};
	process.on("exit", cleanup);

	let version = null;
	for (let i = 0; i < 60; i++) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (res.ok) { version = await res.json(); break; }
		} catch (error) { /* not up yet */ }
		await sleep(250);
	}
	if (!version) {
		console.error("browser did not expose CDP on port " + port);
		try {
			console.error("browser log:\n" + fs.readFileSync(logPath, "utf8").split("\n").slice(-15).join("\n"));
		} catch (error) { /* ignore */ }
		process.exit(3);
	}
	console.log("browser:", version["Browser"], "| protocol:", version["Protocol-Version"]);

	const created = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
	const targetId = created.id;

	const ws = new WebSocket(created.webSocketDebuggerUrl);
	let msgId = 0;
	const pending = new Map();
	const consoleLines = [];
	ws.addEventListener("message", (event) => {
		const msg = JSON.parse(event.data);
		if (msg.id && pending.has(msg.id)) {
			pending.get(msg.id)(msg);
			pending.delete(msg.id);
			return;
		}
		if (msg.method === "Runtime.consoleAPICalled") {
			consoleLines.push("[console." + msg.params.type + "] " + msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
		}
		if (msg.method === "Runtime.exceptionThrown") {
			consoleLines.push("[exception] " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
		}
	});
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});
	const send = (method, params) => new Promise((resolve) => {
		const id = ++msgId;
		pending.set(id, (msg) => resolve(msg.result ?? msg.error));
		ws.send(JSON.stringify({ id, method, params: params || {} }));
	});

	await send("Runtime.enable");
	await send("Page.enable");
	await send("Page.navigate", { url });
	await sleep(waitMs);

	const probe = await send("Runtime.evaluate", { expression: PROBE, returnByValue: true, awaitPromise: false });
	console.log("== probe ==");
	console.log(JSON.stringify(probe.result?.value ?? probe, null, 2));

	// 再等一拍,看弹幕数量是否在增长(发射器活着吗)
	const countExpr = `document.querySelectorAll(".dsh-status-rotator-danmaku-item").length`;
	const c1 = (await send("Runtime.evaluate", { expression: countExpr, returnByValue: true })).result?.value;
	await sleep(4000);
	const c2 = (await send("Runtime.evaluate", { expression: countExpr, returnByValue: true })).result?.value;
	console.log("== item count ==", c1, "→", c2, c2 > c1 ? "(发射中)" : "(未增长)");

	if (consoleLines.length > 0) {
		console.log("== page console (tail) ==");
		console.log(consoleLines.slice(-30).join("\n"));
	}
	await send("Target.closeTarget", { targetId });
	ws.close();
	cleanup();
	process.exit(0);
})().catch((error) => {
	console.error("probe failed:", error);
	process.exit(1);
});
