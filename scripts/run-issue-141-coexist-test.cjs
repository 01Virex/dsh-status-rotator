/**
 * 真浏览器跑 issue #141 共存回归页(dev-only,不随 npm 包发布)。
 *
 * scripts/issue-141-coexist-test.html 需要 Chromium 内核浏览器;这个脚本用 CDP
 * 无头驱动它,读回 window.__RESULTS__(不看源码文本,只看计算样式与布局盒)。
 *
 * 用法:
 *   node scripts/run-issue-141-coexist-test.cjs [--browser=<path>] [--wait=2500]
 */
const { runPageTestAndExit } = require("./browser-test-runner.cjs");

runPageTestAndExit({
	file: "issue-141-coexist-test.html",
	label: "issue #141 共存回归",
}).catch((error) => {
	console.error("runner 异常:", error);
	process.exit(4);
});
