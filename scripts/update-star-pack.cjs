#!/usr/bin/env node
/**
 * update-star-pack.cjs — 把 GitHub stargazers 刷进「星标者路由」词库包。
 *
 * 重建 config.example.json 里的两个 star 词库包(默认都不启用):
 *   - star-ask   纯求 star 文案(定义在下方 STATIC,可自行调整);
 *   - star-route 每位 stargazer 一条:
 *                   正在路由 <login> 写代码…   /   Routing <login> to write code…
 *                (login 过长时自动改用短句型,保持词库风格的省略号结尾)
 *
 * 注意:GitHub 的 stargazers 接口现在强制要求认证,且只有对该仓库有访问权的
 * 账号(仓库所有者 / 协作者)才拿得到名单 —— 请用 --token 或环境变量
 * GH_TOKEN / GITHUB_TOKEN 提供 PAT(fine-grained 只需 Metadata: Read)。
 * 仓库自带的 `.github/workflows/star-pack.yml` 用 Actions 的 GITHUB_TOKEN 跑,
 * 无需自备 PAT;没有网络/令牌时也可以用 --names 从本地名单离线重建。
 *
 * 用法:
 *   node scripts/update-star-pack.cjs                # 拉取线上星标名单并更新 config.example.json
 *   node scripts/update-star-pack.cjs --dry-run      # 只预览,不写文件
 *   node scripts/update-star-pack.cjs --local        # 同时把 star 包并入本地 config.json
 *   node scripts/update-star-pack.cjs --token <pat>  # 或环境变量 GH_TOKEN / GITHUB_TOKEN
 *   node scripts/update-star-pack.cjs --names s.json # 离线:从 JSON 数组 / 每行一个 login 的文件读取
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const REPO = "01Virex/dsh-status-rotator";
const EXAMPLE = path.join(ROOT, "config.example.json");
const LOCAL = path.join(ROOT, "config.json");
const ASK_PACK_ID = "star-ask";
const ROUTE_PACK_ID = "star-route";
const ASK_PACK_LABEL = { zh: "求 star", en: "Star asks" };
const ROUTE_PACK_LABEL = { zh: "星标者路由", en: "Stargazer routing" };
/** v0.15.1 的单包写法,升级时移除 */
const LEGACY_PACK_ID = "star";
const STAR_PACK_IDS = [ASK_PACK_ID, ROUTE_PACK_ID];

/** 纯求 star 文案(全部权重 1,与词库其余词条一致) */
const STATIC = {
	zh: {
		thinking: [
			"正在向你讨一个 star…",
			"求个 star 再赶路…",
			"star 已到账,干劲十足…",
			"正在用 star 发电…",
			"星星在等你点亮…",
			"点个 star 再走呗…",
			"正在向 GitHub 仓库飞奔…",
			"正在 github 上等你点星…",
			"已加星用户,优先加速…"
		],
		running: ["仍在等你那个 star…"],
		long: ["想要星星想到自闭…"]
	},
	en: {
		thinking: [
			"Begging for a star…",
			"Running on pure star power…",
			"Powered by stargazers…",
			"Converting stars into electricity…",
			"Starring you back…",
			"Routing to 01Virex/dsh-status-rotator…",
			"Starring the repo dsh-status-rotator…",
			"github.com/01Virex/dsh-status-rotator…",
			"Stargazers get priority routing…",
			"Posting new phrases to the repo issues…"
		],
		running: ["Still waiting for your star…"],
		long: ["Star-deprived and slowly shrieking…"]
	}
};

/**
 * 每个 stargazer 一条。句型固定、名字两侧一律带空格 —— 之前按名字长度分三档
 * (短名不加空格)导致同一份词库里「正在路由01Virex写代码…」和
 * 「正在路由 1251639747jm-ctrl 写代码…」混排,评审一眼就能看出不齐。
 * 名字是数据(可达 20+ 字符),长度上限由 scripts/check-bank-memes.mjs 对
 * star-route 包单独放宽,不再靠删空格来凑字数。
 */
function zhNamePhrase(name) {
	return `正在路由 ${name} 写代码…`;
}
function enNamePhrase(name) {
	return `Routing ${name} to write code…`;
}

/** 纯求 star 包 */
function buildAskPack() {
	return {
		id: ASK_PACK_ID,
		label: { ...ASK_PACK_LABEL },
		phrases: {
			zh: {
				thinking: [...STATIC.zh.thinking],
				running: [...STATIC.zh.running],
				long: [...STATIC.zh.long]
			},
			en: {
				thinking: [...STATIC.en.thinking],
				running: [...STATIC.en.running],
				long: [...STATIC.en.long]
			}
		}
	};
}

/** 星标者路由包:每位星标者一条(进 thinking) */
function buildRoutePack(names) {
	return {
		id: ROUTE_PACK_ID,
		label: { ...ROUTE_PACK_LABEL },
		phrases: {
			zh: { thinking: names.map(zhNamePhrase) },
			en: { thinking: names.map(enNamePhrase) }
		}
	};
}

/** 包内词条数(三个阶段合计) */
function packCount(pack, lang) {
	const table = pack && pack.phrases ? pack.phrases[lang] : null;
	if (!table) return 0;
	return ["thinking", "running", "long"].reduce((sum, phase) => sum + (Array.isArray(table[phase]) ? table[phase].length : 0), 0);
}

/**
 * 把两个 star 包合并进文档:
 * - 移除 v0.15.1 的单包 `star`;
 * - upsert star-ask / star-route(保留用户可能改过的 label,只刷新 phrases);
 * - 两个 star 包默认不启用:文档没有 enabledPacks(= 全部启用)时补一份
 *   「除 star 包以外」的显式列表;已有列表则从中剔除 star 包。
 */
