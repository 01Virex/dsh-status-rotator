#!/usr/bin/env node
/**
 * 选句引擎的独立验证:(反重复)与 (条件 / 上下文选词)。
 *
 * 这两条都落在 `lib/client.js` 的选句管线上,但它们的正确性**看不出来** —— 状态行少抽一句、
 * 条件句在错误的时候冒出来、设置页保存一次把 when 洗掉,肉眼都不会立刻发现。所以这里按
 * 「纯函数 + 半区契约」两层把它们钉住:
 *
 *   洗牌袋   一轮内不重复 / 跨袋不撞最近 N 条 / 按「语言|相位」分键 / 池子换了就重开 /
 *              快照往返(可选跨刷新持久化)/ recentLimit 可配
 *   条件选词 when 词表的归一化与判定(tool / retry / pending / phase / hour 跨午夜 / firstTurn)、
 *              rarity 掷骰、条件命中即优先的池子策略
 *   行语法      设置页每行 `文本 | 权重 | when:… | rarity:…` **双向可逆** ——
 *              不可逆就意味着「设置页保存一次,手写的条件就没了」
 *   node 半边   校验接受新字段 / 拒绝非法 when 与 rarity;比较键带上 when,避免
 *              「文本与随包条目相同、但带条件」的用户条目被当成随包内容剪掉
 *
 * 运行:node scripts/verify-phrase-selection.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let failures = 0;
const report = (name, pass, extra) => {
	console.log(`  ${pass ? "✓" : "✗"} ${name}${extra ? "  — " + extra : ""}`);
	if (!pass) failures++;
};
const section = (title) => console.log(`\n== ${title} ==`);

// ───────────────────────────────────────────────────────────────────────────
// 加载浏览器半边(纯函数层):与 smoke-test 同一套 vm 沙箱
// ───────────────────────────────────────────────────────────────────────────
const clientSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "client.js"), "utf8");
let exports_ = null;
const sandbox = {
	window: {
		__ModuleLoader__: {
			load: (definition) => {
				const require = (name) => {
					if (name === "react") {
						return {
							useState: () => null, useEffect: () => null, useCallback: (fn) => fn,
							useRef: () => ({ current: null }), createElement: () => null
						};
					}
					throw new Error("verify-phrase-selection 意外 require: " + name);
				};
				exports_ = definition.factory(require);
			}
		}
	},
	document: {
		createElement: () => ({ classList: { contains: () => false, toggle: () => {} }, setAttribute: () => {}, appendChild: () => {}, remove: () => {}, style: {}, textContent: "" }),
		documentElement: { dataset: {} },
		addEventListener: () => {},
		querySelectorAll: () => [],
		body: null,
		head: { appendChild: () => {} }
	},
	localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
	navigator: {},
	console,
	setTimeout,
	clearTimeout,
	setInterval,
	clearInterval,
	fetch: async () => ({ ok: false, status: 404 }),
	Element: class Element {},
	MutationObserver: class MutationObserver { observe() {} disconnect() {} }
};
vm.createContext(sandbox);
vm.runInContext(clientSrc, sandbox, { filename: "client.js" });

const T = exports_ && exports_.__test;
if (!T) {
	console.error("FAIL: 未导出 __test");
	process.exit(1);
}
const textsOf = (list) => list.map((e) => T.entryText(e));
const firstOf = (seq) => seq[0];

// ───────────────────────────────────────────────────────────────────────────
// 洗牌袋
// ───────────────────────────────────────────────────────────────────────────
section("洗牌袋:一轮内不重复、跨袋不撞最近 N 条");

/** rand 恒为 0 → 每次都取袋里第一个,序列完全可预测 */
const zero = () => 0;

