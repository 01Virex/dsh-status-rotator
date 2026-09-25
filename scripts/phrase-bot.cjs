// 词库投稿机器人 —— 单个自包含脚本,零 npm 依赖,CI 里直接 `node scripts/phrase-bot.cjs`。
//
// 流程(由 .github/workflows/phrase-submit.yml 在 issues opened/reopened/labeled 且
// 命中「词库投稿」标签或正文表单标记时触发):
//   1. 解析 Issue:优先取表单字段(github event 的 issue.form),回退解析 markdown body;
//   2. 校验:必须有语种/分组文案、单条上限、禁止 HTML/链接/控制字符、提交须知勾选、查重;
//   3. 归一化:与 scripts/unify-ellipsis.cjs 同规则 —— "..."→"…"、末尾补 "…";
//   4. 评论回复:校验结果 + 预览表格 + 可直接粘贴的"立即试用"JSON;
//   5. 校验通过:开分支 phrase-bot/issue-<n> → 写入 config.example.json → push → 开 PR
//      (label=词库投稿),再评论 PR 链接。维护者点 Merge 即收录,随下次发版分发。
//   6. 刷新模式(main 前进 / 定时 / 手动触发):把所有还开着的投稿分支按**当前 main**
//      重建并强推 —— 否则任何一次投稿合并之后,其它投稿 PR 都会 CONFLICTING,只能人工
//      解 JSON 冲突,而那正是重复键/漏逗号的来源(见 runRefresh 注释)。
//
// 环境变量:GITHUB_TOKEN / EVENT_PATH(github.event_path)/ REPO(owner/name)
// 前置:workflow 已 checkout 仓库且进程 cwd = 仓库根目录(lib 与 config.example.json 同级)。
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { syncRepoFiles } = require("./sync-bank-counts.cjs");

const ELLIPSIS = "\u2026";
const LABEL = "词库投稿";
const MAX_PHRASE_LEN = 200; // 单条文案上限(字符)
const MAX_PHRASES = 60; // 单次提交文案行数上限
const MAX_TOTAL_ITEMS = 120; // 展开后 lang×phase×phrases 总条目上限
const BANNED_HTML = /<\/?[a-zA-Z]/; // 防 HTML/script 注入(客户端以 textContent 渲染,双保险)
const BANNED_URL = /https?:\/\/|www\./i; // 疑似广告链接
const BANNED_CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const asArray = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);
const trunc = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s);
const stripListMark = (line) => line.replace(/^\s*[-*+]\s*(\[[ x]\]\s*)?/, "").trim();

/**
 * 逐字符找 JSON 里的**重复键**。
 *
 * 为什么要自己扫:`JSON.parse` 对重复键是静默的 —— 同名的后一个键直接覆盖前一个,
 * 解析成功、长度看着正常,词条却已经无声丢了。而这个仓库的历史上真的踩过:
 * 投稿分支落后于 main 时 PR 会 CONFLICTING,人工解 `config.example.json` 的 JSON 冲突
 * 极易解出重复的 `running` / `long`(两边的内容都塞进同一个 `zh` 对象),或漏掉逗号
 * (后者被 0.23.4 记录过)。所以在**写盘自检**和 **CI** 两处都挡一道。
 *
 * 返回 [{ path, key }];解析失败(非 JSON)不在这里报,由调用方先 JSON.parse。
 */
function findDuplicateKeys(text) {
	const src = String(text);
	const dups = [];
	// 每层:{ type: "object"|"array", keys: Set, path: string }
	const stack = [];
	const top = () => stack[stack.length - 1];
	/** 当前层里最近读到的键的完整路径(下一个 { / [ 就用它当自己的路径) */
	let pendingPath = null;
	let i = 0;
	const n = src.length;
	while (i < n) {
		const c = src[i];
		if (c === '"') {
			let j = i + 1;
			let out = "";
			while (j < n) {
				const d = src[j];
				if (d === "\\") {
					out += src.slice(j, j + 2);
					j += 2;
					continue;
				}
				if (d === '"') break;
				out += d;
				j += 1;
			}
			const after = j + 1;
			let k = after;
			while (k < n && /\s/.test(src[k])) k += 1;
			const frame = top();
			if (src[k] === ":" && frame && frame.type === "object") {
				const full = `${frame.path}.${out}`;
				if (frame.keys.has(out)) dups.push({ path: full, key: out });
				frame.keys.add(out);
				pendingPath = full;
			}
			i = after;
			continue;
		}
		if (c === "{" || c === "[") {
			const frame = top();
			const base = pendingPath !== null ? pendingPath : (frame ? frame.path : "$");
			const path = c === "[" ? `${base}[]` : base;
			stack.push({ type: c === "{" ? "object" : "array", keys: new Set(), path });
			pendingPath = null;
			i += 1;
			continue;
		}
		if (c === "}" || c === "]") {
			stack.pop();
			pendingPath = null;
			i += 1;
			continue;
		}
		i += 1;
	}
	return dups;
}

/** 解析 + 重复键自检:任何一处重复键都抛错(信息里带路径,便于定位) */
function parseBankStrict(text, label) {
	const doc = JSON.parse(text);
	const dups = findDuplicateKeys(text);
	if (dups.length > 0) {
		const where = dups.slice(0, 5).map((d) => `${d.path}`).join(", ");
		throw new Error(`${label || "JSON"} 存在重复键(JSON.parse 会静默丢掉前一个,条目会无声丢失): ${where}`);
	}
	return doc;
}

