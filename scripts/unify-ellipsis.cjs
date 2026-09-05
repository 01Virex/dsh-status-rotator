// 统一默认配置省略号(仅处理 phrases 子树,绝不触碰 config 字段):
// 所有不以后缀 … 结尾的短语补上 …;多点数序列(......)收敛为 …
// 用法:node scripts/unify-ellipsis.cjs <file1> [file2 ...]
const fs = require("fs");

const ELLIPSIS = "\u2026";
const fixPhrase = (s) => {
	let t = String(s);
	t = t.replace(/\.{2,}/g, ELLIPSIS);
	if (!t.endsWith(ELLIPSIS)) t += ELLIPSIS;
	return t;
};

const walkPhrases = (value) => {
	// 字符串数组 = 短语列表;对象 = 语言/阶段分组,继续下钻
	if (Array.isArray(value)) {
		return value.map((x) => {
			if (typeof x === "string") return fixPhrase(x);
			if (x && typeof x === "object" && typeof x.text === "string") return { ...x, text: fixPhrase(x.text) };
			return x;
		});
	}
	if (value && typeof value === "object") {
		for (const k of Object.keys(value)) value[k] = walkPhrases(value[k]);
	}
	return value;
};

for (const f of process.argv.slice(2)) {
	const doc = JSON.parse(fs.readFileSync(f, "utf8"));
	if (!doc.phrases || typeof doc.phrases !== "object") {
		console.error(`${f}: 缺少 phrases 字段,跳过`);
		process.exit(1);
	}
	let changed = 0;
	const phraseText = (s) => {
		if (typeof s === "string") return s;
		if (s && typeof s === "object" && typeof s.text === "string") return s.text;
		return null;
	};
	const count = (v) => {
		if (Array.isArray(v)) for (const s of v) {
			const t = phraseText(s);
			if (t !== null && (!t.endsWith(ELLIPSIS) || /\.{2,}/.test(t))) changed++;
		}
		else if (v && typeof v === "object") for (const k of Object.keys(v)) count(v[k]);
	};
	count(doc.phrases);
	walkPhrases(doc.phrases);
	fs.writeFileSync(f, JSON.stringify(doc, null, 4) + "\n", "utf8");
	console.log(`${f}: phrases 修正 ${changed} 条(config 未触碰)`);
}

/** 完整性校验:所有短语以 … 结尾;config 关键字段保持原值(供 smoke-test 复用) */
function validateConfigDocumentData(doc) {
	const issues = [];
	const chk = (v, path) => {
		if (Array.isArray(v)) {
			v.forEach((s, i) => {
				const t = s && typeof s === "object" ? (typeof s.text === "string" ? s.text : null) : s;
				if (t === null || typeof t !== "string") return;
				if (!t.endsWith(ELLIPSIS)) issues.push(`${path}[${i}] 未以 … 结尾`);
				if (/\.{2,}/.test(t)) issues.push(`${path}[${i}] 含多点数序列`);
			});
		} else if (v && typeof v === "object") {
			for (const k of Object.keys(v)) chk(v[k], path + "." + k);
		}
	};
	if (doc.phrases) chk(doc.phrases, "phrases");
	// config 字符串不得含 …(渐变颜色/位置等);模板类字段(template/templates/idleTemplate)除外,
	// 它们是用户可自由书写的文案,允许 …(如示例标题模板 "🤔 {phaseLabel}… {elapsed}")
	const chkConfig = (v, path) => {
		const segs = path.split(".");
		// 模板字段(含数组元素,如 title.templates[1])允许 …
		const key = segs[segs.length - 1];
		const parentKey = segs[segs.length - 2];
		if (typeof v === "string") {
			if (v.includes(ELLIPSIS) && !["template", "templates", "idleTemplate"].includes(key) && !["template", "templates", "idleTemplate"].includes(parentKey)) {
				issues.push(`${path} 含省略号: ${v}`);
			}
		} else if (v && typeof v === "object") {
			for (const k of Object.keys(v)) chkConfig(v[k], path + "." + k);
		}
	};
	if (doc.config) chkConfig(doc.config, "config");
	return issues;
}

module.exports = { validateConfigDocumentData };