{
	const bag = T.createShuffleBag({ recentLimit: 3 });
	const pool = ["a", "b", "c"];
	const seq = [];
	for (let i = 0; i < 6; i++) seq.push(bag.next(pool, "zh|thinking|w", false, zero));
	report("袋内不重复(3 条池子 → a,b,c 一轮)", JSON.stringify(seq) === JSON.stringify(["a", "b", "c", "a", "b", "c"]), seq.join(","));
	report("跨袋边界不撞上一句(c→a,不是 c→c)", seq[3] !== seq[2], `${seq[2]}→${seq[3]}`);
}

{
	// 池子比 recentLimit 大:跨袋时最近 N 条被剔掉
	const bag = T.createShuffleBag({ recentLimit: 2 });
	const pool = ["a", "b", "c", "d"];
	const seq = [];
	for (let i = 0; i < 8; i++) seq.push(bag.next(pool, "k", false, zero));
	let boundaryOk = true;
	for (let i = 0; i < seq.length; i++) {
		const recent = seq.slice(Math.max(0, i - 2), i);
		if (recent.includes(seq[i])) boundaryOk = false;
	}
	report("每句都不会撞上最近 2 条(含袋边界)", boundaryOk, seq.join(","));
}

{
	// recentLimit=0:只靠袋子,跨袋允许立刻重复
	const bag = T.createShuffleBag({ recentLimit: 0 });
	const pool = ["a", "b"];
	const seq = [];
	for (let i = 0; i < 4; i++) seq.push(bag.next(pool, "k", false, zero));
	report("recentLimit=0 时只保证袋内不重复", JSON.stringify(seq) === JSON.stringify(["a", "b", "a", "b"]), seq.join(","));
}

{
	// 池子变了(相位 / 语言 / 条件切换)必须重开袋,不能吐陈旧句
	const bag = T.createShuffleBag({ recentLimit: 3 });
	bag.next(["a", "b", "c"], "k", false, zero);
	bag.next(["a", "b", "c"], "k", false, zero);
	const after = bag.next(["x", "y"], "k", false, zero);
	report("池子换了就重开(不会抽出已不在池里的 c)", ["x", "y"].includes(after), String(after));
}

{
	// 分键:同一句可以在不同 key 各出现一次;两个 key 互不影响
	const bag = T.createShuffleBag({ recentLimit: 3 });
	const a1 = bag.next(["a", "b"], "zh|thinking|w", false, zero);
	const a2 = bag.next(["a", "b"], "en|thinking|w", false, zero);
	const a3 = bag.next(["a", "b"], "zh|running|w", false, zero);
	report("按「语言|相位」分键,各自从袋头开始", a1 === "a" && a2 === "a" && a3 === "a", `${a1}/${a2}/${a3}`);
}

{
	// 快照往返 = 可选跨刷新持久化:重载后不会立刻又看到同一句
	const bag = T.createShuffleBag({ recentLimit: 3 });
	const pool = ["a", "b", "c", "d"];
	bag.next(pool, "k", false, zero);
	const last = bag.next(pool, "k", false, zero);
	const restored = T.createShuffleBag({ recentLimit: 3 });
	restored.load(bag.snapshot());
	const afterReload = restored.next(pool, "k", false, zero);
	report("快照往返后不立刻重复上一句", afterReload !== last, `上一句 ${last} → 重载后 ${afterReload}`);
	report("损坏的存档不会拦住启动", (() => {
		const b = T.createShuffleBag({ recentLimit: 3 });
		b.load(null); b.load("x"); b.load({ k: 7 }); b.load({ k: { bag: "no", recent: 3 } });
		return b.next(pool, "k", false, zero) !== null;
	})());
}

{
	// recentLimit 可配:configure 之后立刻生效,并裁剪已有的 recent
	const bag = T.createShuffleBag({ recentLimit: 3 });
	bag.next(["a", "b", "c"], "k", false, zero);
	bag.configure({ recentLimit: 1 });
	report("configure 就地生效", bag.recentLimit === 1, "recentLimit=" + bag.recentLimit);
	report("configure 忽略非法值", (() => { bag.configure({ recentLimit: -5 }); bag.configure(null); return bag.recentLimit === 1; })());
}

