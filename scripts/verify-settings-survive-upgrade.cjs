#!/usr/bin/env node
/**
 * 最小可复现验证:「手改 config.json 的设置,升级后会丢」—— issue #51 那条评论
 * (xiaijiangxue,2026-09-22 14:17Z:「更新到最新的版本,设置又回退了,比如弹幕这个」)。
 *
 * 运行:node scripts/verify-settings-survive-upgrade.cjs
 *
 * 为什么单独起一档:仓库里 `scripts/smoke-test.cjs` 覆盖的是**设置页保存**那条路径
 * (settingsDeltaFor 并入上一次差异,v0.23.3 修的),它现在是绿的;而 README 明确允许
 * 「调文案或选项,可以直接改文件」,那条路径**没人管**:
 *
 *   1. `config.json` 只是 serve 时的**文件层**,改完立刻生效;
 *   2. 把它搬进设置存储的 `trimSettingsSection` 是**一次性**迁移 —— 见到
 *      `settingsVersion` 标记就直接 return(lib/index.js:`if (raw[SETTINGS_VERSION_KEY]
 *      === SETTINGS_VERSION) return;`),之后再改文件也不会再搬;
 *   3. 升级时包目录被整体换掉:npm 包里没有 `config.json`(发布产物 13 个文件里没有它),
 *      Release 的 zip 里那份是 `config.example.json` 的拷贝(`danmaku.enabled: true`)。
 *   → 只在文件里改过的设置没了,随包默认值顶回来(关掉的弹幕又打开)。
 *
 * 本脚本用**真实插件代码**跑这条时间线,只替换宿主框架(settings / webServer 两个服务,
 * 以及 @deepseek-ai/schemastery、@deepseek-ai/dsh-settings 两个宿主包的最小替身),
 * 迁移 / 合并 / 路由全是真跑的。包目录用的是临时目录,不会碰仓库里的文件。
 *
 * 场景:
 *   A(报告人说法)手改 config.json → 升级 → 期望设置还在。**当前实现会失败**。
 *   B(用过设置页的人)存储里已有 section + settingsVersion 标记,再手改 config.json
 *     → 升级。同一个回合里:**设置页存的那项活下来、手改的那项丢** —— 这直接把
 *     「一次性导入被标记关死」这件事坐实。**当前实现也会失败**。
 *   C(对照)从设置页保存 → 升级 → 期望设置还在。应当通过 —— 证明缺陷只在文件那条路径,
 *     不是整条持久化都坏了。
 */
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const REPO = path.join(__dirname, "..");
const ROUTE = "/plugins/dsh-status-rotator/config.json";
const NS = "status-rotator";
const WORK = path.join(os.tmpdir(), "dsh-status-rotator-settings-upgrade-verify");

let failures = 0;
function report(label, ok, detail) {
	if (!ok) failures++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  →  " + detail : ""}`);
}
const log = (...args) => console.log("      ", ...args);

/** 宿主包的最小替身:schemastery 只要能链式调用, dsh-settings 只要能解析命名空间 */
const STUBS = {
	"@deepseek-ai/schemastery": {
		"package.json": JSON.stringify({ name: "@deepseek-ai/schemastery", version: "0.0.0", type: "module", main: "index.js" }),
		"index.js": "export default { object: () => ({ loose: () => ({}) }) };\n"
	},
	"@deepseek-ai/dsh-settings": {
		"package.json": JSON.stringify({ name: "@deepseek-ai/dsh-settings", version: "0.0.0", type: "module", main: "index.js" }),
		"index.js": "export function settingsNamespace(name) { return name; }\nexport default { settingsNamespace };\n"
	}
};

/** 造一个「已安装好的插件包目录」:与 npm 包同形 —— lib/ + config.example.json + package.json,**没有** config.json */
function makePackageDir(dir) {
	fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
	fs.copyFileSync(path.join(REPO, "lib", "index.js"), path.join(dir, "lib", "index.js"));
	fs.copyFileSync(path.join(REPO, "config.example.json"), path.join(dir, "config.example.json"));
	fs.copyFileSync(path.join(REPO, "package.json"), path.join(dir, "package.json"));
	for (const [name, files] of Object.entries(STUBS)) {
		const at = path.join(dir, "node_modules", name);
		fs.mkdirSync(at, { recursive: true });
		for (const [file, body] of Object.entries(files)) fs.writeFileSync(path.join(at, file), body);
	}
}

