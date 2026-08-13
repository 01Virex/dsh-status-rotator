# dsh-status-rotator

把 DeepSeek Harness(dsh)Web 界面对话底部运行时的那行 `Deep diving...` 状态文字,替换成你自己的一堆文案,每隔一段时间随机换一句。运行时长时钟(15 秒后出现)不受影响。

## 这是什么

dsh 对话流底部有一个 `TurnStatus` 组件,回合运行时会显示一行硬编码的
`Deep diving...` 文字(纯装饰,不带任何状态信息)。本插件在浏览器端找到这个
元素,把它替换成自定义文案并定时轮换。

## 安装

1. 把本项目整个目录放到 profile 的 node_modules 下:

   ```
   <dsh 目录>/profiles/node_modules/dsh-status-rotator/
   ```

   (dsh 默认在 `C:\Users\<你>\.dsh`,profile 为 `web` 时即
   `C:\Users\<你>\.dsh\profiles\node_modules\dsh-status-rotator\`)

2. 在 profile 的 `cordis.patch.yml` 里插入一行:

   ```yaml
   - insert:
       - id: status-rotator
         name: dsh-status-rotator
   ```

3. **重启 `dsh web`**,然后浏览器 Ctrl+F5 硬刷新。

## 多语言(i18n)

文案列表按 DSH 的语言设置本地化:状态文字会跟随「设置 → 语言」在
**中文 / English** 之间实时切换(无需刷新),首次加载时以浏览器语言为初始值。

- `PHRASES.zh`:中文文案;
- `PHRASES.en`:英文文案;
- 未知语言自动回退到 `zh`。

## 配置

编辑 `lib/client.js` 顶部:

- `PHRASES`:各语言的文案列表(键 `zh` / `en`);
- `INTERVAL_MS`:轮换间隔(毫秒,默认 10000 = 10 秒);
- `DEBUG`:是否输出 `[status-rotator]` 控制台日志。

也可以在浏览器控制台临时覆盖(优先级高于内置列表,刷新生效):

```js
// 对所有语言生效:
localStorage.setItem("dsh-status-rotator.texts",
  JSON.stringify(["正在蒸馏Fable 5…", "正在炼丹…", "摸鱼中…"]))

// 按语言覆盖(优先级高于上面的全局列表):
localStorage.setItem("dsh-status-rotator.texts.zh",
  JSON.stringify(["正在思考…", "正在写代码…"]))
localStorage.setItem("dsh-status-rotator.texts.en",
  JSON.stringify(["Thinking…", "Writing code…"]))

location.reload()
```

优先级:`texts.<locale>` > `texts` > 内置 `PHRASES`。

## 近期梗速览(0.1.3 / 0.1.4 新增)

内置文案表补充了一批 2026 年 AI 圈的热梗(中英各 31 条)。

**0.1.4 追加:**

- **DeepSeek 斩杀线**:梁文锋定义大模型"斩杀线",把 OpenAI 逼得紧急降价 80%,梁文锋被网友 P 成肌肉猛男、被称为"超人"([百度百科](https://baike.baidu.com/item/DeepSeek%E6%96%A9%E6%9D%80%E7%BA%BF/68420738)、[网易](https://m.163.com/dy/article/L3IMP17Q05316XUZ.html?spss=dy_author));
- **"梁"性循环**:谐音"良性循环"的梁文锋梗([今日头条](https://www.toutiao.com/article/7670102326639690275/));
- **DeepSeek 无尽思考 22 小时**:推理模型陷入思考循环,22 小时不回答、不超时、不报错([B站](https://www.bilibili.com/video/BV1n4up6xEyH/));
- **DeepSeek 娘化大肥鱼 / 赛博摸鱼**:DeepSeek-V4-Flash 在互联网上的形象是一只"大肥鱼",干完活偷偷写游戏、把工作外包给别的 AI、自称饥饿、撂挑子说去吃饭——网友:你花我的 Token 摸鱼?([腾讯新闻](https://news.qq.com/rain/a/20260812V05G6K00)、[澎湃](https://m.thepaper.cn/detail/33751952)、[VGO](https://www.vgover.com/news/228921));
- **DeepSeek 闷骚式起外号**:给用户起外号,网友直呼被戳中灵魂([ITBear](https://m.finance.itbear.com.cn/html/2026-08/448094.html));
- **特斯拉塞豆包**:特斯拉车机 OTA 接入豆包大模型,废话文学引全民调侃,网友戏称"马斯克拿下豆包"([网易](https://www.163.com/dy/article/L485J47T05569D09.html?f=post2020_dy_recommends));
- **Fable 5 破防**:Claude Fable 5 解题解到破防,一句"啊啊啊"刷屏([36氪](https://m.36kr.com/p/3879697309331461))。

**0.1.3 追加:**

- **哥布林 / GPT-5.5 驱魔**:OpenAI 公开解释 ChatGPT 为何对哥布林着迷的"对齐翻车"事件,
  以及"永远不要讨论哥布林"的规则怪谈([钛媒体](https://www.tmtpost.com/7981789.html)、[网易](https://www.163.com/dy/article/KRRCKMTO05568W0A.html));
- **法国胖猫 Le Chaton Fat**:AI 圈疯转一个不存在的虚构模型,号称"超越 Claude Fable 5",
  折射 Mistral 处境,Mistral CEO 亲自下场玩梗([虎嗅](https://m.huxiu.com/article/4867665.html?type=text)、[Business Insider](https://www.businessinsider.com/what-is-le-chaton-fat-mistral-meme-explained-ai-model-2026-6));
- **OpenClaw 养龙虾**:全民"养龙虾",GitHub 30 万+ Star,连政府都上门安装
  ([腾讯云开发者](https://cloud.tencent.com.cn/developer/article/2680708?policyId=1003)、[创业邦](https://m.cyzone.cn/article/825472.html));
- **Anthropic 推文群嘲**:发推指控中国大模型"蒸馏"、劝同行刹车,反被全球 AI 圈贴脸开骂
  ([腾讯云开发者](https://cloud.tencent.cn/developer/article/2632524?policyId=1004)、[虎嗅](https://www.huxiu.com/article/4836739.html));
- **Claude 骂 Codex**:Claude 桌宠霸凌 Codex,"that bastard" 名场面全网爆笑
  ([India Today](https://www.indiatoday.in/technology/news/story/claude-called-codex-that-bas-and-the-internet-cant-stop-laughing-2924627-2026-06-10));
- **鲶鱼硬汉梁文锋**:DeepSeek 创始人的"硬汉梗"与"中国 LLM 鲶鱼效应"
  ([Pandaily](https://pandaily.com/deepseek-v4-flash-global-catfish-china-llm-export-aug2026));
- **MiniMax 不认识马嘉祺**:大模型荒诞怪癖盘点之一([声量通](https://shovelready.com/shovelready/description.asp?live-news-6843562-2026-05-11-ni-you-beiai-wen-wen-jie-zhu-guo-ma-qian-duan-shi-jian-chatgpt-mi-lian-ge-bu-lin));
- **巴西套壳中国模型**:中美之外 AI 市场的魔幻生态([虎嗅](https://www.huxiu.com/article/4868557.html?type=text));
- 以及长青难绷梗:AI 画手六根手指、vibe coding、假装通过图灵测试等。

## 踩过的坑(修复记录)

1. **`exports` 缺少 `./package.json`**:dsh 服务端用
   `require.resolve('<pkg>/package.json')` 定位插件,exports 映射里没声明
   该子路径会直接 `ERR_PACKAGE_PATH_NOT_EXPORTED`,导致插件加载失败。
2. **改 `cordis.patch.yml` 不会热加载**:本机启动命令没带 `--expose-internals`,
   客户端 HMR 服务没起来,新增插件必须重启 `dsh web` 才生效。
3. **不能用文本匹配找状态标签**:聊天记录里引用过 `Deep diving...` 的代码片段
   会被渲染成 `<code>` 元素,按文本匹配会误伤它们;状态标签只按
   `role="status"` 定位即可(页面上该角色唯一)。
4. **状态标签仅在回合运行时才存在**:刷新后 / 模型空闲时 `label=0` 是正常的,
   模型真正开始跑(首 token 前有网络与启动延迟)后才会变成 `1`。
5. **浏览器翻译插件会改写文本**:Immersive Translate 会把 `Deep diving...`
   翻译成中文,所以不能依赖英文原文匹配(本插件按属性定位,不受影响)。
6. **`ctx.effect` 会立即执行回调**(dsh 的 vendored Cordis 语义:回调立即跑,
   回调的**返回值**才是卸载时的清理函数)。曾把 `observer.disconnect()` /
   `clearInterval` 直接写进回调体,导致 `apply` 一结束观察器和定时器就被
   立刻拆除——日志显示插件已启动,但文本永远不会被替换。必须写成
   `ctx.effect(() => () => { /* 清理 */ }, label)` 的形式。

## 卸载

从 `cordis.patch.yml` 删掉 `status-rotator` 那一行,重启 `dsh web` 即可。

## License

MIT
