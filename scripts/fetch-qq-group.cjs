#!/usr/bin/env node
/**
 * fetch-qq-group.cjs — 抓取 QQ 群成员并生成 dsh-status-rotator 文案配置。
 *
 * 通过 OneBot v11 兼容的 HTTP API(如 NapCat / LLOneBot / go-cqhttp / OpenShamrock)
 * 调用 get_group_member_list,把每个成员拼成:
 *
 *     正在路由（<群名片或昵称>）写代码...
 *
 * 并写成独立配置文件(默认 config.qq684306814.json)。也可以不用机器人,
 * 用 --input 传入本地名单(.txt 每行一个昵称 / .json 数组 / .csv 第一列)。
 *
 * 用法:
 *   node scripts/fetch-qq-group.cjs \
 *       --url http://127.0.0.1:3000 \
 *       --token 你的token \
 *       --group 684306814
 *
 *   # 直接替换插件使用的 config.json(自动备份旧文件)
 *   node scripts/fetch-qq-group.cjs --url http://127.0.0.1:3000 --activate
 *
 *   # 用本地名单,不连机器人
 *   node scripts/fetch-qq-group.cjs --input members.txt
 *
 * 环境变量:QQ_GROUP_ID / ONEBOT_HTTP_URL / ONEBOT_ACCESS_TOKEN / ONEBOT_ACTION
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_GROUP = "684306814";
const DEFAULT_URL = "http://127.0.0.1:3000";
const DEFAULT_ACTION = "get_group_member_list";
const DEFAULT_OUTPUT = path.join(ROOT, "config.qq684306814.json");
const EXAMPLE_CONFIG = path.join(ROOT, "config.example.json");

const HELP = `用法: node scripts/fetch-qq-group.cjs [选项]

选项:
  -g, --group <id>      QQ 群号(默认 ${DEFAULT_GROUP},环境变量 QQ_GROUP_ID)
  -u, --url <url>       OneBot HTTP 地址(默认 ${DEFAULT_URL},环境变量 ONEBOT_HTTP_URL)
  -t, --token <token>   access token(默认空,环境变量 ONEBOT_ACCESS_TOKEN)
  -a, --action <path>   动作路径(默认 ${DEFAULT_ACTION};带 /api 前缀的框架可改成
                        /api/get_group_member_list)
  -i, --input <file>    本地名单文件:txt(每行一个昵称) / json(字符串或成员对象数组)
                        / csv(取第一列),指定后跳过 HTTP 抓取
  -o, --output <file>   输出文件(默认 config.qq684306814.json)
  --activate            直接写入插件使用的 config.json,旧文件先备份为
                        config.backup-<时间戳>.json
  --dry-run             只打印预览,不写文件
  -h, --help            显示帮助`;

function parseArgs(argv) {
	const args = { group: process.env.QQ_GROUP_ID || DEFAULT_GROUP, url: process.env.ONEBOT_HTTP_URL || DEFAULT_URL, token: process.env.ONEBOT_ACCESS_TOKEN || "", action: process.env.ONEBOT_ACTION || DEFAULT_ACTION, input: null, output: DEFAULT_OUTPUT, activate: false, dryRun: false, help: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const take = (flag) => {
			const next = argv[i + 1];
			if (next === undefined || next.startsWith("-")) {
				console.error(`缺少 ${flag} 的值`);
				process.exit(2);
			}
			i += 1;
			return next;
		};
		switch (arg) {
			case "-h": case "--help": args.help = true; break;
			case "-g": case "--group": args.group = take(arg); break;
			case "-u": case "--url": args.url = take(arg); break;
			case "-t": case "--token": args.token = take(arg); break;
			case "-a": case "--action": args.action = take(arg); break;
			case "-i": case "--input": args.input = take(arg); break;
			case "-o": case "--output": args.output = take(arg); break;
			case "--activate": args.activate = true; break;
			case "--dry-run": args.dryRun = true; break;
			default:
				console.error(`未知选项: ${arg}`);
				console.error(HELP);
				process.exit(2);
		}
	}
	return args;
}

/** 去掉两端空白;空字符串返回 null */
function cleanName(raw) {
	if (raw === undefined || raw === null) return null;
	const name = String(raw).trim();
	return name.length > 0 ? name : null;
}

/** 从成员对象里取显示名:群名片 > 昵称 > 其它常见字段 > QQ 号 */
function memberName(member) {
	if (typeof member === "string" || typeof member === "number") return cleanName(member);
	if (member === null || typeof member !== "object") return null;
	for (const key of ["card", "nickname", "name", "user_name", "display_name"]) {
		const name = cleanName(member[key]);
		if (name) return name;
	}
	return cleanName(member.user_id);
}

/** 把 OneBot 返回的 payload 归一化为成员数组 */
function extractMembers(payload) {
	let data = payload;
	if (payload !== null && typeof payload === "object" && payload.data !== undefined) data = payload.data;
	if (data !== null && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.members)) data = data.members;
	if (!Array.isArray(data)) {
		const preview = JSON.stringify(payload).slice(0, 200);
		throw new Error(`机器人返回的数据里没有成员数组,收到: ${preview}`);
	}
	const names = [];
	const seen = new Set();
	for (const member of data) {
		const name = memberName(member);
		if (name && !seen.has(name)) {
			seen.add(name);
			names.push(name);
		}
	}
	return names;
}

