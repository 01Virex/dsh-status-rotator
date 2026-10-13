/**
 * 真浏览器跑 issue #141 共存回归页(dev-only,不随 npm 包发布)。
 *
 * scripts/issue-141-coexist-test.html 需要 Chromium 内核浏览器;这个脚本用 CDP
 * 无头驱动它,读回 window.__RESULTS__(不看源码文本,只看计算样式与布局盒)。
 *
 * 用法:
 *   node scripts/run-issue-141-coexist-test.cjs [--browser=<path>] [--wait=2500]
 */
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const args = process.argv.slice(2);
const waitMs = Number((args.find((a) => a.startsWith("--wait=")) || "--wait=2500").slice(7));
const browser = (args.find((a) => a.startsWith("--browser=")) || "").slice(10)
	|| [
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
		"/usr/bin/google-chrome",
		// Playwright 缓存里的 Chromium(本机 / CI 常备,不必系统级安装)
		...(process.env.HOME ? [
			path.join(process.env.HOME, ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome"),
			path.join(process.env.HOME, ".cache/ms-playwright/chromium-1243/chrome-linux/chrome"),
		] : []),
	].find((p) => fs.existsSync(p));
if (!browser) {
	console.error("no chromium browser found; pass --browser=<path>");
	process.exit(2);
}

const pageUrl = pathToFileURL(path.join(__dirname, "issue-141-coexist-test.html")).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-141-"));
	const logFd = fs.openSync(path.join(userDataDir, "browser.log"), "a");
	const child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
		"--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "--window-size=1280,900", "about:blank"],
	{ stdio: ["ignore", logFd, logFd] });
	const cleanup = () => { try { child.kill(); } catch (error) { /* ignore */ } try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (error) { /* ignore */ } };
	process.on("exit", cleanup);

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
		process.exit(3);
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
	await send("Page.navigate", { url: pageUrl + "?cacheBust=" + Date.now() });
	await sleep(waitMs);

	// 页面自己宣告「断言跑完了」;无头下定时器会被降频,固定等待会读到一份
	// 「被截断但全过」的假阳性清单 —— 那是最危险的假阳性,所以等这个标记。
	let timedOut = false;
	const deadline = Date.now() + 30000;
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
		? `PASS issue #141 共存回归(${(parsed || []).length} 项断言)`
		: "FAIL issue #141 共存回归");
	ws.close();
	// 这里刻意不等 closeTarget 的回执:目标页已经读完,关不关得掉不该拖住 runner。
	try { send("Target.closeTarget", { targetId: created.id }); } catch (error) { /* ignore */ }
	cleanup();
	process.exit(pass ? 0 : 1);
})().catch((error) => {
	console.error("runner 异常:", error);
	process.exit(4);
});