/** settings 服务替身:document 就是「$DSH_HOME/settings.yaml 里 status-rotator 那一段」的原文 */
function makeSettings() {
	const document = {};
	return {
		document,
		register(ns) {
			return {
				get: () => (document[ns] && typeof document[ns] === "object" ? JSON.parse(JSON.stringify(document[ns])) : {}),
				replace: (next) => { document[ns] = JSON.parse(JSON.stringify(next)); }
			};
		},
		raw: () => document[NS]
	};
}

function makeWebServer() {
	let server = null;
	return {
		register({ path: routePath, handler }) {
			if (routePath !== ROUTE) throw new Error("意外的路由注册:" + routePath);
			server = http.createServer((req, res) => handler(req, res));
			return () => { try { server.close(); } catch (error) { /* ignore */ } };
		},
		listen: async () => {
			await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
			return server.address().port;
		}
	};
}

/**
 * 起一次「插件启动」:用真实 lib/index.js(可以是新目录、也可以是同一路径的新实例),
 * 只把 settings / webServer 两个服务换成替身。
 */
async function boot({ pkgDir, homeDir, settings, cacheKey }) {
	process.env.DSH_HOME = homeDir;
	process.env.DSH_STATUS_ROTATOR_BANK = path.join(homeDir, "status-rotator", "phrases.json");
	process.env.DSH_STATUS_ROTATOR_BANK_URL = "off";        // 关掉上游自动更新(测试不联网)
	process.env.DSH_STATUS_ROTATOR_BANK_INTERVAL_MS = "0";

	const webServer = makeWebServer();
	const url = pathToFileURL(path.join(pkgDir, "lib", "index.js")).href + (cacheKey ? "?v=" + cacheKey : "");
	const node = await import(url);
	node.apply({
		effect: (callback) => callback(),
		get: (name) => (name === "webServer" ? webServer : name === "settings" ? settings : null),
		on: () => {}
	});
	const port = await webServer.listen();
	return {
		document: async () => {
			const response = await fetch(`http://127.0.0.1:${port}${ROUTE}`);
			if (!response.ok) throw new Error(`GET ${ROUTE} → ${response.status}`);
			return response.json();
		}
	};
}

/** 「升级」:包目录被整体替换成新版本 —— 里面同样没有 config.json(npm 包就是这样) */
function upgradePackage(pkgDir, pristineDir) {
	fs.rmSync(pkgDir, { recursive: true, force: true });
	fs.cpSync(pristineDir, pkgDir, { recursive: true });
}

