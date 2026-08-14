# 贡献者

感谢每一位为本项目贡献过代码、想法或文案的人。没有你们的付出,这个插件不会长成现在的样子。

## 项目作者

**[01Virex](https://github.com/01Virex)**(git 署名 Umamed26)— 项目发起人与主要维护者。设计并实现了阶段感知文案分组、打字机效果、炫彩渐变、配置与文案分离、config 自动加载,以及那份写满 AI 圈梗的词库。

## 贡献者

**liceses** — 提交了 **PR #1**(`fix: scope label takeover to role=status + aria-live=polite`)。这是一个非常关键的修复:

- 最初按文本匹配 `Deep diving...` 来定位状态标签,会误伤聊天记录里引用过这句话的代码片段;
- 只按 `role="status"` 定位,又会把输入栏 notice、重试行、回合错误提示等 aria-live 区域一并替换,毁掉它们的真实状态文案;
- liceses 提出并实现了 **`role="status"` + `aria-live="polite"` 组合定位**,该组合在页面上唯一,精准命中 TurnStatus 且不误伤任何区域。

这个定位策略沿用至今,是整个插件「只动装饰文字、不破坏任何真实信息」这一原则的技术基础。特别致谢!

## 特别鸣谢

- **[DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness)** — 提供了这套可扩展的客户端插件体系,让这个玩具插件得以存在;
- 词库中每一条梗背后的新闻来源与创作者 —— 文案里记录的是 2026 年 AI 圈的集体记忆。

## 如何贡献

- 加文案:直接编辑 `config.json` / `config.example.json` 的 `phrases`,或发 Issue / PR;
- 改行为:欢迎提交 PR 到 [01Virex/dsh-status-rotator](https://github.com/01Virex/dsh-status-rotator);
- 报问题:开 Issue 描述 dsh 版本、现象与控制台输出即可。

再次感谢每一位贡献者 ❤️
