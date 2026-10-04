# 贡献者

> [English](./CONTRIBUTORS.md) | **中文**

感谢每一位为本项目贡献过代码、想法或文案的人。没有你们的付出,这个插件不会长成现在的样子。

## 项目作者

**[01Virex](https://github.com/01Virex)**(git 署名 Umamed26)— 项目发起人与主要维护者:阶段感知文案分组、打字机、炫彩渐变、配置与文案分离、config 自动加载,以及那份写满 AI 圈梗的词库;此外还交付了加权随机抽取(PR #15)、梗词库扩充(PR #16)、词库包模块化(PR #35)、十大主题包重构(PR #36),以及白天 / 黑夜配色(#40)、渐变流动方向(#42)、设置改存插件数据目录(#65)、标题页所有权与设置页可配(#68)、投稿分支冲突自愈与重复键哨兵(#78)、分号类标点过滤(#81)。

## 贡献者

### 代码与基建

**[liceses](https://github.com/liceses)** — 提交了 **PR #1** (`fix: scope label takeover to role=status + aria-live=polite`,状态标签精准定位修复,沿用至今)和 **PR #2** (`chore: 声明 dsh.bundle manifest`,支持 `dsh plugin add` 一键安装)。特别致谢!

**[mrbbbaixue](https://github.com/mrbbbaixue)** — 提交了 **PR #13**(`fix: 规范化默认文案缩写、品牌与模型名大小写`,如 `Deepseek` → `DeepSeek`)、**PR #14**(`feat: 按 DSH 官方设置页风格重排设置窗口控件与排版`——720px 内容列、hairline 分组、官方开关与胶囊按钮)、**PR #37**(`chore(pill): 删除 0.15.0 起注释保留的悬浮状态 Pill 代码`,从 `lib/client.js` 里清掉 160 余行死代码;随它一起停摆的监听者机制在 v0.17.3 一并退役)与 **PR #38**(`feat(settings): 设置页重排为四 tab、对齐官方规格,保存改为改动即写盘`——九个分组归为文案 / 外观 / 行为 / 自动化,补上预设新建改名删除、数值即时校验与恢复默认、调度规则卡片化,并修掉静默丢草稿等五个 bug)。感谢!UI 直接拉满,顺带把仓库也扫干净了。

**[A7m](https://github.com/A7m0spHere)** — 提交 **PR #104**(`feat(whale-tail): 鲸鱼尾巴逐帧摇动动画 + tok/s 调速` —— 24 帧矢量轮廓翻摆,可按实时 tok/s 或固定速率驱动)、**PR #109**(`feat(whale-tail): 多动作平滑切换与工具调用触发` —— 多套尾巴动作交叉淡入淡出、由工具调用触发,另附参考文档与 README 预览图)**PR #112**(`fix(whale-tail): 摇动时藏掉宿主全部图标子级` —— 摇动期间藏掉宿主图标的全部子级,修掉与官方图标重合的问题)**与 PR #133**(`feat(whale-tail): 官方原版晃动动作 + 参与切换的动作池` —— 第 4 个动作按官方 GIF 的 150 帧与原始时序以 SVG 轮廓播放、自带 0.25 次/秒推荐速度,随机与工具触发共用可勾选的动作池,tok/s 分档改为 1.0 / 1.5 / 2.0 / 2.5 预设并可自定义 1–10 上限,并修掉宿主在循环边界重建图标时丢掉衔接通知的问题);另外还写了一篇传播很广的推广帖。感谢这些尾巴工作与这次安利!


### 想法与反馈

- **[fplj-fplj](https://github.com/fplj-fplj)** — 建议状态文字支持字体粗细调节(**Issue #12**),已随 v0.10.0 实现为 `config.fontWeight`(状态文字 / 弹幕统一生效)。
- **[Ztyss](https://github.com/Ztyss)** — 反馈 **Issue #96**:0.27.0 新增的「行为 → 标签页标题」整组从不自动落盘 —— 自动落盘 effect 的签名实参与依赖数组都漏了 `titleDraft`,只改标题时永远不触发写盘(`commitDrafts` 的依赖同样漏了它,还可能写进旧值)。**v0.27.5** 据此把全部草稿状态收成单一来源 `editorState`,签名与各处依赖全从它走,并补了一条「单独拨标题开关 → 断言真的写盘」的浏览器回归。
- **[IThinkItsaName](https://github.com/IThinkItsaName)** — 反馈 **Issue #94**(此前还通过 issue #31 投过文案):插件的 4 个 `<style>` 都没打 `data-plugin`,于是宿主模块系统可能把它们认领给后物化的模块、并在那个模块下次 revision 变化时删掉 —— 设置页因此间歇性失去全部样式。**v0.27.4** 据此新增 `createOwnedStyle()`(建完即用包名声明归属),并把宿主那两步(认领 / 删除)搬进浏览器回归。
- **[Ztyss](https://github.com/Ztyss)** — 反馈 **Issue #6**:设置页没有关闭炫彩渐变的开关,且升级插件会清空 `config.json` 丢失全部设置。两个问题均在 **v0.6.1** 修复——设置页渐变开关与升级不丢配置的官方设置存储(`$DSH_HOME/settings.yaml`)都源于这份报告。
- **[xiaijiangxue](https://github.com/xiaijiangxue)** — 反馈 **Issue #39**:只有一套亮色渐变,白天(浅色)界面下发白看不清。**v0.22.0** 据此拆成两套配色 —— 浅色主题用 `dayColors`、深色主题用 `colors`,并加 `mode: auto / day / night`,默认跟随界面深浅色、也可强制其中一套。
- **[mulinyang041](https://github.com/mulinyang041)** — 反馈 **Issue #92**(文本由他机器上的 DSH agent 写就、本人授权发布):一次设置页保存会把**外部词库**的内容当成用户改动写进配置存储,于是把包从词库文件里删掉也不再回到设置页管理,而兼容镜像还会继续把它供出来。**v0.27.3** 据此修好(判定基准改为 `userChangeBaselineDocument()` = 内置 + 自动更新 + 外部词库;镜像只写用户自己的配置),端到端验证脚本 `scripts/verify-external-bank-ownership.cjs` 已进 CI。他对根因的定位准确,只差把镜像这一半补完。
- **[yihefeikong-rgb](https://github.com/yihefeikong-rgb)** — 反馈 **Issue #87**,并给出完整定位:`lib/client.js` 的 `turnLabels` 只 `set`、从不 `delete`,每个接管的回合都留下一个已脱离 DOM 的 React 标签元素(随回合数线性增长,插件卸载也不释放)。**v0.27.2** 按此修好(`releaseStatusLine()` 里对称地 `turnLabels.delete(button)` + 卸载时清空);报告里那套复现思路也做成了浏览器回归场景 `?case=leak`,现在在 CI 里守着。
- **[Shutiao114514](https://github.com/Shutiao114514)** — 反馈 **Issue #60**:弹幕层在全屏 `backdrop-filter` 遮罩后面继续位移,设置弹窗持续闪烁(dsh 0.1.5-rc.3 + Edge)。**v0.25** 据此新增 `danmaku.pauseBehindMask`:遮罩期间拆掉弹幕层与在途弹幕,遮罩消失立刻重建。
- **[xiaijiangxue](https://github.com/xiaijiangxue)** — 反馈 **Issue #51**:每次更新都会重置保存过的设置。这条反馈推动了整条持久化重做 —— **v0.26.1** 把权威副本搬到 `$DSH_HOME/status-rotator/config.json`(0.1.7-rc.1 的宿主 settings 服务没有 `register()`),并为老安装加了一次性收敛。
- **[xiaijiangxue](https://github.com/xiaijiangxue)** — 反馈 **Issue #41**:炫彩渐变一直从右往左扫,与从左往右的打字机方向相反,希望加个方向选项。**v0.23.0** 据此新增 `gradient.direction`(`rtl` 默认 / `ltr` 从左向右),设置页「炫彩渐变」区加了「流动方向」下拉,预览即时生效。

- **子夜**(小黑盒用户)—— 反馈了「**同时出现两条鲸鱼尾巴**」的 Bug(宿主图标没被藏住、与插件摇动的尾巴叠在一起,后由 A7m 在 PR #112 修掉);**她没有在 GitHub 上提 issue**,是直接告诉我们。感谢这双眼睛!
- **[yanzhaohui1999](https://github.com/yanzhaohui1999)** — 反馈 **Issue #129**:`appearance.fontSize: 0`(「跟随宿主」,也是 `config.example.json` 的出厂默认)被服务端半边的合并段夹成下限 **8**,而浏览器半边是**刻意放行** 0 的 —— 于是设置页选 0 当场生效、服务端落盘 8、下次加载静默回退成 8px。**v0.34.1** 按客户端同口径修好(`src.fontSize === 0 ? 0 : …`),并由 `scripts/verify-appearance-zero.cjs`(两半逐点比对 + 真 PUT→GET 往返)在 CI 里守着。
- **[Ztyss](https://github.com/Ztyss)** — 反馈 **Issue #131**:**同一个** `fontSize: 0` 夹取问题,并附上自己的逐行根因定位(`clampNumber(0, [8, 96]) === 8`、顶层既有的 `ZERO_DISABLES` 先例、以及客户端在 `client.js:1149` 的豁免)—— 独立得出了同样的修法。已对照源码确认,并在同一个 **v0.34.1** 里一起修好。
- **洛水之蔚**(小黑盒用户)—— 建议给鲸尾摇速**分档**:tok/s 模式下摇速连续升到 6 次/秒,尾巴糊成一片看不清(原话「直接起飞了…都看不清尾巴了」)。已实现为 `whaleTailMotion.tpsTiers` —— **2–5 个离散档位、铺在 2–4 次/秒之间**,只在跨过档位边界时变一次速,上限档也还看得清翻转;`0` 保持原来的连续映射,旧配置零改动,并由 `scripts/verify-whale-tail-tiers.cjs` 钉住档位取值、上限与这条不回归路径。**没有在 GitHub 上提 issue**,只是在小黑盒上说了一句 —— 感谢这双眼睛!

### 文案与社区

词库中的大部分文案来自 QQ 群 **641028237** 与 **1103406958** 的群成员——非常感谢!由于贡献散落在群聊里、名单过于杂乱,无法逐一可靠署名。如果你贡献过文案并希望留下名字,请联系维护者([01Virex](https://github.com/01Virex)),我们会把你补进名单。

- **deesnolem** — 贡献了文案。
- **[NotUNperson](https://github.com/NotUNperson)** — 贡献了文案。
- **[Fuhua-code](https://github.com/Fuhua-code)** — 贡献了文案。
- **[rruixi](https://github.com/rruixi)** — 贡献了文案。
- **[fplj-fplj](https://github.com/fplj-fplj)** — 贡献了文案。
- **[milk dragon](https://github.com/1251639747jm-ctrl)** — 贡献了文案。
- **[TanPowasd](https://github.com/TanPowasd)** — 贡献了文案。
- **[dancha0fan](https://github.com/dancha0fan)** — 贡献了文案。
- **[YunMeng-ink](https://github.com/YunMeng-ink)** — 贡献了文案。
- **[achenjins](https://github.com/achenjins)** — 贡献了文案。
- **[laszapens](https://github.com/laszapens)** — 贡献了文案。
- **[hu-1145](https://github.com/hu-1145)** — 贡献了文案。
- **[IThinkItsaName](https://github.com/IThinkItsaName)** — 贡献了文案。
- **[xiaozi233](https://github.com/xiaozi233)** — 贡献了文案。
- **[xialongxl](https://github.com/xialongxl)** — 投稿的文案以 PR #73 收录。
- **[Clmzz-gra](https://github.com/Clmzz-gra)** — 投稿的文案以 PR #75 与 #77 收录。
- **[SQMY-dor](https://github.com/SQMY-dor)** — 投稿的文案以 **PR #46**(issue #45)与 **PR #48**(issue #47)收录。

- **[3418244301q-star](https://github.com/3418244301q-star)** — 通过 **issue #102** 投稿文案(已合并为 #103:`正在让提示词变得硬邦邦…`)。


## 真实贡献统计(同步自 GitHub API)

> 以下数据来自 [`01Virex/dsh-status-rotator`](https://github.com/01Virex/dsh-status-rotator) 的公开贡献者接口,与下文「云贡献者」整活区无关。注意:此处只统计代码提交——上面「文案与社区」中仅贡献文案的人不会出现在这里。该接口统计的是**默认分支上的全部提交,含合并提交**(本地等价算法见表格下方)。

| 贡献者 | 提交数 | 说明 |
| --- | --- | --- |
| [Umamed26](https://github.com/Umamed26) | 167 | 项目作者(01Virex)的 git 署名,主要开发与维护 —— 近期:PR #125 #126 #127 #128 #130 #132 #135 |
| [01Virex](https://github.com/01Virex) | 22 | 仓库账号,合并 PR 并发布 |
| github-actions[bot] | 79 | 词库投稿机器人(校验、自动开 PR、分支刷新)、star 词库刷新工作流,以及 QC 工作流的若干次迭代 |
| [A7m0spHere](https://github.com/A7m0spHere) | 4 | 整条鲸尾动作线:PR #104(24 帧翻摆 + tok/s 调速)+ PR #109(多动作交叉切换 + 工具触发)+ PR #112(摇动时藏掉宿主图标子级)+ PR #133(官方原版晃动 + 可勾选动作池) |
| [mrbbbaixue](https://github.com/mrbbbaixue) | 4 | PR #13(默认词库缩写与品牌名大小写规范化)+ PR #14(设置窗口按官方 DSH 风格重排)+ PR #37(清掉已下线的 Pill 死代码)+ PR #38(设置页四 tab 重排、改动即写盘) |
| [liceses](https://github.com/liceses) | 2 | PR #1(状态标签定位)+ PR #2(dsh.bundle manifest) |

总计 **278 commits**(2026-10-04 同步)——四位真实人类贡献者(**Umamed26**、**A7m0spHere**、**liceses**、**mrbbbaixue**),加上仓库账号的合并/发布提交与词库机器人自己的入库提交。致敬每一位认真提交过代码的人 ❤️

> 重新同步只要一次 API 调用:`https://api.github.com/repos/01Virex/dsh-status-rotator/contributors?per_page=100`(返回 `login` + `contributions`)。
>
> 在本地 clone 里也能算出同样的数字:`git shortlog -sne HEAD`(**含合并提交**,与接口口径一致),再按 GitHub 账号合并身份 —— **Umamed26** `120251447+Umamed26@users.noreply.github.com` 87 + `mr26ishere@gmail.com` 80 = **167**;**github-actions[bot]** `41898282+github-actions[bot]@users.noreply.github.com` 74 + `github-actions[bot]` 5 = **79**;**A7m0spHere** `2154165681@qq.com` 3 + 1 = **4**;**01Virex**、**mrbbbaixue**、**liceses** 各只有一个身份(**22** / **4** / **2**)。`git shortlog` 合计是 279 而不是 278,因为它还统计了一个没有关联 GitHub 账号的占位身份提交(`dsh-fix <fix@local>`,`67d5034`)——接口不列这一条。

## 特别鸣谢

- **[DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness)** — 提供了这套可扩展的客户端插件体系,让这个玩具插件得以存在;
- **[iiwish](https://github.com/iiwish)** — 感谢 **DSH Testkit**(Issue #5)的生命周期兼容性检查:其发现塑造了本插件对宿主安全的设计——不硬依赖 webServer/settings,headless 宿主下照常激活、路由懒注册;
- 词库中每一条梗背后的新闻来源与创作者 —— 文案里记录的是 2026 年 AI 圈的集体记忆。

## 云贡献者(整活区·讽刺向)

以下名单纯属整活。原型人物与本公司无任何实际贡献关系;如有冒犯,说明你被讽刺到了:


> 以上讽刺纯属整活,与真人、真公司、真产品无关;如有雷同,说明互联网有记忆。


- **梁蚊蜂** — 贡献了从梁圣到梁÷的风评，以及让用户等了快一个月Deepseek V4.1 Pro;
- **崔添蚁** — 贡献了Deepseek V4 Pro正式版发布前的抗压和最不会因为破坏性更新导致插件炸完的Deepseek Harness;
- **杨植麟** — 贡献了对标ChatGPT的价格以及K3到K2.8的时光倒流术;
- **张鹏** — 贡献了抢不到的 GLM Coding Plan和臭鸡蛋;
- **唐羯** — 贡献了自动给用户git备份到云端的贼Code;
- **林俊羊** — 贡献了用户的奶茶;
- **李燕宏** — 贡献了文心一言模型;
- **马狮克** — 贡献了 Grok 的R18内容;
- **达狸奥** — 贡献了AI 安全第一的口号和一次钓鱼中国用户的惊天大阳谋;
- **奥特鳗** — 贡献了从非营利到营利再到被马斯克追着咬的变形记;
- **哈鲨比斯** — 贡献了又快又快的Gemini模型;
- **codex** — 贡献了Response api，让全网看到Deepseek更新文档就嗨了;
- **claude code** — 贡献了检测到中国ip就封禁的顶级技术;
- **dsh** — 贡献了整套插件体系，没有它这个项目根本不会存在;
- **opencode** — 贡献了最不朝令夕改的 Opencode Go套餐，Dax畜！;
## 如何贡献

- **投稿词库**:在 Issues 页选 **「词库投稿 💬」** 表单——机器人自动校验、回复预览与"立即试用"JSON,并自动生成可合并的 PR;**一行一条**(行内出现 `;` / `；` 会被拒绝,见[通过 Issue 投稿词库](./README_ZH.md#通过-issue-投稿词库));也可以直接编辑 `config.json` / `config.example.json` 的 `phrases`;
- **改行为**:欢迎提交 PR 到 [01Virex/dsh-status-rotator](https://github.com/01Virex/dsh-status-rotator);
- **报问题 / 提需求**:开 Issue 描述 dsh 版本、现象与控制台输出即可——被采纳的功能建议会记入上面的「想法与反馈」名单。

再次感谢每一位贡献者 ❤️