{
	// 权重仍然生效:加权模式下 rand 指向哪条就抽哪条
	const bag = T.createShuffleBag({ recentLimit: 3 });
	const pool = [{ text: "a", weight: 1 }, { text: "b", weight: 9 }];
	// rand()=0 → 权重表第一项;0.99 → 落在 b
	report("加权模式在袋内照样按权重抽", bag.next(pool, "k", true, () => 0.99) === "b" && bag.next(pool, "k", true, () => 0) === "a");
}

// ───────────────────────────────────────────────────────────────────────────
// when 规则与 rarity
// ───────────────────────────────────────────────────────────────────────────
section("when 规则:归一化与判定");

{
	const n = T.normalizeWhen;
	report("丢弃未知键", JSON.stringify(n({ nope: 1 })) === "null", String(n({ nope: 1 })));
	report("保留合法键并丢弃旁边非法值", JSON.stringify(n({ tool: "bash", hour: [25, 3], nope: 1 })) === JSON.stringify({ tool: "bash" }));
	report("hour 越界 / 非整数一律丢弃", n({ hour: [1.5, 3] }) === null && n({ hour: [0, 24] }) === null && n({ hour: [1] }) === null);
	report("phase 只认四个相位", JSON.stringify(n({ phase: "idle" })) === JSON.stringify({ phase: "idle" }) && n({ phase: "nope" }) === null);
	report("空对象 → null(当作无条件条目)", n({}) === null && n(null) === null && n("x") === null);
	report("pending 数字取整", JSON.stringify(n({ pending: 2.7 })) === JSON.stringify({ pending: 2 }));
}

{
	const m = T.matchWhen;
	const base = { tools: [], retry: false, pending: 0, phase: "running", hour: 12, firstTurn: false };
	report("无条件规则不成立(matchWhen 只管有条件条目)", m(null, base) === false && m({}, base) === false);
	report("tool:精确命中", m({ tool: "bash" }, { ...base, tools: ["bash"] }) === true && m({ tool: "bash" }, { ...base, tools: ["web_search"] }) === false);
	report("tool:数组任一命中", m({ tool: ["bash", "read"] }, { ...base, tools: ["read"] }) === true);
	report("tool:'*' = 任意工具在跑", m({ tool: "*" }, { ...base, tools: ["whatever"] }) === true && m({ tool: "*" }, base) === false);
	report("tool:没有工具在跑时一律不成立", m({ tool: "bash" }, base) === false);
	report("retry:正反都能写", m({ retry: true }, { ...base, retry: true }) === true && m({ retry: true }, base) === false
		&& m({ retry: false }, base) === true && m({ retry: false }, { ...base, retry: true }) === false);
	report("pending:布尔与数字两种口径", m({ pending: true }, { ...base, pending: 1 }) === true && m({ pending: true }, base) === false
		&& m({ pending: 2 }, { ...base, pending: 2 }) === true && m({ pending: 2 }, { ...base, pending: 1 }) === false);
	report("phase:单个与数组", m({ phase: "long" }, { ...base, phase: "long" }) === true && m({ phase: ["thinking", "long"] }, { ...base, phase: "long" }) === true
		&& m({ phase: "long" }, base) === false);
	report("hour:普通区间半开", m({ hour: [9, 17] }, { ...base, hour: 9 }) === true && m({ hour: [9, 17] }, { ...base, hour: 16 }) === true
		&& m({ hour: [9, 17] }, { ...base, hour: 17 }) === false && m({ hour: [9, 17] }, { ...base, hour: 8 }) === false);
	report("hour:跨午夜 22→6", m({ hour: [22, 6] }, { ...base, hour: 23 }) === true && m({ hour: [22, 6] }, { ...base, hour: 5 }) === true
		&& m({ hour: [22, 6] }, { ...base, hour: 6 }) === false && m({ hour: [22, 6] }, { ...base, hour: 12 }) === false);
	report("hour:起止相同 = 整天", m({ hour: [0, 0] }, { ...base, hour: 13 }) === true);
	report("firstTurn 正反", m({ firstTurn: true }, { ...base, firstTurn: true }) === true && m({ firstTurn: true }, base) === false
		&& m({ firstTurn: false }, base) === true);
	report("多条件是 AND", m({ tool: "bash", phase: "long" }, { ...base, tools: ["bash"], phase: "long" }) === true
		&& m({ tool: "bash", phase: "long" }, { ...base, tools: ["bash"], phase: "running" }) === false);
	report("ctx 缺字段按不成立处理(不会误放行)", m({ tool: "bash" }, {}) === false && m({ pending: true }, {}) === false);
}

