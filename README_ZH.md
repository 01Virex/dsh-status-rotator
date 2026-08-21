# dsh-status-rotator

> [English](./README.md) | **中文**

[![npm version](https://img.shields.io/npm/v/dsh-status-rotator?color=4a6cf7)](https://www.npmjs.com/package/dsh-status-rotator)
[![npm downloads](https://img.shields.io/npm/dt/dsh-status-rotator?color=4a6cf7)](https://www.npmjs.com/package/dsh-status-rotator)
[![GitHub stars](https://img.shields.io/github/stars/01Virex/dsh-status-rotator?color=4a6cf7)](https://github.com/01Virex/dsh-status-rotator)
[![license](https://img.shields.io/github/license/01Virex/dsh-status-rotator)](LICENSE)

```bash
# 一行安装
dsh plugin --profile web add dsh-status-rotator
```

> ⭐ **要是它让你笑了一下,就给个 star 吧**——梗的能源全靠它了。

把 DeepSeek Harness(dsh)Web 界面底部回合运行时那行 `Deep diving...` 状态文字,替换成自定义文案:按回合阶段切换、打字机逐字输出、流动炫彩渐变(可关)、定时轮换,支持**模板占位符实时取值**(`{elapsed}`、`{phase}`、`{model}`、`{tps}` 等)、可选的**浏览器标签页标题**轮换、由同一实时引擎驱动的**悬浮状态 Pill**(模型/阶段/时长/token 速度),以及**带时段调度的预设词库**。运行时长时钟(15 秒后出现)不受影响。

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

## 特性

- **阶段感知**:`thinking`(刚启动)/ `running`(15s 后)/ `long`(超过阈值)三组文案,时钟出现或超时立即切换,不用等轮换间隔;
- **打字机效果**:文案逐字"打"出,速度可调,设 0 即关闭;
- **模板占位符**:`{elapsed}`(实时,按 `liveTickMs` 刷新)、`{phase}`、`{phaseLabel}`、`{locale}`、`{date}`、`{time}`,以及实时引擎字段 `{model}`、`{provider}`、`{tps}`、`{pending}`、`{tools}`、`{running}`,例如 `正在写代码 {elapsed}` 能让文案里出现走动的时长;
- **实时状态引擎**:订阅 dsh 会话快照(会话列表/对话快照/模型 RPC/DOM 时钟兜底),文案、标题与 Pill 共用同一数据源;
- **悬浮状态 Pill**:注册进官方 `shell.overlay` 座位,模板驱动的实时信息(`{model} · {phaseLabel} · {elapsed} · ⚡{tps} tok/s`),位置/透明度可配;
- **标签页标题**:用你的模板轮换 `document.title`(如 `⏳ {phase} {elapsed}`),空闲时恢复原标题(可配);
- **预设与调度**:多套命名词库(可带独立配置),设置页一键切换,或按星期/时段自动切换;
- **炫彩渐变**:文字以流动渐变显示,颜色序列与流速可配,可一键关闭;
- **文案与代码分离**:文案全在 `config.json` 里,改文案零代码、免重启;
- **设置页编辑**:在 DSH「设置」里新增「状态文案」页,中英 × 三阶段词库可视化编辑,保存即生效;
- **自动加载**:node half 注册 HTTP 路由 serve `config.json`,开箱即用,无需 localStorage 或部署;
- **热更新**:页面保持打开也会定时重读 `config.json`,切回标签页立即重读,改文案不用刷新;
- **多语言**:中英文文案跟随「设置 → 语言」实时切换,未知语言回退中文;
- **零侵入定位**:按 `role="status"` + `aria-live="polite"` 精确定位 TurnStatus,不误伤聊天记录代码片段与其它 aria-live 区域,不碰时钟。

## 阶段感知

文案按回合进展分三组(判定依据是 TurnStatus 元素里是否出现时钟及其读数):

| 阶段 | 触发条件 | 默认时长 |
|---|---|---|
| `thinking` | 回合刚启动,无时钟 | 0 ~ 15s |
| `running` | 时钟出现,未超时 | 15s ~ `longAfterMs` |
| `long` | 时钟超过 `longAfterMs` | ≥ 60s |

阶段切换会立即触发换文案,无需等轮换间隔。某阶段缺文案组时自动回退(running → thinking → 任意非空组)。

## 炫彩渐变

状态文字默认以流动的七彩渐变显示(仅作用于文案,不影响时钟)。可在配置里关闭或自定义配色:

```json
"gradient": {
    "enabled": false,                          // false 关闭;true 用默认配色
    "colors": ["#ff5f6d", "#00ff88", "#4da6ff"], // 渐变颜色序列(至少 2 个,循环首尾)
    "speed": 4                                 // 流动速度(秒/圈)
}
```

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

随时间变化的占位符(`{elapsed}`、`{date}`、`{time}`、`{tps}`、`{pending}`、`{tools}`)会按 `liveTickMs`(默认 1000 毫秒)**实时刷新**;设为 `0` 则只随轮换刷新。未知占位符原样保留,文案里写 `{...}` 是安全的。实时字段(`{model}`/`{provider}`/`{tps}`/`{pending}`/`{tools}`/`{running}`)来自**实时状态引擎**:订阅 dsh 会话快照与模型 RPC,并以 DOM 时钟兜底——会话 API 不可用时这些字段显示 `—`,插件其余功能不受影响。

```json
"phrases": { "zh": { "thinking": ["正在写代码 {elapsed}…", "正在{phaseLabel}中 ({elapsed})…"] } }
```

## 浏览器标签页标题

可选:回合进行中让标签页标题也轮换:

```json
"title": {
    "enabled": true,
    "templates": ["⏳ {phase} {elapsed}", "🤔 {phaseLabel}… {elapsed}"], // 每 intervalMs 换一条
    "idleTemplate": "💤 dsh 空闲",   // 无回合时显示;"" = 恢复原标题
    "intervalMs": 8000
}
```

模板支持与文案相同的占位符。没有回合进行中时显示 `idleTemplate`,设为 `""` 则恢复原始标题。`title: false` 完全关闭。

## 悬浮状态 Pill

一个悬浮 Pill(官方 `shell.overlay` 座位——文档明示 status pill 属于此处)由同一实时引擎驱动:

```json
"pill": {
    "enabled": true,
    "template": "{model} · {phaseLabel} · {elapsed} · ⚡{tps} tok/s",
    "position": "right-bottom",   // right-bottom / left-bottom / right-top / left-top
    "opacity": 0.92
}
```

模板支持全部文案占位符(含实时引擎字段 `{model}`、`{provider}`、`{tps}`、`{pending}`、`{tools}`)。回合进行中实时显示:**模型名**(来自官方模型目录服务,切换会话/换模型自动跟随)、**阶段**(`thinking`/`running`/`long`)、**已运行时长**与**流式 token 速度**——阶段与时长由实时引擎按**回合开始时刻**推导(基于会话快照,不依赖 DOM 结构);空闲时显示 `— · 空闲 · 0秒 · ⚡0 tok/s`。`pill: false` 关闭。会话 API 不可用(旧版 dsh)时,DOM 时钟兜底驱动阶段/耗时,实时字段显示 `—`——不报错、不崩溃。

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
    "config": { "intervalMs": 10000, "typeSpeedMs": 30, "longAfterMs": 60000, "reloadIntervalMs": 15000, "liveTickMs": 1000, "debug": false, "gradient": { "enabled": true, "colors": ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"], "speed": 4 }, "title": { "enabled": false, "templates": ["⏳ {phaseLabel} {elapsed}"], "idleTemplate": "", "intervalMs": 8000 }, "pill": { "enabled": true, "template": "{model} · {phaseLabel} · {elapsed} · ⚡{tps} tok/s", "position": "right-bottom", "opacity": 0.92 } },
    "phrases": { "zh": { "thinking": ["…"], "running": ["…"], "long": ["…"] }, "en": { "thinking": ["…"], "running": ["…"], "long": ["…"] } },
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
| `liveTickMs` | 1000 | 实时占位符(`{elapsed}` / `{date}` / `{time}` / `{tps}` 等)在文案、标题与 Pill 里的刷新间隔(毫秒),0 关闭 |
| `debug` | false | 控制台诊断日志 |
| `gradient` | 见上 | 炫彩渐变:`false` / `true` / `{enabled, colors, speed}` |
| `title` | 见上 | 标签页标题:`false` / `{enabled, templates, idleTemplate, intervalMs}` |
| `pill` | 见上 | 悬浮状态 Pill:`false` / `{enabled, template, position, opacity}` |
| `phrases` | 来自配置文件 | 文案(中英 × 三阶段;可只写部分,缺的用其它源回退) |
| `presets` | 无 | 命名词库,每项可带独立的 `config` / `phrases` |
| `activePreset` | null | 当前启用的预设(`null` = 用顶层 config/phrases) |
| `schedule` | 无 | 自动切换预设的时段规则 |

文案来源优先级,从高到低:

1. **localStorage 单条覆盖** `dsh-status-rotator.texts[.<locale>]` / `texts`;
2. **localStorage 完整配置** `dsh-status-rotator.config`(粘贴 JSON,刷新生效);
3. **外部 JSON**:`dsh-status-rotator.url` > `EXTERNAL_URL` 常量 > 本地自动加载(`/plugins/dsh-status-rotator/config.json`);
4. **内置默认值**:仅 `lib/client.js` 顶部的 `DEFAULT_CONFIG`(不含文案)。

如果 localStorage 覆盖命中,外部 `config.json` 会被静默压住;新版本会在浏览器控制台输出一条 `[status-rotator] ⚠ localStorage 覆盖生效` 告警,看到它就去清掉对应键。

旧的纯文案外部 JSON(`{ "zh": [...], "en": [...] }` 或 `{ "thinking": [...] }`)依然兼容,视为"只带文案的配置"。

文案跟随「设置 → 语言」在中英文之间实时切换,未知语言回退到中文。

## 设置页编辑词库

打开 DSH 左下角「设置」,导航里会多出一页 **状态文案**:

- **中文 / English** 两个标签页,各含 `thinking` / `running` / `long` 三个文本框,**每行一句**,空行自动忽略;
- 每个阶段实时显示句数;
- 基本设置(轮换间隔、打字机速度、长任务阈值、自动重读间隔、占位符刷新间隔)也在同一页;
- **Pill 设置**:启用开关、显示模板、位置——Pill 与实时引擎占位符在同一页配置;
- **炫彩渐变设置**:启用开关、颜色序列、流动速度——不用再手动改 `config.json` 才能关渐变;
- **预设选择器**:可独立编辑每个预设的文案与配置;「设为当前」写入 `activePreset`;页面上实时显示当前生效的预设(含调度命中);
- **调度编辑器**:以列表增删「星期 + 时段」规则,自动切换预设;
- 点「保存词库」后,浏览器把整份 JSON `PUT` 到 `/plugins/dsh-status-rotator/config.json`,node half 校验后**原子写回**,已打开的页面无需刷新、立即热应用;
- 提交内容会做结构校验(phrases 必须是字符串数组,presets/schedule 结构必须合法),非法内容返回 400 并在页面显示错误,不会写坏配置文件。

升级到带设置页的版本后,需要重启一次 `dsh web`(让 node half 注册写接口),之后全部在页面里操作即可。

## QQ 群成员文案生成器

想要把某个 QQ 群的每个成员变成一句 `正在路由（群成员）写代码...` 文案时,用 `scripts/fetch-qq-group.cjs` 一键生成独立配置文件,不用手抄群成员名单。

前置条件:机器人在目标群内且你有 OneBot v11 兼容 HTTP API(如 NapCat / LLOneBot / go-cqhttp / OpenShamrock)。

```bash
# 默认群号就是 684306814,直接生成 config.qq684306814.json
node scripts/fetch-qq-group.cjs --url http://127.0.0.1:3000 --token 你的token

# 直接替换插件实际使用的 config.json(旧的自动备份为 config.backup-<时间戳>.json)
node scripts/fetch-qq-group.cjs --url http://127.0.0.1:3000 --token 你的token --activate

# 没有机器人接口?把群成员名单存成 members.txt(每行一个昵称)再生成
node scripts/fetch-qq-group.cjs --input members.txt
```

| 选项 | 默认 | 说明 |
|---|---|---|
| `-g, --group` | `684306814` | QQ 群号(也读环境变量 `QQ_GROUP_ID`) |
| `-u, --url` | `http://127.0.0.1:3000` | OneBot HTTP 地址(也读 `ONEBOT_HTTP_URL`) |
| `-t, --token` | 空 | access token(也读 `ONEBOT_ACCESS_TOKEN`) |
| `-a, --action` | `get_group_member_list` | 动作路径,带前缀的框架改 `/api/...` |
| `-i, --input` | 无 | 本地名单:txt(每行一个)/ json(数组)/ csv(第一列) |
| `-o, --output` | `config.qq684306814.json` | 输出文件 |
| `--activate` | 关 | 直接写回 `config.json` 并备份旧文件 |
| `--dry-run` | 关 | 只预览不写文件 |

显示名优先取群名片,没有群名片再取昵称。生成的文件只有 `zh.thinking` 一组:按照本插件的回退规则,thinking 阶段直接用,其余阶段自动回退到同一组。模板见 `config.qq684306814.example.json`;生成产物 `config.qq684306814.json` 已被 `.gitignore` 忽略。

## 项目结构

```
dsh-status-rotator/
├── lib/
│   ├── index.js            # node half:注册 config.json 的 HTTP 路由(GET/PUT,带校验)
│   └── client.js           # client half:状态文字替换 / 占位符 / 渐变 / 标题 / 预设
├── config.example.json     # 完整模板(默认配置 + 全部文案,入库)
├── config.qq684306814.example.json  # QQ 群成员文案模板(scripts/fetch-qq-group.cjs 生成正式文件)
├── config.json             # 本地个性化配置(被 .gitignore 忽略)
├── gen-config.cjs          # 初始化 config.json 的脚本
├── scripts/
│   ├── fetch-qq-group.cjs  # 抓取 QQ 群成员并生成文案配置
│   └── smoke-test.cjs      # 纯函数冒烟测试(npm test)
├── package.json
├── README.md               # 英文文档
├── README_ZH.md            # 中文文档
├── CONTRIBUTORS.md         # 英文贡献者
├── CONTRIBUTORS_ZH.md      # 中文贡献者
└── LICENSE
```

## 测试

`npm test`(或 `node scripts/smoke-test.cjs`)会在 Node 沙箱里加载 `lib/client.js`,对纯逻辑做断言:占位符插值、时长格式化、时钟解析、配置/预设/调度归一化、调度匹配,以及 node half 的配置校验——不需要浏览器。同样的测试在 CI 里每次 push / PR 自动跑(见 [.github/workflows/test.yml](.github/workflows/test.yml))。

## 卸载

从 `cordis.patch.yml` 删掉 `status-rotator` 那一行,重启 `dsh web` 即可。

## 贡献

欢迎提交 Issue 和 Pull Request。加新文案最简单的方式:直接编辑 `config.json` 或 `config.example.json` 的 `phrases` 字段,不需要动任何代码。

## 致谢

本项目的诞生离不开贡献者的帮助,详见 [CONTRIBUTORS_ZH.md](./CONTRIBUTORS_ZH.md)。

## License

[MIT](./LICENSE)