/** 归一化单条文案:与 scripts/unify-ellipsis.cjs 的 fixPhrase 完全一致 */
function normalizePhraseText(raw) {
	let t = String(raw).trim().replace(/\t+/g, " ");
	t = t.replace(/\.{2,}/g, ELLIPSIS);
	if (!t.endsWith(ELLIPSIS)) t += ELLIPSIS;
	return t;
}

/** 语种字段 → ["zh"] / ["en"] / ["zh","en"] */
function parseLangValue(value) {
	const s = asArray(value).join(" ").toLowerCase();
	const out = [];
	if (/\bzh\b|中文/.test(s)) out.push("zh");
	if (/\ben\b|english/.test(s)) out.push("en");
	return out;
}

/** 分组字段 → ["thinking","running","long"] 子集 */
function parsePhaseValue(value) {
	const s = asArray(value).join(" ").toLowerCase();
	if (/全部|都要|all/.test(s)) return ["thinking", "running", "long"];
	const out = [];
	if (s.includes("thinking") || s.includes("刚开始")) out.push("thinking");
	if (s.includes("running") || s.includes("运行中")) out.push("running");
	if (s.includes("long") || s.includes("长时间")) out.push("long");
	return out;
}

/** 文案 textarea → 非空行数组(忽略空行、# 注释行与 ``` 代码围栏) */
function parsePhraseLines(text) {
	if (typeof text !== "string") return [];
	return String(text)
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("```") && !/^---+$/.test(l));
}

