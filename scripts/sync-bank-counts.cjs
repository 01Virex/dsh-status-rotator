// 词库计数同步器 —— 让「展示出来的词库规模」永远跟着 config.example.json 走。
//
// 为什么需要它:投稿机器人(phrase-bot.cjs)与 star 词库刷新(update-star-pack.cjs)都只改
// config.example.json,而同一个总数还被写在 README / README_ZH 的文案与词库表、
// package.json 的描述、lib/index.js 的注释里。任何一处漏改,轻则文档数字对不上,重则让
// main 上的 Test 工作流变红(PR #44 就是这么红的:词库 1077→1078,断言还写着 1077)。
//
// 用法:
//   node scripts/sync-bank-counts.cjs           # 就地同步仓库文件
//   node scripts/sync-bank-counts.cjs --check   # 只检查是否已同步,不一致退出码 1
//
// 机器人侧:开 PR 前调用 syncRepoFiles(root, doc),把变更文件一起 git add 进去。
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.dirname(__dirname);

/** 需要跟随词库计数的文件(键 → 相对仓库根的路径) */
const FILES = {
	readme: "README.md",
	readmeZh: "README_ZH.md",
	pkg: "package.json",
	index: "lib/index.js"
};

/** 词库文档 → 全部展示用计数(纯函数,不碰文件) */
function bankStats(doc) {
	const packs = Array.isArray(doc && doc.packs) ? doc.packs : [];
	const enabled = new Set(Array.isArray(doc && doc.enabledPacks) ? doc.enabledPacks : []);
	const per = {};
	let zh = 0, en = 0, total = 0, on = 0, off = 0;
	for (const pack of packs) {
		const p = { zh: 0, en: 0, total: 0, on: enabled.has(pack && pack.id) };
		const phrases = pack && typeof pack.phrases === "object" && pack.phrases !== null ? pack.phrases : {};
		for (const lang of Object.keys(phrases)) {
			const groups = phrases[lang] && typeof phrases[lang] === "object" ? phrases[lang] : {};
			for (const phase of Object.keys(groups)) {
				const n = Array.isArray(groups[phase]) ? groups[phase].length : 0;
				p[lang] = (p[lang] || 0) + n;
				p.total += n;
			}
		}
		zh += p.zh; en += p.en; total += p.total;
		if (p.on) on += p.total; else off += p.total;
		if (pack && typeof pack.id === "string") per[pack.id] = p;
	}
	return { packs: packs.length, enabled: enabled.size, per: per, zh: zh, en: en, total: total, on: on, off: off };
}

/** 一份 README 文本 → 同步后的文本(zh = 中文版) */
function syncReadme(text, s, zh) {
	let out = text;
	if (zh) {
		out = out.replace(/\*\*\d+ 条梗、\d+ 个主题词库包/, "**" + s.total + " 条梗、" + s.packs + " 个主题词库包");
		out = out.replace(/默认的全部 \d+ 条文案/, "默认的全部 " + s.total + " 条文案");
		out = out.replace(/默认词库当前共 \*\*\d+ 条\*\*/, "默认词库当前共 **" + s.total + " 条**");
		out = out.replace(/拆为 \*\*\d+ 个主题词库包\*\*/, "拆为 **" + s.packs + " 个主题词库包**");
		out = out.replace(/^\| \*\*合计\*\* \| \*\*\d+\*\* \| \*\*\d+\*\* \| \*\*\d+\*\* \| 开 \d+ \/ 关 \d+ \|$/m,
			"| **合计** | **" + s.zh + "** | **" + s.en + "** | **" + s.total + "** | 开 " + s.on + " / 关 " + s.off + " |");
		out = out.replace(/全部 \d+ 条文案/, "全部 " + s.total + " 条文案");
	} else {
		out = out.replace(/\*\*\d+ phrases, \d+ theme packs/, "**" + s.total + " phrases, " + s.packs + " theme packs");
		out = out.replace(/all \d+ default phrases live inside it/, "all " + s.total + " default phrases live inside it");
		out = out.replace(/The default bank ships \*\*\d+ phrases\*\*/, "The default bank ships **" + s.total + " phrases**");
		out = out.replace(/split into \*\*\d+ theme packs\*\*/, "split into **" + s.packs + " theme packs**");
		out = out.replace(/^\| \*\*total\*\* \| \*\*\d+\*\* \| \*\*\d+\*\* \| \*\*\d+\*\* \| \d+ on \/ \d+ off \|$/m,
			"| **total** | **" + s.zh + "** | **" + s.en + "** | **" + s.total + "** | " + s.on + " on / " + s.off + " off |");
		out = out.replace(/all \d+ phrases in \d+ packs/, "all " + s.total + " phrases in " + s.packs + " packs");
	}
	// 词库表逐包行:结构固定为 | 反引号 id 反引号 名字 | zh | en | 小计 | 状态 |
	// 只认词库表那五行单元格的行:三列纯数字 + 末列 开/关/on/off(另一张 Phrase Packs 表是描述文字,不能碰)
	out = out.replace(/^\| \x60([a-z0-9-]+)\x60([^|]*)\| *\d+ *\| *\d+ *\| *\d+ *\| *(开|\*\*关\*\*|on|\*\*off\*\*) *\|$/gm, function (line, id, name, tail) {
		const p = s.per[id];
		if (!p) return line;
		return "| \x60" + id + "\x60" + name + "| " + p.zh + " | " + p.en + " | " + p.total + " | " + tail + " |";
	});
	return out;
}

