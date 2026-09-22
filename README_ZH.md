# dsh-status-rotator

> 把 DSH Web 底部那行 `Deep diving...` / `深度求索中...` 换成你自己的文案库:**1090 条梗、12 个主题词库包、打字机 + 白天/黑夜炫彩渐变 + 弹幕**。

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

一个 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 客户端插件:把 Web 界面底部回合运行时那行硬编码的 `Deep diving...` / `深度求索中...` 状态文字,替换成你自己的文案库 —— 按回合阶段切换、打字机逐字输出、定时轮换、加权随机抽取、带实时取值的模板占位符、白天 / 黑夜两套配色自动跟随界面深浅色的流动炫彩渐变、视频网站风格的弹幕,以及一个同时喂给文案和浏览器标签页标题的实时状态引擎。界面自带的运行时长时钟(15 秒后出现)不受影响。

## 特性总览

**核心**

- **状态文字替换** — `Deep diving...` 标签换成你的文案,每 `intervalMs` 轮换,逐字打字输出(`typeSpeedMs`,`0` 关闭打字机);
- **阶段感知** — `thinking` / `running` / `long` 三组文案,时钟出现或超时立即切换,不用等轮换间隔;
- **加权随机** — 任意文案可带权重,按权重比例抽取(`weightedRandom: false` 回到完全均匀);
- **零侵入定位** — 按 `role="status"` + `aria-live="polite"` 精确定位状态标签,不误伤聊天记录代码片段、其它 aria-live 区域,也不碰时钟。

**内容**

