#!/usr/bin/env node
/**
 * `appearance.fontSize: 0`(跟随宿主)必须能存下来 —— 两半口径一致性验证。
 *
 * 为什么需要它:0 是 `config.example.json` 的**出厂默认**("跟随宿主"),客户端半边一直
 * 放行它(`lib/client.js` 里 `raw.fontSize === 0 ? 0 : …`),但服务端半边的合并段把它当成
 * "小于下限 8" 夹掉了。结果是:设置页选 0 当场生效、保存后服务端落盘 8、刷新回退 8px,
 * 而且**全程没有报错** —— 用户只会以为设置没存住(issue #129)。
 *
 * 这类 bug 的特征是「两半各有一套钳制规则,只在某个边界值上分叉」,肉眼看不出来,所以这里
 * 分三层钉住:
 *
 *   两半口径   对一串 fontSize 取值,客户端归一 与 服务端校验 的结果必须逐点相同
 *   0 的语义   0 → 0(两半都是),且其余取值仍按 8~96 钳制 —— 豁免没有把范围放宽
 *   真往返     GET 整份文档 → 改 config.appearance.fontSize → 整份 PUT 回去 → 再 GET,
 *              并直接读**落盘的存储文件**。注意:值回到与出厂默认相同时,用户增量会整块
 *              消失(这是对的) —— 契约是「不残留被夹过的 8」+「读回来是 0」,而不是存储里
 *              字面写着 0。
 *
 * 运行:node scripts/verify-appearance-zero.cjs
 */
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const ROUTE = "/plugins/dsh-status-rotator/config.json";
const EVENTS = "/plugins/dsh-status-rotator/events";
const WORK = path.join(os.tmpdir(), "dsh-status-rotator-appearance-zero-verify");
const PKG_DIR = path.join(WORK, "pkg");
const HOME_DIR = path.join(WORK, "home");

let failures = 0;
const report = (name, pass, extra) => {
	console.log(`  ${pass ? "✓" : "✗"} ${name}${extra ? "  — " + extra : ""}`);
	if (!pass) failures++;
};
const section = (title) => console.log(`\n== ${title} ==`);

// ── 浏览器半边(纯函数层):与 smoke-test 同一套 vm 沙箱 ──
const clientSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "client.js"), "utf8");
let exports_ = null;
const sandbox = {
	window: {
		__ModuleLoader__: {
			load: (definition) => {
				const require = (name) => {
					if (name === "react") {
						return {
							useState: () => null, useEffect: () => null, useCallback: (fn) => fn,
							useRef: () => ({ current: null }), createElement: () => null
						};
					}
					throw new Error("verify-appearance-zero 意外 require: " + name);
				};
				exports_ = definition.factory(require);
			}
		}
	},
	document: {
		createElement: () => ({ classList: { contains: () => false, toggle: () => {} }, setAttribute: () => {}, appendChild: () => {}, remove: () => {}, style: {}, textContent: "" }),
		documentElement: { dataset: {} },
		addEventListener: () => {},
		querySelectorAll: () => [],
		body: null,
		head: { appendChild: () => {} }
	},
	localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
	navigator: {},
	console,
	setTimeout,
	clearTimeout,
	setInterval,
	clearInterval,
	fetch: async () => ({ ok: false, status: 404 }),
	Element: class Element {},
	MutationObserver: class MutationObserver { observe() {} disconnect() {} }
};
vm.createContext(sandbox);
vm.runInContext(clientSrc, sandbox, { filename: "client.js" });

const T = exports_.__test;
if (!T) {
	console.error("FAIL: client.js 未导出 __test");
	process.exit(1);
}

