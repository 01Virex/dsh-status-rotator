/**
 * 真浏览器回归页的 CDP 驱动(dev-only,不随 npm 包发布)。
 *
 * 仓库里的浏览器回归页(scripts/*-test.html)都是「页面自己跑断言 + 把清单放进
 * window.__RESULTS__」的形态;这个模块负责:找到 Chromium → 无头拉起来 → 等页面置位
 * window.__RESULTS_DONE__ → 读回清单并判定。抽成公共件是因为每个 runner 各写一遍
 * 启动/CDP/超时逻辑,改一处要改五个文件。
 *
 * 用法:
 *   const { runPageTest } = require("./browser-test-runner.cjs");
 *   runPageTest({ file: "issue-144-disabled-pack-test.html", label: "issue #144 自动落点" });
 *
 * 可用 --browser=<path> 指定浏览器,--wait=<ms> 指定导航后的初始等待。
 * 同一页要跑多个场景时用 options.query(如 "?empty=1"),runner 会拼在 cacheBust 之前;
 * runPageTest 只跑一个场景,跑完即 process.exit,所以多场景由调用方自己起子进程循环。
 */
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

/** 按优先级找 Chromium 内核浏览器(系统级 → Playwright 缓存) */
function findBrowser(explicit) {
	if (explicit) return fs.existsSync(explicit) ? explicit : "";
	return [
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
		"/usr/bin/google-chrome",
		"/usr/bin/google-chrome-stable",
		// Playwright 缓存里的 Chromium(本机 / CI 常备,不必系统级安装)
		...(process.env.HOME ? [
			path.join(process.env.HOME, ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome"),
			path.join(process.env.HOME, ".cache/ms-playwright/chromium-1243/chrome-linux/chrome"),
		] : []),
	].find((p) => fs.existsSync(p));
}

/**
 * 跑一页浏览器回归。
 * @param {{file: string, label: string, query?: string, timeoutMs?: number, waitMs?: number, argv?: string[]}} options
 * @returns {Promise<never>} 直接 process.exit(通过 0 / 失败 1 / 环境问题 2·3·4)
 */
async function runPageTest(options) {
	const argv = options.argv || process.argv.slice(2);
	const waitMs = Number((argv.find((a) => a.startsWith("--wait=")) || "--wait=" + (options.waitMs || 2500)).split("=")[1]);
	const timeoutMs = options.timeoutMs || 30000;
	const browser = options.browser || findBrowser((argv.find((a) => a.startsWith("--browser=")) || "").split("=").slice(1).join("="));
	if (!browser) {
		console.error("no chromium browser found; pass --browser=<path>");
		return { pass: false, missingBrowser: true };
	}

	const pageUrl = pathToFileURL(path.join(__dirname, options.file)).href;
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-sr-browser-"));
	const logFd = fs.openSync(path.join(userDataDir, "browser.log"), "a");
	const child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
		"--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "--window-size=1280,900", "about:blank"],
	{ stdio: ["ignore", logFd, logFd] });
	let childAlive = true;
	const cleanup = () => {
		try { if (childAlive) child.kill(); } catch (error) { /* ignore */ }
		childAlive = false;
		try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (error) { /* ignore */ }
	};
	// 浏览器起不来时也要收尾,否则临时目录与进程会留在机器上
	const onExit = () => cleanup();
	process.on("exit", onExit);

	try {
		let port = 0;
		for (let i = 0; i < 80; i++) {
			const portFile = path.join(userDataDir, "DevToolsActivePort");
			if (fs.existsSync(portFile)) {
				const first = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
				if (first) { port = Number(first); break; }
			}
			await sleep(250);
		}
		if (port > 0) {
			try { await fetch(`http://127.0.0.1:${port}/json/version`); } catch (error) { port = 0; }
		}
		if (!port) {
			console.error("browser did not expose CDP; log tail:");
			try { console.error(fs.readFileSync(path.join(userDataDir, "browser.log"), "utf8").split("\n").slice(-12).join("\n")); } catch (error) { /* ignore */ }
			return { pass: false, noCdp: true };
		}

		const created = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" })).json();
		const ws = new WebSocket(created.webSocketDebuggerUrl);
		let id = 0;
		const pending = new Map();
		ws.addEventListener("message", (event) => {
			const msg = JSON.parse(event.data);
			if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
		});
		await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
		const send = (method, params) => new Promise((res) => {
			const i = ++id;
			pending.set(i, (msg) => res(msg.result ?? msg.error));
			ws.send(JSON.stringify({ id: i, method, params: params || {} }));
		});

		const consoleErrors = [];
		await send("Runtime.enable");
		await send("Log.enable");
		ws.addEventListener("message", (event) => {
			const msg = JSON.parse(event.data);
			if (msg.method === "Runtime.exceptionThrown") {
				consoleErrors.push(String(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || "exception"));
			}
		});

		await send("Page.enable");
		const query = options.query || "";
		await send("Page.navigate", { url: pageUrl + query + (query ? "&" : "?") + "cacheBust=" + Date.now() });
		await sleep(waitMs);

		// 页面自己宣告「断言跑完了」;无头下定时器会被降频,固定等待会读到一份
		// 「被截断但全过」的假阳性清单 —— 那是最危险的假阳性,所以等这个标记。
		let timedOut = false;
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const done = (await send("Runtime.evaluate", { expression: "window.__RESULTS_DONE__ === true", returnByValue: true })).result?.value;
			if (done === true) break;
			if (Date.now() > deadline) { timedOut = true; break; }
			await sleep(250);
		}

		const results = (await send("Runtime.evaluate", { expression: "JSON.stringify(window.__RESULTS__ || null)", returnByValue: true })).result?.value;
		let parsed = null;
		try { parsed = JSON.parse(results); } catch (error) { /* ignore */ }
		if (timedOut) {
			parsed = (Array.isArray(parsed) ? parsed : []).concat([{ name: "断言清单在超时前跑完(截断 = 失败)", pass: false, extra: "done flag 未置位" }]);
		}
		const pass = Array.isArray(parsed) && parsed.length > 0 && parsed.every((r) => r.pass);

		for (const r of parsed || []) console.log((r.pass ? "  ✓ " : "  ✗ ") + r.name + (r.extra ? " [" + r.extra + "]" : ""));
		if (consoleErrors.length) console.log("  ! 页面异常: " + consoleErrors.join(" | "));
		console.log(pass
			? `PASS ${options.label}(${(parsed || []).length} 项断言)`
			: `FAIL ${options.label}`);
		ws.close();
		// 这里刻意不等 closeTarget 的回执:目标页已经读完,关不关得掉不该拖住 runner。
		try { send("Target.closeTarget", { targetId: created.id }); } catch (error) { /* ignore */ }
		return { pass, count: (parsed || []).length };
	} finally {
		cleanup();
		process.removeListener("exit", onExit);
	}
}

/** 单场景入口:跑完按结果 process.exit(通过 0 / 失败 1 / 缺浏览器 2 / 无 CDP 3) */
async function runPageTestAndExit(options) {
	const r = await runPageTest(options);
	process.exit(r.missingBrowser ? 2 : r.noCdp ? 3 : r.pass ? 0 : 1);
}

module.exports = { findBrowser, runPageTest, runPageTestAndExit };
