/**
 * 真浏览器跑 issue #151 投稿界面回归(dev-only,不随 npm 包发布)。
 *
 * scripts/issue-151-submit-test.html 用真实 lib/client.js + 真 DOM 走完整交互:
 * 打开「投稿」页签 → 空文案不就绪 → 打字 → 本地同口径校验 → 勾选须知 → 出正文
 * → 「复制正文」拿到正文本身 → 「打开投稿页」的 URL 里 body 与正文逐字一致。
 *
 * 用法:
 *   node scripts/run-issue-151-submit-test.cjs [--browser=<path>]
 */
const { runPageTestAndExit } = require("./browser-test-runner.cjs");

runPageTestAndExit({
	file: "issue-151-submit-test.html",
	label: "issue #151 设置页投稿界面",
	timeoutMs: 60000,
}).catch((error) => {
	console.error("runner 异常:", error);
	process.exit(4);
});
