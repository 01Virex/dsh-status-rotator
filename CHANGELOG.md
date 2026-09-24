# 更新日志

本文件记录 dsh-status-rotator 的每个版本改了什么。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/);安装与配置见 [README_ZH.md](./README_ZH.md)。

最新发布见 [GitHub Releases](https://github.com/01Virex/dsh-status-rotator/releases);词库条数在每次发版时同步刷新。

## [0.26.0] - 2026-09-24

### 新功能

- **状态行文案来源 `labelSource`**:`"phrases"`(默认,轮换短语库)/ `"host"`
  (只用宿主原文 `Deep diving...` / `深度求索中`,完全不轮换)。设置页「状态文案」页签里有同名下拉框,
  `config.json` 与预设里也能直接写。
  `"host"` 不只是换文案 —— 插件自己那条线的外观**逐项对齐 dsh 0.1.6 的 `.turnStatus`**
  (`packages/client/ui-chat` 的 `ChatView.module.css`,原文已逐条核对):
  - `font: var(--dsw-font-s-strong-14)` —— 即 `500 14px/22px <family>`,**字重是 500**;
    插件此前硬编码 `font-weight: 600`,比旧版粗一档(这次一并改掉);
  - `height: calc(26px + var(--dsh-content-font-delta,0px))`、`display: inline-flex`、
    `align-items: center`、`flex: none`、`white-space: nowrap`;
  - 同一套 shimmer 渐变(`linear-gradient` 的四个色标、`background-size: 250% 100%`、
    `background-position: 100% 0`、`1.8s linear infinite`、`background-clip: text`)与
    `prefers-reduced-motion` 降级;
  - 时钟照抄 `.turnStatusClock`:`font: var(--dsw-font-xs-13)`、13px、
    `line-height: calc(20px + …)`、`tabular-nums`、caption 色、`margin-left: 8px`、400 字重;
    并且**按旧版时机出现** —— 0.1.6 是 `elapsedMs >= 15e3` 才渲染时钟,`"host"` 模式照做。
  - 文案直接落字、不走打字机(旧版就是「一上来就写着」的观感)。
  - 旧宿主(≤0.1.6)在 `"host"` 模式下**完全不碰**:它的 `role="status"` 本来就写着宿主原文,
    插件既不改文案也不加渐变。

### 修复

- **状态行不再变成一条空行:没有文案可轮换时回落宿主原文**(「deep diving 不见了」)。
  0.1.7 上插件会藏掉宿主那行、改成自己在输入框上方画一条线;一旦短语库为空
  (典型场景:插件装上了但没 `config.json`),`textsForPhase()` 返回 null → `refresh()`
  直接 return —— 那条线就只剩时钟、一个字都没有,而宿主的「Deep diving for 12s」已经被藏了。
  现在 `"phrases"` 模式同样回落宿主原文,不再是空行;旧宿主(≤0.1.6)保持「不碰」策略。
- **适配 dsh 0.1.7-rc.1**。rc.1 把回合行的渲染条件改了(对照 `TurnProcessNodeView` 源码):
  - alpha 时代:`if (!turnProcess.foldable) return null` —— 没有可折叠内容的回合**什么都不渲染**;
  - rc.1:`if (turn?.start === void 0 && turn?.status !== "closed") return null` —— **每个**回合都渲染,
    且 `canCollapse = foldable && hasContent && !alwaysOpen`,不能折叠时按钮带 `disabled`、
    `data-open` 恒为 true、不渲染 chevron(`open = !foldable || open`)。
  插件依赖的 DOM 契约(`button[data-turn-process]` > `span.label`,标签文本每秒被整段重写)未变,
  接管 / 释放逻辑照常工作;回归页按 rc.1 源码与 CSS 重做夹具并新增一档锁死这个差异。

### 测试

- 冒烟 311 → **319 通过 / 0 失败**:新增 `labelSource` 白名单(`normalizeConfig` / node 半区
  `sanitizeConfigDocument`,含预设内)与 `labelPlanFor` 决策表(短语库有无 × 是否插件自己的线 ×
  两种来源模式,共 8 组)。
- 0.1.7 真浏览器回归 11 → **15 档全过**:
  - `?case=running-simple` —— rc.1 的 `disabled` + `data-open` + 无 chevron 简回合,照样被接管;
  - `?case=no-phrases` —— 完全没有文案来源时,状态行回落宿主原文(不再是空行);
  - `?case=host-only` / `?case=host-only-clock` —— `labelSource: "host"` 下,把插件那条线与页面里
    一份**逐字同构的 0.1.6 `.turnStatus` 参考元素**做 computed style 逐项比对(字体族 / 字重 /
    字号 / 行高 / 盒高 / display / 渐变 / 动画 / 时钟的每一项),并断言字重 = 500;
    时钟按旧版 15 秒时机出现(两种 elapsed 各一档)。
  - 夹具保真度同时修正:旧宿主的 `.EvIC1a_turnStatus` 改为照抄真实 token
    (`--dsw-font-s-strong-14` = `500 14px/22px <family>`),此前夹具写的是 600 —— 正是因为夹具错了,
    插件把字重写成 600 才一直没被发现。
- 弹幕回归页 13 档全过,既有挂载 / 顶底弹幕 / 标签布局 / pending 套件无回归。

## [0.25.0] - 2026-09-22

### 新功能

- **观测通道:把重试从 `Deep diving…` 后面拎出来**(参考
  [deepseek-harness discussion #3669](https://github.com/deepseek-ai/deepseek-harness/discussions/3669))。
  那份讨论的结论是:重试 / 传输降级这些状态今天只躺在 host stderr 里,缺的是**结构化数据通道**,
  而「渲染」这半外部插件自己就能做。这条正好落在本插件身上,于是按讨论里的三条原则实现:
  - **只吃协议事件**:从客户端会话绑定的事件窗口(`binding.eventSource`)里读
    `llm/retry` / `llm/retry-started`(dsh-llm-retry 追加的结构化事件),**不解析任何日志或界面文本**;
  - **词汇表 provider 中立**:`provider` / `code` 原样透传,不枚举产品专属码;`failure.message`
    绝不出境,`code` 还要过一道「短 token」脱敏(URL / 路径 / 凭据一律丢弃);
  - **显式降级**:拿不到事件窗口的宿主上什么都不显示(不猜次数),`step/start`、`turn/end`、
    `assistant/message` 到达即清空。
- **状态行徽标**:时钟后面加一枚小胶囊,模板由 `config.details.badge` 决定(默认
  `⟳ {retry}/{max}`,空串 = 不显示徽标、只留占位符);新旧宿主都渲染(0.1.7 的状态行与
  ≤0.1.6 的 `role=status` 状态行)。
- **新占位符**:`{retry}`、`{retryMax}`、`{retryProvider}`、`{retryCode}`、`{detail}` ——
  文案与标题模板都能用,例如 `"正在重试 {retry}/{retryMax}…"`。
- **配置**:`config.details = { enabled, badge }`;`config.example.json` 同步。

### 修复

- **设置弹窗持续闪烁:弹幕层在全屏 `backdrop-filter` 遮罩后面**([#60](https://github.com/01Virex/dsh-status-rotator/issues/60))。
  dsh 的设置弹窗遮罩是「`position:fixed; inset:0; z-index:1000` 容器 + `position:absolute; inset:0;
  backdrop-filter:blur(2px)` 子层」,遮罩本身只有 24%(浅色)/ 50%(深色)不透明;弹幕层在它后面
  每 2.5 秒发一颗、每颗横穿 18 秒,浏览器于是每帧重算整屏模糊 —— 表现就是设置弹窗一直闪
  (停用插件即恢复,正是这个原因)。新增 `danmaku.pauseBehindMask`(默认 **true**):检测到
  「铺满视口 + 自带 `backdrop-filter`」的宿主层就**整体停摆弹幕** —— 拆掉弹幕层与在途条目
  (连同它们的 CSS 过渡)、清掉发射定时器、还原挂载点上的 `isolation`;遮罩一关掉立刻重建并继续发射。
  - **检测**:视口四角 + 中心共 5 个点做命中测试(`elementsFromPoint`),只对命中栈里的元素读
    computed style —— 不遍历整棵 DOM;DOM 变更合并成 250ms 一次探针,`rescanAll` 每 2 秒兜底
    (只切样式、不增删节点的显隐也能发现)。
  - **不误伤**:菜单 / 卡片这类小面积模糊不满足「铺满视口」,铺满视口但没有模糊的浮层不满足第二条;
    顶部留空 80px 的引导遮罩(`OnboardingSurface`)同样不命中。
  - **可关**:`"danmaku": { "pauseBehindMask": false }`(设置页「弹幕」页签里也有同名开关)
    回到旧行为,弹幕在遮罩后面照跑。
- **实时引擎在 dsh 0.1.7 上一直没接上**:0.1.7 的 `sessions.list` 快照只剩
  `ids / byId / phase / projectionsBySession`,**不再有 `current`**,而插件只读 `current`
  → `connectSession` 从未被调用,`{model}` / `{tps}` / `{pending}` 这些实时字段与
  观测通道在 0.1.7 上全是死的(实测确认)。现在当前会话 id 三路取:
  `sessions.list.current`(≤0.1.6)→ `localStorage["dsh.sessions.current"]`(0.1.7 的界面
  自己记的选择)→ DOM 的 `[data-sidebar-right-session]`;并在 2 秒兜底轮询里重接一次线,
  服务晚到(0.1.7 常见)或用户切会话都能自动跟上。

### 兼容性

- **dsh 0.1.7-alpha.1**:实测 `binding.eventSource` 存在(`eventSource=true`,窗口里有事件),
  观测通道真的能跑;实时引擎经上面三路修复后接通。
- **dsh ≤0.1.6**:走 `sessions.list.current`,状态行是旧位置那行 `role=status`,
  徽标挂在它上面(回归场景 `retry-old-host` 覆盖)。
- **没有事件窗口的宿主**:静默降级(场景 `no-events`),状态行其余功能不受影响。

### 测试

- 冒烟 289 → **311 通过 / 0 失败**:新增观测通道纯函数断言(事件折叠、`retry-started` 同链校验、
  `step/start` 清空、脏数据 → null、`safeObservationToken` 脱敏、徽标模板与孤立斜杠收拾),
  以及 #60 的遮罩判定断言(`hasBackdropFilter`、`danmakuMaskOverlayHit` 的命中 / 不命中 /
  容差 / 脏数据,`pauseBehindMask` 在浏览器半区与 node 半区的归一化)。
- 真浏览器回归 8 → **11 档全过**:新增「观测通道:重试徽标出现 / 跟随窗口 / 清空」「旧宿主也显示徽标」
  「无事件窗口 → 不显示徽标、不猜次数」。
- **弹幕回归页 6 → 8 档**:新增 #60 的两档宿主遮罩场景 —— `?mask=1` 先让弹幕跑起来,再挂上与
  dsh 设置弹窗同构的全屏遮罩(`position:fixed;inset:0;z-index:1000` + 子层
  `backdrop-filter:blur(2px)` + 居中 380px 卡片),断言遮罩出现后弹幕层被拆除、在途弹幕清零、
  面板 `isolation` 还原、静置 1 秒不再发射,遮罩移除后弹幕层自动重建并重新发射;
  `?mask=1&pause=0` 是关掉 `pauseBehindMask` 的反向对照(遮罩期间必须照跑)。
- 既有弹幕 / 布局 / pending 套件无回归;线上 0.1.7 GUI 验收 11/11(状态行位置 / 对齐 / 文案 /
  时钟 / 折叠头 / 读屏公告 / 徽标节点就绪且无重试时不冒出来)。

## [0.24.0] - 2026-09-22

### 变更

- **状态行搬回 dsh 旧版位置(输入框上方、对话下方)**:0.1.7 把回合状态塞进了
  `button[data-turn-process]` —— 回合折叠头,长在回合开头;长回合里它早被滚出视口,
  「替换 deep diving」等于白替换。dsh ≤0.1.6 的状态行在另一个地方:`ChatView` 里
  `ChatNodeList` 之后渲染的 `TurnStatus`,样式 26px 高 / `nowrap` / `inline-flex` /
  自带 shimmer 渐变,时钟 13px + 8px 间距(见旧版 `.turnStatus` / `.turnStatusClock`),
  在居中内容列里靠左对齐。现在按旧版来:
  - **状态行 = 插件自己的 div**,插进输入框座位(composer stack)第一位 ——
    跟着输入框常驻可见,占真实布局空间(不覆盖对话),插在输入卡片之前;
  - **水平对齐复刻旧版**:量当前会话第一条 flow 项的 x,换算成状态行的左右内边距,
    整行满宽 + 文字从消息列左边界开始(座位外那层 `display:contents` 容器也照顾到了);
  - **样式照抄旧版**:26px 高 / `nowrap` / 自带 shimmer 渐变(插件渐变打开时自动换成
    插件配色)、时钟 13px + caption 色 + 8px 间距、`tabular-nums`;
  - **回合折叠头藏起来**(`display:none`),避免同一状态出现两处;回合结束把状态行撤掉、
    折叠头放出来显示 `Took 12s` / `Worked`;
  - **时长 / 阶段仍从折叠头标签文本读**:React 每秒用 `setTextContent` 整段重写那个标签,
    插件不往标签里塞任何东西,只在旁边读它 —— 时长原样搬进状态行时钟,phase /
    `{elapsed}` / 打字机锁宽照旧;
  - 读屏公告 span(1px 的 `role="status"`,内容仍是 `Deep diving...`)不碰;
  - 0.1.6 及更早的 `role="status"` 状态行本来就在旧位置,只替换文字、不额外插行。

### 兼容性(这一版专门审了一遍)

- **dsh ≤0.1.6(旧宿主)**:状态行本来就是 `role="status"` 那一行,插件只替换它的文字、
  不额外插行 —— 位置改动对它们零影响(回归场景 `old-host`)。
- **dsh 0.1.5-rc.2 的「双结构」**:这一版其实**也有** `button[data-turn-process]`,
  但它的 label 是计数摘要(`6 tool calls` / `思考了一会儿`),不是 `Deep diving...`;
  插件按文案匹配,所以只走旧路径、既不接管也不隐藏那个折叠头(新增回归场景
  `015-coexist` 锁死这一点)。0.1.7-alpha.1 才把 `Deep diving for 12s` 搬进折叠头。
- **降级:找不到输入框座位时不硬来**:折叠头只在「状态行确实插好了」之后才隐藏 ——
  万一输入框座位不存在(布局变了 / 插件跑在非聊天页),宿主的运行中状态照旧可见,
  不会出现「藏了宿主状态、又没插件状态」的空窗(新增回归场景 `no-seat`;
  先藏后找的旧顺序已证实会让该场景变红)。
- **基准失效也有退路**:水平对齐量不到消息列(空会话 / flow 项未渲染)时退回输入卡片,
  取不到就保持上一次的内边距,不抛错。
- **旧配置 / 旧词库 / localStorage / 设置存储**:本次没动配置 schema,冒烟测试
  289 条(含 #51 二次保存回归)全绿。

### 测试

- 真浏览器回归页 `scripts/turn-process-017-test.html` 按新位置重写(夹具复刻
  `#scroll > viewArea + 座位(含 display:contents 容器)` 与折叠头;**8 档场景全部通过**):
  新增断言「状态行插在输入框座位第一位」「在输入卡片之前」「与消息列同一左边界」
  「折叠头被藏起来但仍在被宿主重写」「回合结束撤行 + 恢复折叠头」「旧宿主不额外插行」,
  外加本轮加的两档兼容场景(`015-coexist` 0.1.5 双结构、`no-seat` 座位缺失降级)。
- 纯函数冒烟 289 通过 / 0 失败;既有弹幕 / 布局 / pending 浏览器套件无回归。
- 线上验收(真 dsh 0.1.7 GUI):状态行 `line=[280,740,1113,26]` 在输入卡片
  `card=[462,780,745,36]` 上方、`paddingLeft=198px` 与消息列 `flow.x=478`
  对齐、文案与时长随宿主推进、折叠头隐藏、读屏公告仍是 `Deep diving...`。

## [0.23.6] - 2026-09-22

### 修复

- **修复 dsh 0.1.7 起「替换 deep diving 不生效」**:0.1.7 把回合状态行拆成了两半 ——
  一个 1px 视觉隐藏的 `role="status"` 读屏公告 span(内容仍是 `Deep diving...` /
  `深度求索中`),以及 `button[data-turn-process]` 里真正可见的标签
  (`Deep diving for 12s` / `深度求索中，用时12秒`,时长并进同一段文本)。
  旧逻辑只认 `role="status"`,接管的正是那个隐藏公告:文案确实被替换了,但界面上
  看不见,可见标签原样留着 —— 实测线上 0.1.7 GUI 里就是「1px 的隐藏 span 里躺着
  插件文案、旁边的标签还写着 `Deep diving for 15m 52s`」。现在:
  - **接管按钮本身**:线上实测确认 React 提交阶段对「单个字符串子节点」走的是
    `setTextContent` —— 每秒把标签元素的 `textContent` 整段重写,不是改文本节点的
    `nodeValue`。所以插件自己的 span 不能塞进标签里(会被下一次重写整个抹掉,
    连带时钟一起消失、阶段判定只能一直 thinking)。改为按 `[data-turn-process]`
    定位按钮并接管它:React 的标签元素 `display:none` 藏起来(它继续被每秒重写),
    插件自己的文案 span 与时钟 span 挂在按钮上(React 不认识它们,不会动);
  - **时长照旧**:宿主时长文本原样搬到时钟 span(`12s` / `1分02秒` / `2m 04s`),
    阶段判定、`{elapsed}` 占位符、打字机锁宽都按老路径继续工作;文案字号 / 行高
    对齐 dsh 标签自己的规则(同一组 CSS 变量,跟随「内容字号」设置);
  - **读屏公告不再被改写**:那个 1px 的 `role="status"` 公告 span 直接跳过,
    屏幕阅读器听到的仍是宿主原文;
  - **回合结束自动交还**:宿主把标签写成 `Worked` / `Took 12s` / `Stopped` / `Failed`
    时立刻撤掉插件 span/class 并恢复标签显示,结束文案重新可见;下一次回合开始由
    按钮观察器立刻接管;
  - **阶段分界保持旧版语义**:老宿主的时钟是回合开始 15 秒后才出现的,0.1.7 宿主从一开始
    就把时长写在标签里 —— 新宿主沿用同一 15 秒阈值,`thinking` → `running` 的切换点不变;
    阶段真的变化时(时钟出现 / 跨过 `longAfterMs`)立刻换文案,不等轮换间隔;
  - 0.1.6 及更早的 `role="status"` 状态行、旧配置、词库格式全部零改动兼容。

### 测试

- 纯函数冒烟测试 277 → **289 通过 / 0 失败**:新增 0.1.7 运行中标签前缀解析
  (`resolveDiveDurationPrefix`)、运行中/结束文案归类与时长提取(`matchDiveLabel`)、
  时长文本可被 `parseClock` 解析等 12 条断言。
- 新增真浏览器回归页 `scripts/turn-process-017-test.html` + 运行器
  `scripts/run-turn-process-test.cjs`(6 档场景):复刻 0.1.7 的 DOM 与「宿主每秒
  用 React `setTextContent` 把标签整段重写」的真实行为,断言接管的是按钮、React
  标签被藏起来、文案在宿主重写 ≥2 次后仍在、时钟与宿主一致、`thinking`/`running`/
  `long` 分组正确、回合结束交还宿主,以及旧宿主向后兼容。
- 线上验收(真 dsh 0.1.7 GUI,无头浏览器 + 会话 cookie):插件文案出现在运行中回合的
  状态按钮里、时钟跟随宿主时长推进、读屏公告仍是 `Deep diving...`、
  React 每秒重写后插件 span 与文案都还在。

版本 0.23.5 → 0.23.6

## [0.23.5] - 2026-09-22

### 变更

- **star 词库刷新改为走 PR**:main 已开启 required checks(`test`)并禁止强推 / 删除,直推会被拒绝;
  刷新工作流因此改为「建分支 → 提交 → 开 PR → 显式 dispatch 一次 Test → check 绿了自动合并
  (squash,失败回落 merge)」。
- 一个关键坑:`GITHUB_TOKEN` 建的 PR **不会**触发 `pull_request` 工作流,不显式 dispatch 的话
  `test` 永远不报,required check 会让 PR 永远合不进去 —— 所以 `test.yml` 增加 `workflow_dispatch`,
  `star-pack.yml` 增加 `actions: write` / `pull-requests: write` 权限。
- 规则集生效后不再需要给自动化开 bypass 口子。

版本 0.23.4 → 0.23.5


## [0.23.4] - 2026-09-22

### 变更

- **投稿分支每次从 main 重建**:机器人重跑(例如冲突后重新打标签)时不再复用旧分支,而是
  从当前 main 重新构建并 force 更新 PR 分支 —— 两条投稿同时追加文案时不会再留下需要手工
  解冲突的合并(PR #46 的手工解冲突就是 `config.example.json` 缺逗号、main 连续四次 CI 红的来源)。
  写盘后增加一次 JSON 回读自检,坏文件立刻失败,不带病开 PR。
- `Test` 工作流新增 `merge_group` 触发:仓库启用 merge queue 后,「合并后的结果」会在落地前
  先跑一遍测试,而不是等合并后才发现(需在仓库设置里开启 merge queue)。
- README 补充投稿冲突处理:别手改 `config.example.json`,重新打标签让机器人重建分支。

版本 0.23.3 → 0.23.4

## [0.23.3] - 2026-09-21

### 修复

- **修复「每次更新都重置我设置的」(issue #51)**:设置页保存后,服务端会把整份文档镜像进
  插件目录 `config.json`(兼容旧版本 / 不认设置存储的宿主),而这份镜像又是下一次保存的
  基准层之一 —— 只存「本次差异」时,用户第二次保存(改动即写盘,几乎必然发生)会发现上次的
  设置已在基准里,差异为空,于是那次设置从设置存储里消失;插件升级把 `config.json` 镜像清掉后,
  它就被随包默认值顶回来(例如关掉的弹幕又打开)。现在保存时把**上一次的差异一起并进来**
- **修复 main 上 `config.example.json` 的非法 JSON**:两条投稿(#45 / #47)同时往同一数组末尾
  追加文案,PR #46 的合并(手工解决冲突)丢了逗号,`Test` 从 #139 起连续四次失败(与插件代码
  无关,已发布版本不受影响)。补回逗号后 main 恢复绿灯 —— 机器人写盘用 `JSON.stringify`,
  不会产出这种文本,手改合并冲突后需要重跑校验。
(新的纯函数 `settingsDeltaFor`),设置存储重新成为升级后唯一可信来源。

### 测试

- 纯函数冒烟测试 274 → **277 通过 / 0 失败**:新增 issue #51 回归(二次保存 + 升级删镜像后
  设置仍在)、改回默认值以最新一次为准、自动更新词条依旧不进设置。

版本 0.23.2 → 0.23.3

## [0.23.2] - 2026-09-21

### 变更

- **根治「投稿后 CI 变红」**:新增 `scripts/sync-bank-counts.cjs` —— 从 `config.example.json`
  现算词库规模并写回 README / README_ZH 的文案与词库表、`package.json` 描述、`lib/index.js`
  注释;投稿机器人(`phrase-bot.cjs`)与 star 词库刷新(`update-star-pack.cjs` + `star-pack.yml`)
  改动词库后都会自动调用它 —— 投稿 PR 从此自带同步好的计数,不必再在合并时手改。
- `scripts/smoke-test.cjs` 的两处词库断言不再写死条数,改为与随包 `config.example.json`
  实时对比(「生效文档 == 随包」):投稿、star 刷新、手改词库都不会再让 Test 工作流变红。

### 测试

- 纯函数冒烟测试 270 → **274 通过 / 0 失败**:新增 `bankStats` / `syncTexts` 用例
  (内部自洽、加一条 +1、四文件改写 + 幂等、描述性表格不被误改)。

版本 0.23.1 → 0.23.2


## [0.23.1] - 2026-09-21

### 修复

- **修复 main 上的 Test 工作流**:投稿 #43(PR #44)把随包词库从 1077 加到 **1078 条**
  (`china-ai.zh.running` 末尾新增 1 条),但 `scripts/smoke-test.cjs` 里两处写死的总数断言
  仍是 1077 —— 「真实升级路径」用例与「生效文档仍带完整词库」用例因此失败,PR 的 `pull_request`
  run(#130)与合并后的 `push` run(#131,
  https://github.com/01Virex/dsh-status-rotator/actions/runs/35564650747)都是 **268 通过 / 2 失败**。
  两处断言同步为 **1078**。
- README / README_ZH / `package.json` 描述 / `lib/index.js` 注释里的展示计数一并同步:
  中文 565 → **566**、合计 1077 → **1078**、默认启用 890 → **891**,`china-ai` 行 15 → **16**
(小计 25 → **26**);en 512 与关闭 187 不变。

### 测试

- 纯函数冒烟测试 **270 通过 / 0 失败**(本次只改两处断言的期望值,不新增用例)。

版本 0.23.0 → 0.23.1
## [0.23.0] - 2026-09-21

### 新增

- **炫彩渐变「流动方向」可配**:`gradient` 新增 `direction` —— `rtl`(默认,从右向左,与之前
  完全一致)或 `ltr`(从左向右)。`ltr` 用 `animation-direction: reverse` 倒放同一段循环,首尾
  仍然无缝,流光方向与从左往右的打字机同向(issue #41)。设置页「炫彩渐变」区新增「流动方向」
  下拉,实时预览同步生效。

### 变更

- 渐变注入 CSS 的生成抽成纯函数 `gradientTextCss()`,运行期与测试走同一份实现,不再各写一遍。

### 测试

- 纯函数冒烟测试 262 → **270 通过 / 0 失败**:新增 7 项覆盖方向归一化(非法 / 缺省回落 `rtl`)、
  `rtl` / `ltr` 到 CSS 的映射、非法色值过滤,以及 1 项 node 半区 `sanitizeConfigDocument` 的
  `direction` 白名单。

版本 0.22.0 → 0.23.0

## [0.22.0] - 2026-09-20

### 新增

- **白天 / 黑夜两套渐变配色**:`gradient` 新增 `dayColors`(浅色主题色板,随包默认值在
  `config.example.json` / `config.json`,同色系压暗以保证浅底可读),原 `colors` 语义不变 ——
  即深色主题色板;新增 `mode`:`auto`(默认,跟随 DSH 界面的深浅色自动切换)、`day` / `night`
  (强制其中一套)。设置页「炫彩渐变」区新增「配色模式」下拉与白天 / 黑夜两个色板输入框,
  实时预览与运行时走同一套选色判定。
- **切主题即时换色**:浏览器半区监听 `body[data-ds-dark-theme]` 的增删(DSH ui-layout 切换主题时
  打 / 摘这个属性),主题一变就重算注入的渐变 CSS 并刷新已接管的文字,不用刷新页面。

### 变更

- 设置页渐变配色文案区分白天 / 黑夜;保存校验从「颜色至少 2 个」改为「两套色板各至少 2 个」,
  非法色值仍然当场拦截。
- **老配置行为不变**:没写过 `dayColors`(或只写了 `colors`)的配置,浅色主题仍沿用 `colors`,
  升级不改变既有观感;显式配了 `dayColors` 才启用两套配色。选中的色板配了但非法(< 2 个合法色)
  时仍按老规矩不接管文字(文字是 `color:transparent`,硬接管会直接看不见)。
- node 半区的颜色白名单同步覆盖 `gradient.dayColors` 与 `gradient.mode`(非法 / 未知模式一律剔除,
  老配置不受影响)。

### 测试

- 纯函数冒烟测试 252 → **262 通过 / 0 失败**:新增 10 项覆盖 `normalizeGradientMode`、
  `resolveGradientColors`(自动跟随 / 强制 / 未配色板回退 / 老配置沿用 colors / 非法颜色过滤)、
  `normalizeConfig` 新键归一化,以及 1 项 node 半区 `sanitizeConfigDocument` 的 `mode` /
  `dayColors` 白名单。

版本 0.21.0 → 0.22.0

## [0.21.0] - 2026-09-18

### 新增

- **词库自动更新**:node 半区每 6 小时从上游拉一次词库(默认 `main` 分支的
  `config.example.json`,走 jsDelivr CDN,避开 `raw.githubusercontent.com` 的可达性问题),
  校验后只留 `packs` / `phrases`,**内容真的变了才原子写盘**,并立即在内存生效 —— 合进
  main 的词库投稿、每周自动刷新的 star 包,不用重启、不用重装、也不用重发 npm 包就能到达
  运行中的实例。缓存落在 `$DSH_HOME/status-rotator/bank.remote.json`;
  `DSH_STATUS_ROTATOR_BANK_URL` 可换源或 `off` 关闭,`DSH_STATUS_ROTATOR_BANK_INTERVAL_MS`
  可改间隔或 `0` 关闭(默认 6 小时)。
- **失败保留最后一份好词库**:CDN 不可达 / HTTP 错误 / JSON 非法 / 空文档都只记状态
  (`remoteBankStatus()` 的 `lastError`),正在服务的词库不受影响;离线环境等同于没有这一层。
- **新增 `scripts/verify-bank-auto-update.cjs`**(npm 别名 `npm run verify:bank-auto-update`):
  单进程 + 本地上游,依次 A → B → 500,断言自动更新生效、手写本地词库优先、上游挂掉后
  仍保留最后一份好词库。

### 变更

- 生效文档分层补充为 **内置默认 → 插件目录 `config.json` → 自动更新词库 → 设置存储 →
  本地词库文件**:上游更新只作用于用户没有显式改过的包;设置页改过的包、本地词库文件里
  声明过的包仍然优先。
- 设置页保存的差异基准改为设置层**以下**的全部层(内置 → `config.json` → 自动更新词库):
  自动更新来的词条不会再被一次保存冻结成 `settings.yaml` 里的"用户差异",否则设置层会
  永远压住上游,那个包的自动更新就失效了。
- 自动更新层刻意不带 `config` / `enabledPacks`:上游新增的包会被合并进来,但要等发版
  带上 `enabledPacks` 才会默认启用。

### 测试

- 纯函数冒烟测试 234 → **252 通过 / 0 失败**:新增 18 项覆盖上游地址 / 间隔的默认值与关闭
  开关、缓存路径、`phraseOnlyDocument` 过滤、拉取写盘与 `updates` 计数、内容未变不重复
  写盘、网络失败 / 非 JSON / 空文档 / HTTP 500 一律保留上一次成功词库、五层优先级,以及
  「保存差异不把自动更新词条算成用户改动」。词库条数不变(12 包 **1077** 条)。
- 自动更新关闭或没有网络时,行为与 0.20.0 完全一致(路由测试与热重载验证脚本都显式关闭
  自动更新,保持无网络依赖)。

版本 0.20.0 → 0.21.0

## [0.20.0] - 2026-09-18

### 新增

- **外部词库热重载(不用重发一次 npm 包)**:node 半区新增**包外、可写**的词库层,默认路径
  `$DSH_HOME/status-rotator/phrases.json`,环境变量 `DSH_STATUS_ROTATOR_BANK` 可覆盖(绝对路径
  或相对进程工作目录)。文件与 `config.example.json` 同构,**只写要覆盖的键**即可;每次请求先比
  `mtimeNs` + size、再比内容,变更即重载,浏览器半区在下一次 `reloadIntervalMs` 轮询时拿到新内容
  ——**不重启进程、不重装包**。内置 `config.example.json` 仍是兜底:文件不存在时行为与 0.19.x
  完全一致;文件损坏时保留上一次成功加载的词库并记录错误,不会把线上词库打挂。只取文件里的
  `packs` / `phrases`,其它键(例如 `config`)忽略,运行时选项语义不变。
- **最小可复现验证**:新增 `node scripts/verify-phrase-hot-reload.cjs`(npm 别名
  `npm run verify:bank-hot-reload`)。它在同一个进程里 apply 插件、起一个真实 HTTP server,按
  GET → 写外部词库 → GET → 改写 → GET 验证热重载,全程不重启:server 注册 1 次、词库重载 2 次。
- **词库新增 1 条**:`china-ai` 包 `zh.thinking` 加「正在飞唐杰马…」(与 0.19.3 的
  「正在飞张鹏马…」同系列,中文单语),该分组 14 → **15** 条,总数 1076 → **1077**
  (中 565 / 英 512),README 表格(含 `china-ai` 行与开关合计)、npm 描述同步刷新。

### 变更

- 生效文档的分层顺序补充为 **内置默认 → 插件目录 `config.json` → 设置存储 → 外部词库**;
  外部词库是优先级最高的**词库**层(词库包按 `id` 逐条合并,只声明一个包不影响其余 11 个),
  没有该文件时分层与 0.19.x 完全相同。

### 测试

- 纯函数冒烟测试 224 → **234 通过 / 0 失败**:新增 10 项覆盖外部词库路径解析(`$DSH_HOME` /
  环境变量覆盖)、文件不存在时的内置兜底、变更检测(`mtimeNs` + size 快速路径 + 内容比对)、
  `reloads` 计数、损坏文件保留上一次成功值并记录 error、只认 `packs` / `phrases`,
  以及「外部词库覆盖设置层同名包、未声明的包原样保留」;两处词库计数断言同步为 **1077**。
- `node scripts/check-bank-memes.mjs` 审计确认新条目无重复、省略号合规、未新增超长告警
  (48 条既有超长告警与本次无关)。

版本 0.19.3 → 0.20.0

## [0.19.3] - 2026-09-18

### 变更

- **词库新增 2 条**:`china-ai` 包 `zh.thinking` 加「正在卸载偷数据的ZCode…」与「正在飞张鹏马…」(围绕
  智谱 ZCode 被曝静默上传全量 Git 历史的争议),该分组 7 → **9** 条;两条均为中文单语,总数
  1074 → **1076**(中 564 / 英 512),README 表格(含 `china-ai` 行与开关合计)、npm 描述同步刷新。

### 测试

- 纯函数冒烟测试 **224 通过 / 0 失败**:词库计数断言(生效文档「12 包 N 条」两处)随新词条同步为
  **1076**;`node scripts/check-bank-memes.mjs` 审计确认新条目无重复、无缺省略号、未新增超长告警
  (48 条既有超长告警与本次无关)。

## [0.19.2] - 2026-09-16

### 修复

- **0.19.1 的自动收敛在真实升级路径上是空转**:随包词库自己会随版本变化(0.19.1 就给 `deepseek` 加过
  词条、star 包换过排版),而 `deltaOf` 对数组是「整体替换」——老安装存在设置里的整份词库于是处处
  「不相等」,又被整份写回。真机实测:收敛前 `status-rotator` section 82,966 B,收敛后 81,926 B。
  现在收敛前会再过一遍新增的 `pruneShippedBloat`:这条词条随包词库里到底有没有?有 → 那是旧版随包
  数据,不算用户改动。同一份真机数据现在收敛到 **1,586 B**,生效文档词条 **零丢失**(老库里有 30 条
  随包没有的大小写变体,原样留成残差;用户改过的 `danmaku.intervalMs/opacity/maxCount` 与 `pill` 全在)。
  干净的 0.19.0 老安装整库:55,395 B → **37 B**(0.19.1 是 3,939 B)。
- **设置页保存会把整份词库再写回存储**:浏览器提交的是完整文档,只要有一个包被动过,「数组整体替换」
  就会让 12 个包整份进 `settings.yaml`。`deltaOf` / `mergeLayers` 现在对「元素都是带唯一 `id` 的普通
  对象」的数组按 id 逐条递归(与 dsh-settings 的对象合并同口径):只有动过的那条进存储,其余包不受
  影响;user 删掉的条目写成 `$deleted` 墓碑,合并时真删,不会被 base 顶回来。没有唯一 id 的数组
  (`enabledPacks` / `schedule`)仍然是整体替换。
- **一次性收敛不再写删除墓碑**:老安装的整库里没有某个包,只说明「那个包当时还没发布」,不是用户删的,
  收敛时不会顺手把后来新增的包删掉。

### 变更

- **设置标记升到 `settingsVersion: 2`**:0.19.1 已经写过的 section(标记为 1)会再收敛一次,之后幂等。

### 测试

- 纯函数冒烟测试 212 → **224 通过 / 0 失败**:新增 keyed 数组的差异 / 合并 / 墓碑 / 顺序 / 无 id 数组仍
  整体替换 / base 里没有该数组时墓碑不漏进生效文档、`pruneShippedBloat` 的五类判据(旧版随包数据剔空、
  用户词条与自建包保留、遗留单体词库只留残差、空壳包不留 `packs` 键),以及「真实升级路径:老库少一条 +
  用户调过开关 → 收敛成 <400 B 且生效文档仍是 12 包 1074 条」。

## [0.19.1] - 2026-09-16

### 修复

- **装载不再把整份词库塞进 `$DSH_HOME/settings.yaml`**:设置命名空间原先按顶层键整份覆盖,
  而保存/迁移提交上来的文档永远带着完整词库(12 个包 / 1074 条),于是每次装载、每次保存都把
  这份文档序列化进设置存储。默认词库现在只留在包内的 `config.example.json`,设置命名空间里
  只写**与它不同的那部分**;生效文档装载时按 **内置默认 → 插件目录 `config.json` → 设置存储**
  合并,词库与既有功能不受影响。
- **老安装的臃肿设置会自动收敛**:已经被旧版本写进设置存储的整份词库,在首次启动时一次性
  收敛成差异(幂等,之后不再改写)。用仓库里的复现脚本在临时 `$DSH_HOME` 上跑真实设置
  provider:播种旧安装的整份词库后,`settings.yaml` **55,394 B / 1306 行 → 68 B / 5 行**
  (该 section 58,777 B → 68 B),用户的改动(如 `intervalMs`)原样保留。

### 变更

- **设置文档的分层合并改为对象递归、数组整体替换**(与 dsh-settings 同口径):只有这样才能
  「只存差异」而仍还原出完整文档,`mergeDocuments(bundled, deltaOf(bundled, doc))` 与 `doc` 等价。
- **词库新增 1 条**:`deepseek` 包 `zh.thinking` 加「正在往Deepseek Harness文件里塞1000+行屎…」,
  总数 1073 → **1074**(中 562 / 英 512),README 表格、npm 描述同步。

### 测试

- 纯函数冒烟测试 199 → **212 通过 / 0 失败**:新增 `deltaOf` / `mergeLayers` / `deepEqualJson` /
  `contentTypeOf` 的差异计算、数组整体替换、往返等价、标记键不外泄,以及「生效文档仍带完整词库
  (12 包 1074 条)」。

## [0.19.0] - 2026-09-15

### 新增

- **顶部 / 底部弹幕(bilibili 风格)**:`danmaku.types` 三种类型(滚动 / 顶部 / 底部)按权重分发。顶部
  水平居中、后到的自上而下堆叠;底部水平居中、后到的自下而上堆叠;两者固定不动,到 `durationMs`
  整条消失。类型标识接受 `scroll` / `top` / `bottom` 或 bilibili 弹幕协议的 `1` / `4` / `5`;
  `danmaku.mode` 可强制只发某一种。滚动弹幕的代码路径与行为不变。
- **弹幕前层**:顶部 / 底部弹幕进独立前层,用正 `z-index`(默认 10)压在聊天内容之上,不再被消息
  气泡盖住;滚动弹幕仍在界面后面。dsh 外壳 overlay 层是 20、侧栏拖拽手柄 11,所以默认值既压得住
  聊天、又不会糊住设置弹窗;层级由 `danmaku.fixed.zIndex` 控制,设负数即塞回界面后面。
- **设置页新增弹幕类型与样式分组**:三种类型的开关与权重、强制类型下拉、顶部 / 底部样式(字号 / 颜色 /
  描边 / 边距 / 间距 / 停留时长 / 同屏上限 / 层级),以及两个行为开关;实时预览同时渲染一条顶部、
  一条底部弹幕。

### 变更

- **顶部 / 底部弹幕跟随炫彩开关**:`rainbow` 开启时与滚动弹幕共用 `colors` 色板逐颗随机取色,关闭时
  才用 `fixed.color`(默认白字)。
- **固定弹幕改用「车道」堆叠**:每条占一条空闲车道,旧的消失后车道立刻回收,不再出现「按在途高度
  累加」在中间那条提前消失时把两条弹幕叠在同一行的问题。
- **滚动弹幕避开顶部 / 底部弹幕占用的竖直带**(`fixed.reserveBands`,默认开):滚动文案不再从固定
  弹幕后面穿过;关掉即回到旧的随机落点。滚动弹幕的落点参照同时从视口高度改为弹幕层高度,和固定
  弹幕车道用同一套坐标;窗口太矮、区间被挤没时自动退回旧行为,弹幕不会消失。
- **底部弹幕贴住输入区上沿**(`fixed.anchorBottomToHost`,默认开):dsh 状态行就在输入区最上面,
  半透明弹幕压在上面时它的 shimmer 会从弹幕里透出来、看着像「特效映射到了弹幕上」;现在底边按状态行
  的位置算,量不到状态行时回落到 `marginBottom`。

### 修复

- **弹幕文字不受宿主文字特效影响**:每条弹幕显式压掉 `-webkit-text-fill-color` /
  `-webkit-text-stroke` / `animation`,外来的透明填充或动画不会渗到弹幕文字上。
- **node 半区不再丢弹幕新字段**:`sanitizeConfig` 重建 `fixed` 时会把 `zIndex` / `reserveBands` /
  `anchorBottomToHost` 一并保留,设置页保存后开关不会静默丢失。

### 测试

- 纯函数冒烟测试 178 → 199:新增 `danmakuFreeLane` / `danmakuLaneOffset` / `danmakuScrollBand` /
  `pickDanmakuMode` / `normalizeDanmakuMode` / `isSafeShadow`,以及 `mode` / `types` / `fixed` 的
  解析、钳制与向后兼容(node 半区写入侧同口径)。
- 真浏览器回归页新增两档弹幕场景(`?modes=1` 与 `?modes=1&rainbow=1`):居中、车道堆叠与回收、
  同屏不重叠、滚动弹幕不与固定带交叠、命中测试证明固定弹幕不被消息盖住、炫彩取自色板。

## [0.18.0] - 2026-09-15

### 新增

- **设置页补齐预设管理**:可直接新建、就地改名、删除预设;删除时同步清理引用它的调度规则与
  `activePreset`,不必再手改 `config.json` 才能造预设。
- **数值字段即时校验与「恢复默认」**:范围与 node half 的 `CONFIG_LIMITS` / `DANMAKU_LIMITS`
  同口径(`CONFIG_RANGES` / `DANMAKU_RANGES`),越界或非数字当场标红;值偏离默认时出现恢复按钮。

### 变更

- **调度规则改成卡片**:一条规则一张卡,预设下拉、星期药丸、起止时间与删除按钮全部收在同一行
  (原先控件会换行散落);没有规则时显示空状态提示。时间输入加宽到能完整显示 `09:00`。
- **保存改为「改动即写盘」,去掉「保存词库」按钮**:开关与下拉一改即写,文本和数值输入停顿
  400ms 自动写盘(预设改名在失焦时写盘);写盘走串行队列、按操作顺序落盘,乐观更新让界面立刻
  反映。正常状态下不显示任何保存提示(没有「保存中」「已保存」「改动即保存」这些字样),
  只有写盘失败才在工具栏标红;编辑器不再有「未保存」这一状态,失败时改动留在原地、下次改动
  自动重试(不会原地刷屏重试)。
- **设置页按语义归为四个 tab**:文案 / 外观 / 行为 / 自动化。原先九个分组竖排一页,决定文案写进
  哪里的「词库包」被排在「基本设置」之后 —— 现在编辑目标、词库、词库包、预设同处一页。
- **两个编辑目标下拉合并为一个「编辑目标」**:基础词库 / `preset:<id>` / `pack:<id>` 三选一,
  写入位置与界面所选目标一致(旧实现里预设与词库包各有一个下拉,而保存只写其中一个);
  目标失效(预设或包被删)时自动退回基础词库。
- **设置页排版对齐官方插件设置页**(`dsh-client-ui-settings-plugins`):760 列、18/600 标题、
  13/500 字段标签、输入框 h34 / `.5px` `border-l4` / `bg-layer-3` / 13px、`.5px` hairline 分隔、
  次级动作改无边框文本按钮;select 箭头改纯 CSS 折线(不再写死 `#81858C`);清掉无消费者的
  死规则(`.dsh-sr-btn-sm` / `.dsh-sr-phasehead` / `.dsh-sr-btn-primary` / `.dsh-sr-dirty` / `.dsh-sr-ok`)。

### 修复

- **定时规则不再能加成无效规则**:没有预设时「添加规则」置灰并提示先去「文案」页新建预设
  (此前点一下就会造出一条绑不到预设的规则,紧接着报「调度规则无效」);规则的目标下拉不再提供
  「默认(基础词库)」这个不合法选项,指向已删预设的旧规则显示「请选择预设」而不是错的预设名。
- **切编辑目标/预设不再静默丢草稿**:切换目标或「重读」会先把当前草稿落盘再动作,不再需要确认
  弹窗,也不会出现「改了没保存就走人」的情况。
- **锁定态补全**:保存进行中,三阶段文本框与 zh/en 语言 tab 此前仍可编辑(已补 `disabled`)。
- **调度规则校验预设存在性**:指向不存在预设的规则保存时直接报错,不再留下永不命中的规则。
- **英文 `fontWeight.invalid` 文案多一层转义**:界面曾显示字面 `\"inherit\"`,现在正常显示。

### 说明

- 本次发布合并 [mrbbbaixue](https://github.com/mrbbbaixue) 的 **PR #38**:设置页从「九个分组竖排一页」
  重排为**文案 / 外观 / 行为 / 自动化四个 tab**,「预设」与「词库包」两个各自独立的编辑目标下拉合并为
  一个「编辑目标」,排版对齐官方插件设置页(`dsh-client-ui-settings-plugins`),「保存词库」按钮换成
  **改动即写盘**。改动全部落在 `lib/client.js`(981 行改动,+623 / −358),node 半区与配置结构零改动,
  `config.json` 无需迁移。
- **npm 包首次带上 v0.17.3 的修复**:0.17.3 只发了 GitHub Release,npm 上的 `latest` 一直停在 0.17.2 ——
  所以从 npm 升级的人这一次同时拿到 0.17.3 + 0.18.0 两版内容(`{pending}` 不再恒为 `0`,实时占位符
  在取值变化的当下重渲染)。
- 词库随本次发版刷新:`star-route` 随星标名单 77 → **82** 位,总数 1063 → **1073**(中 561 / 英 512),
  npm 描述与中英文 README 表格同步。
- 回归情况:`npm test` **178 通过 / 0 失败**;真浏览器三页回归(`npm run test:browser`)全绿 ——
  弹幕挂载四档时序、标签排版三例、`{pending}` 实时刷新与无 `uiSession` 兜底。
- 贡献者统计随本次发版重新同步(139 → **145** commits,2026-09-15):`mrbbbaixue` 3 → 4(PR #38)、
  仓库账号 19 → 20、机器人 53 → 57;`CONTRIBUTORS.md` / `CONTRIBUTORS_ZH.md` 补上 PR #38 记录。
- 升级后**重启一次 `dsh web`**,再打开「设置 → 状态文案」即可看到新排版。

## [0.17.3] - 2026-09-14

### 修复

- **`{pending}` 恒为 0 修好了**:旧实现读会话快照的 `pending` 字段,而 dsh 0.1.5 的
  `SessionSnapshot` 已经没有这个字段(没有任何写入方),所以这个占位符一直硬编码输出 `0`。
  现在改读 `ctx.uiSession.pendingInteractions` —— 待作答交互的真实来源。**注意它是
  `HostObservable`(取 `getSnapshot()` 才是「SessionId → 交互」的表)**:直接对它取
  `entries` 会数到它自己的方法名,第一版改动就在这里又踩了一次。
- **实时字段不再等下一次轮换**:`setLive()` 的监听者集合此前是空的 —— 唯一的订阅者随
  v0.15.0 的悬浮 Pill 一起下线了,`{pending}` 这类事件驱动的值只能等下一次轮换才被画出来。
  现在由 `setLive()` 自己按微任务合并调度重渲染,并新增原始模板表(`liveTemplates`):
  已接管文案里的占位符已经被插值过,必须靠原始模板才能重渲染,否则等于把插值结果再插值
  一次(数值永远不变)。

### 变更

- 合并 [mrbbbaixue](https://github.com/mrbbbaixue) 的 **PR #37**:删除 v0.15.0 起以注释形式
  保留的悬浮状态 Pill 代码(`lib/client.js` 净减 160 余行,含默认配置块、归一化、中英文案、
  设置页表单、`.dsh-sr-pill*` 样式与 `shell.overlay` 注册),中英文档里的「悬浮状态 Pill
  (已下线)」小节同时移除。随 Pill 一起失去订阅者的 `liveListeners` / `subscribeLive` 机制
  也一并退役 —— `{pending}` 的重渲染由 `setLive()` 直接调度(见上)。

### 说明

- **审批策略的差异现在真的会体现在文案里**:`ask` 下审批面板等待期间 `{pending}` = 1;
  `never` 下 dsh 在派发审批瀑布前就直接判拒、客户端不建面板,所以审批贡献 0(被拒绝不是
  「待作答」),而提问与策略无关、照样计数。插件本身不读也不改权限预设。这条差异是本轮
  改动的起因,已写进中英文文档与 `pendingCountOf` 的注释。
- 新增真浏览器回归页 `scripts/live-pending-test.html`:真插件跑 pending `0 → 1 → 0 → 1`,
  外加无 `uiSession` 服务时的兜底;`npm run test:browser` 现在会跑三页,单跑用
  `npm run test:browser:pending`。
- `npm test` 新增 8 条纯函数断言,当前 **178 通过 / 0 失败**:计数语义、会话隔离、
  `null`/`undefined` 值、非 map 输入与抛错兜底、数字/字符串会话 id、`{pending}` 字符串化。
- 贡献者统计随本次发版重新同步(133 → **139** commits,2026-09-14):`mrbbbaixue` 2 → 3
  (PR #37)、仓库账号 18 → 19、机器人 49 → 53;`CONTRIBUTORS.md` / `CONTRIBUTORS_ZH.md`
  补上 PR #37 与重新同步的 API 方法。
- `scripts/package-release.cjs` 的文件清单与 `package.json` 的 `files` 对齐:补上
  `lib/index.d.ts`(此前解压安装的产物缺类型入口)与 `CHANGELOG.md`。

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

[0.19.2]: https://github.com/01Virex/dsh-status-rotator/compare/v0.19.1...v0.19.2
[0.19.1]: https://github.com/01Virex/dsh-status-rotator/compare/v0.19.0...v0.19.1
[0.19.0]: https://github.com/01Virex/dsh-status-rotator/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/01Virex/dsh-status-rotator/compare/v0.17.3...v0.18.0
[0.17.3]: https://github.com/01Virex/dsh-status-rotator/compare/v0.17.2...v0.17.3
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