/** markdown body 回退解析:按 "### 标题" 切节,仅当表单字段缺失时使用 */
function parseBodyFallback(body) {
	if (typeof body !== "string" || body.length === 0) return {};
	const sections = new Map();
	for (const part of body.split(/^###[ \t]+/m).slice(1)) {
		const nl = part.indexOf("\n");
		const heading = (nl === -1 ? part : part.slice(0, nl)).trim().replace(/\s*\(.*\)\s*$/, "");
		sections.set(heading, nl === -1 ? "" : part.slice(nl + 1));
	}
	const section = (keyRe) => {
		for (const [k, v] of sections) if (keyRe.test(k)) return v;
		return "";
	};
	const firstListLine = (text) => {
		for (const line of text.split(/\r?\n/)) {
			const t = stripListMark(line);
			if (t.length === 0 || /^_no response_$/i.test(t) || t.startsWith("```")) continue;
			return t;
		}
		return "";
	};
	const out = {};
	const langSection = section(/^语种/);
	if (langSection) out.lang = firstListLine(langSection) || (langSection.trim() === "" ? "" : langSection.trim());
	const phaseSection = section(/^分组/);
	if (phaseSection) out.phase = firstListLine(phaseSection);
	const phraseSection = section(/^文案/);
	if (phraseSection) {
		out.phrases = phraseSection
			.split(/\r?\n/)
			.map((l) => stripListMark(l))
			.filter((l) => l.length > 0 && !l.startsWith("#") && !/^---+$/.test(l))
			.join("\n");
	}
	const nameSection = section(/^署名/);
	if (nameSection) out.name = firstListLine(nameSection);
	const packSection = section(/^目标词库包/);
	if (packSection) out.pack = firstListLine(packSection);
	const rulesSection = section(/^提交须知/);
	if (rulesSection) out.rules = /- \[x\]/i.test(rulesSection) ? ["确认"] : [];
	return out;
}

/** 目标词库包值归一:取第一个空白/括号前的 token 作为 id(兼容表单选项文本),非法 → community */
function parsePackValue(value) {
	const token = String(value || "").trim().split(/[\s（(]/)[0].toLowerCase();
	return /^[a-z0-9][a-z0-9-]*$/.test(token) ? token : COMMUNITY_PACK_ID;
}

/**
 * 解析投稿表单(优先 issue.form,缺失字段回退 body):
 * form = { lang, phase, phrases, name, rules };body 为渲染后的 markdown。
 * 返回 { langs, phases, phrases, name, confirmed } 或 { error }。
 */
function parseSubmission(form, body) {
	form = form && typeof form === "object" ? form : {};
	const f = {};
	for (const key of ["lang", "phase", "phrases", "name", "rules", "pack"]) {
		const fromForm = form[key];
		f[key] = fromForm === undefined || fromForm === null ? undefined : fromForm;
	}
	const fallback = parseBodyFallback(body);
	if (f.lang === undefined && fallback.lang !== undefined) f.lang = fallback.lang;
	if (f.phase === undefined && fallback.phase !== undefined) f.phase = fallback.phase;
	if (f.phrases === undefined && fallback.phrases !== undefined) f.phrases = fallback.phrases;
	if (f.name === undefined && fallback.name !== undefined) f.name = fallback.name;
	if (f.pack === undefined && fallback.pack !== undefined) f.pack = fallback.pack;
	if (f.rules === undefined && fallback.rules !== undefined) f.rules = fallback.rules;

	const langs = parseLangValue(f.lang);
	const phases = parsePhaseValue(f.phase);
	// textarea 可能带 "\n"-escaped 的一段文本
	let rawText = Array.isArray(f.phrases) ? f.phrases.join("\n") : String(f.phrases || "");
	rawText = rawText.replace(/\\n/g, "\n");
	const phrases = parsePhraseLines(rawText);
	const confirmed = asArray(f.rules).length > 0;

	if (langs.length === 0 && phases.length === 0 && phrases.length === 0 && !confirmed) {
		return { error: "无法识别表单内容:请使用「词库投稿」模板重新提交(需填写语种、分组和文案,并勾选提交须知)。" };
	}
	// 目标词库包:表单下拉值或正文「目标词库包」段首个值;归一为小写 id,非法/缺省 → community
	return { langs, phases, phrases, name: stripListMark(String(f.name || "")).slice(0, 40), confirmed, pack: parsePackValue(f.pack) };
}

/** 取词库某语言某分组的文案列表(合并视图:核心词库 + 全部词库包;兼容旧格式:短语数组直接当 thinking) */
function bankLists(bank, lang, phase) {
	const out = [];
	const collect = (ph) => {
		const entry = ph && ph[lang];
		if (entry == null) return;
		const list = Array.isArray(entry) ? entry : entry[phase];
		if (Array.isArray(list)) out.push(...list);
	};
	collect(bank && bank.phrases && typeof bank.phrases === "object" ? bank.phrases : bank);
	if (bank && Array.isArray(bank.packs)) {
		for (const pack of bank.packs) {
			if (pack && pack.phrases && typeof pack.phrases === "object") collect(pack.phrases);
		}
	}
	return out;
}

/** 条目文本(兼容加权对象 { text, weight });非文案返回 null */
const phraseText = (e) => (
	typeof e === "string" ? e
	: (e !== null && typeof e === "object" && typeof e.text === "string" ? e.text : null)
);

/**
 * 校验投稿。返回 { ok, errors: string[], items: [{lang, phase, text}], skipped: number }。
 * 格式错误 → 整体拒绝(errors);与现有词库重复 → 跳过并计数,不阻断其余文案。
 */
function validateSubmission(sub, bank) {
	const errors = [];
	if (!sub.confirmed) errors.push("未勾选「提交须知」复选框");
	if (sub.langs.length === 0) errors.push("语种字段缺失或无法识别");
	if (sub.phases.length === 0) errors.push("分组字段缺失或无法识别");
	if (sub.phrases.length === 0) errors.push("文案为空:请在表单里一行填一条文案");
	if (sub.phrases.length > MAX_PHRASES) errors.push(`一次最多提交 ${MAX_PHRASES} 条文案,收到 ${sub.phrases.length} 条`);

	for (const raw of sub.phrases) {
		const probs = [];
		if (raw.length > MAX_PHRASE_LEN) probs.push(`超过 ${MAX_PHRASE_LEN} 字符`);
		if (BANNED_HTML.test(raw)) probs.push("含 HTML/脚本标签");
		if (BANNED_URL.test(raw)) probs.push("含链接(疑似广告)");
		if (BANNED_CTRL.test(raw)) probs.push("含非法控制字符");
		if (probs.length) errors.push(`「${trunc(raw, 24)}」: ${probs.join("; ")}`);
	}
	if (errors.length) return { ok: false, errors, items: [], skipped: 0 };

	const items = [];
	let skipped = 0;
	const seen = new Set();
	for (const lang of sub.langs) {
		for (const phase of sub.phases) {
			for (const raw of sub.phrases) {
				const text = normalizePhraseText(raw);
				const key = `${lang}|${phase}|${text}`;
				if (seen.has(key)) continue;
				seen.add(key);
				if (bankLists(bank, lang, phase).some((e) => phraseText(e) === text)) {
					skipped++;
					continue;
				}
				items.push({ lang, phase, text });
			}
		}
	}
	if (items.length === 0) errors.push("所有文案都已存在于对应的词库分组中,没有新增内容");
	if (items.length > MAX_TOTAL_ITEMS) errors.push(`展开后共 ${items.length} 条,超过上限 ${MAX_TOTAL_ITEMS} 条`);
	if (errors.length) return { ok: false, errors, items: [], skipped };
	return { ok: true, errors: [], items, skipped };
}

/** 社区投稿包的固定 id;机器人只写该包,不碰默认词库本体 */
const COMMUNITY_PACK_ID = "community";
const COMMUNITY_PACK_LABEL = { zh: "社区投稿", en: "Community" };

/** 把校验通过的条目写入指定词库包(packId 缺省/非法 → community;不存在则创建)。返回 { doc, added } */
function applyToBank(bank, items, packId) {
	const doc = bank && typeof bank === "object" ? JSON.parse(JSON.stringify(bank)) : { phrases: {} };
	if (!doc.phrases || typeof doc.phrases !== "object" || Array.isArray(doc.phrases)) doc.phrases = {};
	if (!Array.isArray(doc.packs)) doc.packs = [];
	const id = typeof packId === "string" && /^[a-z0-9][a-z0-9-]*$/.test(packId) ? packId : COMMUNITY_PACK_ID;
	let pack = doc.packs.find((p) => p && p.id === id);
	if (!pack) {
		pack = id === COMMUNITY_PACK_ID
			? { id: COMMUNITY_PACK_ID, label: COMMUNITY_PACK_LABEL, phrases: {} }
			: { id, label: { zh: id, en: id }, phrases: {} };
		doc.packs.push(pack);
	}
	if (!pack.phrases || typeof pack.phrases !== "object" || Array.isArray(pack.phrases)) pack.phrases = {};
	let added = 0;
	for (const it of items) {
		const lang = it.lang;
		const phase = it.phase;
		// 全库(核心 + 已入包)查重:核心已存在的不重复入包,合并时也会被去重
		if (bankLists(JSON.parse(JSON.stringify({ phrases: doc.phrases, packs: doc.packs })), lang, phase).some((e) => phraseText(e) === it.text)) continue;
		const loc = pack.phrases[lang] && typeof pack.phrases[lang] === "object" && !Array.isArray(pack.phrases[lang])
			? pack.phrases[lang] : (pack.phrases[lang] = {});
		const list = loc[phase] || (loc[phase] = []);
		if (Array.isArray(list) && !list.some((e) => phraseText(e) === it.text)) {
			list.push(it.text);
			added++;
		}
	}
	return { doc, added };
}

/** 预览表格:每条文案一行,分组列每行填充(避免分组行与文案行错位) */
function renderPreview(items) {
	const rows = items.map((it) => `| ${it.lang} · ${it.phase} | ${it.text.replace(/\|/g, "\\|")} |`);
	return rows.length ? ["| 分组 | 文案 |", "| --- | --- |", ...rows].join("\n") : "";
}

/** "立即试用"JSON:目标词库包形态(缺省 community),可直接粘到设置页保存,或作为 localStorage dsh-status-rotator.config */
function buildSnippet(items, packId, packLabel) {
	const id = typeof packId === "string" && /^[a-z0-9][a-z0-9-]*$/.test(packId) ? packId : COMMUNITY_PACK_ID;
	const pack = {
		id,
		label: packLabel && typeof packLabel === "object" ? packLabel : (id === COMMUNITY_PACK_ID ? COMMUNITY_PACK_LABEL : { zh: id, en: id }),
		phrases: {},
	};
	for (const it of items) {
		const entry = (pack.phrases[it.lang] || (pack.phrases[it.lang] = {}))[it.phase] || (pack.phrases[it.lang][it.phase] = []);
		entry.push(it.text);
	}
	return JSON.stringify({ packs: [pack] }, null, 2);
}

function renderFailComment(errors) {
	return [
		"## ❌ 词库投稿校验未通过",
		"",
		"本次投稿**没有**改动词库。",
		"",
		...errors.map((e) => `- ${e}`),
		"",
		"💡 按上面的原因修改后,关闭本 Issue 用「词库投稿」表单重新提交即可(机器人不会对同一个 Issue 重试)。",
	].join("\n");
}

function renderSuccessComment(result, added, skipped, prRef, errMsg, packId, packLabel) {
	const lines = [
		"## ✅ 词库投稿校验通过",
		"",
		`共新增 **${result.items.length} 条**文案${added !== result.items.length ? `(实际写入 ${added} 条)` : ""},已按默认词库规范归一: \`...\` → \`…\`、末尾自动补 \`…\`${skipped > 0 ? `;另外跳过 ${skipped} 条与现有词库重复的文案` : ""}。`,
		"",
		`📦 已收录进「${packLabel}」词库包(\`${packId}\`),不会改动默认词库本体;启用/编辑该包可在设置页 → 「词库包」操作。`,
		"",
		"### 预览",
		"",
		renderPreview(result.items),
		"",
		"### 立即试用(不用等合并)",
		"",
		"把下面 JSON 粘到 **设置页 → Status Texts → 保存**(或作为浏览器 localStorage 键 \`dsh-status-rotator.config\` 的值):",
		"",
		"```json",
		buildSnippet(result.items, packId, packLabel),
		"```",
	];
	if (prRef) {
		lines.push("", `### 合并请求`, "", `机器人已自动创建 **${prRef}** —— 维护者点 🟢 Merge 后收录,随下一次 npm 发版进入所有用户的默认词库。`);
	} else {
		lines.push("", "### 状态", "", `⚠️ 合并请求未能自动创建${errMsg ? `: ${errMsg}` : ""}。维护者会人工跟进本 Issue(可参考机器人运行日志)。`);
	}
	lines.push("", "> 本评论由 dsh-status-rotator 词库机器人自动生成。");
	return lines.join("\n");
}

/** 评论(issues: write) */
async function apiComment(token, repo, issueNumber, body) {
	const res = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"User-Agent": "dsh-status-rotator-phrase-bot",
		},
		body: JSON.stringify({ body }),
	});
	if (!res.ok) throw new Error(`评论失败: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
	return res.json();
}

/**
 * 自愈:仓库可能没有「词库投稿」标签(GitHub 表单提交时不会自动创建不存在的标签,
 * 只会在标签已存在时打上)。先尝试创建标签,再给当前 Issue 补上——失败不影响主流程。
 */
async function apiEnsureLabel(token, repo, issueNumber) {
	const headers = {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"User-Agent": "dsh-status-rotator-phrase-bot",
	};
	let created = false;
	const createRes = await fetch(`https://api.github.com/repos/${repo}/labels`, {
		method: "POST",
		headers,
		body: JSON.stringify({ name: LABEL, color: "ff6b6b", description: "词库投稿——机器人自动校验并生成合并请求" }),
	});
	created = createRes.ok;
	const labelRes = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/labels`, {
		method: "POST",
		headers,
		body: JSON.stringify({ labels: [LABEL] }),
	});
	if (!created && !labelRes.ok) throw new Error(`标签处理失败: ${labelRes.status}`);
}

/** 查该分支已存在的 open PR(判重与竞态兜底);找不到/出错返回 null */
async function apiFindOpenPr(token, repo, branch, base) {
	const owner = repo.split("/")[0];
	const res = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=10`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"User-Agent": "dsh-status-rotator-phrase-bot",
		},
	});
	if (!res.ok) return null;
	const list = await res.json();
	return (Array.isArray(list) ? list : []).find((p) => p.head && p.head.ref === branch && p.base && p.base.ref === base) || null;
}

