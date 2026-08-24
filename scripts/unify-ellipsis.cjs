// 统一默认配置省略号:所有不以后缀 … 结尾的短语补上 …;多点数序列收敛为 …
// 用法:node scripts/unify-ellipsis.cjs <file1> [file2 ...]
const fs = require("fs");

const ELLIPSIS = "\u2026";
const fixPhrase = (s) => {
	let t = String(s);
	t = t.replace(/\.{2,}/g, ELLIPSIS);
	if (!t.endsWith(ELLIPSIS)) t += ELLIPSIS;
	return t;
};

const walk = (value) => {
	if (Array.isArray(value)) return value.map((x) => (typeof x === "string" ? fixPhrase(x) : x));
	if (value && typeof value === "object") {
		for (const k of Object.keys(value)) value[k] = walk(value[k]);
	}
	return value;
};

const report = { appended: 0, converted: 0, unchanged: 0 };
const count = (value) => {
	if (Array.isArray(value)) {
		for (const x of value) {
			if (typeof x === "string") {
				if (x.endsWith(ELLIPSIS)) report.unchanged++;
				else if (x.includes(".")) report.converted++;
				else report.appended++;
			}
		}
	} else if (value && typeof value === "object") {
		for (const k of Object.keys(value)) count(value[k]);
	}
	return value;
};

for (const f of process.argv.slice(2)) {
	const doc = JSON.parse(fs.readFileSync(f, "utf8"));
	count(doc);
	walk(doc);
	fs.writeFileSync(f, JSON.stringify(doc, null, 4) + "\n", "utf8");
	console.log(`${f}: 追加省略号 ${report.appended} / 收敛多点数 ${report.converted} / 原有 ${report.unchanged}`);
	report.appended = 0; report.converted = 0; report.unchanged = 0;
}
