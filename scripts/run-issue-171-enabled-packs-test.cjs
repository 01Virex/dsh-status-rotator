/**
 * issue #171:真实设置页开关 → 自动 PUT → 默认层合并 → 卸载并重新打开。
 * 复用设置页的 React/DOM 夹具,覆盖默认部分启用、旧文档缺名单、没有词库包。
 * node scripts/run-issue-171-enabled-packs-test.cjs [--browser=<path>]
 */
const { runPageTest } = require("./browser-test-runner.cjs");

(async () => {
	let failed = 0;
	for (const scenario of ["default", "missing", "empty"]) {
		const result = await runPageTest({
			file: "settings-save-test.html",
			query: "?packs=" + scenario,
			label: "issue #171 词库包启用名单持久化 / " + scenario,
			timeoutMs: 30000,
		});
		if (result.missingBrowser) process.exit(2);
		if (result.noCdp) process.exit(3);
		if (!result.pass) failed++;
	}
	process.exit(failed ? 1 : 0);
})().catch(error => {
	console.error(error);
	process.exit(4);
});