/** 创建 PR / 打 label */
async function apiCreatePr(token, repo, payload) {
	const res = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"User-Agent": "dsh-status-rotator-phrase-bot",
		},
		body: JSON.stringify(payload),
	});
	// 只读一次 body:先 text() 再 json() 会抛 "Body is unusable: Body has already been read" ——
	// PR 其实建成功了,却让整个函数抛错,于是每一条投稿都走「竞态兜底」去列表里反查自己刚建的 PR:
	// 能兜住(评论里仍有链接),但 apiLabelPr 永远跑不到(PR 上没有「词库投稿」标签),
	// 而且兜底一旦失手,投稿人就会看到「合并请求未能自动创建」——实际 PR 已经开好了。
	// 生产日志证据:run 36142085814「Body is unusable」→「竞态兜底:已存在 PR #77」。
	const text = await res.text();
	if (!res.ok) throw new Error(`创建 PR 失败: HTTP ${res.status} ${text.slice(0, 300)}`);
	try {
		return JSON.parse(text);
	} catch (e) {
		throw new Error(`创建 PR 成功但响应解析失败: ${text.slice(0, 200)}`);
	}
}

async function apiLabelPr(token, repo, prNumber) {
	const res = await fetch(`https://api.github.com/repos/${repo}/issues/${prNumber}/labels`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"User-Agent": "dsh-status-rotator-phrase-bot",
		},
		body: JSON.stringify({ labels: [LABEL] }),
	});
	if (!res.ok) throw new Error(`打 label 失败: HTTP ${res.status}`);
}

