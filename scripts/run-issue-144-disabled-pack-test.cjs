/**
 * 真浏览器跑 issue #144 回归页(dev-only,不随 npm 包发布)。
 *
 * scripts/issue-144-disabled-pack-test.html 用真实 lib/client.js + 真 DOM 复现
 * 「核心词库为空时自动落点撞上未启用的词库包」:打字写盘成功,但落进未启用的包,
 * 状态栏永远看不到,且全程没有任何提示。
 *
 * 两个场景(同一个浏览器进程,省掉一次冷启动):
 *   ① 默认      —— 只启用第二个包(报告人的真实形态):落点必须是启用包,写盘必须落进去
 *   ② ?empty=1 —— 一个包都没启用:回落只能落在未启用的包上,但必须显式提示、不许静默
 *   ③ ?bad-enabled=1 —— enabledPacks 整份无效(含非字符串项)= 运行时口径「全部启用」:
 *      界面不能把包标成未启用,也不能把无效数组原样写回去(服务端会拒整次保存)
 *
 * 用法:
 *   node scripts/run-issue-144-disabled-pack-test.cjs [--browser=<path>]
 */
const { runPageTest } = require("./browser-test-runner.cjs");

const scenarios = [
	{ query: "", label: "issue #144 自动落点不撞未启用包" },
	{ query: "?empty=1", label: "issue #144 无启用包时不静默" },
	{ query: "?bad-enabled=1", label: "issue #144 enabledPacks 整份无效时不误判" },
];

(async () => {
	let failed = 0;
	let infra = 0;
	for (const scenario of scenarios) {
		const result = await runPageTest({
			file: "issue-144-disabled-pack-test.html",
			label: scenario.label,
			query: scenario.query,
			timeoutMs: 60000,
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