async function scenario(name, { seed, edit }) {
	console.log(`\n── 场景 ${name} ──`);
	const root = path.join(WORK, name);
	fs.rmSync(root, { recursive: true, force: true });
	fs.mkdirSync(path.join(root, "home", "status-rotator"), { recursive: true });
	const pkgDir = path.join(root, "pkg");
	const pristineDir = path.join(root, "pkg-pristine");
	makePackageDir(pkgDir);
	fs.cpSync(pkgDir, pristineDir, { recursive: true });

	const settings = makeSettings();
	// seed:这次启动之前,设置存储里已经有什么(模拟「以前用过设置页」)
	if (seed) settings.document[NS] = JSON.parse(JSON.stringify(seed));

	// ① 第一次启动(旧版本):弹幕是开的;迁移逻辑这时会跑一遍(有 section 且带标记就直接 return)
	const first = await boot({ pkgDir, homeDir: path.join(root, "home"), settings, cacheKey: 0 });
	const before = await first.document();
	report(`[${name}] ① 首装:弹幕默认开启`, before.config.danmaku.enabled === true, "danmaku.enabled=" + before.config.danmaku.enabled);
	const seededMarker = seed ? seed.settingsVersion : undefined;
	report(`[${name}] ① 启动后设置存储里那段`,
		JSON.stringify(settings.raw()) === JSON.stringify(seed === null ? undefined : seed),
		"stored=" + JSON.stringify(settings.raw()) + (seededMarker === undefined ? "(还没有 section —— 用户没用过设置页)" : "(已带标记,一次性导入从此不再跑)"));

	// ② 用户改设置
	if (edit === "file") {
		// README 允许的用法:直接改插件目录里的 config.json(只覆盖要改的那几项)
		fs.writeFileSync(path.join(pkgDir, "config.json"), JSON.stringify({ config: { danmaku: { enabled: false } } }, null, 2));
		log("已在包目录写入 config.json: config.danmaku.enabled = false");
	} else {
		// 设置页保存:差异进设置存储(升级保留)
		settings.document[NS] = { config: { danmaku: { enabled: false } }, settingsVersion: 2 };
		log("已在设置存储写入: config.danmaku.enabled = false");
	}
	const edited = await first.document();
	report(`[${name}] ② 改完当下确实生效`, edited.config.danmaku.enabled === false, "danmaku.enabled=" + edited.config.danmaku.enabled);
	if (seed && seed.config && typeof seed.config.intervalMs === "number") {
		report(`[${name}] ② 设置页存过的那项也在`, edited.config.intervalMs === seed.config.intervalMs, "intervalMs=" + edited.config.intervalMs);
	}

	// ③ 升级:包目录整体换掉(新目录里没有 config.json),重新加载模块(同一路径、新实例)
	upgradePackage(pkgDir, pristineDir);
	report(`[${name}] ③ 升级后包目录里没有 config.json(与 npm 包一致)`,
		!fs.existsSync(path.join(pkgDir, "config.json")), "pkg=" + pkgDir);

	// ④ 升级后第一次启动:设置还在吗?
	const second = await boot({ pkgDir, homeDir: path.join(root, "home"), settings, cacheKey: 1 });
	const after = await second.document();
	report(`[${name}] ④ 升级后【手改/设置页】的那项仍在(期望 danmaku.enabled=false)`,
		after.config.danmaku.enabled === false,
		"danmaku.enabled=" + after.config.danmaku.enabled + ",settings.yaml 里那段=" + JSON.stringify(settings.raw()));
	if (seed && seed.config && typeof seed.config.intervalMs === "number") {
		report(`[${name}] ④ 升级后【设置页存过】的那项仍在(同一次升级的对照)`,
			after.config.intervalMs === seed.config.intervalMs,
			"intervalMs=" + after.config.intervalMs + "(期望 " + seed.config.intervalMs + ")");
	}
	return after.config.danmaku.enabled === false;
}

(async () => {
	fs.rmSync(WORK, { recursive: true, force: true });
	fs.mkdirSync(WORK, { recursive: true });
	console.log("dsh-status-rotator 设置跨升级存活验证(真实插件代码 + 替身宿主,包目录在临时目录)");
	console.log("work dir   : " + WORK);

	const fileOnly = await scenario("A 手改 config.json(没用过设置页)", { seed: null, edit: "file" });
	const fileAfterPage = await scenario("B 手改 config.json(用过设置页:存储里已有 section)", {
		seed: { config: { intervalMs: 12345 }, settingsVersion: 2 },
		edit: "file"
	});
	const storedOnly = await scenario("C 设置页保存(对照)", { seed: null, edit: "settings" });

	console.log("\n──── 结论 ────");
	console.log(`场景 A(没用过设置页,只手改 config.json):${fileOnly ? "设置保住了" : "**设置丢了(弹幕被打开)**"}`);
	console.log(`场景 B(用过设置页,再手改 config.json):${fileAfterPage ? "设置保住了" : "**手改的那项丢了**,而同一次升级里设置页存的 intervalMs 活了下来"}`);
	console.log(`场景 C(设置页保存,对照):${storedOnly ? "设置保住了(v0.23.3 修的那条路径没问题)" : "设置也丢了(说明问题更大)"}`);
	console.log("\nA / B 失败、C 通过 ⇒ 缺陷只在「文件层改动没人搬进设置存储」这条路:" +
		"lib/index.js 的 trimSettingsSection 是一次性迁移,rawSection 为空时直接 return," +
		"带 settingsVersion 标记时也直接 return —— 而升级会把包目录里的 config.json 整体换掉" +
		"(npm 包里没有它,Release zip 里那份是 danmaku.enabled: true 的默认值)。");

	fs.rmSync(WORK, { recursive: true, force: true });
	process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
	console.error(error);
	fs.rmSync(WORK, { recursive: true, force: true });
	process.exit(1);
});