section("rarity 与池子策略");

{
	report("没有 rarity → 永远参与", T.rarityPass("a", () => 0.999) === true && T.rarityPass({ text: "a" }, () => 0.999) === true);
	report("rarity 掷骰:掷中才参与", T.rarityPass({ text: "a", rarity: 0.01 }, () => 0.005) === true
		&& T.rarityPass({ text: "a", rarity: 0.01 }, () => 0.5) === false);
	report("rarity 归一化:只接受 (0,1]", T.normalizeRarity(0) === undefined && T.normalizeRarity(1.5) === undefined
		&& T.normalizeRarity(0.5) === 0.5 && T.normalizeRarity("0.5") === undefined);
}

{
	const ctx = { tools: ["bash"], retry: false, pending: 0, phase: "running", hour: 12, firstTurn: false };
	const plain = ["p1", "p2"];
	// 条件命中 → 只从命中的条件句里选
	const hit = T.selectPhrasePool([...plain, { text: "t", when: { tool: "bash" } }], ctx, () => 0.999);
	report("条件命中即优先(不被上千条无条件句淹没)", hit.length === 1 && T.entryText(hit[0]) === "t", textsOf(hit).join(","));
	// 条件不命中 → 退回无条件句
	const miss = T.selectPhrasePool([...plain, { text: "t", when: { tool: "web_search" } }], ctx, () => 0.999);
	report("条件没命中 → 退回无条件句", JSON.stringify(textsOf(miss)) === JSON.stringify(plain), textsOf(miss).join(","));
	// 全是有条件句且都没命中 → 退回全体(状态行不空)
	const allCond = T.selectPhrasePool([{ text: "t", when: { tool: "web_search" } }], ctx, () => 0.999);
	report("全是有条件句且都没命中 → 退回全体,状态行不空", allCond.length === 1, textsOf(allCond).join(","));
	// rarity 把整池筛掉 → 退回全体
	const allRare = T.selectPhrasePool([{ text: "r", rarity: 0.01 }], ctx, () => 0.9);
	report("rarity 把整池筛掉 → 退回全体", allRare.length === 1, textsOf(allRare).join(","));
	report("空池返回空数组", T.selectPhrasePool([], ctx, () => 0).length === 0 && T.selectPhrasePool(null, ctx, () => 0).length === 0);
}

section("+ 组合:与 pickFrom 同样的调用顺序");
{
	// pickFrom 的实际顺序是「先 selectPhrasePool 定池 → 再 phraseBag.next 抽」。
	// 分开测都对、合起来接错(比如先抽后筛)就会表现为「条件句永远出不来」,所以这里串起来验一遍。
	const pool0 = ["普通 A", "普通 B", { text: "正在敲命令…", when: { tool: "bash" } }];
	const ctx = { tools: ["bash"], retry: false, pending: 0, phase: "running", hour: 12, firstTurn: false };
	const bag = T.createShuffleBag({ recentLimit: 3 });
	const picked = [];
	for (let i = 0; i < 3; i++) {
		const pool = T.selectPhrasePool(pool0, ctx, () => 0.999);
		picked.push(bag.next(pool, "zh|running|w", true, () => 0));
	}
	report("bash 在跑时,连续三次都只出条件句", picked.every((p) => p === "正在敲命令…"), picked.join(","));
	// 工具停了 → 回到无条件句
	const idle = T.selectPhrasePool(pool0, { ...ctx, tools: [] }, () => 0.999);
	report("工具停了立刻回到无条件句", idle.every((e) => T.entryWhen(e) === null), textsOf(idle).join(","));
}

