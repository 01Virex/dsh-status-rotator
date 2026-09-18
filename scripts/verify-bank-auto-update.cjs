#!/usr/bin/env node
/**
 * 最小可复现验证:词库自动更新。
 *
 * 运行:node scripts/verify-bank-auto-update.cjs
 *
 * 插件在后台定时拉取上游词库(`DSH_STATUS_ROTATOR_BANK_URL`,默认仓库 main 分支的
 * config.example.json),变了才原子写盘并立即生效;任何失败都保留上一次成功的词库。
 * 本脚本起一个本地"上游"(http server,内容可切换)、把 URL 指向它、间隔设为 300ms,
 * 然后在一个 node 进程里按顺序验证:
 *   1. 上游 A        → GET 读到 A(启动后自动拉取)
 *   2. 上游改成 B    → GET 读到 B(变更被拉到)
 *   3. 手写本地词库 C → GET 读到 C(本地优先,自动更新不覆盖手改)
 *   4. 上游开始 500   → 删掉本地词库 → GET 仍是 B(失败保留上一次成功词库)
 * 全程不重启进程、不重装包、不重发 npm 包。
 */
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROUTE = "/plugins/dsh-status-rotator/config.json";
const WORK_DIR = path.join(os.tmpdir(), "dsh-status-rotator-auto-update-verify");
const BANK_FILE = path.join(WORK_DIR, "phrases.json");
const CACHE_FILE = path.join(WORK_DIR, "bank.remote.json");
const INTERVAL_MS = 300;

const SENTINEL_A = "自动更新词库 A…";
const SENTINEL_B = "自动更新词库 B…";
const SENTINEL_C = "手动覆盖词库 C…";

/** 上游文档:只声明 deepseek 包的一个阶段 */
function upstreamBody(phrase) {
	return JSON.stringify({ packs: [{ id: "deepseek", phrases: { zh: { thinking: [phrase] } } }] });
}

/** 取某个包某个阶段的文案列表(缺包/缺阶段 → 空数组) */
function thinkingOf(doc, packId) {
	const pack = (doc.packs || []).find((item) => item && item.id === packId);
	const thinking = pack && pack.phrases && pack.phrases.zh && pack.phrases.zh.thinking;
	return Array.isArray(thinking) ? thinking : [];
}

