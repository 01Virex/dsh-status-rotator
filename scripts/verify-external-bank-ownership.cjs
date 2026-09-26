#!/usr/bin/env node
/**
 * 外部词库的「归属」验证(issue #92)。
 *
 * README 承诺:外部词库是**优先级最高的词库层**,「想让某个包回到设置页管理,把该包从外部词库
 * 文件里删掉即可」。0.27.2 及以前做不到 —— 因为:
 *
 *   1. GET 返回的是**所有层合并后的整份文档**(外部词库最高),设置页又把它整份 PUT 回来;
 *   2. 保存时算「用户改动」的基准只有「内置 + 自动更新词库」,**不含外部词库层**;
 *   3. 于是词库塞进去的内容被当成用户改动写进 `$DSH_HOME/status-rotator/config.json`,
 *      而存储层优先级高于 file / remote 层 —— 词库条目删掉后,存储里那份快照顶上来;
 *   4. 镜像这一半同样中招:保存时写进包目录的 `config.json` 是「整份已生效文档」,里面也带着
 *      词库内容,单单修好差异基准还不足以让承诺成立。
 *
 * 本脚本用**真实插件代码 + 真实 HTTP 路由 + 真实外部词库文件 + 真实整份 PUT** 跑完整时间线
 * (报告人当时只跑了纯函数,没做端到端),并额外覆盖「上游自动更新层」与「用户真改动不能被压掉」
 * 两个对照。包目录用临时目录,不碰仓库里的文件。
 *
 * 运行:node scripts/verify-external-bank-ownership.cjs
 */
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = path.join(__dirname, "..");
const ROUTE = "/plugins/dsh-status-rotator/config.json";
const WORK = path.join(os.tmpdir(), "dsh-status-rotator-bank-ownership-verify");
const HOME = path.join(WORK, "home");
const BANK_FILE = path.join(HOME, "status-rotator", "phrases.json");
const REMOTE_FILE = path.join(HOME, "status-rotator", "bank.remote.json");
const STORE_FILE = path.join(HOME, "status-rotator", "config.json");
const MIRROR_FILE = path.join(WORK, "pkg", "config.json");
const PACK = "reverse-proxy";
const BANK_SENTENCE = "外部词库塞进来的一句…";
const REMOTE_SENTENCE = "上游自动更新塞进来的一句…";
const USER_SENTENCE = "用户自己在设置页写的…";

let failures = 0;
const report = (label, ok, detail) => {
	if (!ok) failures++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  →  " + detail : ""}`);
};

const bundled = JSON.parse(fs.readFileSync(path.join(REPO, "config.example.json"), "utf8"));
const bundledList = bundled.packs.find((p) => p.id === PACK).phrases.zh.running;
const listOf = (doc) => ((doc.packs || []).find((p) => p.id === PACK) || { phrases: { zh: {} } }).phrases.zh.running;
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 4) + "\n", "utf8");

/** 起一次「插件启动」:用真实 lib/index.js(从临时包目录加载,镜像才会落在临时目录里) */
async function boot() {
	let handler = null;
	let server = null;
	const node = await import(path.join(WORK, "pkg", "lib", "index.js") + "?v=" + Math.random());
	node.apply({
		effect: (cb) => cb(),
		get: (name) => (name === "webServer" ? {
			register({ path: routePath, handler: registered }) {
				if (routePath !== ROUTE) throw new Error("意外的路由注册: " + routePath);
				handler = registered;
				server = http.createServer((req, res) => handler(req, res));
				return () => {};
			}
		} : null),
		on: () => {}
	});
	if (!server) throw new Error("插件没有注册 webServer 路由");
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const base = `http://127.0.0.1:${server.address().port}${ROUTE}`;
	return {
		get: async () => (await fetch(base)).json(),
		put: async (doc) => {
			const res = await fetch(base, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) });
			return { status: res.status, body: await res.json().catch(() => null) };
		},
		close: () => new Promise((resolve) => server.close(resolve))
	};
}

