# dsh-status-rotator

> 把 DSH Web 底部那行 `Deep diving...` / `深度求索中...` 换成你自己的文案库:**1105 条梗、13 个主题词库包、打字机 + 白天/黑夜炫彩渐变 + 弹幕**。

[English](./README.md) | **中文** · [30 秒上手](#30-秒上手) · [特性总览](#特性总览) · [配置](#配置) · [更新日志](./CHANGELOG.md)

[![npm version](https://img.shields.io/npm/v/dsh-status-rotator?color=4a6cf7)](https://www.npmjs.com/package/dsh-status-rotator)
[![npm downloads](https://img.shields.io/npm/dt/dsh-status-rotator?color=4a6cf7)](https://www.npmjs.com/package/dsh-status-rotator)
[![GitHub stars](https://img.shields.io/github/stars/01Virex/dsh-status-rotator?color=4a6cf7)](https://github.com/01Virex/dsh-status-rotator)
[![license](https://img.shields.io/github/license/01Virex/dsh-status-rotator)](LICENSE)
[![status](https://img.shields.io/badge/status-%E7%A8%B3%E5%AE%9A%E7%89%88-2ecc71)](https://www.npmjs.com/package/dsh-status-rotator)

## 30 秒上手

```bash
dsh plugin --profile web add dsh-status-rotator   # 1. 安装(包内自带 bundle manifest,自动识别)
dsh web                                            # 2. 重启一次,仅首次需要
```

3. 打开左下角 **设置 → 状态文案**:挑词库包、改文案、调渐变与弹幕 —— 改动即保存、即时生效,不用刷新页面。

一个 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 客户端插件:把 Web 界面底部回合运行时那行硬编码的 `Deep diving...` / `深度求索中...` 状态文字,替换成你自己的文案库 —— 按回合阶段切换、打字机逐字输出、定时轮换、加权随机抽取、带实时取值的模板占位符、白天 / 黑夜两套配色自动跟随界面深浅色的流动炫彩渐变、视频网站风格的弹幕,以及一个同时喂给文案和浏览器标签页标题的实时状态引擎。界面自带的运行时长时钟不受影响。

> **dsh 0.1.7 起的状态行**:宿主把运行时文案塞进了回合折叠头 `button[data-turn-process]`(`Deep diving for 12s` / `深度求索中，用时12秒`,长回合里早被滚出视口)。插件把状态行**搬回旧版位置** —— 对话下方、输入框正上方那一行,水平方向与消息列同一左边界(复刻 dsh ≤0.1.6 的 `.turnStatus`:26px 高 / 自带 shimmer / 时钟 13px + 8px 间距),跟着输入框常驻可见;回合折叠头里那行藏起来避免重复,回合结束再把状态行撤掉、放出宿主自己的 `Took 12s` / `Worked`。时长与阶段照旧从折叠头标签文本读(React 每秒整段重写它,插件不往里塞东西),读屏公告 span 不改写。0.1.6 及更早的 `role="status"` 状态行本就在旧位置,行为不变。
>
> **没有文案可轮换时不会留空行**:`config.labelSource`(默认 `"phrases"`)管状态行写什么。短语库为空(比如装了插件但没 `config.json`)时,插件自己那条线会**回落宿主原文**「Deep diving…」/「深度求索中」,而不是一条空状态行;写成 `"host"` 则完全不轮换,只用宿主原文,外观逐项对齐 0.1.6 的 `.turnStatus`(字重 500、inline-flex、26px、shimmer、时钟 15 秒后出现)—— 在 0.1.7 上得到 0.1.6 的观感。详见[状态行文案来源](#状态行文案来源label-source)。

## 特性总览

**核心**

- **状态文字替换** — 宿主那行(`Deep diving...` / 0.1.7 的 `Deep diving for 12s`)换成你的文案,每 `intervalMs` 轮换、逐字打字(`typeSpeedMs`,0 关闭);
- **阶段感知** — `thinking` / `running` / `long` 三组按回合时长切换,不用等轮换间隔;
- **加权随机** — 文案条目可带权重(`weightedRandom: false` = 完全均匀);
- **零侵入定位** — 老宿主按 `role="status"` + `aria-live="polite"`、0.1.7+ 按 `button[data-turn-process]` 定位,不碰聊天记录里的代码片段、其它 aria-live 区域与宿主时钟。

**内容**

- **文案与代码分离 + 词库包模块化** — 文案全在 JSON 里,拆成具名词库包(`packs[]` / `enabledPacks[]`),设置页逐个开关、独立编辑;
- **模板占位符** — `{elapsed}` `{phase}` `{phaseLabel}` `{locale}` `{date}` `{time}`,实时字段 `{model}` `{provider}` `{tps}` `{pending}` `{tools}` `{running}`,见[模板占位符](#模板占位符);
- **观测通道** — 把宿主的 `llm/retry` 结构化信号显示成小徽标(默认 `⟳ 3/5`),并提供 `{retry}` `{retryMax}` `{retryProvider}` `{retryCode}` `{detail}`;拿不到事件窗口就什么都不显示;
- **多语言** — 跟随「设置 → 语言」实时切换,未知语言回退中文;
- **社区词库机器人** — Issue 表单 + 自动校验 + 自动开 PR,分支自动跟随 main 重建(见[通过 Issue 投稿词库](#通过-issue-投稿词库))。

**视觉与实时**

- **炫彩渐变** — 白天 / 黑夜两套配色跟随界面主题(也可 `mode` 强制),颜色与流速可配,一键关闭;
- **弹幕** — 文案以弹幕飘过页面(含 bilibili 风格顶部 / 底部),字号、颜色、透明度、层级可调;
- **标签页标题** — 用模板轮换 `document.title`(默认关闭;只写自己接管过的标题);
- **预设与调度** — 多套命名词库,手动切换或按星期 / 时段自动切换。

**工作流**

- **自动加载 + 热更新** — node half 注册 HTTP 路由 serve 配置,页面打开时定时重读,改完不用重启;
- **持久化** — 保存的设置写进 `$DSH_HOME/status-rotator/config.json`,不属于任何包,升级不丢;
- **设置页** — DSH「设置 → 状态文案」可视化编辑,保存即生效。

## 安装

两种方式:推荐用 `dsh plugin add` 命令,或手动复制。无论哪种方式,首次安装后都需要重启一次 `dsh web`。

### 方式 A:`dsh plugin add`(推荐)

本插件在 `package.json` 里声明了 `dsh.bundle.patch` manifest,安装后自动识别,无需额外标志。命令语法是 `dsh plugin --profile <name> add <package>`(例如 `--profile web`):

- **npm 安装**(最简单):`dsh plugin --profile web add dsh-status-rotator` ← 永远装最新版
- **克隆仓库**:`dsh plugin --profile web add ./dsh-status-rotator`
- **Release 打包产物**:从 Release 页下载 `dsh-status-rotator-<版本>.zip`(里面是解压即用的插件目录,含 `config.json`,**不是 npm tarball**),解压后执行 `dsh plugin --profile web add /path/to/dsh-status-rotator`。

### 方式 B:手动安装

1. 把本项目目录放到 profile 的 node_modules 下(默认 `C:\Users\<你>\.dsh\profiles\node_modules\dsh-status-rotator\`);
2. 在 profile 的 `cordis.patch.yml` 里插入:

   ```yaml
   - insert:
       - id: status-rotator
         name: dsh-status-rotator
   ```

3. 运行 `node gen-config.cjs` 初始化本地 `config.json`(从 `config.example.json` 复制);
4. 重启 `dsh web`,浏览器 Ctrl+F5 硬刷新。

### 首次使用

首次启动时伺服顺序是:你**保存的设置**(`$DSH_HOME/status-rotator/config.json`)→ 包目录 `config.json` → `config.example.json`(npm 安装时就是这一份,默认的全部 1105 条文案都在里面,见[词库现状](#词库现状))。另有**自动更新词库**(每 6 小时,见[词库自动更新](#词库自动更新))与**可选的外部词库**(`$DSH_HOME/status-rotator/phrases.json`,优先级最高,见[可热重载的外部词库](#可热重载的外部词库))。改文案可直接改文件(页面开着时热更新),也可走 DSH 左下角「设置 → 状态文案」。

## 工作原理

### 阶段感知

文案按回合进展分三组(判定依据是状态元素里是否出现时钟及其读数):

| 阶段 | 触发条件 | 默认时长 |
|---|---|---|
| `thinking` | 回合刚启动,无时钟 | 0 ~ 15s |
| `running` | 时钟出现,未超时 | 15s ~ `longAfterMs` |
| `long` | 时钟超过 `longAfterMs` | ≥ 60s |

阶段切换会立即触发换文案,无需等轮换间隔。某阶段缺文案组时自动回退(running → thinking → 任意非空组)。

### 零侵入定位

状态标签按 `role="status"` + `aria-live="polite"`(dsh ≤0.1.6)或 `button[data-turn-process]`(0.1.7+)精确定位,不碰聊天记录里的代码片段或其它 aria-live 区域。0.1.7+ 上插件只做三件事:在输入框座位里插自己的一行、把折叠头那行藏起来、读折叠头的标签文本取时长;宿主时钟只被*读取*,阶段与时长由实时引擎按回合开始时刻推导。

### 状态行文案来源(label source)

`config.labelSource` 决定状态行里写什么,两代宿主都认:

| 取值 | 状态行文案 | 什么时候用 |
| --- | --- | --- |
| `"phrases"`(默认) | 从短语库里抽一句,按阶段轮换 | 插件本来的样子 |
| `"host"` | 只用宿主原文 `Deep diving...` / `深度求索中` | 想要**纯 0.1.6 观感**、不要梗文案 |

- **没文案也不会空行**:短语库为空时(没 `config.json` / 预设清空了文案),`"phrases"` 模式回落宿主原文,0.1.7 上不会只剩一条空行配时钟;
- **`"host"` 连外观一起对齐 0.1.6**:插件那条线逐项照抄 `.turnStatus`(字重 500、`height: calc(26px + …)`、`inline-flex`、同一套 shimmer 与 `prefers-reduced-motion` 降级)与 `.turnStatusClock`(13px、tabular-nums、8px 间距、400 字重),时钟也按旧时机(`elapsedMs >= 15s`)出现,文案一次性写出而不打字;旧宿主(≤0.1.6)在 `"host"` 下插件完全不碰;
- 设置页有同名下拉框(「状态行文案来源」),`{"labelSource": "host"}` 也可直接写进 `config.json` 或预设。

## 词库现状

默认词库当前共 **1105 条**,拆为 **13 个主题词库包**(核心 `phrases` 表为空——词条全部住在包里)。其中 10 个默认启用,两个 **star 包随包发布但默认关闭**——想用就在「设置 → 状态文案 → 词库包」里打开:

| 词库包 | zh | en | 小计 | 默认 |
| --- | --- | --- | --- | --- |
| `deepseek` DeepSeek 专场 | 107 | 111 | 218 | 开 |
| `coding` 写代码日常 | 84 | 81 | 165 | 开 |
| `daily` 日常 | 77 | 64 | 141 | 开 |
| `internet-memes` 网络梗 | 56 | 33 | 89 | 开 |
| `sysadmin` 系统管理 | 41 | 38 | 79 | 开 |
| `slacking` 摸鱼 | 36 | 29 | 65 | 开 |
| `math-physics` 数学与物理 | 31 | 18 | 49 | 开 |
| `western-ai` 西方 AI 圈 | 16 | 18 | 34 | 开 |
| `reverse-proxy` 反代 | 14 | 16 | 30 | 开 |
| `china-ai` 中国 AI 圈 | 18 | 10 | 28 | 开 |
| `star-ask` 求 star | 11 | 12 | 23 | **关** |
| `star-route` 星标者路由 | 89 | 89 | 178 | **关** |
| **合计** | **586** | **519** | **1105** | 开 898 / 关 207 |

- 大部分条目 zh/en 成对镜像;近期社区投稿常为中文单语——投稿表单选「**zh + en (两种都要)**」即可双语收录;
- 含 5 条加权示范条目(见[加权随机](#加权随机)),其余均为默认权重 1 的纯文案;
- 词库通过社区[投稿表单](#通过-issue-投稿词库)持续增长:校验通过并合入的投稿会在 [CONTRIBUTORS.md](./CONTRIBUTORS.md) 名单里致谢;
- 统计由 `node scripts/sync-bank-counts.cjs` 从 `config.example.json` 现算并写回(投稿机器人与 star 词库刷新会自动调用;手改词库后跑一次即可);本地用 `node scripts/check-bank-memes.mjs` 可随时审计当前词库(查重/超长/省略号/系列占比)。

**star 词库包(默认关闭)** — 拆成两个独立的包,想只要求 star 文案、不要星标者点名,就只开前者:

| 词库包 | 内容 |
| --- | --- |
| `star-ask` 求 star | 纯求 star 文案,如「正在向你讨一个 star…」/ `Begging for a star…` |
| `star-route` 星标者路由 | **每位当前星标者一条**——`正在路由 <login> 写代码…` / `Routing <login> to write code…`,让状态轮换真的"路由每个点星的人去干活" |

默认关闭是口味问题不是坏了:在「设置 → 状态文案 → 词库包」打开即可。星标名单由 [`Star packs` 工作流](.github/workflows/star-pack.yml)刷新(每周、文件有改动时、手动),用仓库自带 `GITHUB_TOKEN` 读 stargazers,刷新走机器人 PR 且 `Test` 绿了自动合并;fork 里该 job 整条跳过(那里的令牌看不到上游星标),可用 `STAR_TOKEN` 覆盖。本地刷新:`node scripts/update-star-pack.cjs --token <pat>`。

## 词库包

词库可在核心 `phrases` 之上按具名「词库包」组合:

```jsonc
{
    "packs": [
        { "id": "community",
          "label": { "zh": "社区投稿", "en": "Community" },
          "phrases": { "zh": { "running": ["正在试用词库包…"] } } }
    ],
    "enabledPacks": ["community"]   // 缺省 = 全部包启用;[] = 只用核心库
}
```

- 启用的包按顺序并入生效词库,**按文本去重**——核心库(或更早的包)已存在的条目会被跳过,保留其权重;
- `enabledPacks` 缺省/`null` = 全部启用;`[]` = 只用核心库;名单里的未知 id 直接忽略;
- 包内条目与核心库完全同构(字符串或 `{text, weight}`、三阶段分组、占位符);
- 设置页列出每个包:**逐个启用开关** + **包编辑目标**(选中某包后,词库编辑区读写该包文案);
- 默认自带 **12 个包**(`deepseek` / `western-ai` / `china-ai` / `coding` / `reverse-proxy` / `sysadmin` / `math-physics` / `slacking` / `internet-memes` / `daily` / `star-ask` / `star-route`);`community`(社区投稿)在首次有投稿时创建,`enabledPacks` 钉住默认启用的包。
- 投稿表单的**「目标词库包」**选择器含同样 10 个包 + `community`(默认落点)+ `star-ask`(只求 star 文案;星标者路由包由脚本自动生成,不接受投稿):投稿进入所选包,`community` 包在首次使用时自动创建——核心词库本体不被改动,想关掉或裁剪社区内容一处搞定;
- 旧配置没有 packs 字段,零改动兼容。

## 加权随机

默认按权重抽取。文案条目写成 `"文案 | 3"`(或 `{ "text": "文案", "weight": 3 }`)即为权重 3,未写 = 1;权重上限 1000,非法值按 1 处理。`weightedRandom: false` 回到完全均匀。词库里有 5 条展示用的加权条目。

## 模板占位符

任意文案(以及标题模板)都支持占位符,渲染时替换:

| 占位符 | 含义 | 示例 |
|---|---|---|
| `{elapsed}` | 当前回合已运行时长(本地化,风格同时钟) | `正在写代码 1分02秒…` |
| `{phase}` | 阶段 id:`thinking` / `running` / `long` / `idle` | `running` |
| `{phaseLabel}` | 阶段的本地化短标签 | `运行中` |
| `{model}` | 当前会话的模型名(实时引擎,未知为 `—`) | `deepseek-chat` |
| `{provider}` | 当前会话的供应商路由(实时引擎) | `deepseek` |
| `{tps}` | 流式 token/秒 估算(实时引擎) | `12` |
| `{pending}` | 正在等待作答的交互数 —— 审批与提问共用这一个计数(实时引擎) | `1` |
| `{tools}` | 正在运行的工具名,`+` 连接(实时引擎) | `bash+web_search` |
| `{running}` | `run` / `idle`(实时引擎) | `run` |
| `{retry}` | 当前步的重试次数(实时引擎,无重试为空) | `3` |
| `{retryMax}` | 该重试策略的上限(旧宿主 / always 模式可能为空) | `5` |
| `{retryProvider}` | 触发重试的 provider(provider 中立,原样透传) | `deepseek-official` |
| `{retryCode}` | 失败短码(≤32 字符的安全 token;URL / 路径 / 报文一律不显示) | `sampling_error` |
| `{retryStarted}` | 重试的那次尝试是否已开始跑(`llm/retry-started` 之后为 `1`,否则为空) | `1` |
| `{detail}` | 整条观测徽标(按 `config.details.badge` 模板渲染) | `⟳ 3/5` |
| `{locale}` | 当前界面语言(`zh` / `en`) | `zh` |
| `{date}` | 本地日期 `YYYY-MM-DD` | `2026-08-07` |
| `{time}` | 本地时间 `HH:MM:SS` | `12:34:56` |

- 随时间变化的占位符(`{elapsed}` `{date}` `{time}` `{tps}` `{pending}` `{tools}` `{model}` `{provider}` `{retry}` `{detail}`)按 `liveTickMs`(默认 1000ms)实时刷新,设为 `0` 则只随轮换更新;

- **观测通道**(参考 [discussion #3669](https://github.com/deepseek-ai/deepseek-harness/discussions/3669)):把宿主写进会话事件日志的结构化信号显示成状态行上的小徽标(`llm/retry` 等,默认 `⟳ 3/5`)并提供同名占位符;拿不到事件窗口就什么都不显示,绝不从日志文本里猜次数。

```json
"details": { "enabled": true, "badge": "⟳ {retry}/{max}" }
```

```json
"phrases": { "zh": { "thinking": ["正在写代码 {elapsed}…", "正在{phaseLabel}中 ({elapsed})…"] } }
```

#### `{pending}` 与所在会话的审批策略

`{pending}` 数的是**待作答交互**——和界面里那些「接管输入框」的面板同一份数据;审批与提问**共用这一个计数**,只要有一样在等你回答,它就是 `1`。dsh 对每个会话**最多只发布一条**(按优先级取最高的一条),所以它实际是个 `0` / `1` 状态位,不是队列长度。它由事件驱动而非定时器驱动:交互一出现或一消失,标签立刻重渲染,不必等下一次轮换。

审批能贡献多少,完全取决于该会话自己的权限预设(沙箱模式 + 审批策略,用 `/permission` 切换)——插件既不读也不改这个设置:

- **`ask`** —— 敏感动作先问一句:审批面板等待期间计数为 `1`,你点完(允许或拒绝)立刻回到 `0`;
- **`never`** —— 审批提示被关闭:dsh 直接把这类请求判为拒绝,客户端根本不会建面板,所以审批**不贡献任何计数**。要注意这个计数**不表达**什么:被拒绝不算「待作答」,所以 `{pending}` 永远不会告诉你「刚才有动作被拒了」;
- **提问**是另一套域,与审批策略无关:即便在 `never` 下,dsh 等你回答(比如计划评审)时 `{pending}` 依然可以是 `1`。

所以 `{pending}` 只回答一个问题 —— **现在是不是在等我?** —— 而 `never` 下能让它非零的只剩提问。旧版 dsh 没有待作答交互表时,它保持 `0`。

## 炫彩渐变

状态文字默认以流动的七彩渐变显示(仅作用于文案,不影响时钟)。v0.22.0 起渐变带**两套配色** —— 黑夜(深色主题)与白天(浅色主题),默认跟随 DSH 界面的深浅色自动切换(`mode: "auto"`);`mode: "day"` / `"night"` 可强制其中一套。切主题即时换色,不用刷新。流光方向也可选:`direction` 为 `"rtl"`(默认,从右向左)或 `"ltr"`(从左向右,与打字机同向,issue #41)。可在配置里关闭或自定义配色:

```json
"gradient": {
    "enabled": false,                          // false 关闭;true 用默认配色
    "mode": "auto",                            // auto 跟随界面深浅色自动切换;day / night 强制其中一套
    "direction": "rtl",                        // rtl 从右向左(默认);ltr 从左向右(与打字机同向)
    "colors": ["#ff5f6d", "#00ff88", "#4da6ff"], // 黑夜(深色主题)颜色序列(至少 2 个,循环首尾)
    "dayColors": ["#d92b4b", "#0e7490", "#6d28d9"], // 白天(浅色主题)颜色序列(至少 2 个,循环首尾)
    "speed": 4                                 // 流动速度(秒/圈)
}
```

只写过 `colors` 的老配置会继续在两种主题下使用它(升级后观感不变);想要单独的浅色配色,加上 `dayColors` 即可。

## 弹幕模式

可选:所有文案随机生成视频网站弹幕,从右到左飘过页面(**默认在界面后面**——弹幕层夹在应用背景与聊天内容之间,可见于空隙,不遮挡聊天):

```json
"danmaku": {
    "enabled": true,
    "intervalMs": 2500,        // 发射间隔(毫秒);越小越接近刷屏
    "speedMs": 18000,          // 从右到左穿过屏幕的时长(毫秒);越大飘得越慢
    "fontSizeMin": 14,         // 随机字号下限(px)
    "fontSizeMax": 30,         // 随机字号上限(px)
    "rainbow": true,           // 炫彩:每颗弹幕从 colors 里随机取色
    "colors": ["#ff5f6d", "#00ff88", "#4da6ff"], // 炫彩色板(至少 1 个)
    "color": "#ffffff",        // rainbow=false 时的单色
    "opacity": 0.3,            // 不透明度(0.05 ~ 1);每颗在此基础上取 75%~100% 抖动,更有层次
    "maxCount": 12,            // 同屏弹幕数量上限
    "zIndex": -1,              // 负数 = 界面后面(默认);非负数 = 浮于界面之上
    "scope": "all",            // all = 当前语言全部文案;phase = 只取当前阶段(带回退)
    "marginTop": 16,           // 弹幕活动区顶部留白(px)
    "marginBottom": 160,       // 底部留白(px),避开输入区
    // ── v0.19 新增:顶部 / 底部弹幕(bilibili 风格)──
    "types": {                  // 类型开关 + 相对权重;scroll = 原有滚动弹幕
        "scroll": { "enabled": true, "weight": 2 },
        "top":    { "enabled": true, "weight": 1 },
        "bottom": { "enabled": true, "weight": 1 }
    },
    "mode": "scroll",           // 可选:强制所有弹幕都发成这一种(scroll/top/bottom,或 bilibili 的 1/4/5);不写 = 按权重分发
    "fixed": {                  // 顶部 / 底部样式 —— 所有数值集中在这一处,改一句就全改
        "fontSize": 25,          // 字号(px)
        "color": "#ffffff",      // 单色:关闭炫彩时生效(默认白字)
        "shadow": "1px 0 1px rgba(0,0,0,.85),-1px 0 1px rgba(0,0,0,.85),0 1px 1px rgba(0,0,0,.85),0 -1px 1px rgba(0,0,0,.85)",
        "marginTop": 16,         // 顶部弹幕距播放区域上边(px)
        "marginBottom": 160,     // 底部弹幕距播放区域下边(px)
        "gap": 4,                // 多条堆叠间距(px)
        "durationMs": 4500,      // 单条停留时长(ms)
        "maxCount": 3,           // 同类弹幕同屏上限
        "zIndex": 10,            // 前层层级:10 压住聊天内容、又低于外壳 overlay 层(20)
        "reserveBands": true,     // 滚动弹幕避开顶部/底部弹幕占用的竖直带(不叠字)
        "anchorBottomToHost": true, // 底部弹幕贴住输入区上沿(状态行上方),而不是只靠 marginBottom
        "overflow": "drop"       // 超限处理:丢弃这一拍(与滚动弹幕一致)
    }
}
```

- `zIndex` 为负(默认)时,弹幕层挂进**画应用底色的那个元素**内部(通常就是会话面板),夹在**底色与聊天内容**之间:弹幕在空隙和聊天后面可见,不会盖住气泡或侧边栏。如果主题背景不透明导致看不到,把 `zIndex` 调成非负数即可浮到界面之上——弹幕层 `pointer-events: none`,永远不拦截鼠标操作;
- **挂载点每次发射都会重新解析**(v0.15.2 / v0.16.1 两次修的就是它):先按外壳的 `data-shell-overlay` 找主框架,再取其中「最内层、画不透明底色、覆盖会话列大部分面积」的元素当宿主(给它加 `isolation: isolate`);外壳还没渲染完时先落到 `document.body` 以可见层级显示,目标出现即搬进去。仍不可见就开 `debug`,控制台里找 `danmaku layer mounted inside the background panel`。
- 弹幕文案支持与状态文案相同的占位符(`{elapsed}`、`{model}`、`{phase}`…),发射时用实时引擎当前值渲染;
- `danmaku: false` 完全关闭;`fontSizeMin` / `fontSizeMax` 构成随机字号区间(写反了自动纠正,并钳制到 8~96 px)。

### 与宿主弹窗共存:遮罩期间自动暂停(自 v0.25)

dsh 设置弹窗的遮罩是**全屏 `backdrop-filter: blur(2px)` 层**:弹幕层在它后面继续位移时,浏览器每帧都要重算全屏模糊,设置弹窗会持续闪烁([issue #60](https://github.com/01Virex/dsh-status-rotator/issues/60))。`pauseBehindMask`(默认 `true`)命中这种层就**停掉弹幕**——拆掉弹幕层与在途弹幕、清掉发射定时器、还原宿主的 `isolation`,遮罩一消失全部重建恢复。判定用四角 + 中心的命中测试(250ms 合流一次,2 秒一次 `rescanAll` 兜底),dsh 自己的菜单 / 卡片 / 提示这类小面积或没有模糊的层不会误判。

### 顶部 / 底部弹幕(bilibili 风格,自 v0.19)

`danmaku.types` 三种类型(滚动 / 顶部 / 底部)各有开关与权重,样式集中在 `danmaku.fixed`(字号、单色、描边、间距、停留时长、同类上限、层级、`reserveBands` 让滚动弹幕避开顶底车道、`anchorBottomToHost` 让底部弹幕贴住输入区上沿)。

- `mode` 可强制所有弹幕发成某一种(`scroll` / `top` / `bottom`,或 bilibili 的 `1` / `4` / `5`);不写则按权重分发;
- 顶部 / 底部弹幕默认样式与滚动弹幕不同(白字 + 描边,字号与停留时长独立),数值都在 `danmaku.fixed` 一处;
- ⚠️ **默认分布变了**:配置里没有 `types` 时三种都开(`scroll 2 : top 1 : bottom 1`),想保持 v0.19 之前的样子就把 `top` / `bottom` 的 `enabled` 设为 `false`(或设置页关掉)。

## 浏览器标签页标题

可选:**默认关闭**。开着的时候,回合进行中让标签页标题也按模板轮换:

```json
"title": {
    "enabled": true,
    "templates": ["⏳ {phaseLabel} {elapsed}", "🤔 {phaseLabel}… {elapsed}"], // 每 intervalMs 换一条
    "idleTemplate": "💤 dsh 空闲",   // 无回合时显示;"" = 把标题交还宿主
    "intervalMs": 8000
}
```

模板支持与文案相同的占位符。没有回合进行中时显示 `idleTemplate`;`idleTemplate` 设为 `""`(或关掉 `enabled`)就把标题交还宿主。`title: false` 完全关闭。

**在设置页里改**(v0.27.0 起):DSH「设置 → 状态文案 → 行为」页有「标签页标题」一组 —— 开关、模板(每行一条)、空闲时的标题、轮换间隔,保存后随其余设置一起写进插件的配置存储(升级不丢),不用手改 `config.json`。

**只写自己的标题(重要)**:插件给 `document.title` 写入的前提是「这个标题是它自己写上去的」;从没接管过、或已经把标题交还之后,它一个字都不会碰 —— 包括**宿主自己写的会话标题**(`<会话名> — DeepSeek Harness`)和**别的插件**对标题的改动。关掉这个开关时,插件把最近一次宿主写的标题还回去,然后就不再插手。

> v0.27.0 起插件**只写自己接管过的标题**:读回的值与启动时缓存不一致(宿主或别的插件写的)就交还并停手。此前是「值变了就写回去」,会把 [oh-my-dsh](https://github.com/gulagala001/oh-my-dsh) 这类标题写者的成果顶掉(实测 2.6 秒内互相重写 10 次)。

## 预设与调度

预设 = 命名的词库快照(可带自己的 `config`),设置页一键切换,或按 `schedule` 规则自动切换:

```json
"presets": [{ "id": "night", "name": "夜间", "phrases": { "zh": { "thinking": ["夜深了…"] } } }],
"activePreset": null,
"schedule": [{ "preset": "night", "days": [1,2,3,4,5], "from": "22:00", "to": "06:00" }]
```

- `days` 为 `0`(周日)~ `6`(周六);`from` / `to` 支持跨零点(`22:00` → `06:00`);
- 命中规则时自动切到该预设,离开时段回到 `activePreset`;设置页「自动化」tab 有可视化编辑器并实时显示当前生效的预设;
- 预设里没写的键沿用全局配置。

## 配置

文案已从源码分离,全部放在 JSON 配置文件里。项目根有两个配置文件:

- **`config.example.json`** — 入库的完整模板:**默认配置 + 全部文案**(中英双语,分三阶段);
- **`config.json`** — 你的本地个性化配置,由 `node gen-config.cjs` 初始化(仅当不存在时创建,不覆盖你的改动)。已被 `.gitignore` 忽略,随便改不会污染 git。

**自动加载(默认)**:插件的 node half 注册了一个 HTTP route(`/plugins/dsh-status-rotator/config.json`)来 serve 插件同目录的 `config.json`(每次请求实时读文件)。浏览器端默认自动 fetch 它,并且**页面保持打开时每 `reloadIntervalMs` 自动重读、切回标签页立即重读**,所以只要 `config.json` 放在插件目录里,改完文案**不用刷新页面、不用重启**就会生效。首次安装才需要重启一次 `dsh web`。

### 可热重载的外部词库

**v0.20.0 起**,node 半区还会读取一个**包外、可写**的词库文件——默认 `$DSH_HOME/status-rotator/phrases.json`,可用环境变量 `DSH_STATUS_ROTATOR_BANK` 覆盖(绝对路径,或相对进程工作目录)。它是与 `config.example.json` 同构的普通 JSON,**只写要覆盖的键**即可,最小的一份通常就是一个包的一个阶段:

```json
{ "packs": [{ "id": "china-ai", "phrases": { "zh": { "thinking": ["正在飞唐杰马…"] } } }] }
```

node 半区每次请求都会检查这个文件:变了就重新读取解析(`mtimeNs` + size 走快速路径,再比内容,同一时间粒度内的改写也不会漏),浏览器半区在下一次 `reloadIntervalMs` 轮询时拿到新内容——**不用重启进程、不用重装包、也不用重发一次 npm 包**。规则:

- 只取文件里的 `packs` / `phrases`,里面的 `config` 会被忽略——运行时选项仍然只由设置页 / `config.json` 管理;
- 外部词库是**优先级最高的词库层**:生效文档按 内置 `config.example.json` → `config.json` → 自动更新词库 → 用户配置存储 → 外部词库 合并;词库包按 `id` 逐条合并,写一个包不会动到另外 11 个。想让某个包回到设置页管理,把该包从外部词库文件里删掉即可(词库内容**不会**被算成你的改动写进配置存储或兼容镜像,所以删掉之后随包 / 上游那份立刻回来);
- 内置词库始终是兜底:文件不存在时行为与之前完全一致;文件损坏时保留上一次成功加载的内容继续服务,错误可从 `externalBankStatus()` 读到;
- 单进程自验:`node scripts/verify-phrase-hot-reload.cjs` 会 apply 插件、起一个真实 HTTP server、GET 路由,然后连续两次改写词库文件再 GET,全程不重启。

### 词库自动更新

**v0.21.0 起** node 半区每 **6 小时**拉一次上游 `main` 的 `config.example.json`(默认走 jsDelivr,选它是为了可达性),缓存到 `$DSH_HOME/status-rotator/bank.remote.json`。响应与其它词库层同样校验,只留 `packs` / `phrases`,**内容真的变了才原子写盘** —— 所以合进 main 的投稿、每周的 star 包刷新都能到达正在运行的实例,不用重启、重装或重发 npm 包。

- `DSH_STATUS_ROTATOR_BANK_URL` —— 上游地址(可换自己的镜像);`off` 或留空 = 关闭自动更新;
- `DSH_STATUS_ROTATOR_BANK_INTERVAL_MS` —— 检查间隔(毫秒,`0` = 关闭);不设 = 6 小时。

上游更新只作用于你没显式改过的包:设置页改过的包、或在本地词库文件里声明过的包仍以你为准。上游新增的包会合并进来,但在发版带上 `enabledPacks` 之前保持关闭(自动更新层刻意不带 `config`)。拉取失败(CDN 不可达 / HTTP 错误 / JSON 非法 / 空文档)只记进 `remoteBankStatus()`,继续用上一次成功的副本。默认会周期性向 jsDelivr 发请求,想完全本地化就设 `BANK_URL=off` 或间隔 `0`。

**持久化存储(v0.6.1 起;v0.26.1 起真正落在插件自己的数据目录)**:保存的设置写入 **`$DSH_HOME/status-rotator/config.json`**(可用 `DSH_STATUS_ROTATOR_CONFIG` 覆盖)——与词库文件同目录,**不属于任何包,升级插件不会碰它**。

- 旧方案两次静默失效:配置曾在插件目录里(升级即被替换),后来改存 dsh 官方设置存储,而 0.1.7-rc.1 的 settings 服务**没有 `register()`**,整条链路失效 → 设置又被重置(issue [#51](https://github.com/01Virex/dsh-status-rotator/issues/51))。v0.26.1 起持久化不再依赖宿主设置 API 的形状。
- 插件目录的 `config.json` 保留为**兼容镜像**:保存时照样写一份,README 允许的「直接改文件」也照旧 —— 手改内容会在它还在时被搬进用户配置存储(每次 GET 检查,最迟一个 `reloadIntervalMs`)。
- 存储里**只存与随包默认的差异**,装载时按 内置默认 → `config.json` → 自动更新词库 → 用户配置存储 → 外部词库 合并;带 `id` 的数组(词库包、预设)按 id 逐条比,每次保存都从零重算差异 —— 所以把某项改回默认值就是把它从存储里去掉,老安装里整份词库也会收敛(实测 82,966 B → 1,586 B,词条零丢失)。

> 版本变更史见 [CHANGELOG.md](./CHANGELOG.md)。升级插件后**重启一次 `dsh web`** 让 node 半区加载新代码,客户端半区刷新页面即可。

```json
{
    "config": { "intervalMs": 10000, "typeSpeedMs": 30, "longAfterMs": 60000, "reloadIntervalMs": 15000, "liveTickMs": 1000, "labelSource": "phrases", "weightedRandom": true, "debug": false, "fontWeight": "inherit", "gradient": { "enabled": true, "colors": ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"], "speed": 4 }, "title": { "enabled": false, "templates": ["⏳ {phaseLabel} {elapsed}", "🤔 {phaseLabel}… {elapsed}"], "idleTemplate": "💤 dsh 空闲", "intervalMs": 8000 }, "danmaku": { "enabled": true, "pauseBehindMask": true, "intervalMs": 2500, "speedMs": 18000, "fontSizeMin": 14, "fontSizeMax": 30, "rainbow": true, "colors": ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"], "color": "#ffffff", "opacity": 0.3, "maxCount": 12, "zIndex": -1, "scope": "all", "marginTop": 16, "marginBottom": 160 } },
    "phrases": { "zh": { "thinking": ["…"], "running": ["…"], "long": ["…"] }, "en": { "thinking": ["…"], "running": ["…"], "long": ["…"] } },
    "packs": [],            // 可选,见「词库包」(默认配置自带 12 个主题包)
    "enabledPacks": null,   // null/缺省 = 全部启用;默认配置钉在 10 个非 star 包上
    "presets": [],          // 可选,见「预设与调度」
    "activePreset": null,   // 可选预设 id
    "schedule": []          // 可选时段规则
}
```

| 键 | 默认 | 说明 |
|---|---|---|
| `intervalMs` | 10000 | 轮换间隔(毫秒) |
| `typeSpeedMs` | 30 | 打字机每字符间隔(毫秒),0 关闭打字机 |
| `longAfterMs` | 60000 | 进入 `long` 阶段的阈值 |
| `reloadIntervalMs` | 15000 | 页面打开时自动重读 `config.json` 的间隔(毫秒),0 关闭 |
| `liveTickMs` | 1000 | 实时占位符(`{elapsed}` / `{date}` / `{time}` / `{tps}` 等)在文案与标题里的刷新间隔(毫秒),0 关闭 |
| `weightedRandom` | true | 加权随机抽取;`false` = 完全均匀。文案条目可为 `"text"` 或 `{ "text": "...", "weight": 3 }`(weight 为正数,上限 1000,非法/缺省按 1) |
| `debug` | false | 控制台诊断日志 |
| `fontWeight` | `"inherit"` | 状态文字 / 弹幕的字体粗细:数字(1~1000,常用 100~900)或 CSS 关键字(`normal`/`bold`/`bolder`/`lighter`);`"inherit"` = 跟随界面(默认;弹幕保持原有的 600) |
| `labelSource` | `"phrases"` | 状态行文案来源:`"phrases"` = 轮换短语库;`"host"` = 只用宿主原文(`Deep diving...` / `深度求索中`),外观逐项对齐 0.1.6 的 `.turnStatus`。短语库为空时两种模式都回落宿主原文,见 [状态行文案来源](#状态行文案来源label-source) |
| `gradient` | 见上 | 炫彩渐变:`false` / `true` / `{enabled, mode, direction, colors, dayColors, speed}`(`mode`:auto 跟随深浅色,day / night 强制;`direction`:rtl 默认 / ltr 从左向右) |
| `title` | 见上 | 标签页标题:`false` / `{enabled, templates, idleTemplate, intervalMs}` |
| `danmaku` | 见上 | 弹幕模式:`false` / `{enabled, pauseBehindMask, intervalMs, speedMs, fontSizeMin, fontSizeMax, rainbow, colors, color, opacity, maxCount, zIndex, scope, marginTop, marginBottom, types, fixed}`;`pauseBehindMask` 默认 `true`,见「与宿主弹窗共存」 |
| `phrases` | 来自配置文件 | 文案(中英 × 三阶段;可只写部分,缺的用其它源回退) |
| `packs` | 无 | 词库包:`[{ id, label?, phrases? }]`,按顺序并入生效词库(按文本去重) |
| `enabledPacks` | null(全部) | 已启用的词库包;`null`/缺省 = 全部,`[]` = 只用核心词库。默认配置列出 10 个非 star id,因此 `star-ask` / `star-route` 默认关闭 |
| `presets` | 无 | 命名词库,每项可带独立的 `config` / `phrases` |
| `activePreset` | null | 当前启用的预设(`null` = 用顶层 config/phrases) |
| `schedule` | 无 | 自动切换预设的时段规则 |

**取值保护**:数值字段在保存与加载时都会钳制(轮换间隔 ≥ 250ms、打字机 ≤ 1000ms/字、弹幕发射间隔 ≥ 200ms、同屏上限 ≤ 60、层级 ±1000 等);颜色只接受 `#rrggbb` / `rgb()` / `hsl()` / CSS 颜色名,非法值会被丢弃并在设置页标红。原因很实在:颜色会被拼进注入的 `<style>`,数值会直接喂给 `setInterval`。

**写接口只接受同源请求**:`PUT/POST /plugins/dsh-status-rotator/config.json` 要求 `content-type: application/json` 且来源与 `Host` 同源(`sec-fetch-site` 只允许 `same-origin` / `none`),跨站请求一律 403 —— 否则任意网页都能改写你的本地配置。

文案来源优先级,从高到低:

1. **localStorage 单条覆盖** `dsh-status-rotator.texts[.<locale>]` / `texts`;
2. **localStorage 完整配置** `dsh-status-rotator.config`(粘贴 JSON,刷新生效);
3. **外部 JSON**:`dsh-status-rotator.url` > `EXTERNAL_URL` 常量 > 本地自动加载(`/plugins/dsh-status-rotator/config.json`);
4. **内置默认值**:仅 `lib/client.js` 顶部的 `DEFAULT_CONFIG`(不含文案)。

如果 localStorage 覆盖命中,外部 `config.json` 会被静默压住;新版本会在浏览器控制台输出一条 `[status-rotator] ⚠ localStorage 覆盖生效` 告警,看到它就去清掉对应键。

旧的纯文案外部 JSON(`{ "zh": [...], "en": [...] }` 或 `{ "thinking": [...] }`)依然兼容,视为"只带文案的配置"(扁平数组落到 `thinking` 组)。

文案跟随「设置 → 语言」在中英文之间实时切换,未知语言回退到中文。

## 设置页

打开 DSH 左下角「设置」,导航里会多出一页 **状态文案**。页面按语义拆成四个 tab,排版与官方插件设置页同规格(760 列,同一套 tab / 字段 / 输入框语言):

**文案**

- **编辑目标** —— 一个下拉覆盖基础词库、任意预设(`preset:<id>`)与任意词库包(`pack:<id>`),保存时按它决定写进哪里;目标失效(预设或包被删)自动退回基础词库;
- **中文 / English** 两个标签页,各含 `thinking` / `running` / `long` 三个文本框,**每行一句**,空行自动忽略;行内写 `文案 | 权重` 可设置该句权重,每个阶段实时显示句数;
- **词库包开关** —— 逐个启用/停用主题包(十个非 star 包默认全开);
- **预设管理** —— 选预设、**新建**、就地改名(名称按当前编辑语言保存)、**删除**(引用它的调度规则会一并移除)、「设为当前」写入 `activePreset`。

**外观**

- 字体粗细(状态文字与弹幕共用);
- **炫彩渐变**:启用开关、配色模式(跟随界面深浅色 / 强制白天 / 强制黑夜)、流动方向(从右向左 / 从左向右)、白天 + 黑夜两套颜色序列、流动速度;
- **弹幕**:启用开关、发射间隔、穿越时长、随机字号范围、炫彩开关 + 色板、透明度、同屏上限、层级与文案范围。

**行为**

- 轮换间隔、打字机速度、长任务阈值、自动重读间隔、占位符刷新间隔、加权随机开关。

**自动化**

- **调度编辑器**:以列表增删「星期 + 时段」规则,自动切换预设;页面上实时显示当前生效的预设(含调度命中)。

整页通用:

- **改动即保存**:开关与下拉立即写盘,文本 / 数值停顿 400ms 写盘(预设改名在失焦时),没有保存按钮,只有写盘失败时工具栏标红;
- 每次写盘把整份 JSON `PUT` 到 `/plugins/dsh-status-rotator/config.json`,node half 校验后**原子写回**,已打开页面立即热应用;非法内容返回 400 并在页面报错,不会写坏文件;
- 切换编辑目标 / 「重读」都会先落盘再操作,草稿不会被静默丢弃;数值越界即标红,偏离默认时出现「恢复默认」;页脚直接跳源码仓库。

升级到带设置页的版本后,需要重启一次 `dsh web`(让 node half 注册写接口),之后全部在页面里操作即可。

## QQ 群成员文案生成器

想要把某个 QQ 群的每个成员变成一句 `正在路由（群成员）写代码...` 文案时,用 `scripts/fetch-qq-group.cjs` 一键生成独立配置文件,不用手抄群成员名单。

前置条件:机器人在目标群内且你有 OneBot v11 兼容 HTTP API(如 NapCat / LLOneBot / go-cqhttp / OpenShamrock)。

```bash
# 默认群号是占位符 0——务必用 -g 传你自己的群号,否则默认只生成 config.qq0.json
node scripts/fetch-qq-group.cjs --group 123456789 --url http://localhost:3000 --token 你的token

# 直接替换插件实际使用的 config.json(旧的自动备份为 config.backup-<时间戳>.json)
node scripts/fetch-qq-group.cjs --group 123456789 --url http://localhost:3000 --token 你的token --activate

# 没有机器人接口?把群成员名单存成 members.txt(每行一个昵称)再生成
node scripts/fetch-qq-group.cjs --input members.txt
```

| 选项 | 默认 | 说明 |
|---|---|---|
| `-g, --group` | `0`(占位符) | QQ 群号(也读环境变量 `QQ_GROUP_ID`)。`0` 是故意的无意义默认值——务必传真实群号,如 `--group 123456789` |
| `-u, --url` | `http://localhost:3000` | OneBot HTTP 地址(也读 `ONEBOT_HTTP_URL`) |
| `-t, --token` | 空 | access token(也读 `ONEBOT_ACCESS_TOKEN`) |
| `-a, --action` | `get_group_member_list` | 动作路径(也读 `ONEBOT_ACTION`),带前缀的框架改 `/api/...` |
| `-i, --input` | 无 | 本地名单:txt(每行一个)/ json(数组)/ csv(第一列) |
| `-o, --output` | `config.qq0.json` | 输出文件 |
| `--activate` | 关 | 直接写回 `config.json` 并备份旧文件 |
| `--dry-run` | 关 | 只预览不写文件 |

显示名优先取群名片,没有群名片再取昵称。生成的文件只有 `zh.thinking` 一组:按照本插件的回退规则,thinking 阶段直接用,其余阶段自动回退到同一组。生成产物 `config.qq*.json` 已被 `.gitignore` 忽略。

## 项目结构

```
dsh-status-rotator/
├── .github/
│   ├── workflows/
│   │   ├── phrase-submit.yml   # 词库投稿机器人(issue opened → 校验 → 自动开 PR)
│   │   ├── release.yml         # 打 tag 发布 GitHub Release
│   │   ├── star-pack.yml       # 用仓库自带的 GITHUB_TOKEN 刷新 star-ask / star-route
│   │   └── test.yml            # 每次 push / PR 跑 npm test
│   └── ISSUE_TEMPLATE/
│       └── phrase-submit.yml   # 「词库投稿」表单模板(自动打 词库投稿 标签)
├── lib/
│   ├── index.js            # node half:注册 config.json 的 HTTP 路由(GET/PUT,带校验)
│   └── client.js           # client half:状态文字替换 / 占位符 / 渐变 / 标题 / 弹幕 / 预设
├── config.example.json     # 完整模板(默认配置 + 全部 1078 条文案,分 12 个词库包,入库)
├── config.json             # 本地个性化配置(被 .gitignore 忽略)
├── gen-config.cjs          # 初始化 config.json 的脚本
├── cordis.patch.yml        # dsh bundle patch manifest(被 package.json 的 dsh.bundle.patch 引用)
├── scripts/
│   ├── fetch-qq-group.cjs  # 抓取 QQ 群成员并生成文案配置
│   ├── check-bank-memes.mjs # 词库质检(开发期):查重/超长/省略号/系列占比
│   ├── package-release.cjs # 打包发布文件
│   ├── phrase-bot.cjs      # 词库投稿机器人(解析表单 / 校验 / 写入词库 / 开 PR)
│   ├── smoke-test.cjs      # 纯函数冒烟测试(npm test)
│   ├── sync-bank-counts.cjs # 词库计数同步:从 config.example.json 现算并写回 README/描述/注释
│   ├── update-star-pack.cjs # 从星标名单重建 star-ask / star-route
│   ├── verify-phrase-hot-reload.cjs # 外部词库热重载验证:改完文件不重启即可生效(dev-only)
│   ├── verify-bank-auto-update.cjs # 词库自动更新验证:本地上游 A→B→500,全程不重启(dev-only)
│   ├── verify-settings-survive-upgrade.cjs # 设置跨升级存活验证:手改 config.json / 设置页保存 → 升级 → 设置仍在(#51,dev-only,CI 也跑)
│   ├── danmaku-mount-test.html # 弹幕挂载点的真浏览器回归页(dev-only)
│   ├── label-layout-test.html  # 状态行布局回归页:锁宽/截断/配色回退/设置页渲染(dev-only)
│   ├── live-pending-test.html  # {pending} 实时刷新回归页:待作答交互 → 标签(dev-only)
│   ├── title-coexistence-test.html # 标签页标题所有权回归页:与 oh-my-dsh 品牌替换共存(v0.27.0,dev-only)
│   ├── run-danmaku-mount-test.cjs # 无头驱动上述回归页(--page=danmaku|label|pending|title,dev-only)
│   ├── turn-process-017-test.html # 0.1.7+ 状态行回归页:折叠头接管/简回合/宿主原文回落/0.1.6 观感比对(dev-only)
│   ├── run-turn-process-test.cjs # 无头驱动 0.1.7+ 状态行回归页(dev-only)
│   ├── probe-danmaku-live.cjs # 探针:检查正在运行的 dsh web 弹幕挂载点/绘制顺序(dev-only)
│   └── unify-ellipsis.cjs  # 默认词库省略号统一 / 完整性校验
├── package.json
├── README.md               # 英文文档
├── README_ZH.md            # 中文文档
├── CHANGELOG.md            # 更新日志
├── CONTRIBUTORS.md         # 英文贡献者
├── CONTRIBUTORS_ZH.md      # 中文贡献者
└── LICENSE
```

> 仅本地存在、不入库的产物:`demo-wallpapers/`、`.dsh-web-restart/`、`dist-release/`、`config.qq*.json`、`config.backup-*.json`——都列在 `.gitignore` 里。

## 通过 Issue 投稿词库

在仓库 [Issues](https://github.com/01Virex/dsh-status-rotator/issues/new/choose) 选 **「词库投稿」** 表单:语种(zh / en / 两种都要)、分组(thinking / running / long)、目标词库包(默认 `community`)、文案(**一行一条**,最多 60 条,单条 ≤200 字符)、可选署名。

**会被拒绝的写法**:行内出现分号 `;` `；` `﹔` `;`(分号串起来的整行只会读成一条连不通的长句;中文冒号 `：`、逗号 `，`、顿号 `、` 不受影响)、HTML / 链接 / 控制字符、与现有词库重复、未勾选提交须知。被拒会收到 ❌ 原因说明,改完重新提交即可。

机器人接手后:校验并归一化(`...` → `…`、末尾补 `…`)→ 在 Issue 里回复预览表格与**「立即试用」JSON**(粘到设置页即可看到效果)→ 开一个改 `config.example.json` 的 PR(带 `词库投稿` 标签),**维护者点 Merge 即收录**,随下一次 npm 发版分发。

- **分支自动跟随 main**:main 前进(以及每 6 小时、手动触发)时,机器人把每条开着的投稿分支按当前 main 重建,PR 永远可合并 —— 不需要人工解 `config.example.json` 的冲突(手工解容易出**重复键**,`JSON.parse` 会静默丢掉前一个,条目无声少一半);
- **规则变了会复核**:不再合规的投稿会在 PR 与 Issue 上写明原因并**自动关闭 PR**;机器人读库 / 写盘回读都查重复键,`npm test` 也断言 `config.example.json` 无重复键;
- 只追加进目标词库包,不改代码、不碰默认词库本体;被收录的投稿记入 [CONTRIBUTORS.md](./CONTRIBUTORS.md)。实现见 [.github/workflows/phrase-submit.yml](.github/workflows/phrase-submit.yml) 与 [`scripts/phrase-bot.cjs`](scripts/phrase-bot.cjs)。

## 测试

`npm test`(`node scripts/smoke-test.cjs`)在 Node 沙箱里加载 `lib/client.js` 跑纯逻辑断言:占位符插值、时长格式化、时钟解析、配置 / 预设 / 调度归一化、调度匹配、node half 的配置校验、词库计数与文档一致;CI 每次 push / PR 都跑([.github/workflows/test.yml](.github/workflows/test.yml))。

依赖真实 DOM 的部分(弹幕挂载、状态行锁宽 / 截断 / 配色回退、`{pending}` 实时刷新、标签页标题所有权)另有四个真浏览器回归页,由 `npm run test:browser` 用 CDP 无头跑完(需要本机 Edge / Chrome):

| 页面 | 覆盖 |
| --- | --- |
| [`danmaku-mount-test.html`](./scripts/danmaku-mount-test.html) | 挂载时序、顶 / 底弹幕、宿主全屏模糊遮罩下的暂停与恢复 |
| [`label-layout-test.html`](./scripts/label-layout-test.html) | 打字机锁宽、超长截断、配色非法回退、设置页渲染 |
| [`live-pending-test.html`](./scripts/live-pending-test.html) | 真插件跑 pending 0 → 1 → 0 → 1,以及无 uiSession 服务时的兜底 |
| [`title-coexistence-test.html`](./scripts/title-coexistence-test.html) | 标签页标题所有权:与 oh-my-dsh 的品牌替换共存 |

单跑用 `npm run test:browser:label` / `:pending` / `:title`;0.1.7+ 状态行另有 `node scripts/run-turn-process-test.cjs`(15 档:折叠头接管、回合结束交还、座位缺失降级、观测徽标、`labelSource: "host"` 与 0.1.6 逐项比对)。手动打开页面时用 URL 参数切场景(`?modes=1`、`?mask=1`、`?case=…`、`--page=danmaku|label|pending|title`)。

## 卸载

从 `cordis.patch.yml` 删掉 `status-rotator` 那一行,重启 `dsh web` 即可。

## 贡献

欢迎提交 Issue 和 Pull Request。加新文案最简单的方式:直接编辑 `config.json` 或 `config.example.json` 的 `phrases` 字段,不需要动任何代码;或者用上面的 **[通过 Issue 投稿词库](#通过-issue-投稿词库)**,机器人会自动帮你校验并开好合并请求。

## 致谢

本项目的诞生离不开贡献者的帮助,详见 [CONTRIBUTORS_ZH.md](./CONTRIBUTORS_ZH.md)。

## License

[MIT](./LICENSE)
