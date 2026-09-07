# dsh-status-rotator

> [English](./README.md) | **中文**

[![npm version](https://img.shields.io/npm/v/dsh-status-rotator?color=4a6cf7)](https://www.npmjs.com/package/dsh-status-rotator)
[![npm downloads](https://img.shields.io/npm/dt/dsh-status-rotator?color=4a6cf7)](https://www.npmjs.com/package/dsh-status-rotator)
[![GitHub stars](https://img.shields.io/github/stars/01Virex/dsh-status-rotator?color=4a6cf7)](https://github.com/01Virex/dsh-status-rotator)
[![license](https://img.shields.io/github/license/01Virex/dsh-status-rotator)](LICENSE)
[![status](https://img.shields.io/badge/status-%E7%A8%B3%E5%AE%9A%E7%89%88-2ecc71)](https://www.npmjs.com/package/dsh-status-rotator)

```bash
# 一行安装
dsh plugin --profile web add dsh-status-rotator
```

**v0.15.0 — 稳定版**(v0.14.2 → v0.15.0:悬浮状态 Pill 下线,代码注释保留可随时恢复;实时引擎与 `{model}` / `{tps}` 等占位符继续支持文案与标签页标题)

> ⭐ **要是它让你笑了一下,就给个 star 吧**——梗的能源全靠它了。

一个 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 客户端插件,把 Web 界面底部回合运行时那行硬编码的 `Deep diving...` 状态文字,替换成你自己的文案库:按回合阶段切换、打字机逐字输出、定时轮换、加权随机抽取、带实时取值的模板占位符、流动炫彩渐变、视频网站风格的弹幕,以及一个同时喂给文案和浏览器标签页标题的实时状态引擎。界面自带的运行时长时钟(15 秒后出现)不受影响。

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

- **炫彩渐变** — 文字以流动渐变显示,颜色序列与流速可配,一键关闭;
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
- **Release 打包产物**:从 Release 页下载打包好的 tgz,再执行 `dsh plugin --profile web add /path/to/dsh-status-rotator-<版本>.tgz`。

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

首次启动时,插件会 serve 包目录下的 `config.json`(默认的全部 886 条文案都在里面,见[词库现状](#词库现状))。调文案或选项,可以直接改这个文件(页面打开时热更新),也可以去 DSH 左下角「设置」里的新页面 **状态文案** 操作,见[设置页](#设置页)。

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

默认词库当前共 **886 条**,拆为 **10 个主题词库包**(核心 `phrases` 表为空——词条全部住在包里,缺省全部启用):

| 词库包 | zh | en | 小计 |
| --- | --- | --- | --- |
| `deepseek` DeepSeek 专场 | 103 | 111 | 214 |
| `coding` 写代码日常 | 84 | 81 | 165 |
| `daily` 日常 | 77 | 64 | 141 |
| `internet-memes` 网络梗 | 54 | 33 | 87 |
| `sysadmin` 系统管理 | 41 | 38 | 79 |
| `slacking` 摸鱼 | 36 | 29 | 65 |
| `math-physics` 数学与物理 | 31 | 18 | 49 |
| `western-ai` 西方 AI 圈 | 16 | 18 | 34 |
| `reverse-proxy` 反代 | 14 | 16 | 30 |
| `china-ai` 中国 AI 圈 | 12 | 10 | 22 |
| **合计** | **468** | **418** | **886** |

- 大部分条目 zh/en 成对镜像;近期社区投稿常为中文单语——投稿表单选「**zh + en (两种都要)**」即可双语收录;
- 含 5 条加权示范条目(见[加权随机](#加权随机)),其余均为默认权重 1 的纯文案;
- 词库通过社区[投稿表单](#通过-issue-投稿词库)持续增长:校验通过并合入的投稿会在 [CONTRIBUTORS.md](./CONTRIBUTORS.md) 名单里致谢;
- 统计随每次发版刷新;本地用 `node scripts/check-bank-memes.mjs` 可随时审计当前词库(查重/超长/省略号/系列占比)。

## 词库包

词库可在核心 `phrases` 之上按具名「词库包」组合:

```jsonc
{
    "packs": [
        { "id": "community",
          "label": { "zh": "社区投稿", "en": "Community" },
          "phrases": { "zh": { "running": ["正在试用词库包…"] } } }
    ],
    "enabledPacks": ["community"]   // 缺省 = 全部包启用
}
```

- 启用的包按顺序并入生效词库,**按文本去重**——核心库(或更早的包)已存在的条目会被跳过,保留其权重;
- `enabledPacks` 缺省/`null` = 全部启用;`[]` = 只用核心库;名单里的未知 id 直接忽略;
- 包内条目与核心库完全同构(字符串或 `{text, weight}`、三阶段分组、占位符);
- 设置页列出每个包:**逐个启用开关** + **包编辑目标**(选中某包后,词库编辑区读写该包文案);
- 默认配置自带 **10 个包**(`deepseek` / `western-ai` / `china-ai` / `coding` / `reverse-proxy` / `sysadmin` / `math-physics` / `slacking` / `internet-memes` / `daily`),核心表为空——关掉某包就真的从词池里移除该主题;
- 投稿表单的**「目标词库包」**选择器含同样 10 个包 + `community`(默认落点):投稿进入所选包,`community` 包在首次使用时自动创建——核心词库本体不被改动,想关掉或裁剪社区内容一处搞定;
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
| `{pending}` | 待审批/待提问数(实时引擎) | `1` |
| `{tools}` | 正在运行的工具名,`+` 连接(实时引擎) | `bash+web_search` |
| `{running}` | `run` / `idle`(实时引擎) | `run` |
| `{locale}` | 当前界面语言(`zh` / `en`) | `zh` |
| `{date}` | 本地日期 `YYYY-MM-DD` | `2026-08-07` |
| `{time}` | 本地时间 `HH:MM:SS` | `12:34:56` |

随时间变化的占位符(`{elapsed}`、`{date}`、`{time}`、`{tps}`、`{pending}`、`{tools}`、`{model}`、`{provider}`)会按 `liveTickMs`(默认 1000 毫秒)**实时刷新**;设为 `0` 则只随轮换刷新。未知占位符原样保留,文案里写 `{...}` 是安全的。实时字段来自**实时状态引擎**:订阅 dsh 会话快照与模型 RPC,并以 DOM 时钟兜底——会话 API 不可用时这些字段显示 `—`,插件其余功能不受影响。

```json
"phrases": { "zh": { "thinking": ["正在写代码 {elapsed}…", "正在{phaseLabel}中 ({elapsed})…"] } }
```

## 炫彩渐变

状态文字默认以流动的七彩渐变显示(仅作用于文案,不影响时钟)。可在配置里关闭或自定义配色:

```json
"gradient": {
    "enabled": false,                          // false 关闭;true 用默认配色
    "colors": ["#ff5f6d", "#00ff88", "#4da6ff"], // 渐变颜色序列(至少 2 个,循环首尾)
    "speed": 4                                 // 流动速度(秒/圈)
}
```

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
    "marginBottom": 160        // 底部留白(px),避开输入区
}
```

- `zIndex` 为负(默认)时,弹幕层挂进 dsh 应用主框架内部,夹在**应用背景与聊天内容**之间:弹幕在空隙和聊天后面可见,不会盖住气泡或侧边栏。如果主题背景不透明导致看不到,把 `zIndex` 调成非负数即可浮到界面之上——弹幕层 `pointer-events: none`,永远不拦截鼠标操作;
- 弹幕文案支持与状态文案相同的占位符(`{elapsed}`、`{model}`、`{phase}`…),发射时用实时引擎当前值渲染;
- `danmaku: false` 完全关闭;`fontSizeMin` / `fontSizeMax` 构成随机字号区间(写反了自动纠正,并钳制到 8~96 px)。

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

## 悬浮状态 Pill(已下线)

> **v0.15.0 起,悬浮状态 Pill 已从界面移除**(`shell.overlay` 注册、设置页配置与文档配置均已下线;实现代码在 `lib/client.js` 中以注释保留,需要时可恢复)。**实时状态引擎不受影响**:`{model}`、`{provider}`、`{tps}`、`{pending}`、`{tools}` 等实时占位符依然可用(文案与标签页标题),`liveTickMs` 控制刷新节奏。

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

**持久化存储(v0.6.1 起)**:保存的设置会写入 **dsh 官方设置存储**(`$DSH_HOME/settings.yaml`,命名空间 `status-rotator`)——与 dsh 本体设置同源,**升级插件不会被清空**。之前 `config.json` 在插件目录里,用 npm / release 包升级时整个目录被替换,自定义渐变/文案/预设会全部丢失;现在通过 npm 或 release 升级不会再丢设置。插件目录的 `config.json` 保留为兼容镜像与兜底;首次启动会把已有的 `config.json` 一次性导入设置存储。

```json
{
    "config": { "intervalMs": 10000, "typeSpeedMs": 30, "longAfterMs": 60000, "reloadIntervalMs": 15000, "liveTickMs": 1000, "weightedRandom": true, "debug": false, "fontWeight": "inherit", "gradient": { "enabled": true, "colors": ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"], "speed": 4 }, "title": { "enabled": false, "templates": ["⏳ {phaseLabel} {elapsed}", "🤔 {phaseLabel}… {elapsed}"], "idleTemplate": "💤 dsh 空闲", "intervalMs": 8000 }, "danmaku": { "enabled": true, "intervalMs": 2500, "speedMs": 18000, "fontSizeMin": 14, "fontSizeMax": 30, "rainbow": true, "colors": ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"], "color": "#ffffff", "opacity": 0.3, "maxCount": 12, "zIndex": -1, "scope": "all", "marginTop": 16, "marginBottom": 160 } },
    "phrases": { "zh": { "thinking": ["…"], "running": ["…"], "long": ["…"] }, "en": { "thinking": ["…"], "running": ["…"], "long": ["…"] } },
    "packs": [],            // 可选,见「词库包」(默认配置自带 10 个主题包)
    "enabledPacks": null,   // null/缺省 = 全部启用,[] = 只用核心库
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
| `gradient` | 见上 | 炫彩渐变:`false` / `true` / `{enabled, colors, speed}` |
| `title` | 见上 | 标签页标题:`false` / `{enabled, templates, idleTemplate, intervalMs}` |
| `danmaku` | 见上 | 弹幕模式:`false` / `{enabled, intervalMs, speedMs, fontSizeMin, fontSizeMax, rainbow, colors, color, opacity, maxCount, zIndex, scope, marginTop, marginBottom}` |
| `phrases` | 来自配置文件 | 文案(中英 × 三阶段;可只写部分,缺的用其它源回退) |
| `packs` | 无 | 词库包:`[{ id, label?, phrases? }]`,按顺序并入生效词库(按文本去重) |
| `enabledPacks` | null(全部) | 已启用的词库包;`null`/缺省 = 全部,`[]` = 只用核心词库 |
| `presets` | 无 | 命名词库,每项可带独立的 `config` / `phrases` |
| `activePreset` | null | 当前启用的预设(`null` = 用顶层 config/phrases) |
| `schedule` | 无 | 自动切换预设的时段规则 |

文案来源优先级,从高到低:

1. **localStorage 单条覆盖** `dsh-status-rotator.texts[.<locale>]` / `texts`;
2. **localStorage 完整配置** `dsh-status-rotator.config`(粘贴 JSON,刷新生效);
3. **外部 JSON**:`dsh-status-rotator.url` > `EXTERNAL_URL` 常量 > 本地自动加载(`/plugins/dsh-status-rotator/config.json`);
4. **内置默认值**:仅 `lib/client.js` 顶部的 `DEFAULT_CONFIG`(不含文案)。

如果 localStorage 覆盖命中,外部 `config.json` 会被静默压住;新版本会在浏览器控制台输出一条 `[status-rotator] ⚠ localStorage 覆盖生效` 告警,看到它就去清掉对应键。

旧的纯文案外部 JSON(`{ "zh": [...], "en": [...] }` 或 `{ "thinking": [...] }`)依然兼容,视为"只带文案的配置"(扁平数组落到 `thinking` 组)。

文案跟随「设置 → 语言」在中英文之间实时切换,未知语言回退到中文。

## 设置页

打开 DSH 左下角「设置」,导航里会多出一页 **状态文案**:

- **中文 / English** 两个标签页,各含 `thinking` / `running` / `long` 三个文本框,**每行一句**,空行自动忽略;行内写 `文案 | 权重` 可设置该句权重;
- 每个阶段实时显示句数;
- 基本设置(轮换间隔、打字机速度、长任务阈值、自动重读间隔、占位符刷新间隔、字体粗细、加权随机开关)也在同一页;
- **炫彩渐变设置**:启用开关、颜色序列、流动速度——不用再手动改 `config.json` 才能关渐变;
- **弹幕设置**:启用开关、发射间隔、穿越时长、随机字号范围、炫彩开关 + 色板、透明度、同屏上限、层级与文案范围——全部可视化配置,保存即热生效;
- **词库包控制**:每个包都有启用开关和编辑目标;词库编辑区读写当前选中的包(默认词库为空时自动选中第一个包);
- **预设选择器**:可独立编辑每个预设的文案与配置;「设为当前」写入 `activePreset`;页面上实时显示当前生效的预设(含调度命中);
- **调度编辑器**:以列表增删「星期 + 时段」规则,自动切换预设;
- 点「保存词库」后,浏览器把整份 JSON `PUT` 到 `/plugins/dsh-status-rotator/config.json`,node half 校验后**原子写回**,已打开的页面无需刷新、立即热应用;
- 提交内容会做结构校验(phrases 必须是字符串数组,presets/schedule 结构必须合法),非法内容返回 400 并在页面显示错误,不会写坏配置文件。

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
│   │   └── test.yml            # 每次 push / PR 跑 npm test
│   └── ISSUE_TEMPLATE/
│       └── phrase-submit.yml   # 「词库投稿」表单模板(自动打 词库投稿 标签)
├── lib/
│   ├── index.js            # node half:注册 config.json 的 HTTP 路由(GET/PUT,带校验)
│   └── client.js           # client half:状态文字替换 / 占位符 / 渐变 / 标题 / 弹幕 / 预设
├── config.example.json     # 完整模板(默认配置 + 全部 886 条文案,分 10 个词库包,入库)
├── config.json             # 本地个性化配置(被 .gitignore 忽略)
├── gen-config.cjs          # 初始化 config.json 的脚本
├── cordis.patch.yml        # dsh bundle patch manifest(被 package.json 的 dsh.bundle.patch 引用)
├── scripts/
│   ├── fetch-qq-group.cjs  # 抓取 QQ 群成员并生成文案配置
│   ├── check-bank-memes.mjs # 词库质检(开发期):查重/超长/省略号/系列占比
│   ├── package-release.cjs # 打包发布文件
│   ├── phrase-bot.cjs      # 词库投稿机器人(解析表单 / 校验 / 写入词库 / 开 PR)
│   ├── smoke-test.cjs      # 纯函数冒烟测试(npm test)
│   └── unify-ellipsis.cjs  # 默认词库省略号统一 / 完整性校验
├── package.json
├── README.md               # 英文文档
├── README_ZH.md            # 中文文档
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

投稿只把文案追加进「社区投稿」词库包(`packs[].id = "community"`,见[词库包](#词库包)),不改成任何代码、不碰默认词库本体;格式不过的投稿会收到 ❌ 原因说明,按原表单修改后重新提交即可。被收录的投稿会在 [CONTRIBUTORS.md](./CONTRIBUTORS.md) 名单里致谢。实现见 [.github/workflows/phrase-submit.yml](.github/workflows/phrase-submit.yml) 与 [`scripts/phrase-bot.cjs`](scripts/phrase-bot.cjs)。

## 测试

`npm test`(或 `node scripts/smoke-test.cjs`)会在 Node 沙箱里加载 `lib/client.js`,对纯逻辑做断言:占位符插值、时长格式化、时钟解析、配置/预设/调度归一化、调度匹配,以及 node half 的配置校验——不需要浏览器。同样的测试在 CI 里每次 push / PR 自动跑(见 [.github/workflows/test.yml](.github/workflows/test.yml))。

词库维护另有一个开发期工具 `node scripts/check-bank-memes.mjs`(不在 npm 发布集):输出各分组规模(核心库 + 各词库包)、查重、缺省略号/超长条目、以及「反代/路由」等系列占比;第二个参数传候选 JSON 可在合并前与现有词库做对比。

## 卸载

从 `cordis.patch.yml` 删掉 `status-rotator` 那一行,重启 `dsh web` 即可。

## 贡献

欢迎提交 Issue 和 Pull Request。加新文案最简单的方式:直接编辑 `config.json` 或 `config.example.json` 的 `phrases` 字段,不需要动任何代码;或者用上面的 **[通过 Issue 投稿词库](#通过-issue-投稿词库)**,机器人会自动帮你校验并开好合并请求。

## 致谢

本项目的诞生离不开贡献者的帮助,详见 [CONTRIBUTORS_ZH.md](./CONTRIBUTORS_ZH.md)。

## License

[MIT](./LICENSE)