/** 把计数写回各文件文本(纯函数:文本进、新文本出;只返回真正变化的键) */
function syncTexts(files, doc) {
	const s = bankStats(doc);
	const out = {};
	const keep = function (key, next) {
		if (typeof files[key] === "string" && typeof next === "string" && next !== files[key]) out[key] = next;
	};
	if (typeof files.pkg === "string") keep("pkg", files.pkg.replace(/\d+-phrase meme machine/, s.total + "-phrase meme machine"));
	if (typeof files.index === "string") keep("index", files.index.replace(/完整词库\(\d+ 个包 \d+ 条\)/, "完整词库(" + s.packs + " 个包 " + s.total + " 条)"));
	if (typeof files.readme === "string") keep("readme", syncReadme(files.readme, s, false));
	if (typeof files.readmeZh === "string") keep("readmeZh", syncReadme(files.readmeZh, s, true));
	return out;
}

/** 就地同步仓库文件;返回被改写的相对路径数组(没有变化则为空) */
function syncRepoFiles(root, doc) {
	const texts = {};
	for (const key of Object.keys(FILES)) texts[key] = fs.readFileSync(path.join(root, FILES[key]), "utf8");
	const out = syncTexts(texts, doc);
	const changed = [];
	for (const key of Object.keys(out)) {
		fs.writeFileSync(path.join(root, FILES[key]), out[key], "utf8");
		changed.push(FILES[key]);
	}
	return changed;
}

if (require.main === module) {
	const check = process.argv.includes("--check");
	const doc = JSON.parse(fs.readFileSync(path.join(ROOT, "config.example.json"), "utf8"));
	const s = bankStats(doc);
	if (check) {
		const texts = {};
		for (const key of Object.keys(FILES)) texts[key] = fs.readFileSync(path.join(ROOT, FILES[key]), "utf8");
		const stale = Object.keys(syncTexts(texts, doc)).map(function (k) { return FILES[k]; });
		if (stale.length > 0) {
			console.error("计数未与 config.example.json 同步: " + stale.join(", "));
			console.error("跑一下:node scripts/sync-bank-counts.cjs");
			process.exit(1);
		}
		console.log("计数已一致:" + s.packs + " 包 / " + s.total + " 条(zh " + s.zh + " · en " + s.en + ";默认启用 " + s.on + " · 关闭 " + s.off + ")");
	} else {
		const changed = syncRepoFiles(ROOT, doc);
		console.log(changed.length > 0 ? "已同步 " + changed.length + " 个文件: " + changed.join(", ") : "无需改动(已一致)");
		console.log("词库:" + s.packs + " 包 / " + s.total + " 条(zh " + s.zh + " · en " + s.en + ";默认启用 " + s.on + " · 关闭 " + s.off + ")");
	}
}

module.exports = { bankStats: bankStats, syncTexts: syncTexts, syncRepoFiles: syncRepoFiles, FILES: FILES, ROOT: ROOT };
