#!/usr/bin/env node
/**
 * (推送式热重载)与 (If-Match 并发控制)的端到端验证。
 *
 * 为什么必须端到端:这两条的被修对象都是**两个调用方之间的时序**,纯函数测不到 ——
 *   · 洞是「两个标签页基于同一份旧配置先后写入,后写无声覆盖前写」;
 *   · 洞是「推送通道断了之后,那一端停在一个没人再推的旧值上」。
 * 所以本脚本在同一个进程里 apply() 插件、起一个真实的 http server,用真实的
 * GET / PUT / SSE 长连接把这两条时间线各跑一遍。
 *
 * 运行:node scripts/verify-push-and-conflict.cjs
 */
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROUTE = "/plugins/dsh-status-rotator/config.json";
const EVENTS = "/plugins/dsh-status-rotator/events";
const WORK = path.join(os.tmpdir(), "dsh-status-rotator-push-conflict-verify");
const BANK_FILE = path.join(WORK, "bank", "phrases.json");
const STORE_FILE = path.join(WORK, "store", "config.json");
/**
 * 插件的临时包副本。为什么要复制:saveConfig 会写包目录的兼容镜像 `config.json`,
 * 而那个路径是相对 lib/index.js 硬编码的 —— 直接 import 仓库里的 lib 会把测试内容写进仓库。
 * 所有写入因此都落在 WORK 里,跑完一并删掉。
 */
const PKG_DIR = path.join(WORK, "pkg");

const SENTINEL_A = "并发写入 A 的那句…";
const SENTINEL_B = "并发写入 B 的那句…";
const SENTINEL_FILE = "手改文件塞进来的那句…";
const SENTINEL_A2 = "并发写入 A2 的那句…";
const SENTINEL_B2 = "推送用的那句…";
const SENTINEL_FILE2 = "断线期间改的那句…";