let failures = 0;
function report(label, ok, detail) {
	if (!ok) failures++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}  →  ${detail}`);
}

(async () => {
	fs.rmSync(WORK_DIR, { recursive: true, force: true });
	fs.mkdirSync(WORK_DIR, { recursive: true });

	// 本地上游:body 可切换;broken=true 时返回 500
	let upstreamDoc = upstreamBody(SENTINEL_A);
	let broken = false;
	const upstream = http.createServer((req, res) => {
		if (broken) {
			res.writeHead(500, { "content-type": "text/plain" });
			res.end("upstream down");
			return;
		}
		res.writeHead(200, { "content-type": "application/json" });
		res.end(upstreamDoc);
	});
	await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
	const upstreamPort = upstream.address().port;

	process.env.DSH_STATUS_ROTATOR_BANK = BANK_FILE;
	process.env.DSH_STATUS_ROTATOR_BANK_URL = `http://127.0.0.1:${upstreamPort}/config.example.json`;
	process.env.DSH_STATUS_ROTATOR_BANK_INTERVAL_MS = String(INTERVAL_MS);

	const node = await import("../lib/index.js");
	let server = null;
	let serverRestarts = 0;
	const webServer = {
		register({ path: routePath, handler }) {
			if (routePath !== ROUTE) throw new Error("意外的路由注册: " + routePath);
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
	const pluginPort = server.address().port;

	async function getDocument() {
		const response = await fetch(`http://127.0.0.1:${pluginPort}${ROUTE}`);
		if (!response.ok) throw new Error(`GET ${ROUTE} → ${response.status}`);
		return response.json();
	}
	/** 轮询直到谓词成立(自动更新是后台异步的,给它几个 tick) */
	async function waitFor(predicate, label, timeoutMs = 8000) {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const doc = await getDocument();
			if (predicate(doc)) return doc;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		return null;
	}
	/** 轮询自动更新状态(等一次失败被记录) */
	async function waitForStatus(predicate, timeoutMs = 8000) {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const status = node.remoteBankStatus();
			if (predicate(status)) return status;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		return null;
	}

	console.log("dsh-status-rotator 词库自动更新验证(单进程,不重启、不重装、不重发 npm 包)");
	console.log("upstream   : 本地测试上游(http server,可切换 A / B / 500)");
	console.log("bank file  : " + BANK_FILE);
	console.log("cache file : " + CACHE_FILE);
	console.log("interval   : " + INTERVAL_MS + "ms");

	// 1. 启动后自动拉到上游 A
	const docA = await waitFor((doc) => JSON.stringify(thinkingOf(doc, "deepseek")) === JSON.stringify([SENTINEL_A]), "上游 A");
	report("启动后自动拉到上游词库 A", docA !== null,
		`deepseek/zh/thinking=${JSON.stringify(docA ? thinkingOf(docA, "deepseek") : null)},updates=${node.remoteBankStatus().updates}`);

	// 2. 上游改成 B → 自动更新
	upstreamDoc = upstreamBody(SENTINEL_B);
	const docB = await waitFor((doc) => JSON.stringify(thinkingOf(doc, "deepseek")) === JSON.stringify([SENTINEL_B]), "上游 B");
	report("上游改成 B 后自动更新", docB !== null,
		`deepseek/zh/thinking=${JSON.stringify(docB ? thinkingOf(docB, "deepseek") : null)},updates=${node.remoteBankStatus().updates}`);

	// 3. 手写本地词库优先级最高,自动更新不覆盖
	fs.writeFileSync(BANK_FILE, JSON.stringify({ packs: [{ id: "deepseek", phrases: { zh: { thinking: [SENTINEL_C] } } }] }) + "\n", "utf8");
	const docC = await waitFor((doc) => JSON.stringify(thinkingOf(doc, "deepseek")) === JSON.stringify([SENTINEL_C]), "本地词库 C");
	report("手写本地词库优先,不被自动更新覆盖", docC !== null,
		`deepseek/zh/thinking=${JSON.stringify(docC ? thinkingOf(docC, "deepseek") : null)}`);

	// 4. 上游失败 → 保留上一次成功词库(删掉本地词库后应回到 B)
	broken = true;
	fs.rmSync(BANK_FILE, { force: true });
	const failedStatus = await waitForStatus((status) => typeof status.lastError === "string");
	const docFallback = await getDocument();
	report("上游 500 时保留上一次成功词库", failedStatus !== null && JSON.stringify(thinkingOf(docFallback, "deepseek")) === JSON.stringify([SENTINEL_B]),
		`deepseek/zh/thinking=${JSON.stringify(thinkingOf(docFallback, "deepseek"))},lastError="${failedStatus ? failedStatus.lastError : "（未记录）"}"`);

	// 5. 全程一个进程、一份缓存
	const finalStatus = node.remoteBankStatus();
	report("单进程完成,自动更新缓存已落盘", serverRestarts === 1 && fs.existsSync(CACHE_FILE) && finalStatus.updates === 2,
		`server 注册次数=${serverRestarts},cache 存在=${fs.existsSync(CACHE_FILE)},updates=${finalStatus.updates}`);

	server.close();
	upstream.close();
	fs.rmSync(WORK_DIR, { recursive: true, force: true });
	if (failures > 0) {
		console.error(`\nVERIFY FAILED: ${failures} 项不通过`);
		process.exit(1);
	}
	console.log("\nVERIFIED: 词库自动更新生效(不重启进程、不重装包、不重发 npm 包)");
})().catch((error) => {
	console.error("VERIFY FAILED:", (error && error.stack) || error);
	process.exit(1);
});
