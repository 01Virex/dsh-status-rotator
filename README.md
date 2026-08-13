# dsh-status-rotator

把 DeepSeek Harness(dsh)Web 界面底部回合运行时那行 `Deep diving...` 状态文字,替换成自定义文案,每隔一段时间随机轮换。运行时长时钟(15 秒后出现)不受影响。

## 安装

1. 把本项目目录放到 profile 的 node_modules 下(默认 `C:\Users\<你>\.dsh\profiles\node_modules\dsh-status-rotator\`);
2. 在 profile 的 `cordis.patch.yml` 里插入:

   ```yaml
   - insert:
       - id: status-rotator
         name: dsh-status-rotator
   ```

3. 重启 `dsh web`,浏览器 Ctrl+F5 硬刷新。

## 自定义文案

编辑 `lib/client.js` 顶部的 `PHRASES`(键 `zh` / `en`),保存后 Ctrl+F5 刷新即可;也可以在浏览器控制台临时覆盖(优先级:`texts.<locale>` > `texts` > 内置表,刷新生效):

```js
localStorage.setItem("dsh-status-rotator.texts",
  JSON.stringify(["正在蒸馏Fable 5…", "摸鱼中…"]))
location.reload()
```

其他配置项(均在 `lib/client.js` 顶部):轮换间隔 `INTERVAL_MS`(默认 10000ms)、调试日志 `DEBUG`(默认开)。

文案跟随「设置 → 语言」在中英文之间实时切换,未知语言回退到中文。

## 卸载

从 `cordis.patch.yml` 删掉 `status-rotator` 那一行,重启 `dsh web` 即可。

## License

MIT
