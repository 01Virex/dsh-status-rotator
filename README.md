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