section("零破坏:无条件条目的形状不变");
{
	report("纯字符串条目不多出 when/rarity 键", JSON.stringify(T.normalizeEntry("正在写代码…")) === JSON.stringify({ text: "正在写代码…", weight: 1 }));
	report("只有权重的条目形状不变", JSON.stringify(T.normalizeEntry({ text: "a", weight: 3 })) === JSON.stringify({ text: "a", weight: 3 }));
	report("非法 when 不会把整条变成条件句", (() => {
		const e = T.normalizeEntry({ text: "a", when: { nope: 1 } });
		return e.when === undefined && T.entryWhen(e) === null;
	})());
	report("isBareEntry 只认真正裸的条目", T.isBareEntry({ text: "a", weight: 1 }) === true
		&& T.isBareEntry({ text: "a", weight: 2 }) === false
		&& T.isBareEntry({ text: "a", weight: 1, when: { retry: true } }) === false
		&& T.isBareEntry({ text: "a", weight: 1, rarity: 0.5 }) === false);
}

// ───────────────────────────────────────────────────────────────────────────
// 设置页行语法:必须双向可逆
// ───────────────────────────────────────────────────────────────────────────
section("设置页行语法:parse ↔ phraseLines 双向可逆");
{
	const cases = [
		"plain",
		"a | 3",
		"a | when:tool=bash",
		"a | 3 | when:tool=bash+web_search,phase=long",
		"a | when:retry,pending",
		"a | rarity:0.01",
		"a | 5 | when:hour=22-6 | rarity:0.05",
		"a | when:firstTurn",
		"a | when:tool=*",
		// 旧语义:非正权重 / 非数字后缀 / 空正文 / 两个数字段,一律按原文保留
		"a | 0",
		"d | x",
		"| 5",
		"f | 10 | 2",
		"a | b | 3"
	];
	const broken = cases.filter((line) => {
		const parsed = firstOf(T.parseWeightedLines(line));
		return T.phraseLines([parsed]) !== line;
	});
	report("往返一致(含旧语法边界)", broken.length === 0, broken.length ? "不一致: " + broken.join(" / ") : `${cases.length} 例`);
	// 条件字段确实被解析出来(不是被当正文吃掉)
	const parsed = firstOf(T.parseWeightedLines("正在敲命令… | 2 | when:tool=bash,retry"));
	report("条件段被解析进 when(不是留在正文里)", parsed.text === "正在敲命令…" && parsed.weight === 2
		&& JSON.stringify(parsed.when) === JSON.stringify({ tool: "bash", retry: true }), JSON.stringify(parsed));
	// 反向:手写 JSON 条目 → 设置页行 → 条目。这正是「打开设置页保存一次就丢条件」的路径。
	const jsonEntries = [
		{ text: "a", weight: 2, when: { tool: "bash" } },
		{ text: "b", weight: 1, when: { hour: [22, 6], retry: true } },
		{ text: "c", weight: 1, rarity: 0.25 },
		{ text: "d", weight: 1, when: { phase: ["thinking", "long"], firstTurn: true } }
	];
	const backAgain = jsonEntries.map((e) => firstOf(T.parseWeightedLines(T.phraseLines([e]))));
	report("JSON 条目 → 行 → 条目 不丢条件/稀有度",
		backAgain.every((e, i) => T.entryText(e) === jsonEntries[i].text
			&& T.entryWeight(e) === jsonEntries[i].weight
			&& JSON.stringify(T.entryWhen(e)) === JSON.stringify(T.entryWhen(jsonEntries[i]))
			&& JSON.stringify(T.entryRarity(e)) === JSON.stringify(T.entryRarity(jsonEntries[i]))),
		JSON.stringify(backAgain));
	// 正文里的 | 不被修饰段吃掉
	report("正文里的 | 保留", firstOf(T.parseWeightedLines("a | b | 3")).text === "a | b");
}

