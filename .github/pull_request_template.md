<!-- 请用中文或英文填写均可 / Chinese or English are both fine -->

## 改了什么 / What changed

<!-- 一两句说清改动的对象与效果 / one or two lines: what changed and what it does -->

## 为什么 / Why

<!-- 根因、关联 issue(如 Fixes #123)。没有 issue 也可以,但要写清动机。
     Root cause and the issue it fixes (e.g. "Fixes #123"); no issue is fine, but explain the motivation. -->

## 怎么验证的 / How verified

<!-- 贴命令与实际输出,最好有「修前失败 / 修后通过」的对照。
     Paste the commands and their real output — before-failing / after-passing evidence if this is a fix. -->

- [ ] `npm test`
- [ ] `node scripts/run-danmaku-mount-test.cjs --page=<danmaku|label|settings|pending|title>`
- [ ] `node scripts/run-turn-process-test.cjs`
- [ ] 相关 `node scripts/verify-*.cjs`

```text
<在此粘贴输出 / paste output here>
```

## 影响面 / Impact

<!-- 勾选并补充说明 / tick and add details -->

- [ ] 兼容性:是否影响 dsh ≤0.1.6 / 0.1.7 / 0.2.0+ 三条宿主路径 / host-generation compatibility
- [ ] 词库 / bank(`config.example.json`):一行一条、以 `…` 结尾、不含 `;`、无重复、链接只在 `ads` ✓
- [ ] 设置项 / settings key:已同时改 `DEFAULT_CONFIG`、`normalizeConfig()`、node 半区清洗与设置页 `editorState`(issue #96)
- [ ] 新 `<style>` 走 `createOwnedStyle()`(带 `data-plugin`,issue #94)
- [ ] 卸载/回合结束时释放干净(观察器、map、定时器;issue #87)
- [ ] 文档:`CHANGELOG.md` 已记;`README.md` / `README_ZH.md`(及 `CONTRIBUTORS*.md`)中英同步
