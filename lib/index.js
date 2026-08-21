/**
 * dsh-status-rotator — node half.
 *
 * The browser half (lib/client.js) swaps the "Deep diving..." turn-status
 * label. This node half serves AND persists the config document:
 *
 *   GET/HEAD /plugins/dsh-status-rotator/config.json
 *       → stream the effective document: the official settings namespace
 *         (`$DSH_HOME/settings.yaml`, survives plugin upgrades) first, with
 *         the package's config.json (falling back to config.example.json) as
 *         the legacy/fallback layer.
 *   PUT/POST  same route
 *       → validate the submitted JSON, persist it into the settings namespace
 *         (durable across upgrades) and mirror it to config.json for
 *         backward compatibility.
 *
 * On first start, an existing config.json is imported into the settings
 * namespace once, so current users keep their settings through the upgrade
 * that introduced this change.
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
/**
 * 不硬依赖任何服务:webServer 缺失的宿主(如 headless/测试 profile)也要能激活,
 * 只是不注册配置路由(对应 testkit 生命周期检查发现的问题)。
 */
const inject = [];

const here = dirname(fileURLToPath(import.meta.url));
/** config.json sits at the package root, one level above lib/. */
const CONFIG_PATH = join(here, "..", "config.json");
const EXAMPLE_PATH = join(here, "..", "config.example.json");
/** 官方持久设置命名空间(存于 $DSH_HOME/settings.yaml,升级插件不会清空) */
const SETTINGS_NS = "status-rotator";

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

/** 读插件目录 config.json(可选回退 config.example.json);损坏/缺失返回 null */
async function readFileDocument(exampleFallback) {
	for (const path of exampleFallback ? [CONFIG_PATH, EXAMPLE_PATH] : [CONFIG_PATH]) {
		try {
			return JSON.parse(await readFile(path, "utf8"));
		} catch (error) {
			if (error.code !== "ENOENT") return null;
		}
	}
	return null;
}

/** 合并配置文档:settings 层(userDoc)按顶层键覆盖文件层(fileDoc);纯函数,供测试 */
function mergeDocuments(fileDoc, userDoc) {
	if (!userDoc) return fileDoc || null;
	const out = {};
	if (fileDoc && typeof fileDoc === "object" && !Array.isArray(fileDoc)) Object.assign(out, fileDoc);
	Object.assign(out, userDoc);
	return out;
}

/** 生效配置文档:settings 优先,文件层兜底 */
async function effectiveConfigDocument(getSettingsApi) {
	const s = await getSettingsApi();
	let userDoc = null;
	if (s) {
		try {
			const v = s.scope.get();
			if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0) userDoc = v;
		} catch (error) { /* ignore */ }
	}
	const fileDoc = await readFileDocument(true);
	return mergeDocuments(fileDoc, userDoc);
}

function createServeConfig(getSettingsApi) {
	return async function serveConfig(req, res) {
		if (req.method === "GET" || req.method === "HEAD") {
			const doc = await effectiveConfigDocument(getSettingsApi);
			if (doc === null) {
				res.writeHead(404);
				res.end();
				return;
			}
			res.writeHead(200, {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-cache"
			});
			res.end(JSON.stringify(doc, null, 4) + "\n");
			return;
		}
		if (req.method === "PUT" || req.method === "POST") {
			await saveConfig(req, res, getSettingsApi);
			return;
		}
		res.writeHead(405);
		res.end();
	};
}

async function saveConfig(req, res, getSettingsApi) {
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

	// 先持久化到官方 settings(升级保留),失败则拒绝而不是偷偷用旧值顶掉新值
	const s = await getSettingsApi();
	if (s) {
		try {
			await s.scope.replace(document);
		} catch (error) {
			res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ ok: false, error: `设置持久化失败: ${error.message}` }));
			return;
		}
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
	/**
	 * 惰性设置接入:inject=[] 意味着插件可能在 settings 服务提供**之前**激活,
	 * 所以每次请求都重新解析(成功后缓存);解析成功时顺带做一次性迁移(幂等)。
	 * schemastery/dsh-settings 缺失或未挂载时静默返回 null,插件继续文件式 config.json。
	 */
	let settingsApi = null;
	const getSettingsApi = async () => {
		if (settingsApi) return settingsApi;
		try {
			let settings = null;
			try {
				settings = typeof ctx.get === "function" ? ctx.get("settings") : null;
			} catch (error) { /* ignore */ }
			if (!settings || typeof settings.register !== "function") return null;
			const [{ default: z }, settingsMod] = await Promise.all([
				import("@deepseek-ai/schemastery"),
				import("@deepseek-ai/dsh-settings"),
			]);
			const ns = settingsMod.settingsNamespace(SETTINGS_NS);
			// 宽松 schema:接受任意 JSON 对象(结构校验由 validateConfigDocument 把关)
			const scope = settings.register(ns, z.object({}).loose(), { applies: "live" });
			settingsApi = { scope };
			// 一次性迁移:settings 尚无用户配置且插件目录存在 config.json 时导入(升级保值)
			try {
				const v = scope.get();
				const has = v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0;
				if (!has) {
					const doc = await readFileDocument(false);
					if (doc) await scope.replace(doc);
				}
			} catch (error) { /* ignore */ }
			return settingsApi;
		} catch (error) {
			return null;
		}
	};

	/**
	 * webServer 同样可能晚于插件激活(inject=[] 不等待依赖,加载器不推迟激活):
	 * 轮询等待其就绪后注册路由(500ms × 20 次);headless 宿主等不到就静默结束,
	 * 插件保持激活(回应 DSH Testkit 生命周期检查发现)。
	 * 路由 disposer 与轮询定时器都挂在 effect 清理里,卸载不留残留。
	 */
	ctx.effect(() => {
		const handler = createServeConfig(getSettingsApi);
		let attempts = 0;
		let routeDisposer = null;
		let timer = null;
		const registerNow = () => {
			let ws = null;
			try {
				ws = typeof ctx.get === "function" ? ctx.get("webServer") : null;
			} catch (error) { /* ignore */ }
			if (!ws) {
				try { ws = ctx.webServer || null; } catch (error) { /* ignore */ }
			}
			if (!ws || typeof ws.register !== "function") return false;
			routeDisposer = ws.register({
				kind: "exact",
				path: "/plugins/dsh-status-rotator/config.json",
				handler
			});
			return true;
		};
		if (registerNow()) return () => {};
		timer = setInterval(() => {
			attempts++;
			if (registerNow() || attempts >= 20) clearInterval(timer);
		}, 500);
		return () => {
			if (timer !== null) clearInterval(timer);
			if (routeDisposer) {
				try { routeDisposer(); } catch (error) { /* ignore */ }
			}
		};
	}, "status-rotator: config.json route");
}

export { apply, inject, name, validateConfigDocument, mergeDocuments };