(async () => {
	fs.rmSync(WORK, { recursive: true, force: true });
	fs.mkdirSync(path.join(HOME, "status-rotator"), { recursive: true });
	fs.mkdirSync(path.join(WORK, "pkg", "lib"), { recursive: true });
	fs.copyFileSync(path.join(REPO, "lib", "index.js"), path.join(WORK, "pkg", "lib", "index.js"));
	fs.copyFileSync(path.join(REPO, "config.example.json"), path.join(WORK, "pkg", "config.example.json"));
	fs.copyFileSync(path.join(REPO, "package.json"), path.join(WORK, "pkg", "package.json"));

	process.env.DSH_HOME = HOME;
	process.env.DSH_STATUS_ROTATOR_BANK = BANK_FILE;
	process.env.DSH_STATUS_ROTATOR_BANK_URL = "off";   // 上游内容用缓存文件模拟,不联网
	delete process.env.DSH_STATUS_ROTATOR_CONFIG;

	console.log("dsh-status-rotator 外部词库归属验证(issue #92;真实插件 + 真实路由 + 真实词库文件)");
	console.log("bank  : " + BANK_FILE);
	console.log("store : " + STORE_FILE);
	console.log("mirror: " + MIRROR_FILE + "\n");

	// ══ A. 外部词库的包不该被冻成用户改动 ══
	writeJson(BANK_FILE, { packs: [{ id: PACK, phrases: { zh: { running: [BANK_SENTENCE] } } }] });
	let app = await boot();
	const served = await app.get();
	report("A① 外部词库生效(GET 返回词库那句)", listOf(served).includes(BANK_SENTENCE), `running=${JSON.stringify(listOf(served))}`);

	const edited = JSON.parse(JSON.stringify(served));
	edited.config.intervalMs = 4321;                    // 只改一个**无关**设置(触发条件只需这个)
	const saved = await app.put(edited);
	report("A② 设置页整份 PUT 成功", saved.status === 200 && saved.body && saved.body.ok === true, `HTTP ${saved.status}`);

	const storeText = fs.readFileSync(STORE_FILE, "utf8");
	report("A③ 存储里不含外部词库的内容(不再算成用户改动)", !storeText.includes(BANK_SENTENCE),
		"store.packs=" + JSON.stringify((JSON.parse(storeText).packs || []).map((p) => p.id)));
	report("A④ 兼容镜像里也不含外部词库的内容", !fs.readFileSync(MIRROR_FILE, "utf8").includes(BANK_SENTENCE));
	report("A⑤ 无关设置本身照常存下来", JSON.parse(storeText).config.intervalMs === 4321);

	// 用户按 README 把该包从外部词库删掉 → 必须回到随包内容
	writeJson(BANK_FILE, { packs: [] });
	const afterBankRemoved = await app.get();
	const afterList = listOf(afterBankRemoved);
	report("A⑥ 删掉词库条目后回到随包原文(README 的承诺)", afterList[0] === bundledList[0] && !afterList.includes(BANK_SENTENCE),
		`running=${JSON.stringify(afterList)} ｜ 随包首句=${JSON.stringify(bundledList[0])}`);
	await app.close();

	// ══ B. 上游自动更新层同理(基准里含它,不该被冻住)══
	fs.rmSync(STORE_FILE, { force: true });
	fs.rmSync(MIRROR_FILE, { force: true });
	writeJson(REMOTE_FILE, { packs: [{ id: PACK, phrases: { zh: { running: [REMOTE_SENTENCE] } } }] });
	app = await boot();
	const servedRemote = await app.get();
	report("B① 上游缓存生效(GET 返回上游那句)", listOf(servedRemote).includes(REMOTE_SENTENCE), `running=${JSON.stringify(listOf(servedRemote))}`);
	const editedRemote = JSON.parse(JSON.stringify(servedRemote));
	editedRemote.config.intervalMs = 5000;
	await app.put(editedRemote);
	report("B② 存储里不含上游内容", !fs.readFileSync(STORE_FILE, "utf8").includes(REMOTE_SENTENCE));
	report("B③ 镜像里也不含上游内容", !fs.readFileSync(MIRROR_FILE, "utf8").includes(REMOTE_SENTENCE));
	fs.rmSync(REMOTE_FILE, { force: true });
	const afterRemoteRemoved = await app.get();
	report("B④ 删掉上游缓存后回到随包原文", listOf(afterRemoteRemoved)[0] === bundledList[0] && !listOf(afterRemoteRemoved).includes(REMOTE_SENTENCE),
		`running=${JSON.stringify(listOf(afterRemoteRemoved))}`);
	await app.close();

	// ══ C. 对照:用户自己改的词条不能被连带压掉 ══
	fs.rmSync(STORE_FILE, { force: true });
	fs.rmSync(MIRROR_FILE, { force: true });
	writeJson(BANK_FILE, { packs: [{ id: PACK, phrases: { zh: { running: [BANK_SENTENCE] } } }] });
	app = await boot();
	const servedUser = await app.get();
	const userEdited = JSON.parse(JSON.stringify(servedUser));
	userEdited.packs.find((p) => p.id === PACK).phrases.zh.running = [USER_SENTENCE];
	await app.put(userEdited);
	const storeUser = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
	report("C① 用户改的词条确实进了存储", JSON.stringify(storeUser).includes(USER_SENTENCE));
	// 词库里的那份仍然优先(词库层在存储之上),但把词库条目删掉后用户的改动要回来
	report("C② 词库还在时:词库的那句仍然优先", listOf(await app.get()).includes(BANK_SENTENCE));
	writeJson(BANK_FILE, { packs: [] });
	const afterUser = await app.get();
	report("C③ 删掉词库条目后,用户的改动回到设置页管理", listOf(afterUser).includes(USER_SENTENCE),
		`running=${JSON.stringify(listOf(afterUser))}`);
	await app.close();

	console.log("\n──── 结论 ────");
	console.log(failures === 0
		? "外部词库的内容不再进用户存储 / 镜像;删掉词库条目即可回到随包内容(README 承诺成立)"
		: `仍有 ${failures} 项不成立(见上面的 FAIL)`);
	fs.rmSync(WORK, { recursive: true, force: true });
	process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
	console.error(error);
	fs.rmSync(WORK, { recursive: true, force: true });
	process.exit(2);
});
