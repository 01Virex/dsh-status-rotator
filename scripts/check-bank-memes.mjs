#!/usr/bin/env node
/**
 * 词库质检(开发期工具,不进 npm 发布集):
 * 统计各分组规模、检测组内/跨组重复、超长告警、缺「…」结尾、系列占比。
 * 用法: node scripts/check-bank-memes.mjs [config-path]
 *   默认检查 config.example.json;传入第二个参数为候选文件(JSON:
 *   { zh: { phase: [...], ... }, en: { ... } })时,额外检测候选与现有词库的重复。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bankPath = process.argv[2] || path.join(here, "..", "config.example.json");
const candidatePath = process.argv[3] || null;

const PHASES = ["thinking", "running", "long"];
const entryText = (e) => (typeof e === "string" ? e : e && typeof e.text === "string" ? e.text : null);

const doc = JSON.parse(fs.readFileSync(bankPath, "utf8"));
const bank = doc.phrases;

const stats = {};
const seen = new Map(); // text -> first location
const problems = [];
for (const lang of ["zh", "en"]) {
	stats[lang] = {};
	for (const phase of PHASES) {
		const list = bank[lang][phase] || [];
		const texts = list.map(entryText).filter((t) => t !== null);
		const avg = texts.length ? Math.round(texts.reduce((a, b) => a + b.length, 0) / texts.length) : 0;
		stats[lang][phase] = { count: list.length, avg };
		for (const t of texts) {
			const key = `${t}`;
			if (seen.has(key)) problems.push(`重复:「${key}」(${seen.get(key)} 与 ${lang}.${phase})`);
			else seen.set(key, `${lang}.${phase}`);
			if (!t.endsWith("\u2026")) problems.push(`缺省略号:${lang}.${phase} 「${t}」`);
			const limit = lang === "zh" ? 20 : 45;
			if (t.length > limit) problems.push(`超长(${t.length}>${limit}):${lang}.${phase} 「${t}」`);
		}
	}
}

console.log("== 分组规模 ==");
for (const lang of ["zh", "en"]) {
	for (const phase of PHASES) {
		const s = stats[lang][phase];
		console.log(`  ${lang}.${phase}: ${s.count} 条(平均 ${s.avg})`);
	}
}

// 系列占比监控:反代 / 路由 / 正在黑入 / 思考
for (const series of ["反代", "路由", "黑入", "思考", "正在正在", "极其"]) {
	const n = (bank.zh.running || []).concat(bank.zh.long || [], bank.zh.thinking || [])
		.map(entryText).filter((t) => t && t.includes(series)).length;
	if (n > 0) console.log(`  系列「${series}」: ${n} 条`);
}

console.log("== 问题列表 ==");
for (const p of problems) console.log("  " + p);
if (problems.length === 0) console.log("  (无)");

if (candidatePath) {
	console.log("== 候选 vs 现有词库 ==");
	const cand = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
	let dup = 0;
	let len = 0;
	for (const lang of ["zh", "en"]) {
		for (const phase of PHASES) {
			const list = cand[lang]?.[phase] || [];
			for (const e of list) {
				const t = entryText(e);
				if (!t) { console.log(`  非法候选:${lang}.${phase} ${JSON.stringify(e)}`); continue; }
				len++;
				if (seen.has(t)) { dup++; console.log(`  与现有重复:${lang}.${phase} 「${t}」`); }
				if (!t.endsWith("\u2026")) console.log(`  候选缺省略号:${lang}.${phase} 「${t}」`);
			}
		}
	}
	console.log(`  候选共 ${len} 条,重复 ${dup} 条`);
}

const exitCode = problems.length > 0 ? 1 : 0;
process.exit(exitCode);
