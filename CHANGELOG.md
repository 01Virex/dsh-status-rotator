# 更新日志

本文件记录 dsh-status-rotator 的每个版本改了什么。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/);安装与配置见 [README_ZH.md](./README_ZH.md)。

最新发布见 [GitHub Releases](https://github.com/01Virex/dsh-status-rotator/releases);词库条数在每次发版时同步刷新。

## [0.17.2] - 2026-09-09

### 新增

- 补齐 `lib/index.d.ts` 类型声明与 `types` 字段(node 半区公开面;上下文用最小结构描述,
  不强制依赖 `@deepseek-ai/cordis` 的类型)。
- `exports` 增加 `types` 条件,并显式声明 `peerDependencies`(`@deepseek-ai/cordis`,
  标记为 optional —— 宿主已自带,单独装本插件时不会被强行拉下来)。
- `files` 改为逐文件列出(`lib/index.js` / `lib/client.js` / `lib/index.d.ts`),
  发布产物覆盖更明确。
- 新增 `Plugin QC` 工作流:每次 push / PR 用 [dsh-qc](https://github.com/Herdeny/dsh-qc)
  跑静态 + 动态质检,评分与证据链打到日志里(失败不阻断 CI)。

### 说明

- 起因是把插件放进 awesome 榜单时发现没有可引用的质检分;本地 `dsh-qc report` 由 52/100
  提升到 62/100(清单协议项由 5 通过/3 失败变为 8 通过/0 失败),动态验证交给 CI 在 Linux 上跑。

## [0.17.1] - 2026-09-09

### 变更

- `star-route` 词库包随星标名单刷新:75 → **77** 位(新增 `ippdesu`、`monkeycathyd`),
  词库总数 1059 → **1063**(中 556 / 英 507),README 表格与 npm 描述同步。
- 贡献者统计同步到 GitHub API 最新值(133 commits)。

### 说明

- 纯词库/文档补丁,插件代码零改动;升级后重启一次 `dsh web` 让 node 半区重新读配置即可。

## [0.17.0] - 2026-09-09

### 安全

- **配置写接口补上来源栅栏**:之前 `PUT/POST /plugins/dsh-status-rotator/config.json` 没有任何校验,
  任意网页都能用跨站简单请求(`content-type: text/plain`,不触发预检)改写你的本地配置。
  现在只接受 `application/json` + 同源请求(`Origin` 必须与 `Host` 一致、`sec-fetch-site` 只允许
  `same-origin`/`none`),跨站请求一律 403;读取接口也挡掉 `cross-site`。
- **颜色白名单**:渐变/弹幕颜色会被拼进注入的 `<style>`,现在只接受 `#rrggbb` / `rgb()` / `hsl()` /
  CSS 颜色名,含 `;` `{` `url(` 之类的值直接丢弃 —— 既挡 CSS 注入,也避免一个错色值让整条
  `background-image` 失效。
- **数值钳制**:服务端保存与客户端加载都按同一张表钳制(`intervalMs ≥ 250`、`typeSpeedMs ≤ 1000`、
  弹幕 `intervalMs ≥ 200`、`maxCount ≤ 60`、`zIndex` 收敛等)。此前 `intervalMs: 1` 会让页面
  每秒重建上千次定时器。

### 修复

- 修复路由 disposer 泄漏:正常路径(webServer 已就绪)返回的清理函数是空的,插件重载/二次
  apply 时宿主对重复路由抛 `duplicate exact route`,激活直接失败。
- 渐变配色非法时不再接管文字:以前会写出一条被浏览器丢弃的 `background-image`,而文字是
  `color: transparent` —— 状态行会整条消失;现在回退宿主自带的 shimmer 渐变,并在设置页标红。
- 打字机锁宽:逐字输出期间用整句像素宽度锁住宿主 `min-width`,紧跟其后的时钟不再左右跳。
- 长文案不再撑出横向滚动条:宿主 `.turnStatus` 是 `26px + white-space: nowrap`,超长文案会把
  滚动容器顶出横向滚动条;现在文本盒收窄,真溢出时右侧做淡出,时钟保持可见。
- 渐变生效时关掉宿主自带的 1.8s shimmer,不再两层流光互相打架。

### 变更

- 设置页顺序调整:**实时预览**置顶,**文案词库**从最后一位提到第二位;新增预览卡片(按当前
  草稿实时渲染状态行与弹幕条)——官方设置弹窗是全屏遮罩,以前只能"改→保存→关弹窗→看"。
- 颜色序列输入支持 `rgb(255, 0, 0)` 这类带括号的写法(此前按逗号切分会被拆碎),非法 token
  在输入框标红、保存时拦下并列出。

### 文档

- README 首屏重写:去掉版本变更横幅与求 star 钩子,改为「一句话定位 → 30 秒上手 →
  功能一览」,版本史移入本文件。
- 新增本文件 `CHANGELOG.md`,版本变更不再堆在 README 顶部。
- 修正 Release 安装说明:产物是 `dsh-status-rotator-<tag>.zip`(解压即用目录),不是 npm tarball。
- `star-route` 词库包文案空格归一:此前按名字长度分三档(短名不加空格),同一份词库里
  「正在路由01Virex写代码…」与「正在路由 1251639747jm-ctrl 写代码…」混排,现在统一为
  「正在路由 <login> 写代码…」;长度上限对该包单独放宽(名字是数据,不套人工文案规范)。

### 工程

- 新增 `scripts/label-layout-test.html`(真浏览器布局回归:锁宽/截断/配色回退/设置页渲染),
  `scripts/run-danmaku-mount-test.cjs` 支持 `--page=label`,并改用 `--remote-debugging-port=0`
  (固定端口段在部分 Windows 上落在 Hyper-V 保留区,`bind()` 会失败)。
- 冒烟测试 151 → 170 条断言:新增配置栅栏、数值钳制、颜色白名单、路由卸载回归。

## [0.16.2] - 2026-09-08

### 文档

- 版本横幅与词库统计同步(纯文档补丁,代码零改动)。

## [0.16.1] - 2026-09-08

### 修复

- **弹幕恢复可见**:弹幕层改为挂进「画界面底色的元素」,此前被会话面板自己的不透明底色整块盖住。
- **设置层恢复生效**:新版 `@deepseek-ai/dsh-settings` 不再导出 `settingsNamespace()`,旧调用抛错
  又被外层 `catch` 吞掉,导致保存的设置一直静默失效(不生效、也不落盘)。

## [0.16.0] - 2026-09-08

### 变更

- `star` 词库包拆成两个:纯求 star 的 `star-ask` 与星标者点名的 `star-route`,且**默认关闭**。
- 设置页底部新增仓库链接;新增 `Star packs` 工作流,每周用仓库 `GITHUB_TOKEN` 刷新星标名单。

## [0.15.2] - 2026-09-08

### 修复

- 修复弹幕可能永久不可见:客户端半区早于外壳渲染时退回 `body` 且沿用 `z-index: -1` 且不再重试;
  现在挂载点每拍重解析,并新增真浏览器回归页。

## [0.15.1] - 2026-09-08

### 新增

- 新增 star 词库包(求 star 文案 + 69 位星标者路由文案),词库 886 → 1047 条,10 → 11 包。

## [0.15.0] - 2026-09-07

### 变更

- 悬浮状态 Pill 下线(代码注释保留,可恢复);词库质检脚本修复空核心词库崩溃。

## [0.14.2] - 2026-09-07

### 修复

- 修复中文界面状态标签延迟替换:适配 DSH 本地化文案(`深度求索中...`),状态文字现在立即替换。

## [0.14.1] - 2026-09-06

### 修复

- 设置页词库包 UX:未配置 `enabledPacks` 时显示为全部启用;全开保存不写字段(避免误写 `[]`
  清空词库);默认词库为空时自动选中第一个包;提示改大白话。

## [0.14.0] - 2026-09-06

### 新增

- 词库包模块化:十大主题包(DeepSeek / 西方 AI / 中国 AI / 写代码 / 反代 / 系统管理 / 数理 /
  摸鱼 / 网络梗 / 日常),投稿机器人支持指定目标包。

## [0.13.0] - 2026-09-06

### 新增

- 梗词库扩充(批次 1–5)与社区投稿入库(PR #16/#18/#20/#23/#25/#26/#28)。

## [0.12.0] - 2026-09-06

### 新增

- 加权随机文案选择:文案可写成 `{ "text": "…", "weight": 3 }`,按权重比例抽取。

## [0.11.0] - 2026-09-04

### 变更

- 设置页按 DSH 官方设置页风格重排控件与排版。

## [0.10.0] - 2026-08-30

### 新增

- 词库投稿机器人:Issue 表单一键投稿,自动校验/查重/归一化并开合并 PR;合并后自动删分支、关 Issue。
- 字体粗细可调 `fontWeight`:状态文字与弹幕统一生效,设置页新增下拉。

## [0.9.1] - 2026-08-27

### 变更

- npm 搜索可见性:扩充 keywords / description(danmaku / bilibili / typewriter / rainbow 等)。

## [0.9.0] - 2026-08-27

### 新增

- 弹幕模式:所有文案随机以视频网站弹幕形式在界面后面飘过(炫彩、随机大小、透明度、频率可配)。

## [0.8.0] - 2026-08-27

### 变更

- 开发脚本(`scripts/`、`gen-config.cjs`)移出 npm 发布集,降低静态扫描面。

## [0.7.1] - 2026-08-24

### 修复

- 修复 0.7.0 的省略号规范化脚本误伤 `config` 字段(渐变颜色/标题模板被追加省略号导致渐变失效)。

## [0.7.0] - 2026-08-24

### 变更

- 默认词库省略号全量统一(所有文案以 `…` 结尾);npm dist-tag 标记 `stable`。

## [0.6.6] - 2026-08-21

### 文档

- npm README 与 GitHub 对齐;省略号与 Pill 模板文案统一。

## [0.6.5] - 2026-08-21

### 修复

- 状态 Pill 的阶段/时长改为会话快照优先,模型名走官方 `modelDirectories`;默认模板四字段。

## [0.6.4] - 2026-08-21

### 修复

- 修复 webServer / settings 就绪时序:插件在 `inject = []` 下提前激活导致路由未注册、配置 404。

## [0.6.3] - 2026-08-21

### 修复

- React 重渲染时立即重新接管状态行,修复文案与时钟闪烁。

## [0.6.2] - 2026-08-21

### 修复

- webServer 改为可选加载,没有 Web UI 的宿主也能激活插件。

## [0.6.1] - 2026-08-21

### 修复

- 设置持久化到 dsh 官方设置存储(`$DSH_HOME/settings.yaml`),升级不再丢配置;设置页新增渐变编辑器。

## [0.6.0] - 2026-08-21

### 新增

- 实时状态引擎 + 悬浮状态 Pill(后者已在 0.15.0 下线)。

## [0.5.1] - 2026-08-21

### 工程

- README 徽章与安装命令前置;新增 CI 测试工作流。

## [0.5.0] - 2026-08-21

### 新增

- 模板占位符(`{elapsed}` / `{phase}` / `{date}` …)、浏览器标签页标题轮换、预设与时段调度。

## [0.4.0] - 2026-08-19

### 变更

- 词库按阶段重新分布(running / long);扩充 thinking 中英词库并补全翻译。

## [0.3.0] - 2026-08-18

### 文档

- 文档中英双语化,安装步骤前置,npm 发布配置。

## [0.2.0] - 2026-08-14

### 工程

- 发布基础设施:CI 打包 + 版本号;声明 `dsh.bundle` manifest,支持 `dsh plugin add` 安装。

## [0.1.0] - 2026-08-14

### 新增

- 首个版本:把 DSH Web 回合状态文字替换成自定义文案库(阶段感知、打字机、定时轮换、
  按 `role="status"` + `aria-live="polite"` 零侵入定位),文案与代码分离。

[未发布]: https://github.com/01Virex/dsh-status-rotator/compare/v0.17.2...HEAD
[0.17.2]: https://github.com/01Virex/dsh-status-rotator/compare/v0.17.1...v0.17.2
[0.17.1]: https://github.com/01Virex/dsh-status-rotator/compare/v0.17.0...v0.17.1
[0.17.0]: https://github.com/01Virex/dsh-status-rotator/compare/v0.16.2...v0.17.0
[0.16.2]: https://github.com/01Virex/dsh-status-rotator/compare/v0.16.1...v0.16.2
[0.16.1]: https://github.com/01Virex/dsh-status-rotator/compare/v0.16.0...v0.16.1
[0.16.0]: https://github.com/01Virex/dsh-status-rotator/compare/v0.15.2...v0.16.0
[0.15.2]: https://github.com/01Virex/dsh-status-rotator/compare/v0.15.1...v0.15.2
[0.15.1]: https://github.com/01Virex/dsh-status-rotator/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/01Virex/dsh-status-rotator/compare/v0.14.2...v0.15.0
[0.14.2]: https://github.com/01Virex/dsh-status-rotator/compare/v0.14.1...v0.14.2
[0.14.1]: https://github.com/01Virex/dsh-status-rotator/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/01Virex/dsh-status-rotator/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/01Virex/dsh-status-rotator/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/01Virex/dsh-status-rotator/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/01Virex/dsh-status-rotator/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/01Virex/dsh-status-rotator/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/01Virex/dsh-status-rotator/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/01Virex/dsh-status-rotator/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/01Virex/dsh-status-rotator/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/01Virex/dsh-status-rotator/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/01Virex/dsh-status-rotator/compare/v0.6.6...v0.7.0
[0.6.6]: https://github.com/01Virex/dsh-status-rotator/compare/v0.6.5...v0.6.6
[0.6.5]: https://github.com/01Virex/dsh-status-rotator/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/01Virex/dsh-status-rotator/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/01Virex/dsh-status-rotator/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/01Virex/dsh-status-rotator/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/01Virex/dsh-status-rotator/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/01Virex/dsh-status-rotator/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/01Virex/dsh-status-rotator/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/01Virex/dsh-status-rotator/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/01Virex/dsh-status-rotator/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/01Virex/dsh-status-rotator/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/01Virex/dsh-status-rotator/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/01Virex/dsh-status-rotator/releases/tag/v0.1.0
