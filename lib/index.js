/**
 * dsh-status-rotator — node half.
 *
 * The browser half (lib/client.js) swaps the "Deep diving..." turn-status
 * label. This node half serves AND persists the config document:
 *
 *   GET/HEAD /plugins/dsh-status-rotator/config.json
 *       → stream the effective document, layered as
 *         bundled config.example.json → package config.json → auto-updated phrase
 *         bank ($DSH_HOME/status-rotator/bank.remote.json) → legacy settings
 *         namespace (only on hosts whose settings service still exposes
 *         `register`) → **user config store**
 *         (`$DSH_HOME/status-rotator/config.json`, survives plugin upgrades;
 *         `DSH_STATUS_ROTATOR_CONFIG` overrides the path) → external phrase bank
 *         (`$DSH_HOME/status-rotator/phrases.json`, or
 *         `$DSH_STATUS_ROTATOR_BANK`; re-read whenever the file changes).
 *         Both banks only carry `packs` / `phrases`.
 *   PUT/POST  same route
 *       → validate the submitted JSON, persist the delta into the user config
 *         store (durable across upgrades) and mirror the full document to the
 *         package-local config.json for backward compatibility.
 *
 * Where settings actually live is the whole point of issue #51: the package
 * directory is replaced wholesale on every plugin upgrade, so anything stored
 * next to the package is gone afterwards. Host-side settings were the original
 * plan, but `@deepseek-ai/dsh-settings` 0.1.7-rc.1 only offers
 * `describe`/`update`/`replace`/`mutate` — the `register()` API this plugin was
 * written against no longer exists, so that path silently returned null and the
 * package-local config.json was the only store left. Persistence now lives in
 * the plugin's own data directory under `$DSH_HOME`, which no upgrade touches.
 *
 * On start-up (and on every GET, so a hand-edited file is picked up while it
 * still exists) the package-local config.json is absorbed into the user config
 * store, because that file is documented as editable and is otherwise lost with
 * the next upgrade. A content fingerprint recorded in the store tells our own
 * mirror apart from a human edit, so the mirror is never absorbed twice.
 *
 * The external bank is what makes a phrase update take effect without
 * republishing or reinstalling the npm package: edit that one file and the
 * node half serves the new content on the next request (the browser half
 * re-reads every `reloadIntervalMs` while the page stays open).
 *
 * The browser half fetches that URL by default. No manual localStorage or
 * deployment step is needed — drop config.json next to this package, restart
 * `dsh web`, hard-refresh.
 */
