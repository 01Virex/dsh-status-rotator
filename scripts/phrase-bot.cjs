// 词库投稿机器人 —— 单个自包含脚本,零 npm 依赖,CI 里直接 `node scripts/phrase-bot.cjs`。
//
// 流程(由 .github/workflows/phrase-submit.yml 在 issues: opened + label=词库投稿 时触发):
//   1. 解析 Issue:优先取表单字段(github event 的 issue.form),回退解析 markdown body;
//   2. 校验:必须有语种/分组文案、单条上限、禁止 HTML/链接/控制字符、提交须知勾选、查重;
//   3. 归一化:与 scripts/unify-ellipsis.cjs 同规则 —— "..."→"…"、末尾补 "…";
//   4. 评论回复:校验结果 + 预览表格 + 可直接粘贴的"立即试用"JSON;
//   5. 校验通过:开分支 phrase-bot/issue-<n> → 写入 config.example.json → push → 开 PR
//      (label=词库投稿),再评论 PR 链接。维护者点 Merge 即收录,随下次发版分发。
//
// 环境变量:GITHUB_TOKEN / EVENT_PATH(github.event_path)/ REPO(owner/name)
// 前置:workflow 已 checkout 仓库且进程 cwd = 仓库根目录(lib 与 config.example.json 同级)。
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

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

/** 文案 textarea → 非空行数组(忽略空行与 # 注释行) */
function parsePhraseLines(text) {
	if (typeof text !== "string") return [];
	return String(text)
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length > 0 && !l.startsWith("#") && !/^---+$/.test(l));
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
			if (t.length > 0) return t;
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
	const rulesSection = section(/^提交须知/);
	if (rulesSection) out.rules = /- \[x\]/i.test(rulesSection) ? ["确认"] : [];
	return out;
}

/**
 * 解析投稿表单(优先 issue.form,缺失字段回退 body):
 * form = { lang, phase, phrases, name, rules };body 为渲染后的 markdown。
 * 返回 { langs, phases, phrases, name, confirmed } 或 { error }。
 */
function parseSubmission(form, body) {
	form = form && typeof form === "object" ? form : {};
	const f = {};
	for (const key of ["lang", "phase", "phrases", "name", "rules"]) {
		const fromForm = form[key];
		f[key] = fromForm === undefined || fromForm === null ? undefined : fromForm;
	}
	const fallback = parseBodyFallback(body);
	if (f.lang === undefined && fallback.lang !== undefined) f.lang = fallback.lang;
	if (f.phase === undefined && fallback.phase !== undefined) f.phase = fallback.phase;
	if (f.phrases === undefined && fallback.phrases !== undefined) f.phrases = fallback.phrases;
	if (f.name === undefined && fallback.name !== undefined) f.name = fallback.name;
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
	return { langs, phases, phrases, name: stripListMark(String(f.name || "")).slice(0, 40), confirmed };
}

