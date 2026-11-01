# Smooth whale-tail SVG frames / 鲸尾 SVG 补帧

`wag`, `sway` and `twist` have 150 cyclic frames. Their source loops had 24, 24
and 36 frames respectively. `official` keeps its existing material and decoder.
The current speed settings, four-action pool, 4–8 second random-switch window,
six-frame transition and teardown paths remain the same. At fixed speed 0.25 Hz,
each loop still takes four seconds.

`wag`、`sway`、`twist` 从 24、24、36 帧补到 150 帧；`official` 原素材与解码器不变。
速度、四动作池、4–8 秒随机切换窗口、六帧衔接和卸载路径沿用现有实现。
固定速度 0.25 次/秒时，仍是四秒一轮。

## Source and interpolation / 来源与插值

The original M/L/Z keys from this repository are retained in
`scripts/fixtures/whale-tail-keys.json`. Junction phases (15, 0, 29) are baked
into the new loops rather than rotating the finished arrays by an old frame index.
Wag and sway use consistent winding and a left-base anchor, arc-length sampling
to 256 points, then periodic linear interpolation.

Twist has one to three visible contours and changes face/occlusion. Its offline
helper aligns the fin outline, annotates the visible face, infers edge-on poses
where needed, and transports stem/fold details. It does not pair unrelated raw
vertices. The output has six fixed subpath slots (1024 + 5 × 256 points). Empty
slots collapse to the main contour's starting point and retain zero area. Original
keyframe vertices are retained where the 150-frame timeline hits a source key.

原始 M/L/Z 关键帧保存在 `scripts/fixtures/whale-tail-keys.json`，衔接相位已融入新时间线。
wag/sway 统一绕向与根部锚点，按弧长采样后作周期线性插值。twist 单独处理尾鳍对应、
翻面及遮挡细节，使用六个固定子轮廓槽位；空槽退化为主轮廓起点，不产生可见线段。

## Lossless storage / 无损存储

The encoder stores the already rounded coordinates as integer thousandths,
then second differences, zero runs and base-32 VLQ (five data bits plus one
continuation bit). Each closed subpath resets position and first differences.
Zero is a run marker followed by its length; other values are zigzag signed
integers plus one. The decoder restores the exact SVG strings, including all
points, subpaths, three-decimal precision and loop order. It does not simplify or
reinterpolate at runtime. Each selected action is decoded once per plugin mount.

已验收的坐标按千分之一单位整数、二阶差分、连续零段及 VLQ 编码，解码后 SVG 字符串
逐字一致，不删点、不改轮廓；每种动作在插件挂载后首次使用时解码并缓存。

## Reproduce / 重现

Runtime and regression tests need only Node. Python packages are dev-only and
are not shipped in the npm package. The full generator verifies the reviewed
frame hashes before writing. Platform/library differences that change geometry
therefore fail the check rather than silently replacing the material.

运行与回归只需要 Node；完整重生成需要下列开发依赖，均不随插件发布。生成器会先核对
已验收帧的摘要；若平台或依赖导致轮廓变化，检查会失败，需重新审阅结果。

```sh
node scripts/verify-smooth-tail.cjs
python3 -m pip install -r scripts/smooth-tail-requirements.txt
node scripts/generate-smooth-tail.cjs --check --python=python3
# Omit --check to replace only the generated smooth-tail block.
# 去掉 --check 仅替换补帧素材块。
```

The regression verifies all 450 reviewed SVG strings by action digest, fixed
point counts, closure, bounds, exact codec roundtrip, official material identity,
all 12 directional bridge endpoints, speed and switch policy. The existing
browser turn-process fixture also checks every actual CSS frame, all four
150-frame loops, wraparound and cleanup across host generations.

回归验证 450 帧的摘要、固定点数、闭合、范围、编码往返、官方素材、12 个方向衔接端点、
速度与切换策略；宿主浏览器夹具另验证每个实际 CSS 帧、循环和清理。
