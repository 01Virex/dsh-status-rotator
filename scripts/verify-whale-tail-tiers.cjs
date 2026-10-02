#!/usr/bin/env node
/**
 * 鲸鱼尾巴摇速「分档」的独立验证。
 *
 * 为什么需要它:尾巴摇速跟着 tok/s 走时,原来是**连续**映射( tok/s ÷ 16,夹到 2–6 次/秒 )。
 * 6 次/秒已经是四倍于参考摇速,尾巴只剩糊影 —— 小黑盒那条反馈的原话是
 * 「直接起飞了…都看不清尾巴了」,诉求是「弄成几个档次,不要无上限」。
 *
 * 这件事**看不出来**:分档错了(比如上限还是 6、或者档位不单调、或者旧配置被改变行为)
 * 肉眼只会觉得「好像还是很快」,不会知道是档位没生效。所以这里按三层钉住:
 *
 *   纯函数     档位取值集合 / 上限 / 单调性 / 等待档 / 非法值退回连续
 *   不回归     不带这个键时,逐点等于改动前的连续行为 —— 旧配置零改动
 *   两半契约   浏览器归一半区与 node 半区对同一个键的校验一致(接受、钳制、丢弃非法)
 *
 * 运行:node scripts/verify-whale-tail-tiers.cjs
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

// ── 浏览器半边(纯函数层):与 smoke-test 同一套 vm 沙箱 ──
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
					throw new Error("verify-whale-tail-tiers 意外 require: " + name);
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

const T = exports_.__test;
if (!T) {
	console.error("FAIL: client.js 未导出 __test");
	process.exit(1);
}
(async () => {
const node = await import("../lib/index.js");

const freq = T.whaleTailWagFrequency;
/** 一份「已启用 + tok/s 模式」的最小配置 */
const tpsMode = (extra) => Object.assign({ enabled: true, mode: "tps" }, extra || {});
/** 扫一遍 tok/s,收集出现过的速度值(去重、升序) */
const ladder = (motion) => {
	const seen = new Set();
	// 密集采样:档位是「取不超过期望值的最高档」,采样太稀会漏掉中间档(那不是实现的问题)
	for (let tps = 0; tps <= 200; tps += 1) seen.add(freq(motion, tps));
	for (const tps of [256, 512, 4096, 100000]) seen.add(freq(motion, tps));
	return Array.from(seen).sort((a, b) => a - b);
};
const nearly = (a, b) => Math.abs(a - b) < 1e-9;

console.log("dsh-status-rotator 鲸尾摇速分档验证");

// ───────────────────────────────────────────────────────────────────────────
section("分档取值:离散、且上限压到看得清");
// ───────────────────────────────────────────────────────────────────────────
report("2 档 → {2, 4}", JSON.stringify(ladder(tpsMode({ tpsTiers: 2 }))) === JSON.stringify([2, 4]),
	JSON.stringify(ladder(tpsMode({ tpsTiers: 2 }))));
report("3 档 → {2, 3, 4}", JSON.stringify(ladder(tpsMode({ tpsTiers: 3 }))) === JSON.stringify([2, 3, 4]),
	JSON.stringify(ladder(tpsMode({ tpsTiers: 3 }))));
report("4 档 → {2, 2.67, 3.33, 4}", JSON.stringify(ladder(tpsMode({ tpsTiers: 4 }))) === JSON.stringify([2, 2.67, 3.33, 4]),
	JSON.stringify(ladder(tpsMode({ tpsTiers: 4 }))));
report("5 档 → {2, 2.5, 3, 3.5, 4}", JSON.stringify(ladder(tpsMode({ tpsTiers: 5 }))) === JSON.stringify([2, 2.5, 3, 3.5, 4]),
	JSON.stringify(ladder(tpsMode({ tpsTiers: 5 }))));

