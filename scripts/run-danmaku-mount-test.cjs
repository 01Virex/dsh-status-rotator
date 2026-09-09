/**
 * 真浏览器跑弹幕挂载回归页(dev-only,不随 npm 包发布)。
 *
 * scripts/danmaku-mount-test.html 需要 Chromium 内核浏览器;这个脚本用 CDP
 * 无头驱动它,把几档时序各跑一遍,读回 <title> 里的断言结果。
 *
 * 用法:
 *   node scripts/run-danmaku-mount-test.cjs [--browser=<path>] [--wait=3500]
 */
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const args = process.argv.slice(2);
const waitMs = Number((args.find((a) => a.startsWith("--wait=")) || "--wait=3500").slice(7));
const browser = (args.find((a) => a.startsWith("--browser=")) || "").slice(10)
	|| [
		"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
		"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
		"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
		"/usr/bin/google-chrome",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
	].find((p) => fs.existsSync(p));
if (!browser) {
	console.error("no chromium browser found; pass --browser=<path>");
	process.exit(2);
}

/** --page=danmaku(默认)| label */
const pages = {
	danmaku: {
		file: "danmaku-mount-test.html",
		scenarios: [
			{ label: "外壳与面板同步出现", query: "?frameDelay=0&panelDelay=0" },
			{ label: "面板晚于外壳出现(升级重试)", query: "?frameDelay=1200&panelDelay=600" },
			{ label: "外壳不画底色面板(退回主框架)", query: "?frameDelay=1200&panel=0" },
			{ label: "外壳永不出现(body 兜底层)", query: "?frameDelay=-1" },
		]
	},
	label: {
		file: "label-layout-test.html",
		scenarios: [
			{ label: "渐变生效 + 打字机锁宽", query: "?case=gradient" },
			{ label: "配色非法 → 回退宿主 shimmer", query: "?case=inject" },
			{ label: "超长文案 → 收窄 + 淡出", query: "?case=overflow" },
		]
	}
};
const pageName = (args.find((a) => a.startsWith("--page=")) || "--page=danmaku").slice(7);
const page = pages[pageName] || pages.danmaku;
const scenarios = page.scenarios;
const pageUrl = pathToFileURL(path.join(__dirname, page.file)).href;

// 让浏览器自己挑端口(--remote-debugging-port=0),再从 DevToolsActivePort 读回:
// 固定区间(如 9800-9950)在部分 Windows 上落在 Hyper-V 保留端口里,bind() 会直接失败。
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-mount-test-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
	const logFd = fs.openSync(path.join(userDataDir, "browser.log"), "a");
	const child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
		"--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "--window-size=1280,800", "about:blank"],
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

	let failed = 0;
	for (const scenario of scenarios) {
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
		await send("Page.enable");
		await send("Page.navigate", { url: pageUrl + scenario.query });
		await sleep(waitMs);
		// 结果以 window.__RESULTS__ 为准:插件的「标题」功能会在 title 被改后
		// 把 document.title 还原成原值(它把页面标题当作自己的地盘),所以
		// title 只作参考,断言用页面里的数组(#verdict 与之一致)。
		const results = (await send("Runtime.evaluate", { expression: "JSON.stringify(window.__RESULTS__ || null)", returnByValue: true })).result?.value;
		let parsed = null;
		try { parsed = JSON.parse(results); } catch (error) { /* ignore */ }
		const pass = Array.isArray(parsed) && parsed.length > 0 && parsed.every((r) => r.pass);
		if (!pass) {
			failed++;
			const verdict = (await send("Runtime.evaluate", { expression: "(document.getElementById('verdict')||{}).textContent || document.title", returnByValue: true })).result?.value;
			console.log("      diag: " + (results || "(no results)") + " | verdict=" + verdict);
		}
		console.log((pass ? "PASS " : "FAIL ") + scenario.label);
		for (const r of parsed || []) console.log("      " + (r.pass ? "✓ " : "✗ ") + r.name + (r.extra ? " [" + r.extra + "]" : ""));
		await send("Target.closeTarget", { targetId: created.id });
		ws.close();
	}

	cleanup();
	console.log(failed === 0 ? "\n全部通过" : `\n${failed} 档失败`);
	process.exit(failed === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