let failures = 0;
function report(label, ok, detail) {
	if (!ok) failures++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}  →  ${detail}`);
}

/** 一份只覆盖 deepseek 包 zh.thinking 的词库 */
function bankDocument(phrase) {
	return { packs: [{ id: "deepseek", phrases: { zh: { thinking: [phrase] } } }] };
}
function writeJson(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}
/** 从生效文档里取 deepseek 包 zh.thinking */
function thinkingOf(doc) {
	const pack = (doc.packs || []).find((item) => item && item.id === "deepseek");
	const list = pack && pack.phrases && pack.phrases.zh && pack.phrases.zh.thinking;
	return Array.isArray(list) ? list : [];
}

/** 连一条 SSE,把收到的事件按顺序存起来 */
async function openSse(url) {
	const controller = new AbortController();
	const response = await fetch(url, { signal: controller.signal, headers: { accept: "text/event-stream" } });
	const events = [];
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const pump = (async () => {
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let idx;
				while ((idx = buffer.indexOf("\n\n")) >= 0) {
					const frame = buffer.slice(0, idx);
					buffer = buffer.slice(idx + 2);
					for (const line of frame.split("\n")) {
						if (!line.startsWith("data: ")) continue;
						try { events.push(JSON.parse(line.slice(6))); } catch (error) { /* 非 JSON 帧(心跳注释等) */ }
					}
				}
			}
		} catch (error) { /* abort 或连接关闭 */ }
	})();
	return {
		status: response.status,
		contentType: response.headers.get("content-type") || "",
		events,
		close: () => { try { controller.abort(); } catch (error) { /* ignore */ } },
		pump
	};
}

/** 等到 events 里出现满足条件的事件 */
async function waitFor(events, predicate, timeoutMs) {
	const deadline = Date.now() + (timeoutMs || 6000);
	for (;;) {
		const hit = events.find(predicate);
		if (hit) return hit;
		if (Date.now() > deadline) return null;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

(async () => {
	fs.rmSync(WORK, { recursive: true, force: true });
	fs.mkdirSync(WORK, { recursive: true });
	process.env.DSH_STATUS_ROTATOR_BANK = BANK_FILE;
	process.env.DSH_STATUS_ROTATOR_CONFIG = STORE_FILE;
	process.env.DSH_STATUS_ROTATOR_BANK_URL = "off";   // 不碰网络

	fs.mkdirSync(PKG_DIR, { recursive: true });
	fs.cpSync(path.join(__dirname, "..", "lib"), path.join(PKG_DIR, "lib"), { recursive: true });
	fs.copyFileSync(path.join(__dirname, "..", "config.example.json"), path.join(PKG_DIR, "config.example.json"));
	const node = await import(pathToFileURL(path.join(PKG_DIR, "lib", "index.js")).href);
	const routes = new Map();
	let server = null;
	const webServer = {
		register({ path: routePath, handler }) {
			if (routes.has(routePath)) throw new Error("duplicate exact route: " + routePath);
			routes.set(routePath, handler);
			if (server === null) {
				server = http.createServer((req, res) => {
					const pathname = new URL(req.url, "http://127.0.0.1").pathname;
					const handlerFor = routes.get(pathname);
					if (!handlerFor) { res.writeHead(404); res.end(); return; }
					Promise.resolve(handlerFor(req, res)).catch(() => {
						try { res.writeHead(500); res.end(); } catch (error) { /* ignore */ }
					});
				});
			}
			return () => { routes.delete(routePath); };
		}
	};
	node.apply({
		effect: (callback) => { callback(); },
		get: (name) => (name === "webServer" ? webServer : null),
		on: () => {}
	});
	if (server === null) throw new Error("插件没有注册 webServer 路由");
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;
	const base = `http://127.0.0.1:${port}`;

	const getDoc = async (ifNoneMatch) => {
		const headers = ifNoneMatch ? { "if-none-match": ifNoneMatch } : undefined;
		const res = await fetch(base + ROUTE, { headers });
		return { status: res.status, etag: res.headers.get("etag") || "", body: res.status === 304 ? null : await res.json() };
	};
	const putDoc = async (doc, ifMatch) => {
		const headers = { "content-type": "application/json" };
		if (ifMatch !== undefined) headers["if-match"] = ifMatch;
		const res = await fetch(base + ROUTE, { method: "PUT", headers, body: JSON.stringify(doc) });
		let payload = null;
		try { payload = await res.json(); } catch (error) { /* ignore */ }
		return { status: res.status, etag: res.headers.get("etag") || "", payload };
	};

	console.log("dsh-status-rotator 推送式热重载 + If-Match 并发控制验证");
	console.log("route      : " + ROUTE);
	console.log("events     : " + EVENTS);
	console.log("store      : " + STORE_FILE);
	console.log("\n──── If-Match 前提 ────");

	// 1. GET 必须给出 ETag
	const first = await getDoc();
	report("GET 带 ETag", first.status === 200 && first.etag.length > 0, `status=${first.status}, etag=${first.etag}`);

	// 2. 带着同一个 ETag 再问 → 304(轮询兜底路径的主要开销就省在这里)
	const notModified = await getDoc(first.etag);
	report("If-None-Match 命中 → 304", notModified.status === 304, `status=${notModified.status}`);

	// 3. 不带 If-Match → 照旧无条件写(标准 HTTP:前提是客户端自愿的,既有写入方不受影响)
	const unconditional = await putDoc(bankDocument(SENTINEL_A));
	report("缺 If-Match → 200 无条件写,并回新 ETag",
		unconditional.status === 200 && unconditional.etag.length > 0 && unconditional.etag !== first.etag,
		`status=${unconditional.status}, etag=${unconditional.etag}`);

	// 4. 拿过期 ETag 写 → 409(这就是「基于旧版本的后写」)
	const stale = await putDoc(bankDocument(SENTINEL_A2), first.etag);
	report("If-Match 过期 → 409 且带当前 ETag",
		stale.status === 409 && stale.payload && stale.payload.code === "conflict" && stale.payload.etag === unconditional.etag,
		`status=${stale.status}, code=${stale.payload && stale.payload.code}`);

	// 5. 对上 → 200,并回新的 ETag
	const saved = await putDoc(bankDocument(SENTINEL_B2), unconditional.etag);
	report("If-Match 匹配 → 200 且回新 ETag",
		saved.status === 200 && saved.etag.length > 0 && saved.etag !== unconditional.etag,
		`status=${saved.status}, etag=${saved.etag}`);

	// 6. 用回给的新 ETag 继续写 → 不该被自己刚写的版本判成冲突
	const savedAgain = await putDoc(bankDocument(SENTINEL_B), saved.etag);
	report("用返回的新 ETag 续写 → 200(不会自己撞自己)", savedAgain.status === 200, `status=${savedAgain.status}`);

	// 7. 显式无条件覆盖
	const forced = await putDoc(bankDocument(SENTINEL_A), "*");
	report('If-Match: "*" → 显式无条件覆盖', forced.status === 200, `status=${forced.status}`);

	// ── 两个标签页的真实时间线 ──
	console.log("\n──── 两个标签页基于同一份旧配置先后写入 ────");
	const readA = await getDoc();
	const readB = await getDoc();
	report("两端读到同一份配置(ETag 相同)", readA.etag === readB.etag, `A=${readA.etag}, B=${readB.etag}`);
	const writeA = await putDoc(bankDocument(SENTINEL_FILE), readA.etag);
	report("A 先写 → 成功", writeA.status === 200, `status=${writeA.status}`);
	const writeB = await putDoc(bankDocument(SENTINEL_FILE2), readB.etag);
	report("B 用同一份旧配置再写 → 409 被明确拒绝", writeB.status === 409, `status=${writeB.status}, code=${writeB.payload && writeB.payload.code}`);
	const after = await getDoc();
	report("A 刚写的内容没有被 B 无声覆盖", JSON.stringify(thinkingOf(after.body)) === JSON.stringify([SENTINEL_FILE]),
		`deepseek/zh/thinking=${JSON.stringify(thinkingOf(after.body))}`);
	report("冲突响应里带着「当前该用哪个 ETag」", writeB.payload && writeB.payload.etag === after.etag, `conflict.etag=${writeB.payload && writeB.payload.etag}, now=${after.etag}`);

	// ── 推送 ──
	console.log("\n──── 服务端主动推 ────");
	report("事件路由已注册", routes.has(EVENTS));
	const stream = await openSse(base + EVENTS);
	report("SSE 连上且 content-type 正确",
		stream.status === 200 && stream.contentType.indexOf("text/event-stream") === 0,
		`status=${stream.status}, type=${stream.contentType}`);
	const hello = await waitFor(stream.events, (e) => e.type === "hello");
	report("连上先收到 hello(带当前 ETag)", !!hello && hello.etag === after.etag, `hello.etag=${hello && hello.etag}`);

	// 保存一次 → 已打开的连接应当收到推送
	const beforePush = stream.events.length;
	const pushSave = await putDoc(bankDocument("推送用的一句…"), "*");
	report("这次保存成功(为推送做准备)", pushSave.status === 200, `status=${pushSave.status}`);
	const pushed = await waitFor(stream.events, (e) => e.type === "config-changed" && e.reason === "save");
	report("保存后已打开的连接收到推送", !!pushed && !!pushed.etag && pushed.etag === pushSave.etag,
		`pushed.etag=${pushed ? pushed.etag : "(没有推送)"}, events=${stream.events.length - beforePush}`);

	// 手改文件(不经 HTTP)→ 服务端自己的变更检测也要推出去
	const beforeFilePush = stream.events.length;
	writeJson(BANK_FILE, bankDocument(SENTINEL_FILE));
	const filePush = await waitFor(stream.events, (e) => e.type === "config-changed" && e.etag && e.etag !== (pushed ? pushed.etag : ""));
	report("手改词库文件后也能推出去(不靠客户端轮询)", !!filePush, `events=${stream.events.length - beforeFilePush}`);

	// ── 断线重连:那一端必须回到与当前配置一致的状态 ──
	console.log("\n──── 断线期间的变更,重连后必须能发现 ────");
	stream.close();
	await stream.pump.catch(() => {});
	// 断开期间再改一次。注意改的必须是**外部词库文件**:它的层级高于用户配置存储,
	// 往存储里写是盖不过它的 —— 一开始这里就写错了,有效文档根本没变。
	writeJson(BANK_FILE, bankDocument(SENTINEL_A2));
	// 文件变更由服务端的变更检测发现,等它把有效 ETag 推新(没人订阅时也会更新内部值)
	let missedEtag = null;
	const missDeadline = Date.now() + 8000;
	for (;;) {
		const probe = await getDoc();
		if (probe.etag !== after.etag) { missedEtag = probe.etag; break; }
		if (Date.now() > missDeadline) break;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	report("断线期间发生了一次变更(有效文档真的变了)", missedEtag !== null, `断线前=${after.etag}, 变更后=${missedEtag || "(没变)"}`);
	const missed = { etag: missedEtag };
	const reconnect = await openSse(base + EVENTS);
	const hello2 = await waitFor(reconnect.events, (e) => e.type === "hello");
	report("重连的 hello 带的是**当前** ETag(不是断线前那个)",
		!!hello2 && hello2.etag === missed.etag && hello2.etag !== after.etag,
		`断线前=${after.etag}, 重连后=${hello2 ? hello2.etag : "(没收到 hello)"}`);
	reconnect.close();
	await reconnect.pump.catch(() => {});

	server.close();
	fs.rmSync(WORK, { recursive: true, force: true });
	if (failures > 0) {
		console.error(`\nVERIFY FAILED: ${failures} 项不通过`);
		process.exit(1);
	}
	console.log("\nVERIFIED:配置变更由服务端主动推出(含手改文件与断线重连);基于旧版本的写入被 409 明确拒绝,不会无声覆盖");
	// 必须显式退出:插件的变更检测 setInterval 还挂着,等事件循环自己排空是等不到的
	process.exit(0);
})().catch((error) => {
	console.error(error);
	fs.rmSync(WORK, { recursive: true, force: true });
	process.exit(2);
});