/** 把表单默认标题改成「词库投稿: 首条文案…」,方便维护者一眼区分多条投稿(失败不影响流程) */
async function apiPolishTitle(token, repo, issueNumber, title, firstPhrase) {
	if (title !== "词库投稿: 新文案") return; // 用户改过标题就不动
	const res = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}`, {
		method: "PATCH",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"User-Agent": "dsh-status-rotator-phrase-bot",
		},
		body: JSON.stringify({ title: `词库投稿: ${firstPhrase.slice(0, 40)}` }),
	});
	if (!res.ok) throw new Error(`改标题失败: HTTP ${res.status}`);
}

const git = (args, cwd) => execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });

/** 落盘 + 回读自检(坏 JSON / 重复键立刻抛) + 同步展示计数;返回改到的文件清单 */
function writeBankAndSync(cwd, doc) {
	const bankPath = path.join(cwd, "config.example.json");
	const stamped = JSON.stringify(doc, null, 4) + "\n";
	fs.writeFileSync(bankPath, stamped, "utf8");
	parseBankStrict(stamped, "config.example.json(写盘回读)");
	return [bankPath, ...syncRepoFiles(cwd, doc)].map((f) => path.relative(cwd, f));
}

/** 列仓库里开着的投稿 PR(head 分支形如 phrase-bot/issue-<n>,且 head 在本仓库) */
async function apiListOpenPrs(token, repo, base) {
	const res = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open&base=${encodeURIComponent(base)}&per_page=100`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"User-Agent": "dsh-status-rotator-phrase-bot",
		},
	});
	if (!res.ok) throw new Error(`列 PR 失败: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
	const list = await res.json();
	return (Array.isArray(list) ? list : []).filter((p) => p && p.head && typeof p.head.ref === "string"
		&& /^phrase-bot\/issue-\d+$/.test(p.head.ref)
		&& p.head.repo && p.head.repo.full_name === repo);
}

/** 读 Issue(刷新模式要照原表单重新解析一遍) */
async function apiGetIssue(token, repo, issueNumber) {
	const res = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"User-Agent": "dsh-status-rotator-phrase-bot",
		},
	});
	if (!res.ok) throw new Error(`读 Issue #${issueNumber} 失败: HTTP ${res.status}`);
	return res.json();
}

