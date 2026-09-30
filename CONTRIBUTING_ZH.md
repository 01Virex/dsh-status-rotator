# 为 dsh-status-rotator 做贡献

感谢你愿意帮忙!本插件把 DSH Web 的状态行换成可配置的文案,靠的就是大家的贡献 —— 代码、文案、Bug 报告都算数。[English →](./CONTRIBUTING.md)

## 你可以怎么参与

| 类型 | 怎么提 |
| --- | --- |
| **投稿文案**(最常见) | 用 **[词库投稿表单](https://github.com/01Virex/dsh-status-rotator/issues/new?template=phrase-submit.yml)** —— 机器人校验后自动开 PR。**广告**走同一个表单,把「目标词库包」选成 `ads` 即可(一行一条,写成「功能进行时短句 + 出处」)。不要手工改 `config.example.json` 提文案,条数与格式由机器人统一维护。 |
| **代码 / 文档** | Fork → 开分支 → 提 PR(见下)。 |
| **Bug** | 开 issue,写清 dsh 版本、宿主 profile、现象与控制台输出。 |

## 开发环境

**没有构建步骤**,也没有运行时依赖:插件就是普通 JS(`lib/index.js` = node 半区、`lib/client.js` = 客户端半区、`config.example.json` = 随包词库)。

```bash
git clone https://github.com/<你>/dsh-status-rotator && cd dsh-status-rotator
npm test                                  # 冒烟:纯函数 + 词库完整性(~400 条断言)
node scripts/run-danmaku-mount-test.cjs --page=settings   # 真浏览器跑设置页
node scripts/run-turn-process-test.cjs    # 状态行各档场景(0.1.6 / 0.1.7 / 0.2.0 夹具)
node scripts/verify-settings-survive-upgrade.cjs          # 端点级验证脚本
```

`scripts/` **只用于开发**(不在 `package.json` 的 `files` 里)。CI 三档(见 [`.github/workflows/test.yml`](./.github/workflows/test.yml)):`qc`(插件清单)、`test`(冒烟 + 验证脚本)、`browser`(浏览器回归)。**三档全绿才会合并。**

## 评审会看的约定

- **宿主代数**:必须同时兼容 dsh ≤0.1.6(`role="status"`)、0.1.7+(`button[data-turn-process]`)与 0.2.0+(`div[data-chat-running]`);不要依赖带构建哈希的 class 名,优先用稳定属性。
- **`<style>` 归属**:自己建的每个元素都要走 `createOwnedStyle()`,带上 `data-plugin` —— 没打标记的样式会被宿主模块系统认领后删掉(issue #94)。
- **设置项**:新增键要同时改 `DEFAULT_CONFIG`、`normalizeConfig()`(客户端)**与** node 半区的清洗函数,并放进设置页的 `editorState` 对象 —— 签名与依赖数组都由它派生(issue #96)。
- **卸载路径**:注册过的东西(样式、观察器、map、定时器)必须在回合结束与卸载时释放;`scripts/run-turn-process-test.cjs` 的泄漏档会盯容器规模(issue #87)。
- **词库风格**:一行一条、以 `…` 结尾、不含 `;` / `；`、不重复、不含 HTML;链接只允许出现在 `ads` 包里。
- **文档**:用户可见的改动要写 `CHANGELOG.md`,`README.md` / `README_ZH.md`(以及署名时的 `CONTRIBUTORS*.md`)中英保持同步。

## PR 流程

1. 从 `main` 开分支(建议 `fix/…`、`feat/…`、`docs/…`)。
2. 改动**带上回归**:没有「修前失败 / 修后通过」证据的修复很难被接受。
3. 提 PR:按模板填写、关联 issue,并贴上**修前/修后证据**(命令 + 实际输出)。
4. 等 CI;维护者评审后 squash 合并。`main` 前进时请 rebase —— GitHub 上**有冲突的 PR 根本不会跑 CI**。
5. 发版由维护者执行(改版本号 + CHANGELOG + npm `latest`/`stable` + tag/Release)。

## 署名

贡献过代码、文案或有效 Bug 报告的人都会进 [CONTRIBUTORS_ZH.md](./CONTRIBUTORS_ZH.md) / [CONTRIBUTORS.md](./CONTRIBUTORS.md);想用什么名字告诉我们即可。

参与即表示你同意[行为准则](./CODE_OF_CONDUCT_ZH.md)。安全问题请读 [SECURITY.md](./SECURITY.md),不要开公开 issue。
