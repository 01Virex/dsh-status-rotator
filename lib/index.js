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

/** 校验一组文案:字符串数组,或 { text, weight } 加权对象数组(或缺省) */
function assertPhraseList(value, pathLabel) {
	if (value === undefined) return;
	if (!Array.isArray(value)) {
		throw new Error(`${pathLabel} 必须是数组`);
	}
	for (const [index, item] of value.entries()) {
		if (typeof item === "string") continue;
		if (item !== null && typeof item === "object" && !Array.isArray(item)) {
			if (typeof item.text !== "string" || item.text.length === 0) {
				throw new Error(`${pathLabel}[${index}].text 必须是非空字符串`);
			}
			if (item.weight !== undefined
				&& (typeof item.weight !== "number" || !Number.isFinite(item.weight) || item.weight <= 0)) {
				throw new Error(`${pathLabel}[${index}].weight 必须是正数`);
			}
			continue;
		}
		throw new Error(`${pathLabel}[${index}] 必须是字符串或 { text, weight } 对象`);
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

/** 校验词库包列表 */
function assertPacks(list) {
	if (!Array.isArray(list)) throw new Error("packs 必须是数组");
	const seen = new Set();
	for (const [index, item] of list.entries()) {
		if (item === null || typeof item !== "object" || Array.isArray(item)) {
			throw new Error(`packs[${index}] 必须是对象`);
		}
		if (typeof item.id !== "string" || item.id.length === 0) {
			throw new Error(`packs[${index}].id 必须是非空字符串`);
		}
		if (seen.has(item.id)) {
			throw new Error(`packs[${index}].id 重复: ${item.id}`);
		}
		seen.add(item.id);
		if (item.label !== undefined && typeof item.label !== "string" && (item.label === null || typeof item.label !== "object" || Array.isArray(item.label))) {
			throw new Error(`packs[${index}].label 必须是字符串或 {zh,en} 对象`);
		}
		if (item.phrases !== undefined) {
			assertPhraseTable(item.phrases, `packs[${index}].phrases`);
		}
	}
}

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
 * 配置安全栅栏(服务端)。
 *
 * 为什么需要:这个写接口是本地 HTTP 端点,宿主 dsh 的 /api 通道有
 * Host/Origin 栅栏 + cookie 鉴权,插件自己注册的路由两者都不经过。
 * 跨站页面用 fetch(..., { mode: "no-cors", headers: { "content-type": "text/plain" } })
 * 发的是「简单请求」,不触发预检 —— 于是任何人都能改写你的本地配置。
 *
 * 两个方向一起堵:
 *   1. 请求侧:isTrustedWrite / isTrustedRead(见下);
 *   2. 内容侧:颜色白名单(颜色值会被拼进浏览器端注入的 <style>,
 *      一个 ";" 就能越出声明块注入任意 CSS)+ 数值钳制
 *      (intervalMs 直接喂给 setInterval,没有下限就是自 DoS)。
 */
const COLOR_RE = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/deg-]+\))$/i;
const CONFIG_LIMITS = {
	intervalMs: [250, 3600000],
	typeSpeedMs: [0, 1000],
	longAfterMs: [1000, 86400000],
	reloadIntervalMs: [1000, 3600000],
	liveTickMs: [250, 60000]
};
/** 允许显式写 0 = 关闭的键(0 不参与下限钳制) */
const ZERO_DISABLES = new Set(["typeSpeedMs", "reloadIntervalMs", "liveTickMs"]);
const DANMAKU_LIMITS = {
	intervalMs: [200, 600000],
	speedMs: [1000, 120000],
	fontSizeMin: [8, 200],
	fontSizeMax: [8, 200],
	opacity: [0.05, 1],
	maxCount: [1, 60],
	zIndex: [-1000, 10000]
};