function applyStarPacks(doc, askPack, routePack) {
	if (!doc || typeof doc !== "object") return doc;
	if (!Array.isArray(doc.packs)) doc.packs = [];
	doc.packs = doc.packs.filter((p) => !(p && (p.id === LEGACY_PACK_ID || STAR_PACK_IDS.includes(p.id))));
	for (const pack of [askPack, routePack]) {
		const existing = doc.packs.find((p) => p && p.id === pack.id);
		if (existing) existing.phrases = pack.phrases;
		else doc.packs.push(pack);
	}
	const allIds = doc.packs.map((p) => p && p.id).filter((id) => typeof id === "string");
	doc.enabledPacks = (Array.isArray(doc.enabledPacks) ? doc.enabledPacks : allIds)
		.filter((id) => typeof id === "string" && !STAR_PACK_IDS.includes(id));
	return doc;
}

function readDoc(file) {
	const raw = fs.readFileSync(file, "utf8");
	return { doc: JSON.parse(raw), eol: raw.includes("\r\n") ? "\r\n" : "\n" };
}

function writeDoc(file, doc, eol) {
	fs.writeFileSync(file, JSON.stringify(doc, null, 4).replace(/\n/g, eol) + eol, "utf8");
}

function readToken(args) {
	if (args.token) return args.token;
	if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
	return process.env.GITHUB_TOKEN || "";
}

/** 离线名单:JSON 数组(或 {names:[…]}),或每行一个 login 的纯文本 */
function readNamesFile(file) {
	const raw = fs.readFileSync(file, "utf8");
	let list = null;
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) list = parsed;
		else if (parsed && Array.isArray(parsed.names)) list = parsed.names;
	} catch (error) { /* 不是 JSON:按纯文本处理 */ }
	if (!Array.isArray(list)) list = raw.split(/\r?\n/);
	return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** GitHub API:分页拉取 stargazers(需认证) */
async function fetchStargazers(token) {
	const headers = { "user-agent": "dsh-status-rotator-star-pack", accept: "application/vnd.github+json" };
	if (token) headers.authorization = `Bearer ${token}`;
	const names = [];
	let page = 1;
	for (;;) {
		const url = `https://api.github.com/repos/${REPO}/stargazers?per_page=100&page=${page}`;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 20000);
		let response;
		try {
			response = await fetch(url, { headers, signal: controller.signal });
		} finally {
			clearTimeout(timer);
		}
		if (response.status === 401) throw new Error("GitHub 要求认证:请用 --token 或环境变量 GH_TOKEN / GITHUB_TOKEN 提供 PAT");
		if (response.status === 403) throw new Error(`GitHub API 限额耗尽(HTTP 403),稍后重试或换 token`);
		if (response.status === 404) throw new Error("stargazers 接口返回 404:该令牌所属账号无权读取本仓库星标名单(需仓库所有者/协作者令牌,或改用 Actions 里的 GITHUB_TOKEN)");
		if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
		const list = await response.json();
		names.push(...list.map((u) => u && u.login).filter(Boolean));
		if (list.length < 100) break;
		page += 1;
	}
	return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

function parseArgs(argv) {
	const args = { dryRun: false, local: false, token: "", names: "" };
	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case "--dry-run": args.dryRun = true; break;
			case "--local": args.local = true; break;
			case "--token":
				args.token = argv[i + 1] || "";
				i += 1;
				break;
			case "--names":
				args.names = argv[i + 1] || "";
				i += 1;
				break;
			default:
				console.error(`未知选项: ${argv[i]}`);
				process.exit(2);
		}
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!fs.existsSync(EXAMPLE)) {
		console.error(`找不到 ${EXAMPLE}`);
		process.exit(1);
	}
	let names;
	if (args.names) {
		console.log(`从 ${args.names} 读取星标名单…`);
		names = readNamesFile(args.names);
	} else {
		console.log(`正在拉取 ${REPO} 的星标名单…`);
		names = await fetchStargazers(readToken(args));
	}
	if (names.length === 0) {
		console.error("没有拿到任何 stargazers,未做任何改动。");
		process.exit(1);
	}
	const askPack = buildAskPack();
	const routePack = buildRoutePack(names);
	console.log(`星标者 ${names.length} 人`);
	console.log(`  ${ASK_PACK_ID}: ${packCount(askPack, "zh")} 条 zh / ${packCount(askPack, "en")} 条 en(纯求 star)`);
	console.log(`  ${ROUTE_PACK_ID}: ${packCount(routePack, "zh")} 条 zh / ${packCount(routePack, "en")} 条 en(每位星标者一条)`);
	console.log("预览(前 5 条星标者文案):");
	for (const name of names.slice(0, 5)) console.log(`  ${zhNamePhrase(name)}`);
	if (names.length > 5) console.log("  …");

	const targets = [EXAMPLE];
	if (args.local) {
		if (fs.existsSync(LOCAL)) targets.push(LOCAL);
		else console.log("--local: 本地 config.json 不存在,跳过。");
	}
	if (args.dryRun) {
		console.log(`[dry-run] 未写文件;目标: ${targets.join(", ")}`);
		return;
	}
	for (const file of targets) {
		const { doc, eol } = readDoc(file);
		applyStarPacks(doc, askPack, routePack);
		writeDoc(file, doc, eol);
		console.log(`已写入: ${path.relative(ROOT, file)}`);
	}
	console.log(`提示:两个 star 包默认不启用(enabledPacks 已剔除 ${STAR_PACK_IDS.join(" / ")});`);
	console.log("      词库总数 / README 表格需按新条数同步(可运行 node scripts/check-bank-memes.mjs 核数)。");
}

main().catch((error) => {
	console.error(`更新失败: ${error.message}`);
	process.exit(1);
});