/** 取词库某语言某分组的文案列表(兼容旧格式:短语数组直接当 thinking) */
function bankLists(bank, lang, phase) {
	const ph = bank && bank.phrases && typeof bank.phrases === "object" ? bank.phrases : bank;
	const entry = ph && ph[lang];
	if (entry == null) return [];
	const list = Array.isArray(entry) ? entry : entry[phase];
	return Array.isArray(list) ? list : [];
}

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
				if (bankLists(bank, lang, phase).includes(text)) {
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

/** 把校验通过的条目写入词库文档(新增到末尾,已存在跳过)。返回 { doc, added } */
function applyToBank(bank, items) {
	const doc = bank && typeof bank === "object" ? JSON.parse(JSON.stringify(bank)) : { phrases: {} };
	if (!doc.phrases || typeof doc.phrases !== "object" || Array.isArray(doc.phrases)) doc.phrases = {};
	let added = 0;
	for (const it of items) {
		const lang = it.lang;
		const phase = it.phase;
		if (!doc.phrases[lang] || typeof doc.phrases[lang] !== "object" || Array.isArray(doc.phrases[lang])) {
			if (Array.isArray(doc.phrases[lang])) doc.phrases[lang] = { thinking: doc.phrases[lang], running: [], long: [] };
			else doc.phrases[lang] = {};
		}
		const list = doc.phrases[lang][phase] || (doc.phrases[lang][phase] = []);
		if (Array.isArray(list) && !list.includes(it.text)) {
			list.push(it.text);
			added++;
		}
	}
	return { doc, added };
}

/** 预览表格:按 lang·phase 分组,每条一行 */
function renderPreview(items) {
	const rows = [];
	let cur = "";
	for (const it of items) {
		const key = `${it.lang} · ${it.phase}`;
		if (key !== cur) {
			cur = key;
			rows.push(`| **${key}** | |`);
		}
		rows.push(`| | ${it.text.replace(/\|/g, "\\|")} |`);
	}
	return rows.length ? ["| 分组 | 文案 |", "| --- | --- |", ...rows].join("\n") : "";
}

/** "立即试用"JSON:可直接粘到设置页保存,或作为 localStorage dsh-status-rotator.config */
function buildSnippet(items) {
	const doc = { phrases: {} };
	for (const it of items) {
		const entry = (doc.phrases[it.lang] || (doc.phrases[it.lang] = {}))[it.phase] || (doc.phrases[it.lang][it.phase] = []);
		entry.push(it.text);
	}
	return JSON.stringify(doc, null, 2);
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

function renderSuccessComment(result, added, skipped, prRef) {
	const lines = [
		"## ✅ 词库投稿校验通过",
		"",
		`共新增 **${result.items.length} 条**文案${added !== result.items.length ? `(实际写入 ${added} 条)` : ""},已按默认词库规范归一: \`...\` → \`…\`、末尾自动补 \`…\`${skipped > 0 ? `;另外跳过 ${skipped} 条与现有词库重复的文案` : ""}。`,
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
		buildSnippet(result.items),
		"```",
	];
	if (prRef) {
		lines.push("", `### 合并请求`, "", `机器人已自动创建 **${prRef}** —— 维护者点 🟢 Merge 后收录,随下一次 npm 发版进入所有用户的默认词库。`);
	} else {
		lines.push("", "### 状态", "", "⚠️ 合并请求未能自动创建(见上方机器人日志),维护者会人工跟进本 Issue。");
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
	const text = await res.text();
	if (!res.ok) throw new Error(`创建 PR 失败: HTTP ${res.status} ${text.slice(0, 300)}`);
	return res.json();
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

/** 主入口:ESLint 无关,CI 调用。env 传入 process.env(可注入测试) */
async function run(env) {
	const token = env.GITHUB_TOKEN;
	const eventPath = env.EVENT_PATH;
	if (!token || !eventPath) throw new Error("缺少 GITHUB_TOKEN 或 EVENT_PATH 环境变量");
	const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
	const issue = event.issue;
	const repo = (event.repository && event.repository.full_name) || env.REPO;
	if (!repo || !issue) throw new Error("事件缺少 issue/repository 数据");

	console.log(`event=${event.action} issue=#${issue.number} repo=${repo}`);
	if (event.action !== "opened" || issue.pull_request) return 0; // 只处理新开的 Issue,忽略 PR
	const sender = event.sender || {};
	if (typeof sender.login === "string" && /\[bot\]$/i.test(sender.login)) return 0; // 机器人自带 Issue
	const labels = (issue.labels || []).map((l) => l.name);
	if (!labels.includes(LABEL)) {
		console.log(`无 ${LABEL} 标签,跳过`);
		return 0;
	}

	const cwd = process.cwd();
	const bankPath = path.join(cwd, "config.example.json");
	const bank = JSON.parse(fs.readFileSync(bankPath, "utf8"));
	const base = (event.repository && event.repository.default_branch) || "main";

	const sub = parseSubmission(issue.form, issue.body);
	const result = sub.error ? { ok: false, errors: [sub.error], items: [], skipped: 0 } : validateSubmission(sub, bank);
	const author = `@${sender.login || "未知用户"}${sub.name ? `(署名: ${sub.name})` : ""}`;

	if (!sub.error) {
		try {
			await apiPolishTitle(token, repo, issue.number, issue.title || "", sub.phrases[0] || "");
		} catch (e) {
			console.warn("改标题失败(不影响流程):", String(e.message));
		}
	}

	if (!result.ok) {
		await apiComment(token, repo, issue.number, renderFailComment(result.errors));
		console.log("校验未通过:", result.errors.join("; "));
		return 1;
	}

	const { doc, added } = applyToBank(bank, result.items);
	const branch = `phrase-bot/issue-${issue.number}`;

	// —— 分支 + 写入 + 推送 ——
	git(["config", "user.name", "dsh-status-rotator[bot]"], cwd);
	git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], cwd);
	try {
		git(["checkout", "-b", branch], cwd);
	} catch (e) {
		git(["checkout", branch], cwd);
	}
	fs.writeFileSync(bankPath, JSON.stringify(doc, null, 4) + "\n", "utf8");
	git(["add", "config.example.json"], cwd);
	const previewText = result.items[0].text;
	const commitMsg = `feat: 词库投稿 #${issue.number}(${result.items.length} 条,${previewText.slice(0, 30)})`;
	git(["commit", "-m", commitMsg], cwd);
	try {
		git(["push", "-u", "origin", branch], cwd);
	} catch (e) {
		console.error("push 失败:", String(e.stderr || e.message));
		await apiComment(token, repo, issue.number, renderSuccessComment(result, added, result.skipped, null));
		return 1;
	}

	// —— 开 PR ——
	const prBody = [
		`## 词库投稿 #${issue.number}`,
		"",
		`- 投稿人: ${author}`,
		`- 语种/分组: ${[...new Set(result.items.map((i) => i.lang))].join("、")} × ${[...new Set(result.items.map((i) => i.phase))].join("、")}`,
		`- 新增 ${result.items.length} 条${result.skipped > 0 ? `(跳过 ${result.skipped} 条与现有词库重复)` : ""}`,
		"",
		"### 新增文案",
		"",
		renderPreview(result.items),
		"",
		"✔ 已由词库机器人自动校验:格式 / 查重 / 省略号归一化(`...`→`…`、末尾补 `…`)。",
		`🔗 来源 Issue: #${issue.number} —— 合并后随下一次 npm 发布进入所有用户默认词库。`,
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
		await apiComment(token, repo, issue.number, renderSuccessComment(result, added, result.skipped, null));
		return 1;
	}
	try {
		await apiLabelPr(token, repo, pr.number);
	} catch (e) {
		console.warn("label 失败(不影响 PR):", String(e.message));
	}

	await apiComment(token, repo, issue.number, renderSuccessComment(result, added, result.skipped, `[#${pr.number}](${pr.html_url})`));
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
};
