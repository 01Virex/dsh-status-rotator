#!/usr/bin/env node
/**
 * 最小可复现验证:外部词库文件改动后,同一个 node 进程(不重启进程、不重装 npm 包)
 * 就能通过插件真实的 HTTP 路由 serve 出新内容。
 *
 * 运行:node scripts/verify-phrase-hot-reload.cjs
 *
 * 原理:node 半区把"外部词库"作为可选覆盖层加载(`DSH_STATUS_ROTATOR_BANK`,
 * 默认 `$DSH_HOME/status-rotator/phrases.json`),每次请求比对文件 mtime/内容,
 * 变了就重载;内置词库(config.example.json)始终是兜底。浏览器半区每
 * `reloadIntervalMs` 自动重读该路由,所以页面保持打开时无需刷新、无需重启。
 *
 * 本脚本在同一个进程里 apply() 插件、起一个真实的 http server,并按顺序
 * GET → 写外部词库 → GET → 改写 → GET;进程与 server 都不重启。
 */
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROUTE = "/plugins/dsh-status-rotator/config.json";
const BANK_DIR = path.join(os.tmpdir(), "dsh-status-rotator-hot-reload-verify");
const BANK_FILE = path.join(BANK_DIR, "phrases.json");

const SENTINEL_A = "正在热重载词库 A…";
const SENTINEL_B = "正在热重载词库 B…";
const BUILT_IN = "正在飞唐杰马…";

/** 取某个包某个阶段的文案列表(缺包/缺阶段 → 空数组) */
function thinkingOf(doc, packId) {
	const pack = (doc.packs || []).find((item) => item && item.id === packId);
	const thinking = pack && pack.phrases && pack.phrases.zh && pack.phrases.zh.thinking;
	return Array.isArray(thinking) ? thinking : [];
}

/** 写一份只覆盖 deepseek 包 zh.thinking 的外部词库 */
function writeBank(phrase) {
	fs.writeFileSync(BANK_FILE, JSON.stringify({
		packs: [{ id: "deepseek", phrases: { zh: { thinking: [phrase] } } }]
	}, null, 2) + "\n", "utf8");
}

let failures = 0;
function report(label, ok, detail) {
	if (!ok) failures++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}  →  ${detail}`);
}

(async () => {
	fs.rmSync(BANK_DIR, { recursive: true, force: true });
	fs.mkdirSync(BANK_DIR, { recursive: true });
	process.env.DSH_STATUS_ROTATOR_BANK = BANK_FILE;

	const node = await import("../lib/index.js");
	let handler = null;
	let server = null;
	let serverRestarts = 0;
	const webServer = {
		register({ path: routePath, handler: registered }) {
			if (routePath !== ROUTE) throw new Error("意外的路由注册: " + routePath);
			handler = registered;
			server = http.createServer((req, res) => handler(req, res));
			serverRestarts++;
			return () => {};
		}
	};
	node.apply({
		effect: (callback) => { callback(); },
		get: (name) => (name === "webServer" ? webServer : null),
		on: () => {}
	});
	if (!server) throw new Error("插件没有注册 webServer 路由");
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;

	async function getDocument() {
		const response = await fetch(`http://127.0.0.1:${port}${ROUTE}`);
		if (!response.ok) throw new Error(`GET ${ROUTE} → ${response.status}`);
		return response.json();
	}

	console.log("dsh-status-rotator 外部词库热重载验证(单进程,不重启、不重装包)");
	console.log("route      : " + ROUTE);
	console.log("bank file  : " + BANK_FILE);

	// 1. 外部词库不存在 → 内置词库兜底
	const before = await getDocument();
	const builtIn = thinkingOf(before, "china-ai");
	report("未创建外部词库,内置词库兜底", builtIn.includes(BUILT_IN) && !builtIn.includes(SENTINEL_A),
		`china-ai 含「${BUILT_IN}」=${builtIn.includes(BUILT_IN)},含「${SENTINEL_A}」=${builtIn.includes(SENTINEL_A)}`);

	// 2. 写入外部词库 A → 同一个进程的下一次 GET 就能读到
	writeBank(SENTINEL_A);
	const afterA = await getDocument();
	const thinkingA = thinkingOf(afterA, "deepseek");
	report("写入外部词库 A 后立即 GET", JSON.stringify(thinkingA) === JSON.stringify([SENTINEL_A]),
		`deepseek/zh/thinking=${JSON.stringify(thinkingA)},reloads=${node.externalBankStatus().reloads}`);

	// 3. 改写为外部词库 B → 变更被检测到并重载
	writeBank(SENTINEL_B);
	const afterB = await getDocument();
	const thinkingB = thinkingOf(afterB, "deepseek");
	report("改写为外部词库 B 后再次 GET", JSON.stringify(thinkingB) === JSON.stringify([SENTINEL_B]),
		`deepseek/zh/thinking=${JSON.stringify(thinkingB)},reloads=${node.externalBankStatus().reloads}`);

	// 4. 全程同一个进程 / 同一个 server
	const status = node.externalBankStatus();
	report("进程与路由 server 均未重启", serverRestarts === 1 && status.reloads === 2,
		`server 注册次数=${serverRestarts},外部词库重载次数=${status.reloads}`);

	server.close();
	fs.rmSync(BANK_DIR, { recursive: true, force: true });
	if (failures > 0) {
		console.error(`\nVERIFY FAILED: ${failures} 项不通过`);
		process.exit(1);
	}
	console.log("\nVERIFIED: 改动外部词库后,不重启进程、不重装包即可读到新内容");
})().catch((error) => {
	console.error("VERIFY FAILED:", error && error.stack || error);
	process.exit(1);
});
