/**
 * 真浏览器跑 dsh 0.1.7 状态行回归页(dev-only,不随 npm 包发布)。
 *
 * scripts/turn-process-017-test.html 复刻 dsh 0.1.7 的 TurnProcessNodeView
 * (隐藏读屏公告 span + button[data-turn-process] 里的可见标签,宿主每秒重写
 * 同一个文本节点)。这个脚本用 CDP 无头驱动它,把几档场景各跑一遍,
 * 读回 window.__RESULTS__ 里的断言结果。
 *
 * 用法:
 *   node scripts/run-turn-process-test.cjs [--browser=<path>] [--wait=4200]
 */
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const args = process.argv.slice(2);
const waitMs = Number((args.find((a) => a.startsWith("--wait=")) || "--wait=4200").slice(7));

/** Playwright 的浏览器缓存(CI / Linux 上常见),按版本号从新到旧挑 */
const playwrightCandidates = () => {
	const out = [];
	for (const root of [path.join(os.homedir(), ".cache", "ms-playwright"), "/ms-playwright"]) {
		let entries = [];
		try { entries = fs.readdirSync(root); } catch (error) { return out; }
		for (const name of entries.sort().reverse()) {
			if (!name.startsWith("chromium-")) continue;   // headless_shell 不支持 --headless=new
			out.push(path.join(root, name, "chrome-linux", "chrome"));
			out.push(path.join(root, name, "chrome-linux64", "chrome"));
		}
	}
	return out;
};

const browser = (args.find((a) => a.startsWith("--browser=")) || "").slice(10)
	|| [
		"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
		"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
		"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
		"/usr/bin/google-chrome",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
		...playwrightCandidates(),
	].find((p) => fs.existsSync(p));
if (!browser) {
	console.error("no chromium browser found; pass --browser=<path>");
	process.exit(2);
}

/** 场景:全部跑一遍(每个都独立开页,避免状态串味) */
const scenarios = [
	{ label: "0.1.7 运行中:状态行插到输入框上方(旧版位置)+ 宿主重写后仍在", query: "?case=running" },
	{ label: "0.1.7 起步:时长 <15s → thinking 分组", query: "?case=thinking" },
	{ label: "0.1.7 长回合:时长 ≥ longAfterMs → long 分组", query: "?case=long" },
	{ label: "0.1.7 中文宿主:zh 标签/时长前缀实时解析", query: "?case=zh" },
	{ label: "0.1.7 回合结束:状态行撤掉、折叠头恢复显示", query: "?case=finished", waitMs: 5000 },
	{ label: "旧宿主(≤0.1.6 role=status div)向后兼容、不额外插行", query: "?case=old-host" },
	{ label: "0.1.5 共存(折叠头是计数摘要):只走旧路径、不动折叠头", query: "?case=015-coexist" },
	{ label: "降级(输入框座位缺失):不藏宿主状态、不硬插状态行", query: "?case=no-seat" },
	{ label: "观测通道:llm/retry → 状态行重试徽标(出现/跟随/清空)", query: "?case=retry", waitMs: 5000 },
	{ label: "观测通道兼容:旧宿主(≤0.1.6)也显示重试徽标", query: "?case=retry-old-host", waitMs: 5000 },
	{ label: "观测通道降级:无会话事件窗口 → 不显示徽标、不猜次数", query: "?case=no-events" },
];
const pageUrl = pathToFileURL(path.join(__dirname, "turn-process-017-test.html")).href;

// 让浏览器自己挑端口(--remote-debugging-port=0),再从 DevToolsActivePort 读回:
// 固定区间(如 9800-9950)在部分 Windows 上落在 Hyper-V 保留端口里,bind() 会直接失败。
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-turn-process-test-"));
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
		await sleep(scenario.waitMs || waitMs);
		// 结果以 window.__RESULTS__ 为准(页面每 500ms 重跑一遍断言;#verdict 与之一致)
		const results = (await send("Runtime.evaluate", { expression: "JSON.stringify(window.__RESULTS__ || null)", returnByValue: true })).result?.value;
		let parsed = null;
		try { parsed = JSON.parse(results); } catch (error) { /* ignore */ }
		const pass = Array.isArray(parsed) && parsed.length > 0 && parsed.every((r) => r.pass);
		if (!pass) {
			failed++;
			const verdict = (await send("Runtime.evaluate", { expression: "(document.getElementById('verdict')||{}).textContent || document.title", returnByValue: true })).result?.value;
			console.log("      diag: " + String(verdict).slice(0, 900));
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