// ───────────────────────────────────────────────────────────────────────────
// node 半边:接受新字段、拒绝非法值、比较键带上 when
// ───────────────────────────────────────────────────────────────────────────
(async () => {
	section("node 半边:校验与比较键");
	const { pathToFileURL } = require("node:url");
	const node = await import(pathToFileURL(path.join(__dirname, "..", "lib", "index.js")).href);
	const accepts = (doc) => {
		try { node.validateConfigDocument(doc); return true; } catch (error) { return false; }
	};

	report("接受带 when 的条目", accepts({ phrases: { zh: { thinking: [{ text: "a", when: { tool: "bash" } }] } } }));
	report("接受带 rarity 的条目", accepts({ phrases: { zh: { thinking: [{ text: "a", rarity: 0.01 }] } } }));
	report("拒绝未知 when 键(避免「这句永远不出现」的静默失败)",
		!accepts({ phrases: { zh: { thinking: [{ text: "a", when: { tools: "bash" } }] } } }));
	report("拒绝越界的 hour", !accepts({ phrases: { zh: { thinking: [{ text: "a", when: { hour: [25, 3] } }] } } }));
	report("拒绝非法 phase", !accepts({ phrases: { zh: { thinking: [{ text: "a", when: { phase: "nope" } }] } } }));
	report("拒绝越界 rarity", !accepts({ phrases: { zh: { thinking: [{ text: "a", rarity: 0 }] } } })
		&& !accepts({ phrases: { zh: { thinking: [{ text: "a", rarity: 1.5 }] } } }));
	report("packs 里的条目同样受校验", accepts({ packs: [{ id: "p", phrases: { zh: { thinking: [{ text: "a", when: { retry: true } }] } } }] })
		&& !accepts({ packs: [{ id: "p", phrases: { zh: { thinking: [{ text: "a", when: { nope: 1 } }] } } }] }));

	// 比较键:文本相同、when 不同 → 必须被当成两个不同条目,否则保存一次就丢条件
	const plainKey = node.normalizeEntry({ text: "a", weight: 1 });
	const condKey = node.normalizeEntry({ text: "a", weight: 1, when: { tool: "bash" } });
	const reordered = node.normalizeEntry({ text: "a", weight: 1, when: { retry: true, tool: "bash" } });
	const ordered = node.normalizeEntry({ text: "a", weight: 1, when: { tool: "bash", retry: true } });
	const rareKey = node.normalizeEntry({ text: "a", weight: 1, rarity: 0.5 });
	report("比较键区分「同文本不同 when」", plainKey !== condKey && condKey !== rareKey, condKey);
	report("比较键对 when 键序不敏感", reordered === ordered);

	// antiRepeat 的钳制与持久化开关
	const sanitized = node.sanitizeConfigDocument({ config: { antiRepeat: { recentLimit: 999, persist: true } } });
	report("antiRepeat.recentLimit 被钳到上限", sanitized.config.antiRepeat.recentLimit === 50, String(sanitized.config.antiRepeat.recentLimit));
	report("antiRepeat.persist 保留", sanitized.config.antiRepeat.persist === true);
	const bad = node.sanitizeConfigDocument({ config: { antiRepeat: { recentLimit: "x", persist: "yes" } } });
	report("antiRepeat 非法值被剔除", bad.config.antiRepeat === undefined, JSON.stringify(bad.config.antiRepeat));

	console.log("\n──── 结论 ────");
	console.log(failures === 0
		? "洗牌袋、条件选词、行语法往返与 node 半边的校验/比较键都成立"
		: `仍有 ${failures} 项不成立(见上面的 ✗)`);
	process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
	console.error(error);
	process.exit(2);
});
