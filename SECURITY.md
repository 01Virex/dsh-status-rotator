# Security Policy

[中文说明见下方 ↓](#安全策略中文)

## Supported versions

Security fixes are shipped in a **patch release of the current line** and published to npm `latest` / `stable`.

| Version | Supported |
| --- | --- |
| `0.30.x` (npm `latest` / `stable`) | ✅ |
| older lines (`0.29.x` and below) | ❌ — please upgrade first |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** Use GitHub's private channel instead:

1. Go to the repository's **Security → Report a vulnerability** (GitHub Security Advisories) — this creates a private thread visible only to you and the maintainer.
2. Or send a direct message to the maintainer, [@01Virex](https://github.com/01Virex), on GitHub.

Please include: affected version (`npm ls dsh-status-rotator`), your dsh host version and platform, reproduction steps, impact, and any proof-of-concept. **Best-effort timelines**: acknowledgement within ~3 days, an assessment or fix plan within ~7 days, and a coordinated patch release after that. We will credit you in the CHANGELOG/Release notes unless you prefer otherwise, and we ask that you give us a reasonable window before public disclosure.

## What is in scope

- **The local config route** (`GET`/`PUT /plugins/dsh-status-rotator/config.json`). Write requests are fenced by: `content-type: application/json` (cross-origin simple requests cannot set it), `sec-fetch-site` limited to `same-origin`/`none`, an `Origin` that must match the request `Host`, and the host's loopback-only binding by default. **Known residual risk**: DNS rebinding is same-origin from the browser's point of view and is not caught by this fence — if you expose the port beyond loopback, put an authenticating reverse proxy in front of it.
- **The client half** (`lib/client.js`): it takes over DOM nodes in the DSH Web UI, animates the status line/tail, and renders phrase text. Phrase and config text is inserted as **text**, never as HTML; the submission bot additionally rejects HTML and `;`, so a malicious phrase bank should not be able to inject markup or script.
- **The phrase-submission bot** (`.github/workflows/phrase-submit.yml` + `scripts/phrase-bot.cjs`): it runs on issue content with repository write permission when opening the PR. Anything that lets issue content escape into a shell, a git command or a path is in scope.
- **Supply chain**: the published package has no runtime dependencies; report anything that would make the npm tarball differ from the tagged source.

## Out of scope

- Vulnerabilities in **DeepSeek Harness itself** (report those to DeepSeek).
- The **content** of phrases (they are jokes curated by the community — offensive wording is a Code-of-Conduct matter, see [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)).
- Anything requiring the user to paste secrets into the phrase bank or config store: **both are plain files under `$DSH_HOME` and the bank is shared/published — never put credentials in them.**

---

## 安全策略(中文)

### 支持的版本

安全修复只随**当前版本线的补丁版**发布,并推送到 npm 的 `latest` / `stable`:`0.30.x` 支持 ✓;`0.29.x` 及更早不支持,请先升级。

### 如何私下上报

**请不要开公开 issue。** 走 GitHub 的私密通道:仓库 **Security → Report a vulnerability**(Security Advisory,只有你和维护者可见),或直接给维护者 [@01Virex](https://github.com/01Virex) 发 GitHub 私信。请附上:受影响版本(`npm ls dsh-status-rotator`)、dsh 宿主版本与平台、复现步骤、影响面与 PoC。**尽力而为的时间线**:3 天内确认收到、7 天内给出评估或修复计划、之后协调发布补丁版;除非你要求匿名,我们会在 CHANGELOG 里署名致谢,并请你给一个合理的公开披露窗口期。

### 在范围内

- **本地配置路由**(`GET`/`PUT /plugins/dsh-status-rotator/config.json`):写请求有四道栅栏 —— 必须是 `application/json`(跨域简单请求设不了这个头)、`sec-fetch-site` 只接受 `same-origin`/`none`、`Origin` 必须与 `Host` 同源、宿主默认只监听回环地址。**已知残余风险**:DNS rebinding 在浏览器视角是 same-origin,这道栅栏拦不住 —— 若把端口暴露到回环之外,请自行加带鉴权的反向代理。
- **客户端半区**(`lib/client.js`):它在 DSH Web 界面里接管 DOM、做状态行/尾巴动画、渲染文案。文案与配置一律以**文本**插入,从不解析成 HTML;投稿机器人另外拒绝 HTML 与 `;`,所以恶意词库不应能注入标记或脚本。
- **投稿机器人**(`.github/workflows/phrase-submit.yml` + `scripts/phrase-bot.cjs`):它以仓库写权限处理 issue 内容,任何让 issue 内容逃逸进 shell、git 命令或路径的问题都在范围内。
- **供应链**:发布包没有运行时依赖;让 npm tarball 与 tag 源码不一致的问题都算。

### 不在范围内

- **DSH 宿主本身**的漏洞(请报给 DeepSeek);
- 文案**内容**本身(那是社区梗,措辞问题走[行为准则](./CODE_OF_CONDUCT_ZH.md));
- 任何需要你把密钥粘进词库/配置的场景:**两者都是 `$DSH_HOME` 下的普通文件,且词库是公开分发的 —— 永远不要往里放凭据。**