/** 单个颜色值是否可安全写进注入的 CSS(白名单,挡注入) */
function isSafeColor(value) {
	if (typeof value !== "string") return false;
	const s = value.trim();
	if (s.length === 0 || s.length > 64) return false;
	if (/[;{}<>"'`\\]/.test(s) || /url\s*\(/i.test(s)) return false;
	return COLOR_RE.test(s);
}

function clampNumber(value, range) {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return Math.min(range[1], Math.max(range[0], value));
}

/** 颜色数组 → 合法项(最多 16 个);非法项丢弃,避免整条 background-image 失效 */
function sanitizeColors(list) {
	return Array.isArray(list) ? list.filter(isSafeColor).slice(0, 16) : [];
}

/** 钳制一份 config(顶层或预设内的),返回新对象,不改原对象 */
function sanitizeConfig(config) {
	if (config === null || typeof config !== "object" || Array.isArray(config)) return config;
	const out = { ...config };
	for (const [key, range] of Object.entries(CONFIG_LIMITS)) {
		if (out[key] === undefined) continue;
		const clamped = clampNumber(out[key], range);
		if (clamped === undefined) { delete out[key]; continue; }
		out[key] = ZERO_DISABLES.has(key) && out[key] === 0 ? 0 : clamped;
	}
	if (out.gradient && typeof out.gradient === "object" && !Array.isArray(out.gradient)) {
		const g = { ...out.gradient };
		if (g.colors !== undefined) g.colors = sanitizeColors(g.colors);
		if (g.speed !== undefined) {
			const speed = clampNumber(g.speed, [0.5, 120]);
			if (speed === undefined) delete g.speed; else g.speed = speed;
		}
		out.gradient = g;
	}
	if (out.title && typeof out.title === "object" && !Array.isArray(out.title)) {
		const t = { ...out.title };
		if (t.intervalMs !== undefined) {
			const iv = clampNumber(t.intervalMs, [1000, 3600000]);
			if (iv === undefined) delete t.intervalMs; else t.intervalMs = iv;
		}
		out.title = t;
	}
	if (out.danmaku && typeof out.danmaku === "object" && !Array.isArray(out.danmaku)) {
		const d = { ...out.danmaku };
		for (const [key, range] of Object.entries(DANMAKU_LIMITS)) {
			if (d[key] === undefined) continue;
			const clamped = clampNumber(d[key], range);
			if (clamped === undefined) { delete d[key]; continue; }
			d[key] = key === "maxCount" || key === "zIndex" ? Math.round(clamped) : clamped;
		}
		if (d.colors !== undefined) d.colors = sanitizeColors(d.colors);
		if (d.color !== undefined && !isSafeColor(d.color)) delete d.color;
		out.danmaku = d;
	}
	return out;
}

/** 通过结构校验后的文档再做一次安全/范围归一化(纯函数,供测试与 saveConfig 使用) */
function sanitizeConfigDocument(document) {
	if (document === null || typeof document !== "object" || Array.isArray(document)) return document;
	const out = { ...document };
	if (out.config !== undefined) out.config = sanitizeConfig(out.config);
	if (Array.isArray(out.presets)) {
		out.presets = out.presets.map((preset) => {
			if (preset === null || typeof preset !== "object" || Array.isArray(preset) || preset.config === undefined) return preset;
			return { ...preset, config: sanitizeConfig(preset.config) };
		});
	}
	return out;
}

/** Origin 头(若有)必须与请求 Host 完全同源 */
function originMatchesHost(origin, host) {
	if (!origin) return true;
	try {
		return new URL(origin).host === String(host || "");
	} catch (error) {
		return false;
	}
}

/**
 * 写请求栅栏:
 *   - content-type 必须是 application/json —— 跨域带这个头必然触发预检,
 *     CORS 下预检失败,恶意页面只能发 text/plain 之类的简单请求,直接拒掉;
 *   - sec-fetch-site(浏览器自己带、页面无法伪造)只接受 same-origin / none;
 *   - 带 Origin 时必须同源(非 GET 请求即使同源也会带 Origin)。
 * 残余风险:DNS rebinding 在浏览器视角是 same-origin,拦不住;端口只监听
 * 回环地址时风险可控,若要暴露到局域网,请自行加反向代理鉴权。
 */
function isTrustedWrite(req) {
	const headers = (req && req.headers) || {};
	const type = String(headers["content-type"] || "").toLowerCase();
	if (!type.startsWith("application/json")) return false;
	const site = String(headers["sec-fetch-site"] || "").toLowerCase();
	if (site && site !== "same-origin" && site !== "none") return false;
	return originMatchesHost(headers.origin, headers.host);
}

/** 读请求栅栏:挡掉跨站读取(简单请求即可读,不需要 cookie) */
function isTrustedRead(req) {
	const headers = (req && req.headers) || {};
	if (String(headers["sec-fetch-site"] || "").toLowerCase() === "cross-site") return false;
	return originMatchesHost(headers.origin, headers.host);
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
	if (raw.packs !== undefined) {
		assertPacks(raw.packs);
	}
	if (raw.enabledPacks !== undefined) {
		if (!Array.isArray(raw.enabledPacks) || !raw.enabledPacks.every((s) => typeof s === "string" && s.length > 0)) {
			throw new Error("enabledPacks 必须是字符串数组");
		}
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

/** 统一的拒绝响应(403):跨站/不可信来源,不区分细节 */
function rejectUntrusted(res, reason) {
	res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify({ ok: false, error: `拒绝跨站请求: ${reason}` }));
}

function createServeConfig(getSettingsApi) {
	return async function serveConfig(req, res) {
		if (req.method === "GET" || req.method === "HEAD") {
			if (!isTrustedRead(req)) {
				rejectUntrusted(res, "读取");
				return;
			}
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
			if (!isTrustedWrite(req)) {
				rejectUntrusted(res, "写入");
				return;
			}
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
		// 先做结构校验(拒绝写坏运行时),再做安全/范围归一化(颜色白名单 + 数值钳制)
		document = sanitizeConfigDocument(validateConfigDocument(JSON.parse(raw)));
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

/**
 * 解析设置命名空间。
 * dsh-settings 的导出面收窄过:新版本只导出 { SettingsConflictError,
 * SettingsProvider, redactSecrets },不再有 settingsNamespace()。旧代码直接
 * 调它 → TypeError 被外层 catch 吞掉 → settings 整条链路静默失效(用户配置
 * 不生效、保存也不落盘)。命名空间就是字符串本身(register 会自行解析),
 * 所以新版本直接回退到名字即可。
 */
function resolveSettingsNamespace(settingsMod, name) {
	try {
		if (settingsMod && typeof settingsMod.settingsNamespace === "function") {
			const ns = settingsMod.settingsNamespace(name);
			if (typeof ns === "string" && ns.length > 0) return ns;
		}
	} catch (error) { /* ignore */ }
	return name;
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
			const ns = resolveSettingsNamespace(settingsMod, SETTINGS_NS);
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
		if (registerNow()) {
			// 正常路径也要把路由 disposer 交回去:否则插件重载/二次 apply 时
			// 宿主对重复 path 抛 duplicate exact route,激活直接失败。
			return () => {
				if (routeDisposer) {
					try { routeDisposer(); } catch (error) { /* ignore */ }
				}
			};
		}
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

export {
	apply,
	inject,
	name,
	validateConfigDocument,
	sanitizeConfigDocument,
	sanitizeConfig,
	isSafeColor,
	isTrustedWrite,
	isTrustedRead,
	mergeDocuments,
	resolveSettingsNamespace
};
