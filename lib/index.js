/**
 * dsh-status-rotator — node half.
 *
 * The browser half (lib/client.js) swaps the "Deep diving..." turn-status
 * label. This node half makes the phrase config load AND save:
 *
 *   GET/HEAD /plugins/dsh-status-rotator/config.json
 *       → stream the package's config.json (falling back to config.example.json)
 *   PUT/POST  same route
 *       → validate the submitted JSON and atomically replace config.json,
 *         so the settings-page editor in the browser half can persist edits.
 *
 * The browser half fetches that URL by default. No manual localStorage or
 * deployment step is needed — drop config.json next to this package, restart
 * `dsh web`, hard-refresh.
 */
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Cordis plugin name. */
const name = "status-rotator";
/** Needs the web server to expose the config route. */
const inject = ["webServer"];

const here = dirname(fileURLToPath(import.meta.url));
/** config.json sits at the package root, one level above lib/. */
const CONFIG_PATH = join(here, "..", "config.json");
const EXAMPLE_PATH = join(here, "..", "config.example.json");

/** 请求体上限(5 MiB),避免异常大 body 吃内存 */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** 读尽请求体;超限抛错由调用方转成 413 */
async function readBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > MAX_BODY_BYTES) throw new Error("body too large");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

/** 校验一组文案:必须是字符串数组(或省略) */
function assertPhraseList(value, pathLabel) {
	if (value === undefined) return;
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		throw new Error(`${pathLabel} 必须是字符串数组`);
	}
}

/** 校验一个 phrases 表(语言表或单组表) */
function assertPhraseTable(table, pathLabel) {
	if (Array.isArray(table)) {
		assertPhraseList(table, pathLabel);
		return;
	}
	if (table === null || typeof table !== "object") {
		throw new Error(`${pathLabel} 必须是数组或对象`);
	}
	if (table.zh !== undefined || table.en !== undefined) {
		for (const lang of ["zh", "en"]) {
			if (table[lang] === undefined) continue;
			const entry = table[lang];
			if (Array.isArray(entry)) {
				assertPhraseList(entry, `${pathLabel}.${lang}`);
			} else if (entry === null || typeof entry !== "object") {
				throw new Error(`${pathLabel}.${lang} 必须是数组或 {thinking,running,long} 对象`);
			} else {
				for (const phase of ["thinking", "running", "long"]) {
					assertPhraseList(entry[phase], `${pathLabel}.${lang}.${phase}`);
				}
			}
		}
		return;
	}
	for (const phase of ["thinking", "running", "long"]) {
		assertPhraseList(table[phase], `${pathLabel}.${phase}`);
	}
}

const SCHEDULE_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** 校验预设列表 */
function assertPresets(list) {
	if (!Array.isArray(list)) throw new Error("presets 必须是数组");
	for (const [index, item] of list.entries()) {
		if (item === null || typeof item !== "object" || Array.isArray(item)) {
			throw new Error(`presets[${index}] 必须是对象`);
		}
		if (typeof item.id !== "string" || item.id.length === 0) {
			throw new Error(`presets[${index}].id 必须是非空字符串`);
		}
		if (item.label !== undefined && typeof item.label !== "string" && (item.label === null || typeof item.label !== "object" || Array.isArray(item.label))) {
			throw new Error(`presets[${index}].label 必须是字符串或 {zh,en} 对象`);
		}
		if (item.config !== undefined && (item.config === null || typeof item.config !== "object" || Array.isArray(item.config))) {
			throw new Error(`presets[${index}].config 必须是对象`);
		}
		if (item.phrases !== undefined) {
			assertPhraseTable(item.phrases, `presets[${index}].phrases`);
		}
	}
}

/** 校验调度规则列表 */
function assertSchedule(list) {
	if (!Array.isArray(list)) throw new Error("schedule 必须是数组");
	for (const [index, item] of list.entries()) {
		if (item === null || typeof item !== "object" || Array.isArray(item)) {
			throw new Error(`schedule[${index}] 必须是对象`);
		}
		if (typeof item.preset !== "string" || item.preset.length === 0) {
			throw new Error(`schedule[${index}].preset 必须是非空字符串`);
		}
		if (item.days !== undefined) {
			if (!Array.isArray(item.days) || !item.days.every((d) => SCHEDULE_DAYS.includes(d))) {
				throw new Error(`schedule[${index}].days 必须是 ${SCHEDULE_DAYS.join("/")} 子集`);
			}
		}
		for (const key of ["from", "to"]) {
			if (item[key] !== undefined && (typeof item[key] !== "string" || !/^\d{1,2}:\d{2}$/.test(item[key]))) {
				throw new Error(`schedule[${index}].${key} 必须是 HH:MM 格式`);
			}
		}
	}
}

/**
 * 校验编辑器提交的整份配置。只做「不会写坏运行时」的结构校验,
 * 字段语义交给浏览器端的 normalizeConfig / normalizeTable。
 */
function validateConfigDocument(raw) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("配置必须是 JSON 对象");
	}
	if (raw.config !== undefined && (raw.config === null || typeof raw.config !== "object" || Array.isArray(raw.config))) {
		throw new Error("config 必须是对象");
	}
	if (raw.phrases !== undefined) {
		assertPhraseTable(raw.phrases, "phrases");
	}
	if (raw.presets !== undefined) {
		assertPresets(raw.presets);
	}
	if (raw.activePreset !== undefined && raw.activePreset !== null && typeof raw.activePreset !== "string") {
		throw new Error("activePreset 必须是字符串或 null");
	}
	if (raw.schedule !== undefined) {
		assertSchedule(raw.schedule);
	}
	return raw;
}

async function serveConfig(req, res) {
	if (req.method === "GET" || req.method === "HEAD") {
		for (const path of [CONFIG_PATH, EXAMPLE_PATH]) {
			try {
				const body = await readFile(path);
				res.writeHead(200, {
					"content-type": "application/json; charset=utf-8",
					"cache-control": "no-cache"
				});
				res.end(body);
				return;
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
		}
		res.writeHead(404);
		res.end();
		return;
	}
	if (req.method === "PUT" || req.method === "POST") {
		await saveConfig(req, res);
		return;
	}
	res.writeHead(405);
	res.end();
}

async function saveConfig(req, res) {
	let raw;
	try {
		raw = await readBody(req);
	} catch (error) {
		res.writeHead(413, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ ok: false, error: "请求体过大" }));
		return;
	}
	let document;
	try {
		document = validateConfigDocument(JSON.parse(raw));
	} catch (error) {
		res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ ok: false, error: `配置无效: ${error.message}` }));
		return;
	}

	const tmpPath = `${CONFIG_PATH}.tmp-${process.pid}-${Date.now()}`;
	try {
		await writeFile(tmpPath, JSON.stringify(document, null, 4) + "\n", "utf8");
		await rename(tmpPath, CONFIG_PATH);
	} catch (error) {
		try {
			await unlink(tmpPath);
		} catch (cleanupError) {
			if (cleanupError.code !== "ENOENT") throw cleanupError;
		}
		res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ ok: false, error: `写入失败: ${error.message}` }));
		return;
	}

	res.writeHead(200, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-cache"
	});
	res.end(JSON.stringify({ ok: true }));
}

function apply(ctx) {
	// dsh 的 ctx.effect 会立即执行回调,回调返回值才是卸载时的清理函数。
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/plugins/dsh-status-rotator/config.json",
		handler: serveConfig
	}), "status-rotator: config.json route");
}

export { apply, inject, name, validateConfigDocument };