(async () => {
	fs.rmSync(WORK, { recursive: true, force: true });
	fs.mkdirSync(PKG_DIR, { recursive: true });
	// 临时包副本:保存路径会写包目录的兼容镜像 config.json,直接 import 仓库里的 lib 会把测试内容写进仓库
	fs.cpSync(path.join(__dirname, "..", "lib"), path.join(PKG_DIR, "lib"), { recursive: true });
	fs.copyFileSync(path.join(__dirname, "..", "config.example.json"), path.join(PKG_DIR, "config.example.json"));
	process.env.DSH_HOME = HOME_DIR;
	process.env.DSH_STATUS_ROTATOR_BANK = path.join(HOME_DIR, "status-rotator", "phrases.json");
	process.env.DSH_STATUS_ROTATOR_BANK_URL = "off";
	process.env.DSH_STATUS_ROTATOR_BANK_INTERVAL_MS = "0";
	delete process.env.DSH_STATUS_ROTATOR_CONFIG;

	const node = await import(pathToFileURL(path.join(PKG_DIR, "lib", "index.js")).href);
	const storeFile = path.join(HOME_DIR, "status-rotator", "config.json");

	/** 客户端半边对同一个块的归一结果 */
	const clientSize = (value) => {
		const normalized = T.normalizeAppearance({ fontSize: value });
		return normalized ? normalized.fontSize : undefined;
	};
	/** 服务端半边对同一个块的校验结果 */
	const nodeSize = (value) => {
		const out = node.sanitizeConfigDocument({ config: { appearance: { fontSize: value } } });
		const appearance = out && out.config && out.config.appearance;
		return appearance ? appearance.fontSize : undefined;
	};

	console.log("dsh-status-rotator appearance.fontSize = 0(跟随宿主)验证");

	// ───────────────────────────────────────────────────────────────────────────
	section("两半口径:同一串取值必须逐点相同");
	// ───────────────────────────────────────────────────────────────────────────
	{
		const samples = [-100, -8, -1, 0, 1, 4, 7.4, 8, 8.5, 15, 72, 96, 96.6, 200, 1000];
		const mismatched = samples.filter((value) => clientSize(value) !== nodeSize(value));
		report(`${samples.length} 个取值上客户端归一 == 服务端校验`, mismatched.length === 0,
			mismatched.length === 0
				? "无分叉"
				: mismatched.map((value) => `${value}: client=${clientSize(value)} node=${nodeSize(value)}`).join(" | "));

		// 非数字:两半都应剔除该键(而不是留下一个被钳过的数)
		const nonNumbers = [undefined, null, "0", "12", NaN, Infinity, {}, []];
		const drifted = nonNumbers.filter((value) => clientSize(value) !== nodeSize(value));
		report("非数字取值上两半同样一致(都剔除)", drifted.length === 0,
			drifted.length === 0 ? "无分叉" : drifted.map((v) => `${JSON.stringify(v)}: client=${clientSize(v)} node=${nodeSize(v)}`).join(" | "));

		report("两半的 APPEARANCE_LIMITS.fontSize 是同一个范围",
			JSON.stringify(T.APPEARANCE_LIMITS.fontSize) === JSON.stringify([8, 96]),
			"client=" + JSON.stringify(T.APPEARANCE_LIMITS.fontSize));
	}

	// ───────────────────────────────────────────────────────────────────────────
	section("0 的语义:0 = 跟随宿主,其余仍按 8~96 钳制");
	// ───────────────────────────────────────────────────────────────────────────
	report("客户端:0 → 0", clientSize(0) === 0, String(clientSize(0)));
	report("服务端:0 → 0", nodeSize(0) === 0, String(nodeSize(0)));
	report("服务端:1 → 8(豁免没有放宽下限)", nodeSize(1) === 8, String(nodeSize(1)));
	report("服务端:4 → 8", nodeSize(4) === 8, String(nodeSize(4)));
	report("服务端:7.4 → 8(四舍五入后仍在下限)", nodeSize(7.4) === 8, String(nodeSize(7.4)));
	report("服务端:200 → 96(上限不变)", nodeSize(200) === 96, String(nodeSize(200)));
	report("服务端:72 → 72(区间内原样)", nodeSize(72) === 72, String(nodeSize(72)));
	report("服务端:负数 → 8(不是 0,所以照样钳制)", nodeSize(-1) === 8, String(nodeSize(-1)));
	{
		const preset = node.sanitizeConfigDocument({ presets: [{ id: "p1", config: { appearance: { fontSize: 0 } } }] });
		report("预设内的 fontSize:0 同样是 0", preset.presets[0].config.appearance.fontSize === 0,
			JSON.stringify(preset.presets[0].config.appearance));
	}

	// ───────────────────────────────────────────────────────────────────────────
	section("真往返:整份文档 PUT 回去,并按 issue 的命令读落盘文件");
	// ───────────────────────────────────────────────────────────────────────────
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
	const base = `http://127.0.0.1:${server.address().port}`;

	const getDocument = async () => {
		const response = await fetch(base + ROUTE);
		if (!response.ok) throw new Error(`GET ${ROUTE} → ${response.status}`);
		return response.json();
	};
	/** 设置页保存:浏览器把**整份文档** PUT 回来 */
	const save = async (doc) => {
		const response = await fetch(base + ROUTE, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(doc)
		});
		return response.status;
	};
	const readStore = () => JSON.parse(fs.readFileSync(storeFile, "utf8"));
	const storedSize = () => {
		const store = readStore();
		const appearance = store && store.config && store.config.appearance;
		return appearance ? appearance.fontSize : undefined;
	};

	// 1) 全新状态下保存 0:它等于出厂默认,不该产生任何多余的用户增量
	{
		const doc = await getDocument();
		doc.config.appearance = Object.assign({}, doc.config.appearance, { fontSize: 0 });
		const status = await save(doc);
		report("全新状态保存 fontSize:0 返回 200", status === 200, "status=" + status);
		const after = await getDocument();
		report("读回仍是 0(默认值不因保存而变成 8)", after.config.appearance.fontSize === 0,
			"GET → " + after.config.appearance.fontSize);
		const store = readStore();
		report("没有把出厂默认值写成一个用户增量(存储里没有 8)",
			storedSize() !== 8, "store.config.appearance=" + JSON.stringify(store.config && store.config.appearance));
	}

	// 2) 先设成 72(产生用户增量),再选回 0 —— issue 的复现路径与验证命令
	{
		const doc = await getDocument();
		doc.config.appearance = Object.assign({}, doc.config.appearance, { fontSize: 72 });
		await save(doc);
		report("保存 72 → 落盘 72", storedSize() === 72, "store=" + JSON.stringify(storedSize()));
		const back = await getDocument();
		back.config.appearance = Object.assign({}, back.config.appearance, { fontSize: 0 });
		await save(back);
		// 注意:值回到与出厂默认相同时,用户增量里**不该留残值** —— 存储里整个 appearance 键
		// 被去掉是正确结果(而不是"没存上")。契约是:不能残留被夹过的 8,且读回来必须是 0。
		report("再选回 0 → 存储里不残留 8(增量回到默认就清空)",
			storedSize() !== 8, "store.config.appearance=" + JSON.stringify(readStore().config && readStore().config.appearance));
		const after = await getDocument();
		report("读回 0(刷新 / 重连后不回退成 8) —— issue 的关键现象",
			after.config.appearance.fontSize === 0, "GET → " + JSON.stringify(after.config.appearance));
	}

	// 3) 非 0 值照旧钳制 —— 修复没有顺手改掉邻接行为
	{
		const doc = await getDocument();
		doc.config.appearance = Object.assign({}, doc.config.appearance, { fontSize: 4 });
		await save(doc);
		const after = await getDocument();
		report("保存 fontSize:4 → 落盘并读回 8(下限照旧)", after.config.appearance.fontSize === 8,
			"GET → " + after.config.appearance.fontSize);
	}

	// 4) 预设里的 0 也要活下来
	{
		const doc = await getDocument();
		doc.presets = [{ id: "verify-zero", name: "verify-zero", config: { appearance: { fontSize: 0 } } }];
		await save(doc);
		const after = await getDocument();
		const preset = (after.presets || []).find((item) => item && item.id === "verify-zero");
		report("预设里的 fontSize:0 也存得住", !!preset && preset.config.appearance.fontSize === 0,
			preset ? "preset → " + JSON.stringify(preset.config.appearance) : "预设没找到");
	}

	server.close();
	fs.rmSync(WORK, { recursive: true, force: true });
	if (failures > 0) {
		console.error(`\nVERIFY FAILED: ${failures} 项不通过`);
		process.exit(1);
	}
	console.log("\nVERIFIED:0 = 跟随宿主能落盘并读回,两半口径逐点一致,其余取值仍按 8~96 钳制");
	process.exit(0);
})().catch((error) => {
	console.error(error);
	fs.rmSync(WORK, { recursive: true, force: true });
	process.exit(2);
});
