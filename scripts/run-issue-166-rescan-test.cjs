/**
 * 真浏览器跑 issue #166 回归页(dev-only,不随 npm 包发布)。
 *
 * scripts/issue-166-rescan-test.html 用真实 lib/client.js + 真 DOM 量「常驻 2 秒兜底轮询」
 * 这笔周期开销是否真的收掉了,并证明关掉兜底后各条事件驱动路径仍能接住:
 *   off        —— rescanIntervalMs=0:2.6 秒内 0 次全树重扫;新增节点 / 宽度变化 / 晚到服务仍工作
 *   interval   —— rescanIntervalMs=1000:兜底重扫按配置真的发生(可配 + 空闲调度没坏)
 *   default    —— 文档不写这个键:默认 10000ms,2.6 秒内 0 次全树重扫(旧版 2 秒硬编码会扫 1 次)
 *   settings   —— 设置页「行为 → 基本设置」里有同族字段,默认 10000,改完真的整份落盘
 *
 * 用法:
 *   node scripts/run-issue-166-rescan-test.cjs [--browser=<path>]
 */
const { runPageTest } = require("./browser-test-runner.cjs");

const scenarios = [
	{ query: "?mode=off", label: "issue #166 兜底关闭 + 事件驱动兜底" },
	{ query: "?mode=interval", label: "issue #166 兜底间隔可配" },
	{ query: "?mode=default", label: "issue #166 默认间隔不再是 2 秒" },
	{ query: "?mode=settings", label: "issue #166 设置页同族字段" },
];

(async () => {
	let failed = 0;
	for (const scenario of scenarios) {
		const result = await runPageTest({
			file: "issue-166-rescan-test.html",
			label: scenario.label,
			query: scenario.query,
			timeoutMs: 90000,
		});
		if (result.missingBrowser) process.exit(2);
		if (result.noCdp) process.exit(3);
		if (!result.pass) failed += 1;
	}
	if (failed > 0) console.log(`\n${failed}/${scenarios.length} 个场景失败`);
	process.exit(failed > 0 ? 1 : 0);
})().catch((error) => {
	console.error("runner 异常:", error);
	process.exit(4);
});