/** 读某个分支上的文件原文(用来判断「这次重建和远端是否已经一致」,避免无意义强推) */
async function apiGetFileText(token, repo, file, ref) {
	const res = await fetch(`https://api.github.com/repos/${repo}/contents/${file}?ref=${encodeURIComponent(ref)}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"User-Agent": "dsh-status-rotator-phrase-bot",
		},
	});
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`读 ${file}@${ref} 失败: HTTP ${res.status}`);
	const data = await res.json();
	return Buffer.from(String(data.content || ""), "base64").toString("utf8");
}

/**
 * 刷新模式:main 一动(或定时/手动)就把所有还开着的投稿分支按**当前 main** 重建。
 *
 * 为什么必须做:机器人分支是「提交那一刻的 main + 本次投稿」,而投稿几乎都落在同一个
 * `community` 包上 —— 只要有任何一次投稿(或任何改动)合进 main,其它开着的投稿 PR
 * 立刻变成 CONFLICTING,只能人工解 `config.example.json` 的 JSON 冲突。人工解 JSON
 * 冲突正是「重复键 / 漏逗号」的来源:重复键会被 JSON.parse 静默吃掉(条目无声丢失),
 * 漏逗号直接让整份词库非法(CHANGELOG 0.23.4 记录过)。重建之后分支永远等于
 * 「当前 main + 本 Issue 的条目」,不需要任何人手工碰 JSON。
 */
async function runRefresh(env) {
	const token = env.GITHUB_TOKEN;
	const repo = env.REPO;
	if (!token || !repo) throw new Error("刷新模式需要 GITHUB_TOKEN 与 REPO");
	const cwd = process.cwd();
	const base = env.BASE_BRANCH || "main";
	const dryRun = env.PHRASE_BOT_DRY_RUN === "1";
	const baseRef = git(["rev-parse", "HEAD"], cwd).trim();
	const prs = await apiListOpenPrs(token, repo, base);
	console.log(`刷新模式: ${prs.length} 个开着的投稿 PR(base=${base} @${baseRef.slice(0, 7)}${dryRun ? ", dry-run" : ""})`);
	let rebuilt = 0, skipped = 0, failed = 0;
	for (const pr of prs) {
		const branch = pr.head.ref;
		const issueNumber = Number(branch.slice("phrase-bot/issue-".length));
		try {
			const issue = await apiGetIssue(token, repo, issueNumber);
			if (issue.state === "closed") { console.log(`  #${issueNumber}: Issue 已关闭,跳过(不复活已撤回的投稿)`); skipped += 1; continue; }
			const sub = parseSubmission(issue.form, issue.body);
			if (sub.error) { console.log(`  #${issueNumber}: 无法解析(${sub.error}),跳过`); skipped += 1; continue; }
			// 每次都从「本次运行的 main」重新开始,避免上一个 PR 的改动串味。
			// 用**游离 HEAD**而不是留在上一个分支上:否则 reset --hard 会把上一个分支
			// 一起拽回 main(实测过,两个分支都变成 main 的 SHA)。
			git(["checkout", "--detach", baseRef], cwd);
			git(["reset", "--hard", baseRef], cwd);
			const bank = parseBankStrict(fs.readFileSync(path.join(cwd, "config.example.json"), "utf8"), "config.example.json");
			const result = validateSubmission(sub, bank);
			if (!result.ok) { console.log(`  #${issueNumber}: 校验未过(${result.errors[0]}),跳过`); skipped += 1; continue; }
			const { doc } = applyToBank(bank, result.items, sub.pack);
			const stamped = JSON.stringify(doc, null, 4) + "\n";
			const remote = await apiGetFileText(token, repo, "config.example.json", branch);
			if (remote === stamped) { console.log(`  #${issueNumber}: 已与当前 main 一致,无需重建`); skipped += 1; continue; }
			git(["config", "user.name", "dsh-status-rotator[bot]"], cwd);
			git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], cwd);
			git(["checkout", "-B", branch, baseRef], cwd);
			const files = writeBankAndSync(cwd, doc);
			git(["add", ...files], cwd);
			git(["commit", "-m", `feat: 词库投稿 #${issueNumber}(${result.items.length} 条,跟随 main 重建)`], cwd);
			// 立刻离开该分支(游离 HEAD):分支 ref 留在这次重建的提交上,后续 reset 不影响它
			git(["checkout", "--detach", baseRef], cwd);
			if (dryRun) { console.log(`  #${issueNumber}: [dry-run] 会重建并强推(PR #${pr.number})`); rebuilt += 1; continue; }
			git(["push", "--force", "-u", "origin", branch], cwd);
			console.log(`  #${issueNumber}: 已按当前 main 重建并强推(PR #${pr.number})`);
			rebuilt += 1;
		} catch (e) {
			failed += 1;
			console.error(`  #${issueNumber}: 刷新失败 ${String(e.message).slice(0, 300)}`);
		}
	}
	git(["checkout", "--detach", baseRef], cwd);
	git(["reset", "--hard", baseRef], cwd);
	console.log(`刷新完成:重建 ${rebuilt} / 跳过 ${skipped} / 失败 ${failed}`);
	return failed > 0 ? 1 : 0;
}

/**
 * 合并后清理(workflow 在 pull_request: closed + merged 时触发):
 * 删除 phrase-bot/issue-N 分支 + 关闭对应投稿 Issue。删除/关闭失败只警告,不阻断。
 */
async function runCleanup(env, event) {
	const token = env.GITHUB_TOKEN;
	const repo = (event.repository && event.repository.full_name) || env.REPO;
	const pr = event.pull_request || {};
	const branch = (pr.head && pr.head.ref) || "";
	const m = /^phrase-bot\/issue-(\d+)$/.exec(branch);
	if (!m) {
		console.log(`非词库投稿分支(${branch || "?"}),跳过清理`);
		return 0;
	}
	const issueNumber = Number(m[1]);
	console.log(`PR #${pr.number} 已合并:清理分支 ${branch} + 关闭 Issue #${issueNumber}`);
	const headers = {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"User-Agent": "dsh-status-rotator-phrase-bot",
	};
	let deleted = false;
	try {
		const res = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "DELETE", headers });
		deleted = res.ok || res.status === 404; // 404 = 已被仓库设置自动删除,视为成功
		if (!deleted) throw new Error(`HTTP ${res.status}`);
	} catch (e) {
		console.warn("删分支失败(分支可能已被自动删除):", String(e.message));
	}
	try {
		const res = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}`, {
			method: "PATCH",
			headers,
			body: JSON.stringify({ state: "closed" }),
		});
		if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
	} catch (e) {
		console.warn("关 Issue 失败:", String(e.message));
	}
	console.log(`清理完成: 分支${deleted ? "已删除" : "删除结果未知"} ,投稿 Issue #${issueNumber} 已关闭`);
	return 0;
}