// 反馈的核心:上限。连续模式是 6,分档是 4 —— 且 tok/s 再高也不会越过去。
const veryFast = freq(tpsMode({ tpsTiers: 3 }), 100000);
report("tok/s 极高时仍停在上限档 4(不是 6)", nearly(veryFast, 4), String(veryFast));
report("分档上限 = WHALE_TAIL_TPS_TIER_TOP(4)", T.WHALE_TAIL_TPS_TIER_TOP === 4, String(T.WHALE_TAIL_TPS_TIER_TOP));
report("连续模式的上限仍是 6(未被改动)",
	nearly(freq(tpsMode(), 100000), 6), String(freq(tpsMode(), 100000)));

// 单调不减:tok/s 变大,速度不能反而变小(档位边界处的取整方向)
{
	let previous = -Infinity;
	let monotonic = true;
	let at = -1;
	for (let tps = 0; tps <= 400; tps += 0.5) {
		const value = freq(tpsMode({ tpsTiers: 4 }), tps);
		if (value < previous - 1e-9) { monotonic = false; at = tps; break; }
		previous = value;
	}
	report("随 tok/s 单调不减(0→400 逐点扫)", monotonic, monotonic ? "无回退" : "在 tps=" + at + " 处回退");
}

// 等待时(tps 取不到 / 非有限)保持首档,与原有的「等待时也保持基准速度」一致
report("等待(tps=0)落在首档 2", nearly(freq(tpsMode({ tpsTiers: 3 }), 0), 2), String(freq(tpsMode({ tpsTiers: 3 }), 0)));
report("tps 非有限(NaN)落在首档 2", nearly(freq(tpsMode({ tpsTiers: 3 }), NaN), 2), String(freq(tpsMode({ tpsTiers: 3 }), NaN)));

// ───────────────────────────────────────────────────────────────────────────
section("非法值退回连续:不给旧配置改行为");
// ───────────────────────────────────────────────────────────────────────────
{
	const samples = [0, 1, 8, 24, 48, 96, 512];
	const continuous = samples.map((tps) => freq(tpsMode(), tps));
	const sameAsContinuous = (motion) => samples.every((tps, i) => nearly(freq(motion, tps), continuous[i]));
	report("tpsTiers=0 → 与不带该键逐点一致", sameAsContinuous(tpsMode({ tpsTiers: 0 })));
	report("tpsTiers=1(等于固定速度,无意义)→ 连续", sameAsContinuous(tpsMode({ tpsTiers: 1 })));
	report("tpsTiers=6(越界)→ 连续", sameAsContinuous(tpsMode({ tpsTiers: 6 })));
	report("tpsTiers=-1 → 连续", sameAsContinuous(tpsMode({ tpsTiers: -1 })));
	report("tpsTiers=\"3\"(字符串,非数字)→ 连续", sameAsContinuous(tpsMode({ tpsTiers: "3" })));
	report("tpsTiers=null → 连续", sameAsContinuous(tpsMode({ tpsTiers: null })));
	report("tpsTiers=NaN → 连续", sameAsContinuous(tpsMode({ tpsTiers: NaN })));
	report("whaleTailTpsTiers 对 3.9 取整为 3", T.whaleTailTpsTiers({ tpsTiers: 3.9 }) === 3, String(T.whaleTailTpsTiers({ tpsTiers: 3.9 })));
}

// ───────────────────────────────────────────────────────────────────────────
section("别的分支不受影响");
// ───────────────────────────────────────────────────────────────────────────
report("未启用(enabled=false)→ 0,连档位也不参与",
	freq({ enabled: false, mode: "tps", tpsTiers: 3 }, 128) === 0, String(freq({ enabled: false, mode: "tps", tpsTiers: 3 }, 128)));
report("fixed 模式忽略 tpsTiers,照旧用 fixedSpeed",
	nearly(freq({ enabled: true, mode: "fixed", fixedSpeed: 1.5, tpsTiers: 3 }, 4096), 1.5),
	String(freq({ enabled: true, mode: "fixed", fixedSpeed: 1.5, tpsTiers: 3 }, 4096)));