/** OneBot v11 HTTP 调用:POST {action} {group_id, no_cache} */
async function fetchMembersFromOneBot({ url, action, token, group: groupId }) {
	const groupIdNum = Number(groupId);
	if (!Number.isSafeInteger(groupIdNum) || groupIdNum <= 0) {
		throw new Error(`群号无效: ${groupId}(需为正整数)`);
	}
	const base = url.replace(/\/+$/, "");
	const pathname = action.startsWith("/") ? action : `/${action}`;
	const target = `${base}${pathname}`;
	const headers = { "content-type": "application/json" };
	if (token) headers.authorization = `Bearer ${token}`;
	console.log(`正在调用 ${target} 拉取群 ${groupIdNum} 的成员…`);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 20000);
	try {
		const response = await fetch(target, {
			method: "POST",
			headers,
			body: JSON.stringify({ group_id: groupIdNum, no_cache: false }),
			signal: controller.signal,
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
		}
		let payload;
		try {
			payload = JSON.parse(text);
		} catch {
			throw new Error(`机器人返回的不是 JSON: ${text.slice(0, 200)}`);
		}
		if (payload && typeof payload === "object" && payload.retcode !== undefined && payload.retcode !== 0) {
			throw new Error(`机器人返回错误 retcode=${payload.retcode}: ${JSON.stringify(payload).slice(0, 300)}`);
		}
		return extractMembers(payload);
	} finally {
		clearTimeout(timer);
	}
}

/** 本地名单:txt 每行一个昵称 / json 数组 / csv 第一列 */
function readNamesFromFile(file) {
	const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
	const lower = file.toLowerCase();
	let candidates = null;
	if (lower.endsWith(".json")) {
		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			throw new Error(`解析 JSON 失败: ${file} — ${error.message}`);
		}
		candidates = Array.isArray(parsed) ? parsed : null;
		if (candidates === null) throw new Error(`JSON 文件需为数组: ${file}`);
	} else if (lower.endsWith(".csv")) {
		candidates = raw.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("#")).map((line) => line.split(",")[0]);
	} else {
		candidates = raw.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("#"));
	}
	const names = [];
	const seen = new Set();
	for (const candidate of candidates) {
		const name = memberName(candidate);
		if (name && !seen.has(name)) {
			seen.add(name);
			names.push(name);
		}
	}
	return names;
}

/** 生成文案列表 */
function buildPhrases(names) {
	return names.map((name) => `正在路由（${name}）写代码...`);
}

/** 配置里的 config 块沿用 config.example.json;读不到就退回插件默认值 */
function loadBaseConfig() {
	try {
		const example = JSON.parse(fs.readFileSync(EXAMPLE_CONFIG, "utf8"));
		if (example && typeof example === "object" && example.config !== null && typeof example.config === "object") {
			return example.config;
		}
	} catch (error) {
		/* 忽略,用默认值 */
	}
	return {
		intervalMs: 10000,
		typeSpeedMs: 30,
		longAfterMs: 60000,
		debug: false,
		gradient: {
			enabled: true,
			colors: ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"],
			speed: 4,
		},
	};
}

function timestamp() {
	const d = new Date();
	const p = (n, w = 2) => String(n).padStart(w, "0");
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 写配置文件;--activate 时先备份旧 config.json */
function writeOutput(file, content, activate) {
	let target = file;
	if (activate) {
		target = path.join(ROOT, "config.json");
		if (fs.existsSync(target)) {
			const backup = path.join(ROOT, `config.backup-${timestamp()}.json`);
			fs.copyFileSync(target, backup);
			console.log(`已备份旧配置: ${path.relative(ROOT, backup)}`);
		}
	}
	fs.writeFileSync(target, content, "utf8");
	return target;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(HELP);
		return;
	}
	const names = args.input ? readNamesFromFile(args.input) : await fetchMembersFromOneBot(args);
	if (names.length === 0) {
		console.error("没有拿到任何成员,未生成配置。");
		process.exit(1);
	}
	const phrases = buildPhrases(names);
	const config = {
		config: loadBaseConfig(),
		phrases: { zh: { thinking: phrases } },
	};
	const json = `${JSON.stringify(config, null, 4)}\n`;
	const output = path.resolve(args.output);
	console.log(`群成员 ${names.length} 人,生成 ${phrases.length} 条文案。`);
	console.log("预览(前 5 条):");
	for (const phrase of phrases.slice(0, 5)) console.log(`  ${phrase}`);
	if (phrases.length > 5) console.log("  …");
	if (args.dryRun) {
		console.log(`[dry-run] 未写文件,目标: ${args.activate ? "config.json(activate)" : output}`);
		return;
	}
	const written = writeOutput(output, json, args.activate);
	console.log(`已写入: ${path.relative(ROOT, written)}`);
	if (args.activate) {
		console.log("插件下次加载该配置即可生效(若已运行,重启 dsh web 并 Ctrl+F5 硬刷新)。");
	} else {
		console.log("提示:若要插件直接使用,运行 --activate 写回 config.json,或手动覆盖 config.json 后重启 dsh web。");
	}
}

main().catch((error) => {
	console.error(`抓取失败: ${error.message}`);
	process.exit(1);
});
