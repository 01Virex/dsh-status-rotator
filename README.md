# dsh-status-rotator

把 DeepSeek Harness(dsh)Web 界面底部回合运行时那行 `Deep diving...` 状态文字,替换成自定义文案:按回合阶段切换、打字机逐字输出、流动炫彩渐变(可关)、定时轮换。运行时长时钟(15 秒后出现)不受影响。

## 特性

- **阶段感知**:`thinking`(刚启动)/ `running`(15s 后)/ `long`(超过阈值)三组文案,时钟出现或超时立即切换,不用等轮换间隔;
- **打字机效果**:文案逐字"打"出,速度可调,设 0 即关闭;
- **炫彩渐变**:文字以流动渐变显示,颜色序列与流速可配,可一键关闭;
- **文案与代码分离**:文案全在 `config.json` 里,改文案零代码、免重启;
- **自动加载**:node half 注册 HTTP 路由 serve `config.json`,开箱即用,无需 localStorage 或部署;
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

## 安装

1. 把本项目目录放到 profile 的 node_modules 下(默认 `C:\Users\<你>\.dsh\profiles\node_modules\dsh-status-rotator\`);
2. 在 profile 的 `cordis.patch.yml` 里插入:

   ```yaml
   - insert:
       - id: status-rotator
         name: dsh-status-rotator
   ```

3. 运行 `node gen-config.cjs` 初始化本地 `config.json`(从 `config.example.json` 复制);
4. 重启 `dsh web`,浏览器 Ctrl+F5 硬刷新。

## 配置

文案已从源码分离,全部放在 JSON 配置文件里。项目根有两个配置文件:

- **`config.example.json`** — 入库的完整模板:**默认配置 + 全部文案**(中英双语,分三阶段);
- **`config.json`** — 你的本地个性化配置,由 `node gen-config.cjs` 初始化(仅当不存在时创建,不覆盖你的改动)。已被 `.gitignore` 忽略,随便改不会污染 git。

**自动加载(默认)**:插件的 node half 注册了一个 HTTP route(`/plugins/dsh-status-rotator/config.json`)来 serve 插件同目录的 `config.json`(每次请求实时读文件,改文案后刷新页面即生效)。浏览器端默认自动 fetch 它,所以只要 `config.json` 放在插件目录里,重启一次 `dsh web` 后即可,**无需任何手动步骤**。

```json
{
    "config": { "intervalMs": 10000, "typeSpeedMs": 30, "longAfterMs": 60000, "debug": false, "gradient": { "enabled": true, "colors": ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"], "speed": 4 } },
    "phrases": { "zh": { "thinking": ["…"], "running": ["…"], "long": ["…"] }, "en": { "thinking": ["…"], "running": ["…"], "long": ["…"] } }
}
```

| 键 | 默认 | 说明 |
|---|---|---|
| `intervalMs` | 10000 | 轮换间隔(毫秒) |
| `typeSpeedMs` | 30 | 打字机每字符间隔(毫秒),0 关闭打字机 |
| `longAfterMs` | 60000 | 进入 `long` 阶段的阈值 |
| `debug` | false | 控制台诊断日志 |
| `gradient` | 见上 | 炫彩渐变:`false` / `true` / `{enabled, colors, speed}` |
| `phrases` | 来自配置文件 | 文案(中英 × 三阶段;可只写部分,缺的用其它源回退) |

文案来源优先级,从高到低:

1. **localStorage 单条覆盖** `dsh-status-rotator.texts[.<locale>]` / `texts`;
2. **localStorage 完整配置** `dsh-status-rotator.config`(粘贴 JSON,刷新生效);
3. **外部 JSON**:`dsh-status-rotator.url` > `EXTERNAL_URL` 常量 > 本地自动加载(`/plugins/dsh-status-rotator/config.json`);
4. **内置默认值**:仅 `lib/client.js` 顶部的 `DEFAULT_CONFIG`(不含文案)。

旧的纯文案外部 JSON(`{ "zh": [...], "en": [...] }` 或 `{ "thinking": [...] }`)依然兼容,视为"只带文案的配置"。

文案跟随「设置 → 语言」在中英文之间实时切换,未知语言回退到中文。

## 项目结构

```
dsh-status-rotator/
├── lib/
│   ├── index.js            # node half:注册 config.json 的 HTTP 路由
│   └── client.js           # client half:状态文字替换 / 渐变 / 打字机
├── config.example.json     # 完整模板(默认配置 + 全部文案,入库)
├── config.json             # 本地个性化配置(被 .gitignore 忽略)
├── gen-config.cjs          # 初始化 config.json 的脚本
├── package.json
├── README.md
└── LICENSE
```

## 卸载

从 `cordis.patch.yml` 删掉 `status-rotator` 那一行,重启 `dsh web` 即可。

## 贡献

欢迎提交 Issue 和 Pull Request。加新文案最简单的方式:直接编辑 `config.json` 或 `config.example.json` 的 `phrases` 字段,不需要动任何代码。

## 致谢

本项目的诞生离不开贡献者的帮助,详见 [CONTRIBUTORS.md](./CONTRIBUTORS.md)。

## License

[MIT](./LICENSE)