import { mkdir, readFile, writeFile, rename, stat, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

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
/**
 * 外部词库(热重载)的默认位置:$DSH_HOME/status-rotator/phrases.json。
 * npm 包目录会随升级被整体替换(而且通常不可写),所以词库的"可写副本"必须落在
 * 用户数据目录里;该文件是**可选**覆盖层,不存在时完全按内置词库(config.example.json)运行。
 */
const BANK_DIR = "status-rotator";
const BANK_FILE = "phrases.json";
/** 覆盖外部词库路径的环境变量(绝对路径,或相对当前工作目录) */
const BANK_PATH_ENV = "DSH_STATUS_ROTATOR_BANK";
/**
 * 用户配置的持久存储:**必须**和词库一样落在 `$DSH_HOME/status-rotator/` 下,
 * 不能落在包目录里 —— 包目录会被 npm / Release 升级整体替换,写在里面的配置每次升级
 * 都会没(issue #51「每次更新都会重置我设置的」的根因,详见 userConfigPath)。
 */
const USER_CONFIG_FILE = "config.json";
/** 覆盖用户配置存储路径的环境变量(绝对路径,或相对当前工作目录;测试用) */
const USER_CONFIG_ENV = "DSH_STATUS_ROTATOR_CONFIG";
/**
 * 自动更新(从上游拉取词库):默认源是仓库 main 分支的 config.example.json,
 * 走 jsDelivr CDN(国内可达性优于 raw.githubusercontent);可用环境变量覆盖成
 * raw / 镜像 / 自建地址,空或 off = 关闭。
 */
const BANK_URL_ENV = "DSH_STATUS_ROTATOR_BANK_URL";
const DEFAULT_BANK_URL = "https://cdn.jsdelivr.net/gh/01Virex/dsh-status-rotator@main/config.example.json";
/** 自动更新检查间隔(毫秒);未设置 = 6 小时,0 / 非法 = 关闭 */
const BANK_INTERVAL_ENV = "DSH_STATUS_ROTATOR_BANK_INTERVAL_MS";
const DEFAULT_BANK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 上游词库的落盘缓存文件名(放在本地词库文件同目录,用户不用手改) */
const BANK_REMOTE_FILE = "bank.remote.json";
/** 单次拉取上限 2 MiB(正常 config.example.json 约 75 KB) */
const MAX_BANK_BYTES = 2 * 1024 * 1024;

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
/** 渐变配色模式白名单:auto = 跟随深浅色主题,day / night = 强制其中一套 */
const GRADIENT_MODES = ["auto", "day", "night"];
/** 渐变流动方向白名单:rtl = 从右向左(默认),ltr = 从左向右 */
const GRADIENT_DIRECTIONS = ["rtl", "ltr"];
/** 状态行文案来源白名单:phrases = 轮换短语库(默认);host = 只用宿主原文(0.1.6 观感) */
const LABEL_SOURCES = ["phrases", "host"];
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
/** 顶部 / 底部弹幕数值范围(与 lib/client.js 的 DANMAKU_FIXED_LIMITS 同口径) */
const DANMAKU_FIXED_LIMITS = {
	fontSize: [8, 200],
	marginTop: [0, 2000],
	marginBottom: [0, 2000],
	gap: [0, 200],
	durationMs: [500, 60000],
	maxCount: [1, 20],
	zIndex: [-1000, 10000]
};
/** 类型权重范围(0 = 该类型不再被抽到,仍可用 danmaku.mode 强制) */
const DANMAKU_TYPE_WEIGHT = [0, 100];
/** 类型标识:滚动(原有) / 顶部 / 底部;bilibili 弹幕协议 mode 别名 1 / 4 / 5 */
const DANMAKU_MODES = ["scroll", "top", "bottom"];
const DANMAKU_MODE_ALIASES = { "1": "scroll", "4": "bottom", "5": "top" };

/** 类型标识是否合法 → 归一化结果;未知 / 非法返回 null(调用方决定丢弃还是回落) */
function danmakuModeToken(value) {
	if (typeof value === "string") {
		const s = value.trim().toLowerCase();
		if (DANMAKU_MODES.includes(s)) return s;
		if (Object.prototype.hasOwnProperty.call(DANMAKU_MODE_ALIASES, s)) return DANMAKU_MODE_ALIASES[s];
		return null;
	}
	if (typeof value === "number" && Object.prototype.hasOwnProperty.call(DANMAKU_MODE_ALIASES, String(value))) {
		return DANMAKU_MODE_ALIASES[String(value)];
	}
	return null;
}

/** text-shadow 值白名单(挡注入;与浏览器半区同一套口径) */
function isSafeShadow(value) {
	const s = String(value || "").trim();
	if (s.length === 0 || s.length > 240) return false;
	if (/[;{}<>"'`\\]/.test(s) || /url\s*\(/i.test(s)) return false;
	return /^[#0-9a-zA-Z(),.%\s/+-]+$/.test(s);
}

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
	// 状态行文案来源:phrases(默认)/ host;非法值剔除,让浏览器半区回落默认
	if (out.labelSource !== undefined && !LABEL_SOURCES.includes(out.labelSource)) delete out.labelSource;
	if (out.gradient && typeof out.gradient === "object" && !Array.isArray(out.gradient)) {
		const g = { ...out.gradient };
		if (g.mode !== undefined && !GRADIENT_MODES.includes(g.mode)) delete g.mode;
		if (g.direction !== undefined && !GRADIENT_DIRECTIONS.includes(g.direction)) delete g.direction;
		if (g.colors !== undefined) g.colors = sanitizeColors(g.colors);
		if (g.dayColors !== undefined) g.dayColors = sanitizeColors(g.dayColors);
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
		// 布尔开关:宿主全屏遮罩期间暂停弹幕(issue #60);非布尔值剔除,缺省 = 开
		if (d.pauseBehindMask !== undefined && typeof d.pauseBehindMask !== "boolean") delete d.pauseBehindMask;
		// 类型标识:非法值直接剔除(运行时仍会回落 scroll)
		if (d.mode !== undefined) {
			const mode = danmakuModeToken(d.mode);
			if (mode === null) delete d.mode; else d.mode = mode;
		}
		// 类型分发:布尔简写或 { enabled, weight };权重钳制,空结果整块剔除
		if (d.types !== undefined) {
			if (d.types === null || typeof d.types !== "object" || Array.isArray(d.types)) {
				delete d.types;
			} else {
				const tt = {};
				for (const mode of DANMAKU_MODES) {
					const src = d.types[mode];
					if (src === undefined) continue;
					if (typeof src === "boolean") { tt[mode] = { enabled: src }; continue; }
					if (src === null || typeof src !== "object" || Array.isArray(src)) continue;
					const one = {};
					if (typeof src.enabled === "boolean") one.enabled = src.enabled;
					if (src.weight !== undefined) {
						const weight = clampNumber(src.weight, DANMAKU_TYPE_WEIGHT);
						if (weight !== undefined) one.weight = weight;
					}
					if (Object.keys(one).length > 0) tt[mode] = one;
				}
				if (Object.keys(tt).length > 0) d.types = tt; else delete d.types;
			}
		}
		// 顶部 / 底部弹幕样式:数值钳制 + 颜色 / 描边白名单;空结果整块剔除
		if (d.fixed !== undefined) {
			if (d.fixed === null || typeof d.fixed !== "object" || Array.isArray(d.fixed)) {
				delete d.fixed;
			} else {
				const ff = {};
				for (const [key, range] of Object.entries(DANMAKU_FIXED_LIMITS)) {
					if (d.fixed[key] === undefined) continue;
					const clamped = clampNumber(d.fixed[key], range);
					if (clamped === undefined) continue;
					ff[key] = Math.round(clamped);
				}
				if (d.fixed.color !== undefined && isSafeColor(d.fixed.color)) ff.color = String(d.fixed.color).trim();
				if (d.fixed.shadow !== undefined && isSafeShadow(d.fixed.shadow)) ff.shadow = String(d.fixed.shadow).trim();
				if (d.fixed.overflow === "drop") ff.overflow = "drop";
				if (typeof d.fixed.reserveBands === "boolean") ff.reserveBands = d.fixed.reserveBands;
				if (typeof d.fixed.anchorBottomToHost === "boolean") ff.anchorBottomToHost = d.fixed.anchorBottomToHost;
				if (Object.keys(ff).length > 0) d.fixed = ff; else delete d.fixed;
			}
		}
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

/**
 * 随包发布的默认文档(config.example.json),只在内存里缓存一份。
 * 它是词库的**唯一权威副本**:设置命名空间里只存用户改动过的部分。
 */
let bundledDocumentCache;
async function bundledDocument() {
	if (bundledDocumentCache !== undefined) return bundledDocumentCache;
	let doc = null;
	try {
		doc = JSON.parse(await readFile(EXAMPLE_PATH, "utf8"));
	} catch (error) { /* ignore */ }
	bundledDocumentCache = doc;
	return doc;
}

/** dsh 用户目录:$DSH_HOME 优先,缺省 ~/.dsh(与 dsh 本体、settings.yaml 同一约定) */
function dshHomeDirectory() {
	const fromEnv = process.env.DSH_HOME;
	if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();
	return join(homedir(), ".dsh");
}

/** 外部词库文件路径:DSH_STATUS_ROTATOR_BANK 优先,否则 $DSH_HOME/status-rotator/phrases.json */
function externalBankPath() {
	const override = process.env[BANK_PATH_ENV];
	if (typeof override === "string" && override.trim().length > 0) return override.trim();
	return join(dshHomeDirectory(), BANK_DIR, BANK_FILE);
}

/**
 * 词库覆盖层的加载缓存。为什么要缓存而不是每次读:GET 路由每 `reloadIntervalMs`
 * 就被每个打开的页面轮询一次,重复 parse 70+ KB JSON 没有必要;但**文件变更必须被
 * 检测到** —— 先用 mtimeNs + size 走快速路径,元数据变了再比文本内容(同一时间粒度内
 * 的两次写入、或只 touch 不改内容,都不会误判成"变了")。
 */
let externalBankCache = { path: null, mtimeNs: null, size: -1, text: null, doc: null, reloads: 0, error: null };
let remoteBankCache = { path: null, mtimeNs: null, size: -1, text: null, doc: null, reloads: 0, error: null };

/** 词库层只贡献词库:只取 `packs` / `phrases`,其余键(例如 config)一律忽略 */
function phraseOnlyDocument(parsed) {
	const doc = {};
	if (parsed && parsed.phrases !== undefined) doc.phrases = parsed.phrases;
	if (parsed && parsed.packs !== undefined) doc.packs = parsed.packs;
	return doc;
}

/**
 * 读一份可热重载的 JSON 覆盖文件,返回 { cache, doc }。文件不存在 → doc 为 null;
 * 损坏 / 校验不过 → 保留 cache 里上一次成功加载的 doc 并记录 error。
 * `project` 决定这份文件最终贡献哪些键(词库只认 packs / phrases;用户配置多带
 * 一个内部标记键,见 userConfigBody)。
 */
async function readCachedDocument(path, cache, project = phraseOnlyDocument) {
	let info = null;
	try {
		info = await stat(path, { bigint: true });
	} catch (error) {
		const same = cache.path === path;
		if (!same || cache.doc !== null || cache.text !== null) {
			cache = {
				path,
				mtimeNs: null,
				size: -1,
				text: null,
				doc: null,
				reloads: same ? cache.reloads : 0,
				error: error.code === "ENOENT" ? null : String(error.message || error)
			};
		}
		return { cache, doc: null };
	}
	const mtimeNs = info.mtimeNs.toString();
	const size = Number(info.size);
	if (cache.path === path && cache.mtimeNs === mtimeNs && cache.size === size) {
		return { cache, doc: cache.doc };
	}
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		// 竞态:stat 之后文件被删/被换;保留上一次成功值,不把异常抛给请求处理
		return { cache, doc: cache.path === path ? cache.doc : null };
	}
	if (cache.path === path && cache.text === text) {
		cache = { ...cache, mtimeNs, size };
		return { cache, doc: cache.doc };
	}
	const kept = cache.path === path ? cache : null;
	let doc = null;
	let error = null;
	try {
		doc = project(validateConfigDocument(JSON.parse(text)));
	} catch (parseError) {
		error = String(parseError.message || parseError);
	}
	if (error !== null) {
		cache = { path, mtimeNs, size, text, doc: kept ? kept.doc : null, reloads: kept ? kept.reloads : 0, error };
		return { cache, doc: cache.doc };
	}
	cache = { path, mtimeNs, size, text, doc, reloads: (kept ? kept.reloads : 0) + 1, error: null };
	return { cache, doc };
}

/**
 * 读取**本地**词库覆盖层(手改的那份):进程运行期间检测文件变更并重载,不需要重启、
 * 不需要重装包。语义:
 *   - 文件不存在 → 返回 null,生效文档回落到内置词库(内置词库是兜底);
 *   - 合法 JSON 文档(与 config.example.json 同构,**只写要覆盖的键**即可)→ 作为
 *     优先级最高的词库层参与 mergeLayers;只认 `packs` / `phrases`;
 *   - 损坏或校验不过 → 记录 error、保留上一次成功加载的值;删除后回落到内置词库。
 */
async function externalBankDocument() {
	const result = await readCachedDocument(externalBankPath(), externalBankCache);
	externalBankCache = result.cache;
	return result.doc;
}

/** 本地词库的加载状态(诊断 / 测试用;不参与请求处理) */
function externalBankStatus() {
	const path = externalBankPath();
	const current = externalBankCache.path === path ? externalBankCache : null;
	return {
		path,
		loaded: Boolean(current && current.doc !== null),
		reloads: current ? current.reloads : 0,
		error: current ? current.error : null
	};
}

/** 自动更新词库的落盘缓存路径:与本地词库文件同目录,用户不用手改 */
function remoteBankPath() {
	return join(dirname(externalBankPath()), BANK_REMOTE_FILE);
}

/** 读取自动更新的落盘缓存(外部手改缓存同样会被检测到) */
async function remoteBankDocument() {
	const result = await readCachedDocument(remoteBankPath(), remoteBankCache);
	remoteBankCache = result.cache;
	return result.doc;
}

/** 上游词库地址;返回 null = 关闭自动更新(显式 off / 空) */
function remoteBankUrl() {
	const raw = process.env[BANK_URL_ENV];
	const url = raw === undefined || raw.trim() === "" ? DEFAULT_BANK_URL : raw.trim();
	return /^(off|none|false|0)$/i.test(url) ? null : url;
}

/** 自动更新间隔(毫秒);<= 0 = 关闭 */
function remoteBankIntervalMs() {
	const raw = process.env[BANK_INTERVAL_ENV];
	if (raw === undefined || String(raw).trim() === "") return DEFAULT_BANK_INTERVAL_MS;
	const value = Number(String(raw).trim());
	return Number.isFinite(value) && value > 0 ? value : 0;
}

/** 自动更新的运行状态(诊断 / 测试用) */
const remoteBankUpdate = { lastCheckAt: 0, lastSuccessAt: 0, updates: 0, lastError: null, inFlight: false };

/**
 * 拉一次上游词库:结构校验 → 只留 packs / phrases → 与当前缓存比对,变了才原子写盘,
 * 并立刻在内存里生效(下一次 GET 就能读到,不需要重启、不需要重装包)。任何失败都只
 * 记录状态并保留上一次成功的词库 —— 离线 / CDN 挂掉不影响插件运行。
 */
async function refreshRemoteBank() {
	const url = remoteBankUrl();
	if (!url) return { ok: false, skipped: "disabled" };
	if (remoteBankUpdate.inFlight) return { ok: false, skipped: "in-flight" };
	if (typeof fetch !== "function") {
		remoteBankUpdate.lastCheckAt = Date.now();
		remoteBankUpdate.lastError = "当前运行时没有全局 fetch";
		return { ok: false, error: remoteBankUpdate.lastError };
	}
	remoteBankUpdate.inFlight = true;
	remoteBankUpdate.lastCheckAt = Date.now();
	try {
		const response = await fetch(url, {
			redirect: "follow",
			signal: AbortSignal.timeout(15000),
			headers: { accept: "application/json", "user-agent": "dsh-status-rotator" }
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const text = await response.text();
		if (Buffer.byteLength(text, "utf8") > MAX_BANK_BYTES) throw new Error("上游词库超过 2 MiB,已忽略");
		const doc = phraseOnlyDocument(validateConfigDocument(JSON.parse(text)));
		if (doc.packs === undefined && doc.phrases === undefined) throw new Error("上游词库为空");
		const current = await remoteBankDocument();
		let updated = false;
		if (current === null || !deepEqualJson(current, doc)) {
			const path = remoteBankPath();
			await mkdir(dirname(path), { recursive: true });
			const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
			const serialized = JSON.stringify(doc, null, 4) + "\n";
			try {
				await writeFile(tmpPath, serialized, "utf8");
				await rename(tmpPath, path);
			} catch (error) {
				try {
					await unlink(tmpPath);
				} catch (cleanupError) {
					if (cleanupError.code !== "ENOENT") throw cleanupError;
				}
				throw error;
			}
			const kept = remoteBankCache.path === path ? remoteBankCache : null;
			remoteBankCache = { path, mtimeNs: null, size: -1, text: serialized, doc, reloads: (kept ? kept.reloads : 0) + 1, error: null };
			remoteBankUpdate.updates++;
			updated = true;
		}
		remoteBankUpdate.lastSuccessAt = Date.now();
		remoteBankUpdate.lastError = null;
		return { ok: true, updated };
	} catch (error) {
		remoteBankUpdate.lastError = String((error && error.message) || error);
		return { ok: false, error: remoteBankUpdate.lastError };
	} finally {
		remoteBankUpdate.inFlight = false;
	}
}

/**
 * 启动自动更新定时器:串行执行(上一次没跑完不叠加请求),timer 挂 unref,不影响
 * 进程退出。返回停止函数,交给 ctx.effect 清理。
 */
function startRemoteBankUpdater() {
	if (!remoteBankUrl() || remoteBankIntervalMs() <= 0) return () => {};
	let timer = null;
	let stopped = false;
	const tick = async () => {
		try {
			await refreshRemoteBank();
		} catch (error) { /* refreshRemoteBank 内部已记录错误 */ }
		if (stopped || !remoteBankUrl() || remoteBankIntervalMs() <= 0) return;
		timer = setTimeout(tick, remoteBankIntervalMs());
		if (typeof timer.unref === "function") timer.unref();
	};
	timer = setTimeout(tick, 0);
	if (typeof timer.unref === "function") timer.unref();
	return () => {
		stopped = true;
		if (timer !== null) clearTimeout(timer);
	};
}

/** 自动更新的公开状态(诊断 / 测试用) */
function remoteBankStatus() {
	const url = remoteBankUrl();
	const intervalMs = remoteBankIntervalMs();
	const path = remoteBankPath();
	const current = remoteBankCache.path === path ? remoteBankCache : null;
	return {
		url,
		intervalMs,
		enabled: Boolean(url) && intervalMs > 0,
		path,
		loaded: Boolean(current && current.doc !== null),
		updates: remoteBankUpdate.updates,
		lastCheckAt: remoteBankUpdate.lastCheckAt || null,
		lastSuccessAt: remoteBankUpdate.lastSuccessAt || null,
		lastError: remoteBankUpdate.lastError
	};
}
/** 是否是可以递归比较的普通对象 */
function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** keyed 数组的元素标识键;以及「这条被删了」的内部墓碑键(delta 专用,不外发) */
const ARRAY_ID_KEY = "id";
const ARRAY_DELETED_KEY = "$deleted";

/**
 * 元素全是「带唯一非空字符串 id 的普通对象」的数组 → id → 元素;其余返回 null。
 * 只有这种数组按 id 逐条合并/求差异,别的数组(字符串表、无 id 的结构)保持整体替换。
 */
function keyedIndexOf(value) {
	if (!Array.isArray(value)) return null;
	const index = new Map();
	for (const item of value) {
		if (!isPlainObject(item)) return null;
		const id = item[ARRAY_ID_KEY];
		if (typeof id !== "string" || id.length === 0 || index.has(id)) return null;
		index.set(id, item);
	}
	return index;
}

/**
 * keyed 数组的差异:同 id 递归求差异,user 新增的整条带走,
 * base 有而 user 没有的写成墓碑 —— 否则 mergeLayers 会把 base 里那条顶回来,
 * 「删掉一个包 / 一个预设」就存不住。
 */
function deltaOfKeyedArray(baseList, userList) {
	const base = keyedIndexOf(baseList);
	const user = keyedIndexOf(userList);
	const out = [];
	for (const [id, item] of user) {
		const baseItem = base.get(id);
		if (baseItem === undefined) {
			out.push(item);
			continue;
		}
		const sub = deltaOf(baseItem, item);
		if (Object.keys(sub).length > 0) out.push({ [ARRAY_ID_KEY]: id, ...sub });
	}
	for (const id of base.keys()) {
		if (!user.has(id)) out.push({ [ARRAY_ID_KEY]: id, [ARRAY_DELETED_KEY]: true });
	}
	return out;
}

/**
 * 只保留 userDoc 相对 baseDoc 真正不同的部分(深层递归;带唯一 id 的对象数组按 id
 * 逐条求差异,其余数组整体替换)。
 *
 * 为什么需要:设置命名空间原本按顶层键整份覆盖,而提交上来的文档永远带着
 * 完整词库(13 个包 1105 条)→ 每次装载/保存都把 70+ KB 词库序列化进
 * `$DSH_HOME/settings.yaml`,配置文件和词库一起膨胀。
 *
 * 为什么数组要按 id:设置页保存时浏览器提交的是**完整文档**,只要有一个包被动过,
 * 「数组整体替换」就会把 12 个包整份写回存储(0.19.1 的真机上依然如此)。按 id 求
 * 差异后只有动过的那条进存储,语义与 mergeLayers 的 mergeKeyedArray 对称,所以
 * `mergeLayers(bundled, deltaOf(bundled, doc))` 仍与 doc 等价。
 * 纯函数,供测试。
 */
function deltaOf(baseDoc, userDoc) {
	if (!isPlainObject(userDoc)) return userDoc;
	const out = {};
	for (const [key, value] of Object.entries(userDoc)) {
		const baseValue = isPlainObject(baseDoc) ? baseDoc[key] : undefined;
		if (isPlainObject(value) && isPlainObject(baseValue)) {
			const sub = deltaOf(baseValue, value);
			if (Object.keys(sub).length > 0) out[key] = sub;
			continue;
		}
		if (keyedIndexOf(value) && keyedIndexOf(baseValue)) {
			const sub = deltaOfKeyedArray(baseValue, value);
			if (sub.length > 0) out[key] = sub;
			continue;
		}
		if (!deepEqualJson(baseValue, value)) out[key] = value;
	}
	return out;
}

/** 结构相等判断(JSON 语义;对象键序无关) */
function deepEqualJson(a, b) {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((item, index) => deepEqualJson(item, b[index]));
	}
	if (isPlainObject(a) && isPlainObject(b)) {
		const aKeys = Object.keys(a);
		if (aKeys.length !== Object.keys(b).length) return false;
		return aKeys.every((key) => Object.hasOwn(b, key) && deepEqualJson(a[key], b[key]));
	}
	return false;
}

/**
 * 合并配置文档:settings 层(userDoc)按顶层键覆盖文件层(fileDoc);纯函数,供测试。
 *
 * 顶层键整体覆盖(数组 / 标量 / 对象都一样)——这是历史行为,也是旧调用方的契约;
 * 需要「对象递归、数组整体替换」的分层语义请用 mergeLayers(与 dsh-settings 一致)。
 */
function mergeDocuments(fileDoc, userDoc) {
	if (!userDoc) return fileDoc || null;
	const out = {};
	if (fileDoc && typeof fileDoc === "object" && !Array.isArray(fileDoc)) Object.assign(out, fileDoc);
	Object.assign(out, userDoc);
	return out;
}

/**
 * keyed 数组的合并:同 id 递归合并(墓碑处删除),base 里没有的条目按 layer 顺序追加。
 */
function mergeKeyedArray(baseList, layerList) {
	const layer = keyedIndexOf(layerList);
	const out = [];
	for (const item of baseList) {
		const override = layer.get(item[ARRAY_ID_KEY]);
		if (override === undefined) {
			out.push(item);
			continue;
		}
		if (override[ARRAY_DELETED_KEY] === true) continue;
		out.push(mergeLayers(item, override));
	}
	for (const [id, item] of layer) {
		if (item[ARRAY_DELETED_KEY] === true) continue;
		if (baseList.some((base) => base[ARRAY_ID_KEY] === id)) continue;
		out.push(item);
	}
	return out;
}

/**
 * 分层合并多份配置文档:普通对象逐键递归,带唯一 id 的对象数组按 id 逐条递归合并,
 * 其余数组 / 标量整体替换。
 *
 * 与 dsh-settings 的分层语义同口径,所以
 * `mergeLayers(bundled, deltaOf(bundled, doc))` 才等价于 doc —— 这是
 * 「设置里只存差异」能成立的前提(见 deltaOf)。
 */
function mergeLayers(...layers) {
	let out = null;
	for (const layer of layers) {
		if (!isPlainObject(layer)) {
			if (layer !== undefined && layer !== null) out = layer;
			continue;
		}
		if (!isPlainObject(out)) {
			out = { ...layer };
			continue;
		}
		const merged = { ...out };
		for (const [key, value] of Object.entries(layer)) {
			const current = merged[key];
			if (isPlainObject(value) && isPlainObject(current)) merged[key] = mergeLayers(current, value);
			else if (keyedIndexOf(value) && keyedIndexOf(current)) merged[key] = mergeKeyedArray(current, value);
			// base 里没有这个数组时只能整体赋值,但墓碑是存储内部标记,不能漏进生效文档
			else if (keyedIndexOf(value)) merged[key] = value.filter((item) => item[ARRAY_DELETED_KEY] !== true);
			else merged[key] = value;
		}
		out = merged;
	}
	return out;
}

/**
 * 用户配置存储的落盘路径:`$DSH_HOME/status-rotator/config.json`(与词库同目录),
 * 可用 `DSH_STATUS_ROTATOR_CONFIG` 覆盖。
 *
 * 为什么不是包目录里的 `config.json`:npm / Release 升级会把包目录**整体替换**,
 * 放在里面的配置每次升级都会跟着没 —— issue #51「每次更新都会重置我设置的(比如关掉的
 * 弹幕又打开)」正是这条链。$DSH_HOME 下的文件不属于任何包,升级不会碰它。
 *
 * 为什么不是宿主设置存储:`@deepseek-ai/dsh-settings` 0.1.7-rc.1 的 settings 服务只有
 * `describe` / `update` / `replace` / `mutate` / `configure`,**没有**插件原来依赖的
 * `register()`(也没有 `document`),所以老实现里 `getSettingsApi()` 在真机上一直返回
 * null —— 整条官方存储链路静默失效,配置只剩包目录里的 config.json 一份。持久化因此
 * 落在插件自己的数据目录里,不再取决于宿主 API 的形状(老宿主仍会顺带写一份,见 saveConfig)。
 */
function userConfigPath() {
	const override = process.env[USER_CONFIG_ENV];
	if (typeof override === "string" && override.trim().length > 0) return override.trim();
	return join(dshHomeDirectory(), BANK_DIR, USER_CONFIG_FILE);
}

/**
 * 用户配置存储的内部键:随这份文件一起落盘,但不参与合并、也不发给浏览器。
 *  - SETTINGS_VERSION_KEY:区分「已经收敛过」和「还没动过」;
 *  - MIRROR_HASH_KEY:上一次由插件自己写进包目录 config.json 的内容指纹。有了它,
 *    启动后第一次 GET 才分得清那份 config.json 是「插件写的镜像」还是「用户手改的」——
 *    前者不能再搬一遍(会把上游旧词条冻结成用户改动),后者必须搬(否则升级就丢)。
 */
const SETTINGS_VERSION_KEY = "settingsVersion";
const MIRROR_HASH_KEY = "configMirrorHash";

/** 内容指纹(镜像认领用;不是安全边界) */
function digestOf(text) {
	return createHash("sha256").update(String(text), "utf8").digest("hex").slice(0, 32);
}

/** 用户配置存储里「可以参与合并」的部分:内部键剔掉 */
function userConfigBody(raw) {
	const doc = {};
	if (isPlainObject(raw)) {
		for (const [key, value] of Object.entries(raw)) {
			if (key === SETTINGS_VERSION_KEY || key === MIRROR_HASH_KEY) continue;
			doc[key] = value;
		}
	}
	return doc;
}

let userConfigCache = { path: null, mtimeNs: null, size: -1, text: null, doc: null, reloads: 0, error: null };

/** 读用户配置存储(含内部键);不存在 / 损坏返回 null(调用方按「没有用户配置」处理) */
async function readUserConfigDocument() {
	const result = await readCachedDocument(userConfigPath(), userConfigCache, (parsed) => parsed);
	userConfigCache = result.cache;
	return result.doc;
}

/** 用户配置存储的加载状态(诊断 / 测试用) */
function userConfigStatus() {
	const path = userConfigPath();
	const current = userConfigCache.path === path ? userConfigCache : null;
	return {
		path,
		loaded: Boolean(current && current.doc !== null),
		reloads: current ? current.reloads : 0,
		error: current ? current.error : null
	};
}

/** 原子写用户配置存储(先写同目录临时文件再 rename);写不进去就抛,由调用方决定怎么报错 */
async function writeUserConfigDocument(doc) {
	const path = userConfigPath();
	await mkdir(dirname(path), { recursive: true });
	const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
	try {
		await writeFile(tmpPath, JSON.stringify(doc, null, 4) + "\n", "utf8");
		await rename(tmpPath, path);
	} catch (error) {
		try {
			await unlink(tmpPath);
		} catch (cleanupError) {
			if (cleanupError.code !== "ENOENT") throw cleanupError;
		}
		throw error;
	}
	// 写盘后就地更新缓存(mtimeNs 置空 → 下一次读会重新 stat,拿到的仍是盘上的真实内容)
	userConfigCache = { path, mtimeNs: null, size: -1, text: null, doc, reloads: userConfigCache.path === path ? userConfigCache.reloads + 1 : 1, error: null };
}

/**
 * 「随包」基准层:内置默认文档 + 自动更新词库。
 * 用户配置存储里只放与它的差异 —— 自动更新来的词条不是用户改动,不该被一次保存
 * 冻结成设置快照(否则存储层会永远压住上游,自动更新对那个包就失效了)。
 */
async function shippedBaselineDocument() {
	return mergeLayers(await bundledDocument(), await remoteBankDocument());
}

/**
 * 词库包只做「合并且改内容」:存储里**永不**写「某个包被删了」的墓碑。
 *
 * 为什么:设置页的词库包区只有「启用 / 停用」开关和文案编辑,**没有删除按钮**
 * (预设才有删除),所以「提交上来的文档里少了某个包」只可能是文档本身不完整 ——
 * 设置页开着的时候插件升级 / 上游新增了包 / 这次提交的文档是残缺的 —— 而不是用户删的。
 * 一旦按删除记进存储,内置词库会被静默清空:生效文档成为 `packs: []` 而 `enabledPacks`
 * 还剩 10 条,设置页于是显示「共 0 个包,已启用 10 个」「暂无词库包」(外部反馈的现象),
 * 而且此后每次保存都会把这份残缺文档再存一次,永久卡住。
 *
 * 内容差异照旧保留(改过文案的包仍然进存储);删除墓碑只对「预设」这类真的有删除入口的
 * 数组有意义。纯函数,供测试。
 */
function withoutPackDeletions(delta) {
	if (!isPlainObject(delta) || !Array.isArray(delta.packs)) return delta;
	const kept = delta.packs.filter((entry) => !(isPlainObject(entry) && entry[ARRAY_DELETED_KEY] === true));
	if (kept.length === delta.packs.length) return delta;
	const out = { ...delta };
	if (kept.length > 0) out.packs = kept; else delete out.packs;
	return out;
}

/**
 * 用户配置存储里该写什么 = 提交上来的完整文档相对「随包基准」的差异。
 *
 * 设置页每次提交的都是**完整文档**(lib/client.js:`persist` 在最新文档上应用改动),
 * 所以这里是从零重算而不是和上一次的差异叠加:用户把某项改回默认值、或删掉自己加的
 * 词条时,重算出来的差异里就没有它了(叠加语义做不到「删除」,会把旧值永久留下)。
 * 纯函数,供测试。
 */
function userConfigDeltaFor(baseline, document) {
	const delta = baseline ? deltaOf(baseline, document) : document;
	return isPlainObject(withoutPackDeletions(delta)) ? withoutPackDeletions(delta) : {};
}

/**
 * 包目录 `config.json` 里「值得搬进用户配置存储」的那部分。
 *
 * 差异基准是**内置默认**(不是内置 + 自动更新):Release 包里那份 `config.json` 就是
 * `config.example.json` 的拷贝,拿自动更新词库当基准会把「上游新增的词条」反向算成
 * 用户删改,把上游词库钉回旧版(老的一次性收敛 trimSettingsSection 用的同样是
 * `deltaOf(bundled, fileDoc)`,语义与它一致,只是这里文件一变就会再跑一次)。
 *
 * 再拿「内置 + 自动更新」整池 prune 一遍:快照里那些「只是随包 / 上游旧版」的词条
 * 不算用户改动(pruneShippedBloat 本来就是为老安装里那份整库快照写的)。纯函数,供测试。
 */
function absorbableFileDelta(bundled, baseline, parsed) {
	return pruneShippedBloat(baseline, userConfigDeltaFor(bundled, parsed));
}

/** 包目录 config.json 的探测缓存:只看 mtime + size,内容变了才真读 */
let fileLayerCache = { mtimeNs: null, size: -1 };

/**
 * 包目录里那份 `config.json` 是「插件写的镜像」还是「用户手改的」?
 * 返回需要搬进用户配置存储的原文;返回 null 表示不用搬(没文件 / 没变 / 就是我们写的镜像)。
 */
async function unabsorbedFileLayerText() {
	const path = CONFIG_PATH;
	let info = null;
	try {
		info = await stat(path, { bigint: true });
	} catch (error) {
		fileLayerCache = { mtimeNs: null, size: -1 };
		return null; // 没有文件就没有可搬的东西(升级后正是这种情况)
	}
	const mtimeNs = info.mtimeNs.toString();
	const size = Number(info.size);
	if (fileLayerCache.mtimeNs === mtimeNs && fileLayerCache.size === size) return null;
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		return null; // 竞态:stat 之后被删/被换
	}
	fileLayerCache = { mtimeNs, size };
	const raw = await readUserConfigDocument();
	// 指纹对得上 → 这份文件是插件自己写的镜像,不必再搬(搬了会把写镜像那一刻的上游
	// 词库快照冻结成用户改动)。指纹是 null = 上一次镜像写盘失败,同样不认领:
	// 盘上留着的可能是更老的内容,搬它会把用户刚保存的设置顶回去。
	if (raw && raw[MIRROR_HASH_KEY] !== undefined && raw[MIRROR_HASH_KEY] !== null && raw[MIRROR_HASH_KEY] === digestOf(text)) return null;
	return text;
}

/**
 * 把包目录 `config.json` 里用户改过的部分搬进用户配置存储。
 *
 * 为什么必须搬:README 明确允许「调文案或选项直接改文件」,而那份文件在插件升级时
 * 会被整体替换掉 —— 不趁它还在的时候搬走,改动就随升级消失(issue #51 的场景 A / B)。
 * 为什么在 serve 路径上搬:页面打开时每 `reloadIntervalMs` 就 GET 一次,所以最迟十几秒内
 * 会被搬走,不用等重启;而重启往往已经是升级之后了,那时文件早没了。
 *
 * 只搬「与内置默认的差异」,并过一次 pruneShippedBloat(它本来就是为「老安装里那份整库
 * 快照」准备的收敛器,见 absorbableFileDelta)。幂等:内容没变、或与存储里已有的值一致
 * 时都不写盘。
 */
async function absorbFileLayer() {
	const text = await unabsorbedFileLayerText();
	if (text === null) return false;
	let parsed = null;
	try {
		parsed = validateConfigDocument(JSON.parse(text));
	} catch (error) {
		return false; // 坏文件不搬:serve 时它本来就会被忽略
	}
	const delta = absorbableFileDelta(await bundledDocument(), await shippedBaselineDocument(), parsed);
	const raw = await readUserConfigDocument();
	const current = userConfigBody(raw);
	const merged = mergeLayers(current, delta);
	if (!isPlainObject(merged) || deepEqualJson(merged, current)) return false;
	const next = { ...merged, [SETTINGS_VERSION_KEY]: SETTINGS_VERSION };
	if (raw && raw[MIRROR_HASH_KEY] !== undefined) next[MIRROR_HASH_KEY] = raw[MIRROR_HASH_KEY];
	await writeUserConfigDocument(next);
	return true;
}

/**
 * 读用户配置存储,顺手治好已经被写进去的「词库包已删除」墓碑(见 withoutPackDeletions)。
 *
 * 为什么要在读的时候治:受影响的安装里存储**已经**存着一份残缺文档,只在保存路径上堵住
 * 并不能让它们恢复 —— 每次 GET 都会把 0 个包的文档发给设置页,保存又原样写回来。这里幂等
 * 地清掉墓碑并把干净的那份写回存储(写不进去也照样服务干净的那一份)。
 */
async function healedUserConfigDocument() {
	const raw = await readUserConfigDocument();
	const body = userConfigBody(raw);
	const healed = withoutPackDeletions(body);
	if (healed === body) return body;
	try {
		const next = { ...healed, [SETTINGS_VERSION_KEY]: SETTINGS_VERSION };
		if (raw && raw[MIRROR_HASH_KEY] !== undefined) next[MIRROR_HASH_KEY] = raw[MIRROR_HASH_KEY];
		await writeUserConfigDocument(next);
	} catch (error) { /* 写不进去不影响这一次 serve */ }
	return healed;
}

/** 生效配置文档:内置默认 → 插件目录 config.json → 自动更新词库 → 老宿主设置存储 → 用户配置存储 → 外部词库 */
async function effectiveConfigDocument(getSettingsApi) {
	const s = await getSettingsApi();
	let userDoc = null;
	if (s) {
		try {
			const v = s.scope.get();
			if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0) userDoc = v;
		} catch (error) { /* ignore */ }
	}
	// 先把包目录里手改的 config.json 搬进用户配置存储(升级会把包目录整体换掉,#51);
	// 搬不动也不影响这一次 serve —— 文件层本身还在生效。
	try {
		await absorbFileLayer();
	} catch (error) { /* ignore */ }
	const fileDoc = await readFileDocument(true);
	// 两个可选的词库层,顺序即优先级(低 → 高):
	//   自动更新词库(remote):上游 main 的 config.example.json 落盘缓存,压在
	//     config.json 之上(否则插件目录/示例文件层会把它整份顶掉),但在用户配置之下
	//     —— 用户显式保存过的包仍以用户为准;上游新增的包按 id 追加,不影响其余包。
	//   本地词库(bank):手改的那份,优先级最高,改完即生效(见 externalBankDocument)。
	// 两者都只带 packs / phrases,不会碰运行时配置。
	const remoteDoc = await remoteBankDocument();
	// 用户配置存储($DSH_HOME/status-rotator/config.json):设置页保存的落点,
	// 也是「手改 config.json」被搬过来的落点;升级插件不会清空它(issue #51)。
	const storedDoc = await healedUserConfigDocument();
	const bankDoc = await externalBankDocument();
	return mergeLayers(await bundledDocument(), fileDoc, remoteDoc, userDoc, storedDoc, bankDoc);
}

/**
 * 设置命名空间里存的是「与随包默认文档的差异」,外加一个标记键区分
 * 「已经导入过」和「还没有动过」。标记键同样要留在存储里,只是不发给浏览器。
 */
// 2:0.19.1 的收敛在真机上会空转(随包词库变了 → 整份照写),这里带 pruneShippedBloat
// 再收敛一次;老 section 会因此被重写一遍,之后幂等。
// 3:再收敛一次,顺带把老版本可能写下的「词库包已删除」墓碑清掉(pruneShippedBloat 丢墓碑)
//   —— 那是「共 0 个包,已启用 10 个」那类反馈的另一种来源(见 withoutPackDeletions)。
const SETTINGS_VERSION = 3;

/**
 * 保存时写进设置存储的差异 = 上一次的差异 ⊕ 本次差异。
 *
 * 为什么必须带上一次:保存完成后还会把整份文档镜像进插件目录 config.json(供不认设置
 * 存储的宿主 / 旧版本读),而这份镜像是下一次保存的基准层之一。若只存「本次差异」,用户
 * 第二次保存(设置页改动即写盘,几乎必然发生)时上一次的设置已经在基准里 → 差异为空 →
 * 设置从存储里消失;插件升级清掉 config.json 后这次设置就丢了 —— issue #51「每次更新
 * 都会重置我设置的(比如关掉的弹幕又打开)」正是这条链。
 *
 * 上一次差异里的词条不是本次用户改动,但确实是用户当初改过的部分,应当保留;随包 /
 * 自动更新来的词条仍不会进存储(基准层没变,差值依旧为空)。纯函数,供测试。
 */
function settingsDeltaFor(bundled, fileDoc, remoteDoc, previous, document) {
	const baseline = mergeLayers(bundled, fileDoc, remoteDoc);
	const next = baseline ? deltaOf(baseline, document) : document;
	const merged = mergeLayers(isPlainObject(previous) ? previous : {}, isPlainObject(withoutPackDeletions(next)) ? withoutPackDeletions(next) : {});
	return isPlainObject(merged) ? merged : {};
}

/** 从 scope 拿**原始**存储 section(不是解析后的合并值) */
function rawSection(s) {
	try {
		const section = s.provider?.document?.[SETTINGS_NS];
		return isPlainObject(section) ? section : null;
	} catch (error) {
		return null;
	}
}

/** 去掉内部标记键,得到可以直接合并/应答的配置文档 */
function contentTypeOf(doc) {
	if (!isPlainObject(doc)) return {};
	return userConfigBody(doc);
}

/** 词条的归一化比较形式:字符串去掉所有空白,加权词条按固定键序序列化 */
function normalizeEntry(value) {
	if (typeof value === "string") return value.replace(/\s+/g, "");
	if (isPlainObject(value) && typeof value.text === "string") {
		return JSON.stringify(value.weight === undefined ? { text: value.text } : { text: value.text, weight: value.weight });
	}
	return JSON.stringify(value);
}

/** 是不是「词条数组」(字符串表,或 {text,weight} 加权词条表) */
function isEntryArray(value) {
	return Array.isArray(value)
		&& value.every((item) => typeof item === "string" || (isPlainObject(item) && typeof item.text === "string"));
}

/** 随包词库里出现过的全部词条(归一化后进集合),用来判断某条到底是不是用户写的 */
function shippedEntryPool(bundled) {
	const pool = new Set();
	const collect = (value) => {
		if (isEntryArray(value)) {
			for (const item of value) pool.add(normalizeEntry(item));
			return;
		}
		if (Array.isArray(value)) {
			for (const item of value) collect(item);
			return;
		}
		if (isPlainObject(value)) for (const item of Object.values(value)) collect(item);
	};
	try {
		collect((bundled?.packs ?? []).map((pack) => pack?.phrases));
		collect(bundled?.phrases);
	} catch (error) { /* ignore */ }
	return pool;
}

/**
 * 把「随包词库里已经有的词条」从差异里剔掉,只留用户真正自己写的条目。
 * 返回 undefined 表示这一层剔空了。
 */
function residualLibrary(deltaNode, pool) {
	if (isEntryArray(deltaNode)) {
		const kept = deltaNode.filter((item) => !pool.has(normalizeEntry(item)));
		return kept.length > 0 ? kept : undefined;
	}
	if (isPlainObject(deltaNode)) {
		const out = {};
		for (const [key, value] of Object.entries(deltaNode)) {
			const sub = residualLibrary(value, pool);
			if (sub !== undefined) out[key] = sub;
		}
		return Object.keys(out).length > 0 ? out : undefined;
	}
	return deltaNode;
}

/**
 * 遗留整库收敛:把 delta 里「只是随包词库旧版」的差异再剔一遍。
 *
 * 为什么 deltaOf 还不够:随包词库自己会随版本变化(加词条、调排版),
 * 老安装存在设置里的整份词库于是处处「不相等」→ 整份照写回去,收敛成了空转
 * (0.19.1 在真机上正是如此:82,966 B → 81,926 B)。这里换个问法:这条词条
 * 随包词库里到底有没有?有 → 那是旧版随包数据,不算用户改动。
 *  - packs:整个包都是随包词库里的旧条目 → 丢掉;包里有一条随包没有的(用户改过
 *    措辞 / 自己加过)→ 整条保留,语义和保存路径一致;
 *  - 顶层遗留 phrases(单体词库):逐条留残差,用户额外加的那些一条不丢;
 *  - 删除墓碑一律不写:老库里没有的包只是「那个包当时还没发布」,不是用户删的。
 * 只在一次性收敛(trimSettingsSection)里用,保存路径仍是 deltaOf 的精确语义。
 */
function pruneShippedBloat(bundled, delta) {
	if (!isPlainObject(bundled) || !isPlainObject(delta)) return delta;
	const pool = shippedEntryPool(bundled);
	const out = { ...delta };
	if (Array.isArray(out.packs)) {
		const kept = [];
		for (const entry of out.packs) {
			if (!isPlainObject(entry)) { kept.push(entry); continue; }
			if (entry[ARRAY_DELETED_KEY] === true) continue;
			const bundledPack = (bundled.packs ?? []).find((pack) => pack?.id === entry[ARRAY_ID_KEY]);
			if (!bundledPack) { kept.push(entry); continue; } // 随包没有的包:用户自建,保留
			const { [ARRAY_ID_KEY]: id, ...content } = entry;
			if (residualLibrary(content, pool) !== undefined) kept.push(entry);
		}
		if (kept.length > 0) out.packs = kept; else delete out.packs;
	}
	if (isPlainObject(out.phrases)) {
		const residual = residualLibrary(out.phrases, pool);
		if (residual !== undefined) out.phrases = residual; else delete out.phrases;
	}
	return out;
}

/**
 * 一次性把历史遗留的整份文档收敛成「差异 + 标记」:
 *  - 有 config.json(老版本/解压包导入过) → 只保留与随包默认不同的部分;
 *  - 没有 config.json 但存储里已经是历史遗留的整份文档(升级上来的) → 同样收敛。
 * 两条分支都会再过一遍 pruneShippedBloat,否则随包词库一变,整份又原样写回。
 * 幂等:第二次起 section 已经带标记,直接跳过。
 */
async function trimSettingsSection(s) {
	const raw = rawSection(s);
	if (!raw) return; // 拿不到原始 section 就不动存储,避免误覆盖
	if (raw[SETTINGS_VERSION_KEY] === SETTINGS_VERSION) return;
	const stored = contentTypeOf(raw);
	const hasStored = Object.keys(stored).length > 0;
	const fileDoc = await readFileDocument(false);
	const bundled = await bundledDocument();
	let next;
	if (fileDoc && bundled) {
		// config.json 是用户改过的可信来源,优先于历史遗留的整份存储
		next = { ...pruneShippedBloat(bundled, deltaOf(bundled, fileDoc)), [SETTINGS_VERSION_KEY]: SETTINGS_VERSION };
	} else if (hasStored && bundled) {
		next = { ...pruneShippedBloat(bundled, deltaOf(bundled, stored)), [SETTINGS_VERSION_KEY]: SETTINGS_VERSION };
	} else {
		next = { [SETTINGS_VERSION_KEY]: SETTINGS_VERSION };
	}
	await s.scope.replace(next);
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
			res.end(JSON.stringify(contentTypeOf(doc), null, 4) + "\n");
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

/**
 * 保存设置页提交的完整文档。
 *
 * 落盘顺序(**持久化以用户配置存储为准**):
 *   1. 用户配置存储 `$DSH_HOME/status-rotator/config.json` —— 升级不会被替换,写不进去
 *      就明确 500,不假装保存成功(v0.26.0 及以前只写包目录,升级即丢,#51);
 *   2. 包目录 `config.json` 兼容镜像 —— 文档 / 老版本 / 手改工作流都认它,失败不算保存
 *      失败(数据已经在存储里了),只是把指纹记成 null 不再认领这个文件;
 *   3. 老宿主(settings 服务还带 `register` 的那代)顺带写一份官方命名空间。
 */
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

	// 兼容镜像先写:存储里要记下「这份镜像是插件写的」的指纹,顺序反了就会把上一轮的
	// 指纹配到新内容上,下次启动会把手改/旧镜像误当成用户改动又搬一遍(见 absorbFileLayer)。
	const mirrorText = JSON.stringify(document, null, 4) + "\n";
	const mirrorOk = await writeMirrorFile(mirrorText);

	// 只写「与随包基准(内置 + 自动更新词库)的差异」:整份词库留在包内的
	// config.example.json,用户配置存储不跟着词库一起膨胀;自动更新来的词条也不算用户改动。
	const bundled = await bundledDocument();
	const delta = userConfigDeltaFor(await shippedBaselineDocument(), document);
	try {
		await writeUserConfigDocument({
			...delta,
			[SETTINGS_VERSION_KEY]: SETTINGS_VERSION,
			[MIRROR_HASH_KEY]: mirrorOk ? digestOf(mirrorText) : null
		});
	} catch (error) {
		res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ ok: false, error: `设置持久化失败: ${error.message}(${userConfigPath()})` }));
		return;
	}

	// 老宿主:官方设置命名空间也写一份(新版 dsh 的 settings 服务没有 register,
	// getSettingsApi() 返回 null,这段自然跳过)。它已经不是权威副本,失败不影响保存结果。
	const s = await getSettingsApi();
	if (s) {
		try {
			const stored = {
				...settingsDeltaFor(
					bundled,
					await readFileDocument(true),
					await remoteBankDocument(),
					contentTypeOf(rawSection(s) || {}),
					document
				),
				[SETTINGS_VERSION_KEY]: SETTINGS_VERSION
			};
			await s.scope.replace(stored);
		} catch (error) { /* ignore */ }
	}

	res.writeHead(200, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-cache"
	});
	res.end(JSON.stringify({ ok: true, mirror: mirrorOk }));
}