- **文案与代码分离** — 文案全在 JSON 配置文件里,改文案零代码、免重启;
- **词库包模块化** — 文案拆成具名词库包(`packs[]` + `enabledPacks[]`),按文本去重叠加进生效词库,设置页可逐个开关、独立编辑;
- **模板占位符** — `{elapsed}`、`{phase}`、`{phaseLabel}`、`{locale}`、`{date}`、`{time}`,以及实时引擎字段 `{model}`、`{provider}`、`{tps}`、`{pending}`、`{tools}`、`{running}`;
- **多语言** — 中英文文案跟随「设置 → 语言」实时切换,未知语言回退中文;
- **社区词库机器人** — GitHub Issue 表单 + 自动校验 + 自动开合并请求(见[通过 Issue 投稿词库](#通过-issue-投稿词库))。

**视觉**

- **炫彩渐变** — 文字以流动渐变显示;白天(浅色)/ 黑夜(深色)两套配色跟随界面主题自动切换,也可用 `mode` 强制其一;颜色序列与流速可配,一键关闭;
- **弹幕模式** — 所有文案随机以视频网站弹幕形式从右到左飘过页面,随机大小、每颗随机炫彩颜色、透明度与层级可调。

**实时**

- **实时状态引擎** — 订阅 dsh 会话快照(会话列表 / 对话快照 / 模型 RPC),DOM 时钟兜底——文案与标签页标题共用同一数据源;
- **标签页标题** — 用你的模板轮换 `document.title`,空闲时恢复原标题(可配);
- **预设与调度** — 多套命名词库(可带独立配置),设置页一键切换,或按星期/时段自动切换。

**工作流**

- **自动加载** — node half 注册 HTTP 路由 serve `config.json`,开箱即用,无需 localStorage 或部署;
- **热更新** — 页面保持打开会定时重读配置,切回标签页立即重读;
- **持久化存储** — 保存的设置写入 dsh 官方设置存储(`$DSH_HOME/settings.yaml`),升级插件不清空;
- **设置页编辑** — DSH「设置」里新增「状态文案」页,中英 × 三阶段词库可视化编辑,保存即生效。

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

首次启动时,插件按这个顺序 serve:你**保存的设置**(`$DSH_HOME/settings.yaml`,命名空间 `status-rotator`)覆盖在包目录的 `config.json` 之上;该文件不存在时(用 npm 安装就是这种情况)则以 `config.example.json` 为底——默认的全部 1090 条文案都在里面,见[词库现状](#词库现状)——此外还有两层词库:**自动更新词库**(每 6 小时从上游拉取,见下文「词库自动更新」)和**可选的外部词库**(`$DSH_HOME/status-rotator/phrases.json`,手改、优先级最高、改完即被重新读取,见下文「可热重载的外部词库」)。调文案或选项,可以直接改文件(页面打开时热更新),也可以去 DSH 左下角「设置」里的 **状态文案** 页面操作,见[设置页](#设置页)。

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

状态标签按 `role="status"` + `aria-live="polite"` 精确定位,插件不会碰聊天记录里的代码片段或其它 aria-live 区域——也从不改动时钟(DOM 时钟只被*读取*用于判阶段;阶段与时长由实时引擎按回合开始时刻推导)。

## 词库现状

默认词库当前共 **1090 条**,拆为 **12 个主题词库包**(核心 `phrases` 表为空——词条全部住在包里)。其中 10 个默认启用,两个 **star 包随包发布但默认关闭**——想用就在「设置 → 状态文案 → 词库包」里打开:

| 词库包 | zh | en | 小计 | 默认 |
| --- | --- | --- | --- | --- |
| `deepseek` DeepSeek 专场 | 104 | 111 | 215 | 开 |
| `coding` 写代码日常 | 84 | 81 | 165 | 开 |
| `daily` 日常 | 77 | 64 | 141 | 开 |
| `internet-memes` 网络梗 | 54 | 33 | 87 | 开 |
| `sysadmin` 系统管理 | 41 | 38 | 79 | 开 |
| `slacking` 摸鱼 | 36 | 29 | 65 | 开 |
| `math-physics` 数学与物理 | 31 | 18 | 49 | 开 |
| `western-ai` 西方 AI 圈 | 16 | 18 | 34 | 开 |
| `reverse-proxy` 反代 | 14 | 16 | 30 | 开 |
| `china-ai` 中国 AI 圈 | 18 | 10 | 28 | 开 |
| `star-ask` 求 star | 11 | 12 | 23 | **关** |
| `star-route` 星标者路由 | 87 | 87 | 174 | **关** |
| **合计** | **573** | **517** | **1090** | 开 893 / 关 197 |

- 大部分条目 zh/en 成对镜像;近期社区投稿常为中文单语——投稿表单选「**zh + en (两种都要)**」即可双语收录;
- 含 5 条加权示范条目(见[加权随机](#加权随机)),其余均为默认权重 1 的纯文案;
- 词库通过社区[投稿表单](#通过-issue-投稿词库)持续增长:校验通过并合入的投稿会在 [CONTRIBUTORS.md](./CONTRIBUTORS.md) 名单里致谢;
- 统计由 `node scripts/sync-bank-counts.cjs` 从 `config.example.json` 现算并写回(投稿机器人与 star 词库刷新会自动调用;手改词库后跑一次即可);本地用 `node scripts/check-bank-memes.mjs` 可随时审计当前词库(查重/超长/省略号/系列占比)。

**star 词库包(默认关闭)** — 拆成两个独立的包,想只要求 star 文案、不要星标者点名,就只开前者:

| 词库包 | 内容 |
| --- | --- |
| `star-ask` 求 star | 纯求 star 文案,如「正在向你讨一个 star…」/ `Begging for a star…` |
| `star-route` 星标者路由 | **每位当前星标者一条**——`正在路由 <login> 写代码…` / `Routing <login> to write code…`,让状态轮换真的"路由每个点星的人去干活" |

默认关闭是因为"讨 star"是口味问题,不是功能坏了:想用就在「设置 → 状态文案 → 词库包」里打开。星标名单由新的 [`Star packs` 工作流](.github/workflows/star-pack.yml) 刷新——每周一次、也可手动 `workflow_dispatch` 触发——它用仓库自带的 `GITHUB_TOKEN` 读 stargazers,所以新点星的人最多一周内自动进词库,不需要任何人操作(该接口需要能看见本仓库的令牌,可用 `STAR_TOKEN` secret 覆盖)。本地刷新:`node scripts/update-star-pack.cjs --token <pat>`,或 `--names names.json` 从离线名单重建。老安装升级后即带上这两个包;若此前保存过的设置文档里已经钉死了 `enabledPacks`,两个 id 会保持关闭,手动开一下即可。

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
- 默认配置自带 **12 个包**(`deepseek` / `western-ai` / `china-ai` / `coding` / `reverse-proxy` / `sysadmin` / `math-physics` / `slacking` / `internet-memes` / `daily` / `star-ask` / `star-route`),并把 `enabledPacks` 钉在 10 个非 star 包上,所以两个 star 包**默认关闭**;核心表为空——关掉某包就真的从词池里移除该主题;
- 投稿表单的**「目标词库包」**选择器含同样 10 个包 + `community`(默认落点)+ `star-ask`(只求 star 文案;星标者路由包由脚本自动生成,不接受投稿):投稿进入所选包,`community` 包在首次使用时自动创建——核心词库本体不被改动,想关掉或裁剪社区内容一处搞定;
- 旧配置没有 packs 字段,零改动兼容。

## 加权随机

默认按均匀随机抽取(避免连续重复)。给文案配上权重后,抽取变为按比例:权重 `3` 的文案出现概率是权重 `1` 的 3 倍。

```json
"phrases": { "zh": { "thinking": [
    "正在写代码…",                       // 纯字符串,权重 1
    { "text": "正在加水…", "weight": 3 }   // 3 倍概率
] } }
```

- 一条文案可以是纯字符串(权重 1)或对象 `{ "text": "...", "weight": 3 }`;`weight` 须为正数(支持小数),超过 1000 按 1000 计,非法/缺省按 1 计。权重完全可选——旧的纯字符串词库零改动兼容;
- **设置页编辑器**里每行写 `文案 | 权重`(如 `正在写代码 | 3`)即可;编辑器回写时会给加权文案追加 ` | 权重` 后缀。「基本设置」里的「加权随机」开关可一键回到完全均匀,不用改词库;
- 权重同时作用于状态文字轮换与**弹幕池**(弹幕按文本去重,保留首条权重);
- 「避免与上一句重复」规则保留:上一句在抽取时临时排除(若只剩它一个候选则重复)。

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
| `{locale}` | 当前界面语言(`zh` / `en`) | `zh` |
| `{date}` | 本地日期 `YYYY-MM-DD` | `2026-08-07` |
| `{time}` | 本地时间 `HH:MM:SS` | `12:34:56` |

随时间变化的占位符(`{elapsed}`、`{date}`、`{time}`、`{tps}`、`{pending}`、`{tools}`、`{model}`、`{provider}`)会按 `liveTickMs`(默认 1000 毫秒)**实时刷新**;设为 `0` 则只随轮换刷新。未知占位符原样保留,文案里写 `{...}` 是安全的。实时字段来自**实时状态引擎**:订阅 dsh 会话快照、待作答交互表与模型 RPC,并以 DOM 时钟兜底——会话 API 不可用时 `{model}` / `{provider}` / `{tps}` / `{tools}` 显示 `—`、`{pending}` 保持 `0`,插件其余功能不受影响。

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
- **挂载点每次发射都会重新解析**(v0.15.2,挂载目标在 v0.16.1 细化):先按外壳自带的 `data-shell-overlay` 标记找主框架,再退回结构判断;主框架内再找「最内层、画着不透明底色、且覆盖会话列大部分面积」的元素当宿主(弹幕层夹在它内部,给它加 `isolation: isolate`)。如果外壳还没渲染完(客户端插件比外壳先加载),弹幕层会短暂落到 `document.body` 上、用**可见**层级显示,等目标一出现就自动搬进去。旧版本要么在兜底后一直沿用 `z-index:-1` 被 body 的不透明背景盖住(v0.15.2),要么把层挂在主框架上、被会话面板自己的不透明底色整块盖住(v0.16.1)——两种情况下弹幕都在生成、在动,只是永远看不见。如果仍然不可见,打开 `debug`,在浏览器控制台里找 `danmaku layer mounted inside the background panel` 这行日志;
- 弹幕文案支持与状态文案相同的占位符(`{elapsed}`、`{model}`、`{phase}`…),发射时用实时引擎当前值渲染;
- `danmaku: false` 完全关闭;`fontSizeMin` / `fontSizeMax` 构成随机字号区间(写反了自动纠正,并钳制到 8~96 px)。

### 顶部 / 底部弹幕(bilibili 风格,自 v0.19)

- **类型**:`danmaku.types` 三项 —— `scroll`(原有右→左滚动,行为完全没变)、`top`(顶部)、`bottom`(底部)。每项 `{ enabled, weight }`:`enabled: false` 关掉该类型,`weight` 是发射时被抽中的相对概率。`danmaku.mode`(可选)强制所有弹幕只用某一种,取值 `scroll` / `top` / `bottom` 或 bilibili 弹幕协议的数字别名 `1` / `4` / `5`(适合「只发顶部弹幕」)。非法值会被丢弃,缺省一律按滚动处理,**老配置照常能用**。
- **行为**:顶部弹幕水平居中、出现在播放区域顶部,后到的自上而下堆叠;底部弹幕水平居中、出现在底部,后到的自下而上堆叠。两者都固定不动(不随播放进度变形),到 `fixed.durationMs` 整条消失。每条占一条车道,旧的消失后车道立刻回收、新弹幕补进空位,不会两条叠在同一行。同类满员(`fixed.maxCount`)或堆到区域另一头时,**丢弃这一拍** —— 与滚动弹幕一直以来的处理策略一致。
- **视觉**:白字(关炫彩时的默认)+ 四向黑描边、无背景块;字号与滚动弹幕共用同一套渲染管线(同一个 `pointer-events: none`)。所有顶部 / 底部数值**集中在 `danmaku.fixed` 一处**(默认值同时只在 `lib/client.js` 的 `DANMAKU_FIXED_DEFAULTS` 定义一次),改一句话就全改。
- **不会叠字**:`reserveBands`(默认开)把滚动弹幕的落点限制在顶部与底部车道**之间**,所以滚动文案永远不会从固定弹幕后面穿过。`anchorBottomToHost`(默认开)让底部弹幕贴住输入区上沿 —— dsh 自己的状态行就在那儿,半透明弹幕压在上面时,状态行的流光看起来就像「映射到了弹幕上」。关掉开关、或量不到宿主时,自动回落到原来的 `marginTop` / `marginBottom` 行为。
- **层级与配色**:顶部 / 底部弹幕进一个独立的「前层」,画在聊天内容之上(`fixed.zIndex`,默认 `10` —— 外壳 overlay 层是 20、侧栏拖拽手柄 11,所以设置弹窗仍在其上),不会被消息气泡盖住;滚动弹幕保持原来的「界面后面」层,行为不变。把 `fixed.zIndex` 设成负数,固定弹幕也会一起塞回界面后面。两种弹幕共用同一套色板:`rainbow` 开启(默认)时顶部/底部和滚动弹幕一样逐颗从 `colors` 随机取色,`rainbow: false` 时才用 `fixed.color`(默认白字)。
- ⚠️ **这些数值是按 bilibili 观感取的合理默认值,不是查证过的官方数值**([待确认]):`fontSize: 25`、`marginTop: 16`、`marginBottom: 160`、`gap: 4`、`durationMs: 4500`、`maxCount: 3`。要调就在 `danmaku.fixed` / `DANMAKU_FIXED_DEFAULTS` 里调。
- ⚠️ **默认分布有变化**:配置里没写 `types` 时,三种类型默认全开,比例为 `滚动 2 : 顶部 1 : 底部 1`,所以升级后会看到顶部 / 底部弹幕。想完全保持 v0.19 之前的样子,把 `"top": { "enabled": false }` 和 `"bottom": { "enabled": false }` 写上(或在设置页里关掉这两个开关)。


## 浏览器标签页标题

可选:回合进行中让标签页标题也轮换:

```json
"title": {
    "enabled": true,
    "templates": ["⏳ {phaseLabel} {elapsed}", "🤔 {phaseLabel}… {elapsed}"], // 每 intervalMs 换一条
    "idleTemplate": "💤 dsh 空闲",   // 无回合时显示;"" = 恢复原标题
    "intervalMs": 8000
}
```

模板支持与文案相同的占位符。没有回合进行中时显示 `idleTemplate`,设为 `""` 则恢复原始标题。`title: false` 完全关闭。

## 预设与调度

命名词库可以打包成预设,各自带独立的 `config` 与 `phrases`;设置页可切换,也可按星期/时段自动切换:

```json
{
    "activePreset": "work",
    "presets": [
        { "id": "work", "label": { "zh": "工作模式", "en": "Work" },
          "config": { "intervalMs": 12000, "gradient": false },
          "phrases": { "zh": { "thinking": ["正在认真写代码…"] } } },
        { "id": "fun", "label": { "zh": "摸鱼模式", "en": "Fun" },
          "phrases": { "zh": { "thinking": ["正在摸鱼…"] } } }
    ],
    "schedule": [
        { "preset": "work", "days": ["mon", "tue", "wed", "thu", "fri"], "from": "09:00", "to": "18:00" },
        { "preset": "fun",  "days": ["sat", "sun"], "from": "00:00", "to": "23:59" }
    ]
}
```

- `presets[]`:每项必填 `id`,可选 `label`(字符串或 `{zh, en}`)、可选 `config`(叠加在顶层 config 之上)和可选 `phrases`(替代顶层 phrases)。只写 `id` 的"空壳预设"表示切回基础词库;
- `activePreset`:预设 id,或 `null` / 缺省(用顶层 `config` / `phrases`);
- `schedule[]`:规则含 `preset`、`days`(`mon`…`sun`,省略 = 每天)、`from` / `to`(`HH:MM`)。支持跨天窗口(如 `22:00`–`06:00`)。命中规则时用该预设,否则用 `activePreset`;每分钟重新评估,实时生效;
- 设置页的编辑始终针对选中的预设(选「默认」则编辑基础词库);「设为当前」写 `activePreset`;调度规则也在同一页以列表形式编辑。

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
- 外部词库是**优先级最高的词库层**:生效文档按 内置 `config.example.json` → `config.json` → 设置存储 → 外部词库 合并;词库包按 `id` 逐条合并,写一个包不会动到另外 11 个。想让某个包回到设置页管理,把该包从外部词库文件里删掉即可;
- 内置词库始终是兜底:文件不存在时行为与之前完全一致;文件损坏时保留上一次成功加载的内容继续服务,错误可从 `externalBankStatus()` 读到;
- 单进程自验:`node scripts/verify-phrase-hot-reload.cjs` 会 apply 插件、起一个真实 HTTP server、GET 路由,然后连续两次改写词库文件再 GET,全程不重启。

### 词库自动更新

**v0.21.0 起** node 半区还会自己去上游刷新词库:每 **6 小时**拉一次仓库 `main` 分支的 `config.example.json`(默认源 `https://cdn.jsdelivr.net/gh/01Virex/dsh-status-rotator@main/config.example.json`,选它而不是 `raw.githubusercontent.com` 是为了可达性),缓存到 `$DSH_HOME/status-rotator/bank.remote.json`。响应与其它词库层走同一套校验,只留 `packs` / `phrases`,而且**只有内容真的变了才原子写盘** —— 于是合进 main 的词库投稿(以及每周自动刷新的 star 包)不用重启、不用重装、也不用重发 npm 包就能到达正在运行的实例。两个环境变量控制它:

- `DSH_STATUS_ROTATOR_BANK_URL` —— 上游地址(可换成自己的镜像 / `raw.githubusercontent.com` 地址);`off` 或留空 = 关闭自动更新;
- `DSH_STATUS_ROTATOR_BANK_INTERVAL_MS` —— 检查间隔(毫秒,`0` = 关闭);不设 = 6 小时。

装载优先级变成 **内置 `config.example.json` → `config.json` → 自动更新词库 → 设置存储 → 本地词库文件**:上游更新对你没有显式改过的包立即生效;在设置页改过、或在本地词库文件里声明过的包仍然以你为准。上游新增的包会被合并进来,但在发版带上 `enabledPacks` 之前保持关闭(自动更新层刻意不带 `config` / `enabledPacks`)。同理,设置页保存时的差异基准是设置层**以下**的全部层,自动更新来的词条不会被冻结进 `settings.yaml` 冒充你的改动。

失败不会把词库打挂:CDN 不可达 / HTTP 错误 / JSON 非法 / 空文档都只记进 `remoteBankStatus()`,并继续用上一次成功拉取的副本(落盘缓存就是干这个的)。有一点需要知道:默认情况下你的机器会周期性向 jsDelivr 发 HTTPS 请求 —— 想完全本地化就设 `DSH_STATUS_ROTATOR_BANK_URL=off`(或把间隔设为 `0`)。

```
$ node scripts/verify-bank-auto-update.cjs
```

(单进程 + 本地上游:依次提供 A、B、500,断言生效词库跟着 A → B、手写本地词库仍然优先、上游挂掉后仍保留最后一份好词库。)

**持久化存储(v0.6.1 起)**:保存的设置会写入 **dsh 官方设置存储**(`$DSH_HOME/settings.yaml`,命名空间 `status-rotator`)——与 dsh 本体设置同源,**升级插件不会被清空**。之前 `config.json` 在插件目录里,用 npm / release 包升级时整个目录被替换,自定义渐变/文案/预设会全部丢失;现在通过 npm 或 release 升级不会再丢设置。插件目录的 `config.json` 保留为兼容镜像与兜底;首次启动会把已有的 `config.json` 一次性导入设置存储。

**设置存储只存差异(v0.19.1 起;v0.19.2 起真的收敛)**:设置命名空间里保存的只是「与随包默认文档 `config.example.json` 不同的那部分」,词库本身留在包里不再往 `settings.yaml` 里抄一份;装载时按 **内置默认 → 插件目录 `config.json` → 自动更新词库 → 设置存储(用户差异) → 外部词库(存在时,见上)** 的顺序合并成生效文档。带唯一 `id` 的对象数组(词库包、预设)按 **id 逐条**比:设置页提交的是完整文档,「数组整体替换」会让 12 个包整份写回,按 id 比之后只有动过的那条进存储。老安装里已经被写进去的整份词库会在首次启动时收敛:凡是随包词库里也有的词条(去空白后按条比)都当成旧版随包数据剔掉,只留用户自己写的。真机实测 82,966 B → **1,586 B**,词条零丢失(幂等,不会反复改写)。

> 版本变更史统一记在 [CHANGELOG.md](./CHANGELOG.md)。`settingsNamespace()` 在 0.16.1 修过一次静默失效(详见更新日志);升级插件后**重启一次 `dsh web`** 让 node 半区加载到新代码,客户端半区刷新页面即可。

```json
{
    "config": { "intervalMs": 10000, "typeSpeedMs": 30, "longAfterMs": 60000, "reloadIntervalMs": 15000, "liveTickMs": 1000, "weightedRandom": true, "debug": false, "fontWeight": "inherit", "gradient": { "enabled": true, "colors": ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"], "speed": 4 }, "title": { "enabled": false, "templates": ["⏳ {phaseLabel} {elapsed}", "🤔 {phaseLabel}… {elapsed}"], "idleTemplate": "💤 dsh 空闲", "intervalMs": 8000 }, "danmaku": { "enabled": true, "intervalMs": 2500, "speedMs": 18000, "fontSizeMin": 14, "fontSizeMax": 30, "rainbow": true, "colors": ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"], "color": "#ffffff", "opacity": 0.3, "maxCount": 12, "zIndex": -1, "scope": "all", "marginTop": 16, "marginBottom": 160 } },
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
| `gradient` | 见上 | 炫彩渐变:`false` / `true` / `{enabled, mode, direction, colors, dayColors, speed}`(`mode`:auto 跟随深浅色,day / night 强制;`direction`:rtl 默认 / ltr 从左向右) |
| `title` | 见上 | 标签页标题:`false` / `{enabled, templates, idleTemplate, intervalMs}` |
| `danmaku` | 见上 | 弹幕模式:`false` / `{enabled, intervalMs, speedMs, fontSizeMin, fontSizeMax, rainbow, colors, color, opacity, maxCount, zIndex, scope, marginTop, marginBottom}` |
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

- **改动即保存**:开关与下拉一改就写盘,文本和数值输入停顿 400ms 自动写盘(预设改名在失焦时写盘),没有保存按钮;正常状态下页面不显示任何保存提示,只有写盘失败时才在工具栏标红,改动会保留,等你下次改动时重试;
- 每次写盘都由浏览器把整份 JSON `PUT` 到 `/plugins/dsh-status-rotator/config.json`,node half 校验后**原子写回**,已打开的页面无需刷新、立即热应用;提交内容会做结构校验,非法内容返回 400 并在页面显示错误,不会写坏配置文件;
- 切换编辑目标会先把当前草稿落盘再切,「重读」同样先落盘再读盘,改动不会被静默丢弃;
- 数值字段边输入边校验(范围与 node half 的钳制一致),越界即标红;值偏离默认时出现「恢复默认」;
- 页面最底部的页脚直接跳 [github.com/01Virex/dsh-status-rotator](https://github.com/01Virex/dsh-status-rotator),随时能回到源码。

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
│   ├── danmaku-mount-test.html # 弹幕挂载点的真浏览器回归页(dev-only)
│   ├── label-layout-test.html  # 状态行布局回归页:锁宽/截断/配色回退/设置页渲染(dev-only)
│   ├── live-pending-test.html  # {pending} 实时刷新回归页:待作答交互 → 标签(dev-only)
│   ├── run-danmaku-mount-test.cjs # 无头驱动上述回归页(--page=danmaku|label|pending,dev-only)
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

想让你的文案进入默认词库?在 GitHub 仓库 [Issues](https://github.com/01Virex/dsh-status-rotator/issues/new/choose) 选 **「词库投稿」** 表单,填三样东西即可:

1. **语种**(zh / en / 两种都要)、**分组**(thinking / running / long / 全部三阶段)和**目标词库包**(投稿收录到哪个包,默认 `community`);
2. **文案**,一行一条(最多 60 条,支持 `{elapsed}` 等全部[模板占位符](#模板占位符));
3. (可选)署名,会记录在合并请求里,不写入词库文件。

提交后 **词库机器人** 自动接手:

- **校验**:语种/分组/格式、单条 ≤200 字符、禁止 HTML 标签 / 广告链接 / 控制字符、必须勾选提交须知、与现有词库查重;
- **归一化**:与默认词库同规范(`scripts/unify-ellipsis.cjs`)—— `...` → `…`,末尾自动补 `…`;
- **评论回复**:校验结果 + 预览表格 + **「立即试用」JSON**(粘到设置页 → 状态文案 保存,或塞进 localStorage `dsh-status-rotator.config`,立刻就能看到效果,不用等合并);
- **自动开 PR**:通过后机器人开一个改动 `config.example.json` 的合并请求(带 `词库投稿` 标签和来源 Issue 链接),**维护者点 🟢 Merge 即收录**,随下一次 npm 发版进入所有用户默认词库。

投稿只把文案追加进「社区投稿」词库包(`packs[].id = "community"`,见[词库包](#词库包)),不改成任何代码、不碰默认词库本体;格式不过的投稿会收到 ❌ 原因说明,按原表单修改后重新提交即可。被收录的投稿会在 [CONTRIBUTORS.md](./CONTRIBUTORS.md) 名单里致谢。实现见 [.github/workflows/phrase-submit.yml](.github/workflows/phrase-submit.yml) 与 [`scripts/phrase-bot.cjs`](scripts/phrase-bot.cjs)。**遇到冲突不要手改**:机器人分支只增不改,若它落后于 main,去投稿 issue 上重新打一次「词库投稿」标签即可 —— 机器人会从当前 main 重建分支并更新 PR;手工解 `config.example.json` 的冲突极易漏逗号,让整份词库变成非法 JSON(只有 `Test` 变红才发现)。

## 测试

`npm test`(或 `node scripts/smoke-test.cjs`)会在 Node 沙箱里加载 `lib/client.js`,对纯逻辑做断言:占位符插值、时长格式化、时钟解析、配置/预设/调度归一化、调度匹配,以及 node half 的配置校验——不需要浏览器。同样的测试在 CI 里每次 push / PR 自动跑(见 [.github/workflows/test.yml](.github/workflows/test.yml))。

弹幕的挂载逻辑、状态行的锁宽/截断/配色回退,以及 `{pending}` 的实时刷新都依赖运行时 DOM,纯函数测不到,因此有三个真浏览器回归页:[`scripts/danmaku-mount-test.html`](./scripts/danmaku-mount-test.html)(四档挂载时序;v0.19 起再加一档顶部 / 底部弹幕场景 —— `?modes=1` 断言居中、堆叠方向与间距、停留时长、同类上限、白字描边,以及和滚动弹幕同屏共存)、[`scripts/label-layout-test.html`](./scripts/label-layout-test.html)(打字机锁宽、超长截断、配色非法回退、设置页渲染)与 [`scripts/live-pending-test.html`](./scripts/live-pending-test.html)(真插件跑 pending 0 → 1 → 0 → 1,外加无 uiSession 服务时的兜底)。`npm run test:browser` 用 CDP 无头把三页跑完(需要本机有 Edge/Chrome),单跑用 `npm run test:browser:label` / `npm run test:browser:pending`。也可以手动打开任一页(外壳与底色面板同步出现 / 面板晚于外壳 / 外壳不画底色面板 / 外壳永不出现)并打印结果。手动跑时,`frameDelay`、`panelDelay` 分别控制外壳、底色面板晚于插件渲染的毫秒数(负数 = 永远不渲染):

```bash
msedge --headless=new --disable-gpu --virtual-time-budget=9000 \
       --dump-dom "file:///<repo>/scripts/danmaku-mount-test.html?frameDelay=1200&panelDelay=600"
```

正在运行的界面里弹幕看不见时,用 `node scripts/probe-danmaku-live.cjs "http://127.0.0.1:3080/?token=..."` 让无头浏览器挂上去,它会报出弹幕层挂在哪、层级多少、在飞几颗,以及弹幕是否真的画在底色面板之上(绘制顺序探针)。

词库维护另有一个开发期工具 `node scripts/check-bank-memes.mjs`(不在 npm 发布集):输出各分组规模(核心库 + 各词库包)、查重、缺省略号/超长条目、以及「反代/路由」等系列占比;第二个参数传候选 JSON 可在合并前与现有词库做对比。

## 卸载

从 `cordis.patch.yml` 删掉 `status-rotator` 那一行,重启 `dsh web` 即可。

## 贡献

欢迎提交 Issue 和 Pull Request。加新文案最简单的方式:直接编辑 `config.json` 或 `config.example.json` 的 `phrases` 字段,不需要动任何代码;或者用上面的 **[通过 Issue 投稿词库](#通过-issue-投稿词库)**,机器人会自动帮你校验并开好合并请求。

## 致谢

本项目的诞生离不开贡献者的帮助,详见 [CONTRIBUTORS_ZH.md](./CONTRIBUTORS_ZH.md)。

## License

[MIT](./LICENSE)
