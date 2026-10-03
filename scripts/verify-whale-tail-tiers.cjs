#!/usr/bin/env node
/** Slower tok/s ladders, configurable cap, hysteresis and client/server contracts. */
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
section("速度档位、预设上限和等待速度");
const bottom = 1;
for (const [count, expected] of [[2, [1]], [3, [1, 1.25, 1.5]], [4, [1, 1.333, 1.667, 2]], [5, [1, 1.375, 1.75, 2.125, 2.5]]]) {
    const actual = ladder(tpsMode({ tpsTiers: count }));
    report(count + " 档完整取值集合", JSON.stringify(actual) === JSON.stringify(expected), JSON.stringify(actual));
    let prior = -Infinity;
    let monotonic = true;
    for (let tps = 0; tps <= 500; tps += 0.5) {
        const value = freq(tpsMode({ tpsTiers: count }), tps);
        if (value < prior) monotonic = false;
        prior = value;
    }
    report(count + " 档随输出速度单调不减", monotonic);
}
report("连续模式等待时每轮 1 秒", nearly(freq(tpsMode(), 0), bottom));
report("所有档位等待时每轮 1 秒", [2, 3, 4, 5].every(tpsTiers => nearly(freq(tpsMode({ tpsTiers }), 0), bottom)));
report("非法/非有限输出速度安全回到等待档", [NaN, Infinity, -Infinity, -10].every(tps => nearly(freq(tpsMode({ tpsTiers: 3 }), tps), bottom)));
report("高档位具有更高上限:1 / 1.5 / 2 / 2.5", [2, 3, 4, 5].every(tpsTiers => nearly(freq(tpsMode({ tpsTiers }), 100000), tpsTiers / 2)));
report("默认 3 档及连续模式上限为 1.5", [0, 3].every(tpsTiers => nearly(freq(tpsMode({ tpsTiers }), 100000), 1.5)));
report("同一 tok/s 下高档位不会反而更慢", Array.from({ length: 241 }, (_, tps) => tps).every(tps => [3, 4, 5].every(tpsTiers => freq(tpsMode({ tpsTiers }), tps) >= freq(tpsMode({ tpsTiers: tpsTiers - 1 }), tps))));
report("手动改上限显示自定义,匹配预设及连续模式正常识别", T.whaleTailTpsPresetSelection({ tpsTiers: "4", tpsMaxSpeed: "1.5" }) === "custom"
    && T.whaleTailTpsPresetSelection({ tpsTiers: "4", tpsMaxSpeed: "2" }) === "4"
    && T.whaleTailTpsPresetSelection({ tpsTiers: "0", tpsMaxSpeed: "2" }) === "0");
report("默认档位为 3", T.DEFAULT_CONFIG.whaleTailMotion.tpsTiers === 3);
for (const cap of [1, 1.0835, 2, 3, 5, 10]) {
    report("连续和分档都遵守自定义上限 " + cap, [0, 2, 3, 4, 5].every(tpsTiers => nearly(freq(tpsMode({ tpsTiers, tpsMaxSpeed: cap }), 100000), cap)));
}
report("旧上限低于 1 时自动归一为 1,不压低最低档", [0, 2, 3, 4, 5].every(tpsTiers => [0, 60, 120, 100000].every(tps => nearly(freq(tpsMode({ tpsTiers, tpsMaxSpeed: 0.5 }), tps), 1))));
report("自定义上限越界钳制到 10", [0, 2, 3, 4, 5].every(tpsTiers => nearly(freq(tpsMode({ tpsTiers, tpsMaxSpeed: 99 }), 100000), 10)));
report("小数上限不被档位舍入反向超过", [1.0005, 1.0835, 9.9995].every(tpsMaxSpeed => [0, 2, 3, 4, 5].every(tpsTiers => Array.from({ length: 121 }, (_, tps) => freq(tpsMode({ tpsTiers, tpsMaxSpeed }), tps)).every(speed => speed <= tpsMaxSpeed))));
report("新范围的前后端与预设校验一致", [0.5, 1, 10, 10.25, 99].every(tpsMaxSpeed => {
    const input = { whaleTailMotion: { tpsMaxSpeed } };
    const client = T.normalizeConfig(input).whaleTailMotion;
    const doc = node.sanitizeConfigDocument({ config: input, presets: [{ id: "limit", config: input }] });
    const expected = Math.min(10, Math.max(1, tpsMaxSpeed));
    return client.tpsMaxSpeed === expected && doc.config.whaleTailMotion.tpsMaxSpeed === expected && doc.presets[0].config.whaleTailMotion.tpsMaxSpeed === expected;
}));
report("非法档位退回更慢的连续模式", [1, 6, -1, "3", null, NaN].every(tpsTiers => [0, 32, 120, 100000].every(tps => nearly(freq(tpsMode({ tpsTiers }), tps), freq(tpsMode(), tps)))));

section("档位边界防抖,改上限即时生效");
const motion = tpsMode({ tpsTiers: 3 });
let speed = bottom;
let stable = true;
for (const tps of [59, 61, 60, 62, 61]) {
    speed = freq(motion, tps, speed);
    if (!nearly(speed, bottom)) stable = false;
}
report("60 tok/s 附近上下来回不会反复升档", stable);
speed = freq(motion, 65, speed);
report("超过缓冲区后进入中档", nearly(speed, 1.25));
stable = true;
for (const tps of [61, 59, 57, 58]) {
    speed = freq(motion, tps, speed);
    if (!nearly(speed, 1.25)) stable = false;
}
report("中档不会因短暂边界波动立即降档", stable);
report("输出降到缓冲区外会回到低档", nearly(freq(motion, 54, speed), bottom));
report("等待立即回低档", nearly(freq(motion, 0, 1.5), bottom));
report("变更上限不沿用失效的旧档位", nearly(freq(tpsMode({ tpsTiers: 3, tpsMaxSpeed: 10 }), 200, 1.5), 10));
report("未启用不播放", freq({ enabled: false, mode: "tps", tpsTiers: 3 }, 128) === 0);
report("固定模式保持原有范围", nearly(freq({ enabled: true, mode: "fixed", fixedSpeed: 99 }, 0), 6)
    && nearly(freq({ enabled: true, mode: "fixed", fixedSpeed: 1.5, tpsTiers: 3, tpsMaxSpeed: 0.5 }, 0), 1.5));

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
console.log("\nVERIFIED:慢速档位、可调上限、边界防抖与前后端校验通过");
})().catch((error) => {
	console.error(error);
	process.exit(2);
});