/**
 * 把整份文档原子写进包目录的 `config.json`(兼容镜像)。返回是否写成功。
 * 失败不抛:包目录在 pnpm store / 解压包里可能是只读的,而持久化已经落在用户配置存储里了。
 */
async function writeMirrorFile(text) {
	const tmpPath = `${CONFIG_PATH}.tmp-${process.pid}-${Date.now()}`;
	try {
		await writeFile(tmpPath, text, "utf8");
		await rename(tmpPath, CONFIG_PATH);
		return true;
	} catch (error) {
		try {
			await unlink(tmpPath);
		} catch (cleanupError) {
			if (cleanupError.code !== "ENOENT") return false;
		}
		return false;
	}
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
			settingsApi = { scope, provider: settings };
			// 一次性收敛:见 trimSettingsSection(幂等,只在没有标记时动手)
			try {
				await trimSettingsSection(settingsApi);
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
	/**
	 * 自动更新:定时拉上游词库(默认 6 小时;DSH_STATUS_ROTATOR_BANK_INTERVAL_MS=0
	 * 或 DSH_STATUS_ROTATOR_BANK_URL=off 可关闭)。拉取、校验、写盘都在后台,
	 * 失败只记录状态,永远不影响正在服务的词库。
	 */
	ctx.effect(() => startRemoteBankUpdater(), "status-rotator: remote bank updater");

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
	dshHomeDirectory,
	externalBankPath,
	externalBankDocument,
	externalBankStatus,
	phraseOnlyDocument,
	remoteBankPath,
	remoteBankDocument,
	remoteBankUrl,
	remoteBankIntervalMs,
	remoteBankStatus,
	refreshRemoteBank,
	validateConfigDocument,
	sanitizeConfigDocument,
	sanitizeConfig,
	isSafeColor,
	isSafeShadow,
	danmakuModeToken,
	DANMAKU_FIXED_LIMITS,
	isTrustedWrite,
	isTrustedRead,
	mergeDocuments,
	mergeLayers,
	deltaOf,
	settingsDeltaFor,
	deepEqualJson,
	contentTypeOf,
	pruneShippedBloat,
	keyedIndexOf,
	normalizeEntry,
	SETTINGS_VERSION,
	SETTINGS_VERSION_KEY,
	MIRROR_HASH_KEY,
	ARRAY_DELETED_KEY,
	resolveSettingsNamespace,
	userConfigPath,
	userConfigBody,
	userConfigStatus,
	readUserConfigDocument,
	writeUserConfigDocument,
	shippedBaselineDocument,
	userConfigDeltaFor,
	withoutPackDeletions,
	healedUserConfigDocument,
	absorbableFileDelta,
	absorbFileLayer
};
