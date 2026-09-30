# 鲸鱼尾巴动画的参考与适配

参考项目：[asdnmy123/dsh-whale-sway](https://github.com/asdnmy123/dsh-whale-sway)。2026-09-30 阅读，参考提交为 [`26cec3e`](https://github.com/asdnmy123/dsh-whale-sway/tree/26cec3ef0b3cd42827659e5c58ffbe833d5080e8)。该项目采用 MIT 许可证。本次借鉴设计思路，继续使用 status-rotator 自己的 SVG 轮廓、流式事件采样和配置存储。

| 参考做法 | 对当前实现的价值 | 本地适配 |
| --- | --- | --- |
| 积分推进相位，改速时不重启时间轴 | tok/s 上下波动时，尾巴不会突然跳到另一帧 | 已加入：修改 CSS 周期时按新旧周期换算 `currentTime`，保留循环次数和圈内进度；6 帧衔接保持自己的时长 |
| 图标被宿主替换后，重新应用当前动作 | React 重绘状态行时不会丢失尾巴效果 | 已加入：检查现存图标、回收旧元素的监听和状态；新图标恢复动作、速度、炫彩；随机模式沿用当前动作和下一次切换计划 |
| 并排动画卡片采用相同预览速度 | 用户能看清动作差异，速度不会影响摆幅比较 | 可用于下一步设置页：三种动作统一 1 秒周期并排展示，随机选项独立保留；预览遵循减少动态效果偏好 |
| 独立测量根部漂移、相邻帧步进和素材身份 | 便于判断描边精度、图标抖动和衔接质量 | 可用于下一步素材工具：保存源文件摘要，测量根部与尾鳍的运动，检查相邻帧和首尾衔接；往返回放的重复帧应记录真实数量 |

参考项目的运动循环和重绘恢复逻辑见 [client.js](https://github.com/asdnmy123/dsh-whale-sway/blob/26cec3ef0b3cd42827659e5c58ffbe833d5080e8/client.js#L1107)，并排卡片见 [配置界面](https://github.com/asdnmy123/dsh-whale-sway/blob/26cec3ef0b3cd42827659e5c58ffbe833d5080e8/client.js#L1651)，素材与运动指标见 [README](https://github.com/asdnmy123/dsh-whale-sway/blob/26cec3ef0b3cd42827659e5c58ffbe833d5080e8/README.md)。

## 保留的交互约定

- 原版翻摆、24 帧左右摆尾、36 帧扭转摆尾及随机切换继续可选。
- 随机动作在匹配姿态处切换，经过 6 帧轮廓衔接；最短过渡 120ms。
- 新增工具调用可按概率请求动作切换，默认开关关闭、概率 35%；历史与重复通知不触发，连续命中合并等待。固定动作也可参与，关闭此项后恢复所选动作。
- 等待时保持原有最低 2 次/秒，tok/s 模式上限 6 次/秒；固定模式范围仍为 0.25–6 次/秒。
- 用户明确开启的运行中摇动继续服从当前开关；设置页的可选预览不应强制播放。

## 验证入口

`npm test` 检查配置与纯逻辑。以下浏览器场景覆盖这次适配：

```sh
node scripts/run-turn-process-test.cjs --case=020-running-row-wag-tps --case=020-running-row-tail-rebuild --case=020-running-row-random-rebuild --case=020-running-row-random
node scripts/run-turn-process-test.cjs --case=020-running-row-tool-switch --case=020-running-row-tool-zero --case=020-running-row-tool-disabled
```

调速场景锁定真实 CSS 动画的轮廓与循环进度，改变流式输出速率后检查二者保持一致；重绘场景真实替换宿主图标，检查恢复动作和回收旧监听；随机场景检查 6 帧衔接的两端轮廓及卸载清理。

工具触发场景检查历史过滤、参数流过滤、重复通知去重、0% 与 100% 概率、连续调用合并，以及固定动作切换后的保持与清理。设置页回归还覆盖开关、百分比与动作选择的自动保存。
