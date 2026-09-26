# dsh-status-rotator

> Replaces the DSH Web status line (`Deep diving...`) with your own phrase bank: **1105 phrases, 13 theme packs, typewriter + day/night rainbow gradient + danmaku**.

**English** | [中文](./README_ZH.md) · [Quick start](#quick-start) · [Features](#feature-overview) · [Configuration](#configuration) · [Changelog](./CHANGELOG.md)

[![npm version](https://img.shields.io/npm/v/dsh-status-rotator?color=4a6cf7)](https://www.npmjs.com/package/dsh-status-rotator)
[![npm downloads](https://img.shields.io/npm/dt/dsh-status-rotator?color=4a6cf7)](https://www.npmjs.com/package/dsh-status-rotator)
[![GitHub stars](https://img.shields.io/github/stars/01Virex/dsh-status-rotator?color=4a6cf7)](https://github.com/01Virex/dsh-status-rotator)
[![license](https://img.shields.io/github/license/01Virex/dsh-status-rotator)](LICENSE)
[![status](https://img.shields.io/badge/status-stable-2ecc71)](https://www.npmjs.com/package/dsh-status-rotator)

## Quick start

```bash
dsh plugin --profile web add dsh-status-rotator   # 1. install (the package ships its own bundle manifest)
dsh web                                            # 2. restart once, first install only
```

3. Open **Settings → Status Texts** (bottom left): toggle theme packs, edit phrases, tune the gradient and danmaku — every change saves and applies live, no refresh.

A [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) client plugin that replaces the hardcoded `Deep diving...` / `深度求索中...` status line with your own phrase bank: phase-aware groups, typewriter output, weighted random, live placeholders, an animated day/night gradient, danmaku, and a real-time engine feeding both the phrases and the tab title. The host clock is untouched.

> **Status line as of dsh 0.1.7**: the host moved it into the turn's fold header `button[data-turn-process]` (`Deep diving for 12s`), which scrolls out of view in a long turn. The plugin moves the line **back above the input box**, styled like dsh ≤0.1.6's `.turnStatus` (26px, shimmer, 13px clock) and pinned with the composer; the header copy is hidden and returns when the turn ends. Duration and phase come from reading the header label (never writing into it). On 0.1.6 and older the `role="status"` line already sits there and behaves as before.
>
> **Never a blank line**: `config.labelSource` (default `"phrases"`) decides the text; with an empty bank the plugin's line falls back to the host text instead of rendering an empty row. Set it to `"host"` to drop rotation and get the verbatim 0.1.6 `.turnStatus` look (weight 500, inline-flex, 26px, shimmer, clock after 15s).

## Feature Overview

**Core**

- **Status text replacement** — swaps the host line (`Deep diving...` / `Deep diving for 12s` on 0.1.7) for your phrases, rotating every `intervalMs` and typed out (`typeSpeedMs`, 0 disables);
- **Phase awareness** — `thinking` / `running` / `long` groups switch on turn duration, no need to wait for a rotation;
- **Weighted random** — phrase entries may carry a weight (`weightedRandom: false` = fully uniform);
- **Non-invasive targeting** — located by `role="status"` + `aria-live="polite"` (old hosts) or `button[data-turn-process]` (0.1.7+); never touches chat code blocks, other aria-live regions or the host clock.

**Content**

- **Phrases separate from code, modular packs** — everything lives in JSON, grouped into named packs (`packs[]` / `enabledPacks[]`) that the settings page toggles and edits;
- **Template placeholders** — `{elapsed}` `{phase}` `{phaseLabel}` `{locale}` `{date}` `{time}` plus live fields `{model}` `{provider}` `{tps}` `{pending}` `{tools}` `{running}` — see [Template Placeholders](#template-placeholders);
- **Observation channel** — shows the structured `llm/retry` signals of the host as a small badge (`⟳ 3/5` by default) with `{retry}` `{retryMax}` `{retryProvider}` `{retryCode}` `{detail}`; nothing is shown on hosts without an event window;
- **Multilingual** — follows Settings → Language live, unknown languages fall back to Chinese;
- **Community phrase bot** — issue form + validation + auto-PR, with branches rebuilt on `main` automatically (see [Contributing Phrases](#contributing-phrases-via-github-issues)).

**Visuals & live engine**

- **Rainbow gradient** — day / night palettes follow the interface theme (or force one with `mode`); colors and speed configurable, one switch off;
- **Danmaku** — phrases fly across the page (including bilibili-style top/bottom), with size, color, opacity and z-index options;
- **Tab title** — rotates `document.title` through your templates (off by default; only writes back a title it took over);
- **Presets & schedule** — multiple named banks, switched by hand or by weekday/time window.

**Workflow**

- **Auto-loading + hot reload** — the node half serves the config over HTTP and open pages re-read it, so edits need no restart;
- **Persistence** — saved settings go to `$DSH_HOME/status-rotator/config.json`, which belongs to no package and survives upgrades;
- **Settings page** — edit everything from Settings → Status Texts, applied on save.

## Installation

Two ways to install: the recommended `dsh plugin add` command, or the manual copy. Either way, restart `dsh web` once after the first install.

### Option A: `dsh plugin add` (recommended)

The plugin's `package.json` declares a `dsh.bundle.patch` manifest, so it is recognized automatically after install — no extra flags needed. The command syntax is `dsh plugin --profile <name> add <package>` (e.g. `--profile web`):

- **From npm** (easiest): `dsh plugin --profile web add dsh-status-rotator` ← always installs the latest release
- **From a clone**: `dsh plugin --profile web add ./dsh-status-rotator`
- **From a release package**: download `dsh-status-rotator-<version>.zip` from the Release page (it contains a ready-to-use plugin directory with `config.json` — **not** an npm tarball), unzip it, then `dsh plugin --profile web add /path/to/dsh-status-rotator`.

### Option B: manual install

1. Put this project directory under your profile's node_modules (default `C:\Users\<you>\.dsh\profiles\node_modules\dsh-status-rotator\`);
2. Insert the following into the profile's `cordis.patch.yml`:

   ```yaml
   - insert:
       - id: status-rotator
         name: dsh-status-rotator
   ```

3. Run `node gen-config.cjs` to initialize the local `config.json` (copied from `config.example.json`);
4. Restart `dsh web` and hard-refresh the browser with Ctrl+F5.

### First run

On first start the plugin serves, in order: your **saved settings** (`$DSH_HOME/status-rotator/config.json`) → the package `config.json` → `config.example.json` (what an npm install has: all 1105 default phrases live inside it, see [Phrase Bank](#phrase-bank)). Two more layers join in: the **auto-updated bank** (every 6 hours, see [Auto-updating the bank](#auto-updating-the-bank)) and the optional **external bank** (`$DSH_HOME/status-rotator/phrases.json`, highest priority, see [Hot-reloadable external bank](#hot-reloadable-external-bank)). Edit files directly (hot-reloaded while a page is open) or use the Settings → Status Texts page of DSH.

## How It Works

### Phase Awareness

Phrases are split into three groups based on turn progress (determined by whether a clock has appeared in the status element and its reading):

| Phase | Trigger | Default duration |
|---|---|---|
| `thinking` | Turn just started, no clock | 0 ~ 15s |
| `running` | Clock visible, under the limit | 15s ~ `longAfterMs` |
| `long` | Clock past `longAfterMs` | ≥ 60s |

Phase changes swap the phrase immediately without waiting for the rotation interval. If a phase has no phrase group, it falls back automatically (running → thinking → any non-empty group).

### Zero-Intrusion Targeting

The status label is located by `role="status"` + `aria-live="polite"` (dsh ≤0.1.6) or `button[data-turn-process]` (0.1.7+), so code snippets in the chat history and other aria-live regions are never touched. On 0.1.7+ the plugin does exactly three things: insert its own line in the composer seat, hide the header copy, and read the header label for the duration — the host clock is only *read*, while phase and elapsed come from the session snapshot.

### Status line text source (label source)

`config.labelSource` decides what the status line says; both host generations honour it:

| Value | Status line text | When to use it |
| --- | --- | --- |
| `"phrases"` (default) | one phrase from the bank, rotating per phase | the plugin's normal behaviour |
| `"host"` | the host text only: `Deep diving...` / `深度求索中` | when you want the **pure 0.1.6 look** with no meme phrases |

- **Never a blank line**: when the bank is empty (no `config.json`, or a preset cleared the texts), `"phrases"` mode falls back to the host text instead of leaving an empty row with only the clock;
- **`"host"` copies the 0.1.6 look as well**: the plugin line matches `.turnStatus` property for property (weight 500, `height: calc(26px + …)`, `inline-flex`, same shimmer and `prefers-reduced-motion` fallback) and `.turnStatusClock` (13px, tabular-nums, 8px gap, weight 400), with the clock on the old schedule (`elapsedMs >= 15s`) and the text written in one go rather than typed; old hosts (≤0.1.6) are not touched at all in `"host"` mode;
- A matching dropdown lives on the settings page (Status line text source), and `{"labelSource": "host"}` can be written into `config.json` or a preset.

## Phrase Bank

The default bank ships **1105 phrases**, split into **13 theme packs** (the core `phrases` table is empty — everything lives in packs). Ten packs are enabled by default; the two **star packs are shipped but off by default** — turn them on from Settings → Status Texts → Phrase packs:

| Pack | zh | en | Total | Default |
| --- | --- | --- | --- | --- |
| `deepseek` DeepSeek 专场 | 107 | 111 | 218 | on |
| `coding` 写代码日常 | 84 | 81 | 165 | on |
| `daily` 日常 | 77 | 64 | 141 | on |
| `internet-memes` 网络梗 | 56 | 33 | 89 | on |
| `sysadmin` 系统管理 | 41 | 38 | 79 | on |
| `slacking` 摸鱼 | 36 | 29 | 65 | on |
| `math-physics` 数学与物理 | 31 | 18 | 49 | on |
| `western-ai` 西方 AI 圈 | 16 | 18 | 34 | on |
| `reverse-proxy` 反代 | 14 | 16 | 30 | on |
| `china-ai` 中国 AI 圈 | 18 | 10 | 28 | on |
| `star-ask` 求 star | 11 | 12 | 23 | **off** |
| `star-route` 星标者路由 | 89 | 89 | 178 | **off** |
| **total** | **586** | **519** | **1105** | 898 on / 207 off |

- Most entries are zh/en mirrored pairs; recent community submissions are often zh-only — choose **zh + en (both)** in the submission form to get each phrase in both languages;
- 5 weighted showcase entries (see [Weighted Random](#weighted-random)) — most phrases are plain weight-1 strings;
- The bank grows through the community [phrase-submission form](#contributing-phrases-via-github-issues): validated and merged submissions are credited in [CONTRIBUTORS.md](./CONTRIBUTORS.md);
- The numbers are computed from `config.example.json` by `node scripts/sync-bank-counts.cjs` (the submission bot and the star-pack refresh call it automatically; run it once after editing the bank by hand); run `node scripts/check-bank-memes.mjs` locally to audit the current bank (duplicates, lengths, ellipsis, series share).

**The star packs (off by default)** — two separate packs, so you can take one without the other:

| Pack | What it is |
| --- | --- |
| `star-ask` 求 star | pure star-ask phrases, e.g. `正在向你讨一个 star…` / `Begging for a star…` |
| `star-route` 星标者路由 | **one phrase per current stargazer** — `正在路由 <login> 写代码…` / `Routing <login> to write code…`, so the rotation literally routes every star-giver to work |

They ship disabled because begging is a matter of taste, not because they are broken: flip them on in Settings → Status Texts → Phrase packs. The [`Star packs` workflow](.github/workflows/star-pack.yml) refreshes the stargazer list (weekly, when its own files change, or on demand) with the repo `GITHUB_TOKEN`, landing through a bot PR that is merged automatically once `Test` is green; the job is skipped in forks (their token cannot read stargazers of this repository) and `STAR_TOKEN` overrides it. Locally: `node scripts/update-star-pack.cjs --token <pat>`.

## Phrase Packs

The bank is composable from named packs layered on top of the core `phrases` table:

```jsonc
{
    "packs": [
        { "id": "community",
          "label": { "zh": "社区投稿", "en": "Community" },
          "phrases": { "zh": { "running": ["正在试用词库包…"] } } }
    ],
    "enabledPacks": ["community"]   // absent = all packs enabled; [] = core bank only
}
```

- Enabled packs merge into the effective bank **in order, deduped by text** — an entry already present in the core bank (or an earlier pack) is skipped, keeping its weight;
- `enabledPacks` absent/`null` = all packs on; `[]` = core bank only. Unknown ids in the list are ignored;
- Packs support the exact same entries as the core bank (strings or `{text, weight}`, per-phase groups, placeholders);
- The settings page shows every pack with a per-pack **enable toggle** and a **pack editor target**: pick a pack and the phrase library editor reads/writes that pack's phrases;
- The default config ships **12 packs** (`deepseek` / `western-ai` / `china-ai` / `coding` / `reverse-proxy` / `sysadmin` / `math-physics` / `slacking` / `internet-memes` / `daily` / `star-ask` / `star-route`); `community` is created with the first submission, and `enabledPacks` pins which packs start enabled.
- The phrase-submission form has a **目标词库包** picker (same pack ids plus `community` as the default landing spot): submissions land in the chosen pack, and a `community` pack is created on first use — the core bank stays untouched, so you can disable or prune community content in one place;
- Old configs without packs keep working untouched.

## Weighted Random

Entries are picked by weight. Write a phrase as `"text | 3"` (or `{ "text": "text", "weight": 3 }`) for weight 3; no weight = 1, capped at 1000, invalid values count as 1. `weightedRandom: false` goes back to fully uniform. Five showcase entries in the bank use weights.

## Template Placeholders

Any phrase (and any title template) may contain placeholders, replaced at render time:

| Placeholder | Meaning | Example |
|---|---|---|
| `{elapsed}` | elapsed time of the current turn, localized like the clock | `正在写代码 1分02秒…` |
| `{phase}` | phase id: `thinking` / `running` / `long` / `idle` | `running` |
| `{phaseLabel}` | localized short label of the phase | `运行中` |
| `{model}` | model of the current session (live engine, `—` when unknown) | `deepseek-chat` |
| `{provider}` | provider route of the current session (live engine) | `deepseek` |
| `{tps}` | streaming tokens/s estimate (live engine) | `12` |
| `{pending}` | interactions waiting for an answer — approvals and questions share this one counter (live engine) | `1` |
| `{tools}` | running tool names joined with `+` (live engine) | `bash+web_search` |
| `{running}` | `run` / `idle` (live engine) | `run` |
| `{retry}` | retry attempt in the current step (live engine; empty when none) | `3` |
| `{retryMax}` | the retry policy's cap (may be empty on older hosts / `always` mode) | `5` |
| `{retryProvider}` | provider that triggered the retry (provider-neutral, passed through verbatim) | `deepseek-official` |
| `{retryCode}` | short failure code (safe token ≤32 chars; URLs, paths and raw messages are never rendered) | `sampling_error` |
| `{retryStarted}` | `1` once the retried attempt is actually running (after `llm/retry-started`), else empty | `1` |
| `{detail}` | the whole observation badge, rendered from `config.details.badge` | `⟳ 3/5` |
| `{locale}` | current UI language (`zh` / `en`) | `zh` |
| `{date}` | local date `YYYY-MM-DD` | `2026-08-07` |
| `{time}` | local time `HH:MM:SS` | `12:34:56` |

Placeholders that change over time (`{elapsed}` `{date}` `{time}` `{tps}` `{pending}` `{tools}` `{model}` `{provider}` `{retry}` `{detail}`) refresh **live** every `liveTickMs` (default 1000 ms; `0` = once per rotation). Unknown placeholders are left as-is, so `{...}` is safe in a phrase. Values come from a **real-time status engine** subscribing to the session snapshot, the pending list, model RPC and the session **event window**, with a DOM clock fallback — without the session API, `{model}` / `{provider}` / `{tps}` / `{tools}` stay `—` and `{pending}` stays `0`. The current session id is resolved as `sessions.list.current` (≤0.1.6) → `localStorage['dsh.sessions.current']` (0.1.7+) → the DOM's `[data-sidebar-right-session]`.

**Observation channel** (see [deepseek-harness discussion #3669](https://github.com/deepseek-ai/deepseek-harness/discussions/3669)): that thread points out that subagent retries and transport fallback hide behind `Deep diving…`, and that the missing half is a structured data channel. The plugin consumes **protocol events only** (`llm/retry` / `llm/retry-started` from `binding.eventSource`) — no log scraping, no wording inference; the vocabulary stays provider-neutral (`provider` / `code` passed through, never enumerating product-specific codes); with no event window it simply shows nothing. The badge template lives in `config.details.badge` (empty string = placeholders only, no badge):

```json
"details": { "enabled": true, "badge": "⟳ {retry}/{max}" }
```

```json
"phrases": { "zh": { "thinking": ["正在写代码 {elapsed}…", "正在{phaseLabel}中 ({elapsed})…"] } }
```

#### `{pending}` and the session's approval policy

`{pending}` counts the session's **pending interactions** — the same list the UI renders as composer takeovers — with approvals and questions sharing one counter, so either one makes it `1` while it waits. dsh publishes **at most one** interaction per session, so in practice this is a `0` / `1` flag, not a queue length; it is event-driven, re-rendering the label the moment an interaction appears or disappears.

What approvals contribute depends entirely on the session's own permission preset (sandbox mode + approval policy, switched with `/permission`) — the plugin neither reads nor changes that setting:

- **`ask`** — a sensitive action asks first, and its approval request counts while it waits: `{pending}` turns `1` as the approval panel appears and back to `0` once you click;
- **`never`** — approval prompts are disabled: dsh rejects such an action up front, the client never builds a panel, and approvals contribute **nothing**. Note what the counter does *not* say: a rejection is not a pending interaction, so `{pending}` can never report "an action was rejected";
- **questions** are a different domain and stay pending regardless of the policy, so `{pending}` can still show `1` under `never` while dsh waits for an answer (a plan review, for instance).

So `{pending}` answers exactly one question — *is dsh waiting for me right now?* — and under `never` the only thing that can make it non-zero is a question. On a dsh build that exposes no pending-interaction list at all, the value simply stays `0`.

## Rainbow Gradient

Status text is drawn with an animated rainbow gradient by default (text only, not the clock). Since v0.22.0 there are **two palettes** — night (dark) and day (light) — following the interface theme (`mode: "auto"`; `"day"` / `"night"` forces one) and re-coloring live; `direction` is `"rtl"` (default) or `"ltr"` to match the typewriter (issue #41). Disable or recolor it in the config:

```json
"gradient": {
    "enabled": false,                          // false to disable; true for default colors
    "mode": "auto",                            // auto follows the interface light/dark theme; day / night forces one
    "direction": "rtl",                        // rtl right-to-left (default); ltr left-to-right (matches the typewriter)
    "colors": ["#ff5f6d", "#00ff88", "#4da6ff"], // night (dark theme) color sequence (at least 2, first/last cycle)
    "dayColors": ["#d92b4b", "#0e7490", "#6d28d9"], // day (light theme) color sequence (at least 2, first/last cycle)
    "speed": 4                                 // animation speed (seconds per cycle)
}
```

Existing configs that only set `colors` keep using it in both themes (nothing changes on upgrade); add `dayColors` to get a separate light-theme palette.

## Danmaku

Optional: every phrase can also spawn as video-site-style bullet-screen comments flying from right to left across the page (by default **behind** the UI — the layer is squeezed between the app background and the chat content, visible in the gaps):

```json
"danmaku": {
    "enabled": true,
    "intervalMs": 2500,        // spawn interval (ms); smaller = more of a flood
    "speedMs": 18000,          // time to cross the screen, right → left (ms); larger = slower
    "fontSizeMin": 14,         // min random font size (px)
    "fontSizeMax": 30,         // max random font size (px)
    "rainbow": true,           // rainbow mode: each bullet picks a random color from `colors`
    "colors": ["#ff5f6d", "#00ff88", "#4da6ff"], // palette (at least 1)
    "color": "#ffffff",        // solid color used when rainbow = false
    "opacity": 0.3,            // global opacity (0.05 ~ 1); each bullet jitters between 75% and 100% of it
    "maxCount": 12,            // max concurrent bullets on screen
    "zIndex": -1,              // negative = behind the UI (default), non-negative = above the UI
    "scope": "all",            // "all" = every phrase of the current language; "phase" = current phase only (with fallback)
    "marginTop": 16,           // top padding of the bullet band (px)
    "marginBottom": 160,       // bottom padding (px), keeps the input area clear
    // ── new in v0.19: top / bottom (bilibili-style) danmaku ──
    "types": {                  // per-type switch + relative weight; scroll = the original type
        "scroll": { "enabled": true, "weight": 2 },
        "top":    { "enabled": true, "weight": 1 },
        "bottom": { "enabled": true, "weight": 1 }
    },
    "mode": "scroll",           // optional: force ONE type for every bullet (scroll/top/bottom, or 1/4/5); omit = weighted
    "fixed": {                  // top/bottom style — the single place to change them all
        "fontSize": 25,          // px
        "color": "#ffffff",      // solid colour used when rainbow = false
        "shadow": "1px 0 1px rgba(0,0,0,.85),-1px 0 1px rgba(0,0,0,.85),0 1px 1px rgba(0,0,0,.85),0 -1px 1px rgba(0,0,0,.85)",
        "marginTop": 16,         // distance from the top edge of the play area (px)
        "marginBottom": 160,     // distance from the bottom edge (px)
        "gap": 4,                // stacking gap between bullets (px)
        "durationMs": 4500,      // how long one bullet stays on screen (ms)
        "maxCount": 3,           // max bullets of the SAME type at once
        "zIndex": 10,            // front layer: 10 sits above the chat, below the shell overlay (20)
        "reserveBands": true,     // scrolling bullets keep out of the top/bottom lanes (no overlapping text)
        "anchorBottomToHost": true, // bottom bullets sit above the input area (its status line), not merely marginBottom away
        "overflow": "drop"       // full → drop this spawn (same strategy as scrolling danmaku)
    }
}
```

- With `zIndex < 0` (default) the layer is mounted **inside the element painting the app background** (normally the conversation surface), so bullets sit *between that background and the chat content* — visible in the gaps and behind the conversation, never covering bubbles or the sidebar. Hidden by an opaque theme background? Set a non-negative `zIndex` to float above the UI; the layer never intercepts pointers.
- **Mount point is re-resolved on every spawn** (the fix behind v0.15.2 / v0.16.1): the app frame is found through the shell marker `data-shell-overlay`, and the innermost element inside it that paints an opaque background and covers most of the conversation column becomes the host (it gets `isolation: isolate`). Before the shell renders, the layer briefly falls back to `document.body` at a visible z-index and moves into place as soon as the target appears. Still invisible? Turn on `debug` and look for `danmaku layer mounted inside the background panel`.
- Bullets support the same placeholders as phrases (`{elapsed}` `{model}` `{phase}`…), rendered with live values at spawn time; `danmaku: false` disables the feature, and `fontSizeMin` / `fontSizeMax` set the random size range (auto-corrected, clamped to 8–96 px).
- `danmaku: false` disables it entirely. `fontSizeMin` / `fontSizeMax` set the random size range (auto-corrected if reversed, clamped to 8–96 px).

### Coexisting with host dialogs: pause behind the mask (since v0.25)

The dsh settings dialog mask is a **full-viewport `backdrop-filter: blur(2px)` layer**: with the danmaku layer still translating behind it, the browser recomputes a full-screen blur every frame and the dialog flickers ([issue #60](https://github.com/01Virex/dsh-status-rotator/issues/60)). With `pauseBehindMask` (default `true`) a hit **stops the danmaku outright** — layer and in-flight bullets torn down, spawn timer cleared, host `isolation` restored — rebuilding everything the moment the mask goes away. Detection hit-tests the four corners plus the centre (one probe per 250 ms, `rescanAll` every 2 s as a safety net); small `backdrop-filter` surfaces (menus, cards, tooltips) never match.

### Top / bottom danmaku (bilibili-style, since v0.19)

`danmaku.types` gives the three types (scrolling / top / bottom) an `enabled` flag and a relative weight, and `danmaku.fixed` collects their styling (font size, single color, stroke, gap, hold time, same-type cap, z-index, `reserveBands` to keep scrolling bullets out of the top/bottom lanes, `anchorBottomToHost` to pin bottom bullets above the input area).

- `mode` forces every bullet to one type (`scroll` / `top` / `bottom`, or bilibili 1 / 4 / 5); leave it out to distribute by weight;
- Top/bottom bullets default to white text with a stroke and their own size and hold time — all of it lives in `danmaku.fixed`;
- ⚠️ **The default distribution changed**: with no `types` in your config all three are on (`scroll 2 : top 1 : bottom 1`); for the pre-v0.19 look set `"top": { "enabled": false }` and `"bottom": { "enabled": false }` (or flip them off on the settings page).

## Browser Tab Title

Optional and **off by default**. When on, the browser tab title rotates through your templates while a turn is running:

```json
"title": {
    "enabled": true,
    "templates": ["⏳ {phaseLabel} {elapsed}", "🤔 {phaseLabel}… {elapsed}"], // rotated every intervalMs
    "idleTemplate": "💤 dsh 空闲",   // "" = hand the title back to the host when idle
    "intervalMs": 8000
}
```

Templates support the same placeholders as phrases. When no turn is active the title shows `idleTemplate`; with `idleTemplate: ""` (or `enabled: false`) the plugin hands the title back to the host. `title: false` disables it entirely.

**Editable from the settings page** (since v0.27.0): DSH → Settings → Status Texts → **Behavior** has a *Tab title* group — an on/off switch, the templates (one per line), the idle title and the rotation interval. Saving writes it into the plugin's config store with everything else, so it survives plugin upgrades and you never have to hand-edit `config.json`.

**It only writes a title it took over itself**: the plugin touches `document.title` only while that title is its own. If it never took one over — or already handed it back — it does not touch it at all, including the **session title the host writes** (`<session> — DeepSeek Harness`) and titles written by **other plugins**. Turning the switch off hands back the last host-written title and stops touching the title for good.

> Fixed in v0.27.0. The old rule was "if the current title differs from the value cached at start-up, write it back", which overwrote *any* other writer — classically [oh-my-dsh](https://github.com/gulagala001/oh-my-dsh)'s brand rename (it rewrites a trailing `DeepSeek Harness` to `Oh My DSH`). The value read back could never equal the value written, so the title was rewritten **every tick** (`scripts/title-coexistence-test.html` measures 10 rewrites in 2.6 s with the session title wiped off the tab; 1 write after the fix).

## Presets & Scheduling

A preset is a named bank snapshot (optionally with its own `config`), switched from the settings page or automatically by `schedule` rules:

```json
"presets": [{ "id": "night", "name": "Night", "phrases": { "zh": { "thinking": ["夜深了…"] } } }],
"activePreset": null,
"schedule": [{ "preset": "night", "days": [1,2,3,4,5], "from": "22:00", "to": "06:00" }]
```

- `days` runs `0` (Sunday) to `6` (Saturday); `from` / `to` may cross midnight (`22:00` → `06:00`);
- While a window matches, that preset is active; outside it the plugin returns to `activePreset`. The Automation tab has a visual editor and shows the effective preset live;
- Keys a preset leaves out fall back to the global config.

## Configuration

Phrases are fully separated from the source code and live in JSON config files. There are two config files at the project root:

- **`config.example.json`** — the complete template committed to the repo: default config + all phrases (bilingual, split into three phases);
- **`config.json`** — your local personalized config, initialized by `node gen-config.cjs` (only created when missing, never overwrites your changes). It's in `.gitignore`, so edit freely without polluting git.

**Auto-loading (default)**: the plugin's node half registers an HTTP route (`/plugins/dsh-status-rotator/config.json`) that serves the `config.json` next to the plugin (read from disk on every request). The browser fetches it automatically by default, and **while the page stays open it re-reads every `reloadIntervalMs`, plus immediately when you switch back to the tab**, so as long as `config.json` sits in the plugin directory, phrase edits take effect **without a refresh or restart**. The only restart of `dsh web` needed is on first install.

### Hot-reloadable external bank

Since **v0.20.0** the node half also reads an optional **phrase bank file outside the package** — `$DSH_HOME/status-rotator/phrases.json` by default, overridable with the `DSH_STATUS_ROTATOR_BANK` environment variable (absolute path, or relative to the process working directory). It is plain JSON with the same shape as `config.example.json`, but you only need the keys you want to override — the minimal file is one pack and one phase:

```json
{ "packs": [{ "id": "china-ai", "phrases": { "zh": { "thinking": ["正在飞唐杰马…"] } } }] }
```

The node half inspects the file on every request: when it changes it is re-read and re-parsed (an `mtimeNs` + size fast path, then a content comparison, so a rewrite within the same timestamp tick is still caught), and the browser half picks the new content up on its next `reloadIntervalMs` poll — **no process restart, no reinstall, no republished npm package**. Rules:

- only `packs` / `phrases` are taken from that file; a `config` key inside it is ignored, so runtime options stay under the settings page / `config.json`;
- the bank is the **highest-precedence phrase layer**: the effective document is merged as bundled `config.example.json` → `config.json` → auto-updated bank → user config store → external bank, and packs are merged per `id`, so declaring one pack leaves the other 11 untouched. To hand a pack back to the settings page, delete that pack from the bank file (bank content is **never** recorded as your change in the config store or the compatibility mirror, so the bundled / upstream copy comes straight back);
- the built-in bank stays the fallback: with no such file the plugin behaves exactly as before, and a corrupt file keeps the last successfully loaded copy in service while recording the error (`externalBankStatus()`);
- verify it on a single process: `node scripts/verify-phrase-hot-reload.cjs` applies the plugin, starts a real HTTP server, GETs the route, rewrites the bank file twice and GETs again — all without a restart.

### Auto-updating the bank

Since **v0.21.0** the node half fetches the repo `main` `config.example.json` every **6 hours** (jsDelivr by default, for reachability) and caches it at `$DSH_HOME/status-rotator/bank.remote.json`. The response is validated like any other layer, only `packs` / `phrases` are kept, and the cache is rewritten atomically **only when the content actually changed** — so merged submissions and the weekly star-pack refresh reach a running install without a restart, a reinstall or another npm release.

- `DSH_STATUS_ROTATOR_BANK_URL` — upstream address (your own mirror works); `off` or empty disables it;
- `DSH_STATUS_ROTATOR_BANK_INTERVAL_MS` — interval in ms (`0` disables); unset = 6 hours.

Upstream changes apply only to packs you have not explicitly customized: a pack edited on the settings page (or declared in the local bank file) keeps winning, and a new pack added upstream stays off until an `enabledPacks` entry ships with a release (the auto-updated layer deliberately carries no `config`). Failures (unreachable CDN, HTTP error, invalid JSON, empty document) only land in `remoteBankStatus()` while the last good copy keeps serving. By default this is a periodic request to jsDelivr — set the URL to `off` (or the interval to `0`) to stay fully local.

**Persistent storage (v0.6.1, and since v0.26.1 really in the plugin data directory)**: saved edits go to **`$DSH_HOME/status-rotator/config.json`** (path overridable with `DSH_STATUS_ROTATOR_CONFIG`) — next to the bank files, **belonging to no package, so upgrades never touch it**.

- Two silent failures came before: the config once lived in the plugin directory (replaced on upgrade), and the official dsh settings store turned out to have **no `register()`** on 0.1.7-rc.1, which killed that path and reset settings again (issue [#51](https://github.com/01Virex/dsh-status-rotator/issues/51)). Since v0.26.1 persistence no longer depends on the shape of the host settings API.
- The plugin-directory `config.json` stays as a **compatibility mirror** (written on save, and hand edits are absorbed into the store while the file still exists — checked on every GET, at the latest one `reloadIntervalMs`).
- The store holds **only the diff against the bundled defaults**; loading merges bundled default → `config.json` → auto-updated bank → user config store → external bank. Arrays with `id` (packs, presets) are compared per id and every save recomputes the diff from scratch, so reverting a value to its default simply removes it from the store (old installs converge too: 82,966 B → 1,586 B measured, no entries lost).

> Version history lives in [CHANGELOG.md](./CHANGELOG.md). After upgrading, **restart `dsh web` once** so the node half picks up new code; a page refresh is enough on the client side.

```json
{
    "config": { "intervalMs": 10000, "typeSpeedMs": 30, "longAfterMs": 60000, "reloadIntervalMs": 15000, "liveTickMs": 1000, "labelSource": "phrases", "weightedRandom": true, "debug": false, "fontWeight": "inherit", "gradient": { "enabled": true, "colors": ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"], "speed": 4 }, "title": { "enabled": false, "templates": ["⏳ {phaseLabel} {elapsed}", "🤔 {phaseLabel}… {elapsed}"], "idleTemplate": "💤 dsh 空闲", "intervalMs": 8000 }, "danmaku": { "enabled": true, "pauseBehindMask": true, "intervalMs": 2500, "speedMs": 18000, "fontSizeMin": 14, "fontSizeMax": 30, "rainbow": true, "colors": ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"], "color": "#ffffff", "opacity": 0.3, "maxCount": 12, "zIndex": -1, "scope": "all", "marginTop": 16, "marginBottom": 160 } },
    "phrases": { "zh": { "thinking": ["…"], "running": ["…"], "long": ["…"] }, "en": { "thinking": ["…"], "running": ["…"], "long": ["…"] } },
    "packs": [],            // optional, see "Phrase Packs" (default config ships 12 theme packs)
    "enabledPacks": null,   // null/absent = all packs; the shipped default pins the ten non-star ids
    "presets": [],          // optional, see "Presets & Scheduling"
    "activePreset": null,   // optional preset id
    "schedule": []          // optional time rules
}
```

| Key | Default | Description |
|---|---|---|
| `intervalMs` | 10000 | Rotation interval (ms) |
| `typeSpeedMs` | 30 | Typewriter delay per character (ms), 0 disables the typewriter |
| `longAfterMs` | 60000 | Threshold for entering the `long` phase |
| `reloadIntervalMs` | 15000 | Interval for auto re-reading `config.json` while the page is open (ms), 0 disables |
| `liveTickMs` | 1000 | Refresh interval for live placeholders (`{elapsed}` / `{date}` / `{time}` / `{tps}`…) in phrases and titles (ms), 0 disables |
| `weightedRandom` | true | Weighted random picking. `false` = fully uniform over phrases. Phrase entries may be `"text"` or `{ "text": "...", "weight": 3 }` (weight > 0, capped at 1000, invalid/missing = 1) |
| `debug` | false | Console diagnostic logs |
| `fontWeight` | `"inherit"` | Font weight of the status text and the danmaku: a number (1–1000; typical 100–900) or a CSS keyword (`normal`/`bold`/`bolder`/`lighter`); `"inherit"` follows the UI (default; danmaku keeps its built-in 600) |
| `labelSource` | `"phrases"` | Status line text source: `"phrases"` rotates the phrase bank; `"host"` uses the host text only (`Deep diving...` / `深度求索中`) with the 0.1.6 `.turnStatus` look. With an empty bank both modes fall back to the host text — see [Status line text source](#status-line-text-source-label-source) |
| `gradient` | see above | Rainbow gradient: `false` / `true` / `{enabled, mode, direction, colors, dayColors, speed}` (`mode`: auto follows light/dark, day / night forces one; `direction`: rtl default / ltr left-to-right) |
| `title` | see above | Tab title rotation: `false` / `{enabled, templates, idleTemplate, intervalMs}` |
| `danmaku` | see above | Bullet-screen comments: `false` / `{enabled, pauseBehindMask, intervalMs, speedMs, fontSizeMin, fontSizeMax, rainbow, colors, color, opacity, maxCount, zIndex, scope, marginTop, marginBottom, types, fixed}`; `pauseBehindMask` defaults to `true` — see "Coexisting with host dialogs" |
| `phrases` | from config file | The phrases (Chinese/English × three phases; partial entries allowed, missing ones fall back to other sources) |
| `packs` | none | Modular phrase packs: `[{ id, label?, phrases? }]`, merged into the effective bank in order (deduped by text) |
| `enabledPacks` | null (all) | Which packs are enabled; `null`/absent = all, `[]` = core bank only. The shipped default lists the ten non-star ids, so `star-ask` / `star-route` start off |
| `presets` | none | Named phrase banks, each with optional `config` / `phrases` |
| `activePreset` | null | Which preset is active (`null` = use the top-level config/phrases) |
| `schedule` | none | Time rules that switch the active preset automatically |

**Value guards**: numeric fields are clamped on save and on load (rotation ≥ 250 ms, typewriter ≤ 1000 ms/char, danmaku spawn ≥ 200 ms, concurrent bullets ≤ 60, z-index ±1000 …); colors accept only `#rrggbb` / `rgb()` / `hsl()` / CSS names, and invalid values are dropped and flagged in the settings page. The guards exist because colors go into an injected `<style>` and numbers feed `setInterval`.

**Same-origin writes only**: `PUT/POST /plugins/dsh-status-rotator/config.json` requires `content-type: application/json` and an origin matching `Host` (`sec-fetch-site` must be `same-origin` / `none`); cross-site requests get 403. Without this, any web page could rewrite your local config.

Phrase source priority, highest first:

1. **localStorage single-text override** `dsh-status-rotator.texts[.<locale>]` / `texts`;
2. **localStorage full config** `dsh-status-rotator.config` (paste JSON, applies after refresh);
3. **External JSON**: `dsh-status-rotator.url` > `EXTERNAL_URL` constant > local auto-load (`/plugins/dsh-status-rotator/config.json`);
4. **Built-in defaults**: only `DEFAULT_CONFIG` at the top of `lib/client.js` (no phrases).

If a localStorage override matches, the external `config.json` is silently suppressed; the new version logs a `[status-rotator] ⚠ localStorage override active` warning in the browser console — when you see it, clear the corresponding key.

Old phrase-only external JSON (`{ "zh": [...], "en": [...] }` or `{ "thinking": [...] }`) is still supported and treated as a "phrases-only config" (a flat array lands in the `thinking` group).

Phrases switch live between Chinese and English following Settings → Language; unknown languages fall back to Chinese.

## Settings Page

Open Settings in the bottom-left of DSH and a new **Status Texts** page appears in the navigation. The page is split into four tabs and follows the official plugin settings-page spec (760px column, the same tab / field / input language):

**Content**

- **Edit target** — one selector covering the base library, any preset (`preset:<id>`) and any phrase pack (`pack:<id>`); saving writes to that target. A target that no longer exists (preset or pack deleted) falls back to the base library;
- **中文 / English** tabs, each with three text boxes for `thinking` / `running` / `long`, **one phrase per line**, blank lines ignored; a line `text | weight` sets that phrase's weight; each phase shows its phrase count;
- **Pack toggles** — enable or disable each phrase pack (the ten non-star packs ship enabled);
- **Presets** — pick a preset, **New** to create one, edit its name inline (stored per editing language), **Delete** to remove it (schedule rules referencing it go with it), and "Set active" to write `activePreset`.

**Appearance**

- Font weight, shared by the status line and danmaku;
- **Rainbow gradient**: enable toggle, palette mode (follow the interface light/dark, or force day/night), flow direction (right-to-left / left-to-right), separate day + night color sequences, flow speed;
- **Danmaku**: enable toggle, spawn interval, cross duration, random font-size range, rainbow mode + palette, opacity, max concurrent bullets, layer z-index and phrase scope.

**Behavior**

- Rotation interval, typewriter speed, long-task threshold, auto-reload interval, placeholder refresh interval, weighted-random toggle.

**Automation**

- **Schedule editor**: add/remove weekday + time-window rules that switch presets automatically; the currently effective preset (schedule included) is shown live.

Across the page:

- **Changes save themselves**: toggles and selects write immediately, text/number fields 400ms after you stop typing (a preset rename on blur) — no save button, and only a failed write turns the toolbar red;
- Every write PUTs the full JSON to `/plugins/dsh-status-rotator/config.json`; the node half validates and **writes it back atomically**, and open pages hot-apply it — invalid content returns 400 and shows an error instead of corrupting the file;
- Switching the edit target or hitting Reload flushes drafts first (nothing is silently dropped); numeric fields are validated as you type with a **Reset** action when a value differs from its default; the footer links back to the source repo.

After upgrading to a version with the settings page, restart `dsh web` once (so the node half registers the write endpoint); everything after that can be done from the page.

## QQ Group Member Phrase Generator

To turn every member of a QQ group into a phrase like `正在路由（群成员）写代码...` (meaning "routing (group member) to write code..."), use `scripts/fetch-qq-group.cjs` to generate a standalone config file in one go — no need to type out the member list by hand.

Prerequisites: the bot is in the target group and you have a OneBot v11 compatible HTTP API (e.g. NapCat / LLOneBot / go-cqhttp / OpenShamrock).

```bash
# The default group is a placeholder (0) — always pass your own with -g; generates config.qq0.json otherwise
node scripts/fetch-qq-group.cjs --group 123456789 --url http://localhost:3000 --token your-token

# Directly replace the config.json the plugin actually uses (the old one is backed up as config.backup-<timestamp>.json)
node scripts/fetch-qq-group.cjs --group 123456789 --url http://localhost:3000 --token your-token --activate

# No bot API? Save the member list as members.txt (one nickname per line) and generate from it
node scripts/fetch-qq-group.cjs --input members.txt
```

| Option | Default | Description |
|---|---|---|
| `-g, --group` | `0` (placeholder) | QQ group ID (also reads the `QQ_GROUP_ID` env var). `0` is meaningless on purpose — always pass a real group id, e.g. `--group 123456789` |
| `-u, --url` | `http://localhost:3000` | OneBot HTTP URL (also reads `ONEBOT_HTTP_URL`) |
| `-t, --token` | empty | Access token (also reads `ONEBOT_ACCESS_TOKEN`) |
| `-a, --action` | `get_group_member_list` | Action path (also reads `ONEBOT_ACTION`); frameworks with a prefix use `/api/...` |
| `-i, --input` | none | Local member list: txt (one per line) / json (array) / csv (first column) |
| `-o, --output` | `config.qq0.json` | Output file |
| `--activate` | off | Write back to `config.json` directly and back up the old file |
| `--dry-run` | off | Preview only, writes nothing |

The display name prefers the group card name, falling back to the nickname. The generated file contains only the `zh.thinking` group: per this plugin's fallback rules, the thinking phase uses it directly and the other phases fall back to the same group. The generated `config.qq*.json` is gitignored.

## Project Structure

```
dsh-status-rotator/
├── .github/
│   ├── workflows/
│   │   ├── phrase-submit.yml   # phrase-submission bot (issue opened → validate → auto-PR)
│   │   ├── release.yml         # GitHub Release on tag push
│   │   ├── star-pack.yml       # refreshes star-ask / star-route with the repo's GITHUB_TOKEN
│   │   └── test.yml            # npm test on every push / PR
│   └── ISSUE_TEMPLATE/
│       └── phrase-submit.yml   # "Phrase Submission" form (auto-applies the 词库投稿 label)
├── lib/
│   ├── index.js            # node half: registers the HTTP route for config.json (GET/PUT, validated)
│   └── client.js           # client half: status text replacement / placeholders / gradient / title / danmaku / presets
├── config.example.json     # complete template (default config + all 1105 phrases in 13 packs, committed)
├── config.json             # local personalized config (gitignored)
├── gen-config.cjs          # script that initializes config.json
├── cordis.patch.yml        # dsh bundle patch manifest (referenced by package.json dsh.bundle.patch)
├── scripts/
│   ├── fetch-qq-group.cjs  # fetches QQ group members and generates the phrase config
│   ├── check-bank-memes.mjs # dev-only bank audit (dups / length / ellipsis / series share)
│   ├── danmaku-mount-test.html # dev-only browser regression page for the danmaku mount point
│   ├── label-layout-test.html  # dev-only: status-line layout (width lock / clipping / color fallback / settings render)
│   ├── live-pending-test.html  # dev-only: {pending} live refresh (pending-interaction events → label)
│   ├── title-coexistence-test.html # dev-only: tab-title ownership / coexisting with oh-my-dsh's brand rename (v0.27.0)
│   ├── run-danmaku-mount-test.cjs # dev-only: drives any regression page (--page=danmaku|label|pending|title)
│   ├── turn-process-017-test.html # dev-only: 0.1.7+ status line (header takeover / simple turn / host-text fallback / 0.1.6 look)
│   ├── run-turn-process-test.cjs # dev-only: drives the 0.1.7+ status-line page
│   ├── probe-danmaku-live.cjs # dev-only: inspects the live dsh web page (mount point / paint order)
│   ├── package-release.cjs # packages release files
│   ├── phrase-bot.cjs      # phrase-submission bot (parse form / validate / apply / open PR)
│   ├── smoke-test.cjs      # pure-function smoke tests (npm test)
│   ├── sync-bank-counts.cjs # keeps README/package.json counts in sync with the bank (bot + star-pack call it)
│   ├── update-star-pack.cjs # rebuilds star-ask / star-route from the stargazer list
│   ├── verify-phrase-hot-reload.cjs # dev-only: proves the external bank hot-reloads in one process
│   ├── verify-bank-auto-update.cjs # dev-only: proves the bank auto-updates from a local upstream in one process
│   ├── verify-settings-survive-upgrade.cjs # dev-only (also runs in CI): settings survive an upgrade for hand-edited config.json and settings-page saves (#51)
│   └── unify-ellipsis.cjs  # default-bank ellipsis normalization / integrity check
├── package.json
├── README.md               # English docs
├── README_ZH.md            # Chinese docs
├── CHANGELOG.md            # changelog
├── CONTRIBUTORS.md         # English contributors
├── CONTRIBUTORS_ZH.md      # Chinese contributors
└── LICENSE
```

> Local-only artifacts (never committed): `demo-wallpapers/`, `.dsh-web-restart/`, `dist-release/`, `config.qq*.json` and `config.backup-*.json` — all listed in `.gitignore`.

## Contributing Phrases via GitHub Issues

Pick the **「词库投稿」** form on the [Issues](https://github.com/01Virex/dsh-status-rotator/issues/new/choose) page: language (zh / en / both), group (thinking / running / long), target pack (`community` by default), phrases (**one per line**, up to 60, ≤200 chars each) and an optional signature.

**What gets rejected**: an in-line semicolon — `;` `；` `﹔` `;` (a semicolon-joined line only renders as one unreadable run-on; Chinese colon `：`, comma `，` and enumeration comma `、` are fine) — plus HTML / links / control characters, duplicates of the existing bank, and an unticked submission checklist. A rejection comes with a ❌ comment listing the reasons; fix and resubmit.

The bot then validates and normalizes (`...` → `…`, trailing `…` appended), replies on the issue with a preview table and a **"try it now" JSON** (paste it into the settings page to see it immediately), and opens a PR editing `config.example.json` (tagged `词库投稿`) — the maintainer clicks Merge and it ships with the next npm release.

- **Branches follow `main`**: whenever `main` moves (and every 6 hours, or on demand) the bot rebuilds every open submission branch on the current `main`, so PRs stay mergeable — nobody has to hand-resolve a `config.example.json` conflict (which easily produces **duplicate keys** that `JSON.parse` silently collapses, losing entries);
- **Rule changes are re-checked**: a submission that no longer complies gets the reasons on the PR and the issue and its **PR is closed automatically**; the bot also checks for duplicate keys on every bank read and after every write, and `npm test` asserts `config.example.json` has none;
- Submissions only append to the target pack — no code changes, no touching the core bank — and merged ones are credited in [CONTRIBUTORS.md](./CONTRIBUTORS.md). Implementation: [.github/workflows/phrase-submit.yml](.github/workflows/phrase-submit.yml) and [`scripts/phrase-bot.cjs`](scripts/phrase-bot.cjs).

## Testing

`npm test` (`node scripts/smoke-test.cjs`) loads `lib/client.js` in a Node sandbox and asserts the pure logic: placeholder interpolation, duration formatting, clock parsing, config / preset / schedule normalization, schedule matching, the config validation of the node half, and that the documented counts match the bank; CI runs it on every push / PR ([.github/workflows/test.yml](.github/workflows/test.yml)).

Everything that needs a live DOM (danmaku mounting, status-line width lock / clipping / color fallback, the live `{pending}` refresh, tab-title ownership) has four real-browser regression pages, driven headlessly through CDP by `npm run test:browser` (needs a local Edge/Chrome):

| Page | Covers |
| --- | --- |
| [`danmaku-mount-test.html`](./scripts/danmaku-mount-test.html) | mount timing, top/bottom bullets, pause and recovery behind a full-screen host blur mask |
| [`label-layout-test.html`](./scripts/label-layout-test.html) | typewriter width lock, clipping, invalid-color fallback, settings render |
| [`live-pending-test.html`](./scripts/live-pending-test.html) | pending 0 → 1 → 0 → 1 through the real plugin, plus the no-service fallback |
| [`title-coexistence-test.html`](./scripts/title-coexistence-test.html) | tab-title ownership: coexisting with oh-my-dsh brand rename |

Run one alone with `npm run test:browser:label` / `:pending` / `:title`; the 0.1.7+ status line has its own page via `node scripts/run-turn-process-test.cjs` (15 scenarios: header takeover, hand-back, no-seat fallback, observation badge, `labelSource: "host"` compared against 0.1.6). Open a page by hand to switch scenarios with URL parameters (`?modes=1`, `?mask=1`, `?case=…`, `--page=danmaku|label|pending|title`).

## Uninstall

Remove the `status-rotator` line from `cordis.patch.yml` and restart `dsh web`.

## Contributing

Issues and pull requests are welcome. The easiest way to add phrases: edit the `phrases` field in `config.json` or `config.example.json` directly — no code changes needed. Or use the **[phrase-submission form](#contributing-phrases-via-github-issues)** and let the bot validate and open the PR for you.

## Credits

This project wouldn't exist without the help of its contributors — see [CONTRIBUTORS.md](./CONTRIBUTORS.md).

## License

[MIT](./LICENSE)