/** 主入口:ESLint 无关,CI 调用。env 传入 process.env(可注入测试) */
async function run(env) {
	const token = env.GITHUB_TOKEN;
	const eventPath = env.EVENT_PATH;
	if (!token || !eventPath) throw new Error("缺少 GITHUB_TOKEN 或 EVENT_PATH 环境变量");
	const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));

	// 刷新模式:main 前进 / 定时 / 手动 —— 事件里没有 issue,由「开着的投稿 PR」驱动
	if (env.PHRASE_BOT_MODE === "refresh" || (!event.issue && ["push", "schedule", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME || ""))) {
		return runRefresh({
			...env,
			REPO: (event.repository && event.repository.full_name) || env.REPO,
			BASE_BRANCH: (event.repository && event.repository.default_branch) || env.BASE_BRANCH || "main",
		});
	}

	// 合并清理分支:pull_request: closed + merged(workflow if 已限制 head 前缀与本仓库)
	if (event.pull_request) {
		if (event.action !== "closed" || !event.pull_request.merged) return 0;
		return runCleanup(env, event);
	}

	const issue = event.issue;
	const repo = (event.repository && event.repository.full_name) || env.REPO;
	if (!repo || !issue) throw new Error("事件缺少 issue/repository 数据");

	console.log(`event=${event.action} issue=#${issue.number} repo=${repo}`);
	if (!["opened", "reopened", "labeled"].includes(event.action) || issue.pull_request) return 0; // 创建/重开/补标签都处理;忽略 PR
	const sender = event.sender || {};
	if (typeof sender.login === "string" && /\[bot\]$/i.test(sender.login)) return 0; // 机器人自身触发的 labeled 不重复处理
	const labels = (issue.labels || []).map((l) => l.name);
	const hasLabel = labels.includes(LABEL);

	const cwd = process.cwd();
	const bankPath = path.join(cwd, "config.example.json");
	const bank = parseBankStrict(fs.readFileSync(bankPath, "utf8"), "config.example.json");
	const base = (event.repository && event.repository.default_branch) || "main";
	const prBranch = `phrase-bot/issue-${issue.number}`;

	// 判重:表单创建会同时发 opened + labeled 两个事件(双触发),已处理过的 Issue 直接静默跳过
	try {
		const existingPr = await apiFindOpenPr(token, repo, prBranch, base);
		if (existingPr) {
			console.log(`该 Issue 已生成过 PR #${existingPr.number},跳过本轮`);
			return 0;
		}
	} catch (e) {
		console.warn("查重失败(继续执行):", String(e.message));
	}

	const sub = parseSubmission(issue.form, issue.body);
	let result;
	if (sub.error) {
		// 解析不出提交内容:普通 Issue(无标签)悄悄跳过;带标签的则评论说明,避免"点了没反应"
		if (!hasLabel) {
			console.log(`无法识别为词库投稿(无 ${LABEL} 标签且非表单内容),跳过`);
			return 0;
		}
		console.log("带标签但无法解析:", sub.error);
		result = { ok: false, errors: [sub.error], items: [], skipped: 0 };
	} else {
		result = validateSubmission(sub, bank);
	}
	const author = `@${sender.login || "未知用户"}${sub.name ? `(署名: ${sub.name})` : ""}`;

	if (!sub.error) {
		try {
			await apiPolishTitle(token, repo, issue.number, issue.title || "", sub.phrases[0] || "");
		} catch (e) {
			console.warn("改标题失败(不影响流程):", String(e.message));
		}
	}

	// 自愈标签:仓库缺「词库投稿」标签时创建并给当前 Issue 补上(失败不影响流程)
	try {
		await apiEnsureLabel(token, repo, issue.number);
	} catch (e) {
		console.warn("标签处理失败(不影响流程):", String(e.message));
	}

	if (!result.ok) {
		await apiComment(token, repo, issue.number, renderFailComment(result.errors));
		console.log("校验未通过:", result.errors.join("; "));
		return 1;
	}

	const packId = sub.pack || COMMUNITY_PACK_ID;
	const { doc, added } = applyToBank(bank, result.items, packId);
	// 目标包显示名(写入后一定存在)
	const appliedPack = Array.isArray(doc.packs) ? doc.packs.find((p) => p && p.id === packId) : null;
	const packLabelObj = appliedPack && appliedPack.label && typeof appliedPack.label === "object"
		? appliedPack.label
		: (appliedPack && typeof appliedPack.label === "string" ? { zh: appliedPack.label, en: appliedPack.label } : COMMUNITY_PACK_LABEL);
	const packLabel = packLabelObj.zh || packLabelObj.en || packId;
	const packLabelFull = appliedPack ? packLabelObj : COMMUNITY_PACK_LABEL;
	const branch = prBranch;

	// —— 分支 + 写入 + 推送 ——
	git(["config", "user.name", "dsh-status-rotator[bot]"], cwd);
	git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], cwd);
	// 每次从当前 HEAD(工作流刚 checkout 的 main)重建分支:机器人分支只增不改,
	// 复用一份落后于 main 的旧分支就会留下需要手工解冲突的合并 —— 手工解
	// config.example.json 的冲突极易漏逗号,让整份词库变成非法 JSON(见 CHANGELOG 0.23.4)。
	git(["checkout", "-B", branch], cwd);
	// 顺带把展示计数(README / 两张表 / package.json 描述 / lib 注释)同步到新规模,
	// 否则合并后 main 上的 Test 会因条数对不上而变红(issue #43 / PR #44 的教训)
	const syncedFiles = writeBankAndSync(cwd, doc);
	git(["add", "config.example.json", ...syncedFiles], cwd);
	const previewText = result.items[0].text;
	const commitMsg = `feat: 词库投稿 #${issue.number}(${result.items.length} 条,${previewText.slice(0, 30)})`;
	git(["commit", "-m", commitMsg], cwd);
	try {
		git(["push", "--force", "-u", "origin", branch], cwd); // 重建过的分支要覆盖远端旧内容(机器人自有分支)
	} catch (e) {
		// 竞态兜底:双触发时另一个 run 可能已把同分支推上去(内容相同,up-to-date 也算成功)
		let remoteHas = false;
		try {
			execFileSync("git", ["ls-remote", "--exit-code", "origin", branch], { cwd, stdio: "ignore" });
			remoteHas = true;
		} catch (_e) {
			remoteHas = false;
		}
		if (!remoteHas) {
			console.error("push 失败:", String(e.stderr || e.message));
			await apiComment(token, repo, issue.number, renderSuccessComment(result, added, result.skipped, null, `git push 失败: ${String(e.stderr || e.message).slice(0, 300)}`, packId, packLabel));
			return 1;
		}
		console.log("push 竞态:远端已有该分支(内容相同),继续尝试开 PR");
	}

	// —— 开 PR ——
	const prBody = [
		`## 词库投稿 #${issue.number}`,
		"",
		`- 投稿人: ${author}`,
		`- 语种/分组: ${[...new Set(result.items.map((i) => i.lang))].join("、")} × ${[...new Set(result.items.map((i) => i.phase))].join("、")}`,
		`- 目标词库包: ${packLabel}(\`${packId}\`)`,
		`- 新增 ${result.items.length} 条${result.skipped > 0 ? `(跳过 ${result.skipped} 条与现有词库重复)` : ""}`,
		"",
		"### 新增文案",
		"",
		renderPreview(result.items),
		"",
		"✔ 已由词库机器人自动校验:格式 / 查重 / 省略号归一化(`...`→`…`、末尾补 `…`)。",
		`📦 收录进「${packLabel}」词库包(\`${packId}\`),不触碰默认词库本体;可在设置页 → 「词库包」启用/编辑。`,
		`🔗 来源 Issue: #${issue.number} —— 合并后随下一次 npm 发布进入所有用户默认词库。`,
		"",
		`Closes #${issue.number}`,
	].join("\n");

	let pr;
	try {
		pr = await apiCreatePr(token, repo, {
			title: `词库投稿 #${issue.number}: ${previewText.slice(0, 50)}`,
			head: branch,
			base,
			body: prBody,
			maintainer_can_modify: true,
		});
	} catch (e) {
		console.error(String(e.message));
		// 兜底:另一个 run 可能已经建好了 PR(双触发竞态),找到了就当作成功
		let raced = null;
		try {
			raced = await apiFindOpenPr(token, repo, branch, base);
		} catch (_e) {
			raced = null;
		}
		if (raced) {
			await apiComment(token, repo, issue.number, renderSuccessComment(result, added, result.skipped, `[#${raced.number}](${raced.html_url})`, null, packId, packLabel));
			console.log(`竞态兜底:已存在 PR #${raced.number},引用它`);
			return 0;
		}
		await apiComment(token, repo, issue.number, renderSuccessComment(result, added, result.skipped, null, String(e.message).slice(0, 300), packId, packLabel));
		return 1;
	}
	try {
		await apiLabelPr(token, repo, pr.number);
	} catch (e) {
		console.warn("label 失败(不影响 PR):", String(e.message));
	}

	await apiComment(token, repo, issue.number, renderSuccessComment(result, added, result.skipped, `[#${pr.number}](${pr.html_url})`, null, packId, packLabel));
	console.log(`OK: PR #${pr.number} ${pr.html_url}`);
	return 0;
}

if (require.main === module) {
	run(process.env).then(
		(code) => process.exit(code),
		(err) => {
			console.error("机器人内部错误:", err && err.message ? err.message : err);
			process.exit(1);
		}
	);
}

module.exports = {
	run,
	runCleanup,
	ELLIPSIS,
	MAX_PHRASE_LEN,
	MAX_PHRASES,
	normalizePhraseText,
	parseLangValue,
	parsePhaseValue,
	parsePhraseLines,
	parseBodyFallback,
	parseSubmission,
	validateSubmission,
	applyToBank,
	renderPreview,
	buildSnippet,
	renderFailComment,
	renderSuccessComment,
	findDuplicateKeys,
	parseBankStrict,
	writeBankAndSync,
	runRefresh,
};