report("fixed 模式仍钳制到 6",
	nearly(freq({ enabled: true, mode: "fixed", fixedSpeed: 99, tpsTiers: 3 }, 4096), 6),
	String(freq({ enabled: true, mode: "fixed", fixedSpeed: 99, tpsTiers: 3 }, 4096)));

// ───────────────────────────────────────────────────────────────────────────
section("两半契约:同一个键,浏览器归一半区与 node 半区校验一致");
// ───────────────────────────────────────────────────────────────────────────
{
	const viaNormalize = T.normalizeConfig({ whaleTailMotion: { enabled: true, mode: "tps", tpsTiers: 3.9 } }).whaleTailMotion;
	report("归一化:接受并取整(3.9 → 3)", viaNormalize.tpsTiers === 3, JSON.stringify(viaNormalize));

	const clampedLarge = T.normalizeConfig({ whaleTailMotion: { tpsTiers: 99 } }).whaleTailMotion;
	report("归一化:越界钳到上限 5", clampedLarge.tpsTiers === 5, JSON.stringify(clampedLarge));

	const clampedNegative = T.normalizeConfig({ whaleTailMotion: { tpsTiers: -4 } }).whaleTailMotion;
	report("归一化:负数钳到 0", clampedNegative.tpsTiers === 0, JSON.stringify(clampedNegative));

	const dropped = (T.normalizeConfig({ whaleTailMotion: { tpsTiers: "3" } }) || {}).whaleTailMotion || {};
	report("归一化:非数字丢弃该键", dropped.tpsTiers === undefined, JSON.stringify(dropped));

	const nodeValid = node.sanitizeConfigDocument({ config: { whaleTailMotion: { enabled: true, mode: "tps", tpsTiers: 4 } } });
	report("node 校验:合法值透传", nodeValid.config.whaleTailMotion.tpsTiers === 4, JSON.stringify(nodeValid.config.whaleTailMotion));

	const nodeClamp = node.sanitizeConfigDocument({ config: { whaleTailMotion: { tpsTiers: 88 } } });
	report("node 校验:越界钳到 5", nodeClamp.config.whaleTailMotion.tpsTiers === 5, JSON.stringify(nodeClamp.config.whaleTailMotion));

	const nodeFloor = node.sanitizeConfigDocument({ config: { whaleTailMotion: { tpsTiers: 2.7 } } });
	report("node 校验:取整(2.7 → 2)", nodeFloor.config.whaleTailMotion.tpsTiers === 2, JSON.stringify(nodeFloor.config.whaleTailMotion));

	const nodeBad = node.sanitizeConfigDocument({ config: { whaleTailMotion: { tpsTiers: "many" } } });
	report("node 校验:非数字丢弃该键(整块也随之清掉)", (nodeBad.config.whaleTailMotion || {}).tpsTiers === undefined, JSON.stringify(nodeBad.config.whaleTailMotion));

	const nodePreset = node.sanitizeConfigDocument({ presets: [{ id: "p1", config: { whaleTailMotion: { enabled: true, tpsTiers: 9 } } }] });
	report("node 校验:预设内的 tpsTiers 同样过校验",
		nodePreset.presets[0].config.whaleTailMotion.tpsTiers === 5, JSON.stringify(nodePreset.presets[0].config.whaleTailMotion));

	// 两半的上限必须一致,否则设置页存 5 会被 node 半区改成别的值
	report("两半的上限常量为同一个值",
		node.sanitizeConfigDocument({ config: { whaleTailMotion: { tpsTiers: T.WHALE_TAIL_TPS_TIER_MAX } } }).config.whaleTailMotion.tpsTiers === T.WHALE_TAIL_TPS_TIER_MAX,
		"浏览器上限 " + T.WHALE_TAIL_TPS_TIER_MAX);
}

if (failures > 0) {
	console.error(`\nVERIFY FAILED: ${failures} 项不通过`);
	process.exit(1);
}
console.log("\nVERIFIED:分档是离散的、上限压到 4 次/秒;不带该键/非法值时逐点等于改动前的连续行为");
})().catch((error) => {
	console.error(error);
	process.exit(2);
});
