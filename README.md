# dsh-status-rotator

> Replaces the DSH Web status line (`Deep diving...`) with your own phrase bank: **1078 phrases, 12 theme packs, typewriter + day/night rainbow gradient + danmaku**.

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

A [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) client plugin that replaces the hardcoded `Deep diving...` / `深度求索中...` status line in the Web UI's turn footer with your own phrase bank: phase-aware switching, typewriter output, timed rotation, weighted random picking, template placeholders with live values, an animated rainbow gradient with separate day/night palettes, video-site-style danmaku, and a real-time engine that feeds the phrases and the browser tab title. The elapsed-time clock of the UI (which appears after 15 seconds) is left untouched.

## Feature Overview

**Core**

- **Status swapping** — the `Deep diving...` label is replaced by your phrases, rotated every `intervalMs`, typed out character by character (`typeSpeedMs`, `0` disables the typewriter);
- **Phase-aware** — separate phrase sets for `thinking` / `running` / `long`; the switch happens the moment the clock appears or the timeout hits, without waiting for the rotation interval;
- **Weighted random** — any phrase may carry a weight; picking follows the weights (`weightedRandom: false` falls back to fully uniform);
- **Zero-intrusion targeting** — locates the status label by `role="status"` + `aria-live="polite"`, so chat-history code snippets, other aria-live regions and the clock are never touched.

**Content**

- **Phrase bank separated from code** — all phrases live in JSON files; editing them needs zero code and no restart;
- **Modular phrase packs** — phrases are grouped into named packs (`packs[]` + `enabledPacks[]`) that merge into the effective bank with text-dedup; the settings page toggles packs and edits each one independently;
- **Template placeholders** — `{elapsed}`, `{phase}`, `{phaseLabel}`, `{locale}`, `{date}`, `{time}`, plus live-engine values `{model}`, `{provider}`, `{tps}`, `{pending}`, `{tools}`, `{running}`;
- **Multilingual** — phrases switch live between Chinese and English following Settings → Language; unknown languages fall back to Chinese;
- **Community phrase bot** — a GitHub-issue form with an automatic validator and auto-PR (see [Contributing Phrases](#contributing-phrases-via-github-issues)).

**Visuals**

- **Rainbow gradient** — text rendered with an animated gradient; separate day (light) / night (dark) palettes that follow the interface theme (or force one with `mode`); colors and speed configurable, one switch to turn off;
- **Danmaku** — every phrase can also fly across the page as bullet-screen comments; random size, per-bullet random rainbow colors, adjustable opacity and z-index.

**Live**

- **Real-time status engine** — subscribes to the dsh session snapshot (session list, conversation snapshot, model RPC) with a DOM clock fallback — one source feeding phrases and the tab title;
- **Browser tab title** — rotates `document.title` through your templates, restores the original title when idle (configurable);
- **Presets & scheduling** — multiple named phrase banks with their own config, switched from the settings page or automatically by time-of-day / weekday rules.

**Workflow**

- **Auto-loading** — the node half registers an HTTP route to serve `config.json`; no localStorage or deployment needed;
- **Hot reload** — while the page stays open the config is re-read periodically and immediately when you switch back to the tab;
- **Persistent storage** — saved edits are written into the official dsh settings store (`$DSH_HOME/settings.yaml`), surviving plugin upgrades;
- **Settings page** — a "Status Texts" page in DSH's Settings with visual editing for the Chinese/English × three-phase phrase banks; saves take effect immediately.

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

On first start the plugin serves, in order: your **saved settings** (`$DSH_HOME/settings.yaml`, namespace `status-rotator`) merged over the `config.json` sitting next to the package — or over `config.example.json` when that file is absent, which is the case for npm installs (all 1078 default phrases live inside it — see [Phrase Bank](#phrase-bank)) — plus two bank layers on top: an **auto-updated bank** pulled from upstream every 6 hours (see [Auto-updating the bank](#auto-updating-the-bank) below) and an optional **external phrase bank** (`$DSH_HOME/status-rotator/phrases.json`) you edit by hand, which wins over all of them and is re-read whenever it changes (see [Hot-reloadable external bank](#hot-reloadable-external-bank) below). To tweak phrases or options you can edit a file (hot-reloaded while the page is open) or use the **Status Texts** page in DSH Settings (bottom-left) — see [Settings Page](#settings-page).

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

The status label is located precisely by `role="status"` + `aria-live="polite"`, so the plugin never touches code snippets in the chat history or other aria-live regions — and never touches the clock (the DOM clock is only *read* to detect the phase, while the real-time engine derives phase/elapsed from the session snapshot).

## Phrase Bank

The default bank ships **1078 phrases**, split into **12 theme packs** (the core `phrases` table is empty — everything lives in packs). Ten packs are enabled by default; the two **star packs are shipped but off by default** — turn them on from Settings → Status Texts → Phrase packs:

| Pack | zh | en | Total | Default |
| --- | --- | --- | --- | --- |
| `deepseek` DeepSeek 专场 | 104 | 111 | 215 | on |
| `coding` 写代码日常 | 84 | 81 | 165 | on |
| `daily` 日常 | 77 | 64 | 141 | on |
| `internet-memes` 网络梗 | 54 | 33 | 87 | on |
| `sysadmin` 系统管理 | 41 | 38 | 79 | on |
| `slacking` 摸鱼 | 36 | 29 | 65 | on |
| `math-physics` 数学与物理 | 31 | 18 | 49 | on |
| `western-ai` 西方 AI 圈 | 16 | 18 | 34 | on |
| `reverse-proxy` 反代 | 14 | 16 | 30 | on |
| `china-ai` 中国 AI 圈 | 16 | 10 | 26 | on |
| `star-ask` 求 star | 11 | 12 | 23 | **off** |
| `star-route` 星标者路由 | 82 | 82 | 164 | **off** |
| **total** | **566** | **512** | **1078** | 891 on / 187 off |

- Most entries are zh/en mirrored pairs; recent community submissions are often zh-only — choose **zh + en (both)** in the submission form to get each phrase in both languages;
- 5 weighted showcase entries (see [Weighted Random](#weighted-random)) — most phrases are plain weight-1 strings;
- The bank grows through the community [phrase-submission form](#contributing-phrases-via-github-issues): validated and merged submissions are credited in [CONTRIBUTORS.md](./CONTRIBUTORS.md);
- Numbers are refreshed at each release; run `node scripts/check-bank-memes.mjs` locally to audit the current bank (duplicates, lengths, ellipsis, series share).

**The star packs (off by default)** — two separate packs, so you can take one without the other:

| Pack | What it is |
| --- | --- |
| `star-ask` 求 star | pure star-ask phrases, e.g. `正在向你讨一个 star…` / `Begging for a star…` |
| `star-route` 星标者路由 | **one phrase per current stargazer** — `正在路由 <login> 写代码…` / `Routing <login> to write code…`, so the rotation literally routes every star-giver to work |

They ship disabled because begging is a matter of taste, not because they are broken: flip them on in Settings → Status Texts → Phrase packs. The stargazer list is refreshed by the [`Star packs` workflow](.github/workflows/star-pack.yml) — weekly and on demand (`workflow_dispatch`) — which reads the stargazers with the repository's own `GITHUB_TOKEN`, so a new star shows up in the bank within a week without anyone doing anything (the endpoint needs a token that can see this repo; a `STAR_TOKEN` secret overrides it). Locally: `node scripts/update-star-pack.cjs --token <pat>`, or `--names names.json` to rebuild from an offline list. Existing installs pick the packs up on upgrade; if a saved settings document already pins `enabledPacks`, the two ids simply stay off until you toggle them.

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
- The default config ships **12 packs** (`deepseek` / `western-ai` / `china-ai` / `coding` / `reverse-proxy` / `sysadmin` / `math-physics` / `slacking` / `internet-memes` / `daily` / `star-ask` / `star-route`) and pins `enabledPacks` to the ten non-star ids, so the two star packs ship **off by default** — the core table is empty, so disabling a pack really removes that theme from the pool;
- The phrase-submission form has a **目标词库包** picker (same pack ids plus `community` as the default landing spot): submissions land in the chosen pack, and a `community` pack is created on first use — the core bank stays untouched, so you can disable or prune community content in one place;
- Old configs without packs keep working untouched.

## Weighted Random

By default the wording is picked uniformly (avoiding immediate repeats). Give phrases a weight and the picker becomes proportional: a `weight: 3` phrase is 3× more likely than a `weight: 1` phrase.

```json
"phrases": { "zh": { "thinking": [
    "正在写代码…",                    // plain string, weight 1
    { "text": "正在加水…", "weight": 3 }   // 3× more likely
] } }
```

- A phrase entry is a plain string (weight 1) or an object `{ "text": "...", "weight": 3 }`; `weight` must be a positive number (decimals allowed), values above 1000 clamp to 1000, invalid/missing weights count as 1. Weight entries are fully optional — old string-only phrase banks work unchanged.
- In the **settings editor** write `text | weight` per line: `正在写代码 | 3`. The editor re-renders weighted phrases with their ` | weight` suffix on load; the `weightedRandom` toggle in Basic settings switches back to uniform picking without touching the phrase bank.
- Weights apply to the status text rotation **and** the danmaku pool (danmaku dedupes by text, keeping the first entry's weight).
- The "avoid repeating the previous phrase" rule stays: the last phrase is temporarily excluded from the draw (if it's the only candidate left, it repeats).

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
| `{locale}` | current UI language (`zh` / `en`) | `zh` |
| `{date}` | local date `YYYY-MM-DD` | `2026-08-07` |
| `{time}` | local time `HH:MM:SS` | `12:34:56` |

Placeholders that change over time (`{elapsed}`, `{date}`, `{time}`, `{tps}`, `{pending}`, `{tools}`, `{model}`, `{provider}`) are refreshed **live** every `liveTickMs` (default 1000 ms; `0` disables live refresh, they then update once per rotation). Unknown placeholders are left as-is, so `{...}` in a phrase is safe. The live values come from a **real-time status engine** that subscribes to the dsh session snapshot, the pending-interaction list and model RPC, with a DOM clock fallback — if the session API is unavailable, `{model}` / `{provider}` / `{tps}` / `{tools}` stay `—`, `{pending}` stays `0`, and the plugin keeps working.

```json
"phrases": { "zh": { "thinking": ["正在写代码 {elapsed}…", "正在{phaseLabel}中 ({elapsed})…"] } }
```

#### `{pending}` and the session's approval policy

`{pending}` counts the session's **pending interactions** — the same list the UI renders as composer takeovers — where approvals and questions share one counter, so an **approval request** and a **question** each make it `1` while they wait for your answer. dsh publishes **at most one** interaction per session (the highest-precedence one), so in practice the value is a `0` / `1` flag, not a queue length. It is event-driven rather than tick-driven: the moment an interaction appears or disappears, the label is re-rendered — no need to wait for the next rotation.

What approvals contribute depends entirely on the session's own permission preset (sandbox mode + approval policy, switched with `/permission`) — the plugin neither reads nor changes that setting:

- **`ask`** — a sensitive action asks first, and its approval request counts while it waits: `{pending}` turns `1` as the approval panel appears and back to `0` once you click;
- **`never`** — approval prompts are disabled: dsh rejects such an action up front, the client never builds a panel, and approvals contribute **nothing**. Note what the counter does *not* say: a rejection is not a pending interaction, so `{pending}` can never report "an action was rejected";
- **questions** are a different domain and stay pending regardless of the policy, so `{pending}` can still show `1` under `never` while dsh waits for an answer (a plan review, for instance).

So `{pending}` answers exactly one question — *is dsh waiting for me right now?* — and under `never` the only thing that can make it non-zero is a question. On a dsh build that exposes no pending-interaction list at all, the value simply stays `0`.

## Rainbow Gradient

Status text is shown with an animated rainbow gradient by default (applies to the text only, not the clock). Since v0.22.0 the gradient carries **two palettes** — night (dark theme) and day (light theme) — and follows the interface light/dark setting automatically (`mode: "auto"`); `mode: "day"` / `"night"` forces one. Switching the theme re-colors the text live, no refresh. The flow direction is configurable too: `direction` is `"rtl"` (default, right to left) or `"ltr"` (left to right, matching the typewriter — issue #41). Can be disabled or re-colored in the config:

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

- With `zIndex < 0` (default) the layer is mounted **inside the element that paints the app background** — normally the conversation surface, which is why bullets sit *between that background and the chat content*: visible in the empty area and behind the conversation, never covering the chat bubbles or the sidebar. If your theme paints an opaque background that hides them, set a non-negative `zIndex` to float them above the UI instead — the layer never intercepts pointers (`pointer-events: none`).
- **Mount point is re-resolved on every spawn** (v0.15.2, target refined in v0.16.1). The app frame is located through the shell's own `data-shell-overlay` marker first, then by structure; inside it, the innermost element that paints an opaque background and covers most of the conversation column becomes the host (the layer is sandwiched in it, with `isolation: isolate`). If neither is there yet — the client half loads *before* the shell renders — the layer briefly falls back to `document.body` at a **visible** z-index and is moved into place as soon as the target appears. Earlier versions kept the `z-index: -1` body fallback forever (v0.15.2), or hung the layer on the app frame while the conversation panel painted its own opaque background on top of it (v0.16.1) — in both cases the bullets existed and animated, you just could never see them. If it is still invisible, turn on `debug` and look for `danmaku layer mounted inside the background panel` in the browser console.
- Bullets support the same placeholders as phrases (`{elapsed}`, `{model}`, `{phase}`…), rendered with the live engine values at spawn time.
- `danmaku: false` disables it entirely. `fontSizeMin` / `fontSizeMax` set the random size range (auto-corrected if reversed, clamped to 8–96 px).

### Top / bottom danmaku (bilibili-style, since v0.19)

- **Types**: `danmaku.types` carries three entries — `scroll` (the original right→left type, unchanged), `top` and `bottom`. Each is `{ enabled, weight }`; `enabled: false` retires the type, `weight` is the relative chance of being picked at spawn. `danmaku.mode` (optional) forces a single type for every bullet and accepts `scroll` / `top` / `bottom` or the bilibili danmaku-protocol `mode` aliases `1` / `4` / `5` — handy for "only top danmaku". Unknown values are dropped, and anything missing falls back to scrolling, so **old configs keep working**.
- **Behaviour**: a top bullet is horizontally centred and appears at the top of the play area, later ones stacking downward; a bottom bullet is centred at the bottom, later ones stacking upward. Both are fixed in place (no horizontal motion, no distortion with playback) and disappear as a whole after `fixed.durationMs`. Each bullet occupies one lane, and the lane freed by an expiring bullet is reused right away, so two bullets never pile up on the same row. When a type is full (`fixed.maxCount`) or the stack reaches the opposite edge, that spawn is dropped — the same strategy the scrolling danmaku has always used.
- **Style**: white text (the rainbow-off default) with a four-way black stroke and no background block, sharing the scrolling danmaku's font-size range, palette, opacity and render pipeline (same `pointer-events: none`). All top/bottom numbers live in one place: `danmaku.fixed` (defaults also defined once as `DANMAKU_FIXED_DEFAULTS` in `lib/client.js`), so changing one line changes them everywhere.
- **No overlapping text**: with `reserveBands` (default on) the scrolling bullets are placed in the gap *between* the top and bottom lanes, so a scrolling phrase never runs behind a fixed one. `anchorBottomToHost` (default on) puts the bottom band just above the input area — DSH's own turn-status line sits there, and a semi-transparent bullet drawn on top of it makes the status shimmer look like it is "on" the danmaku. Both fall back to the plain `marginTop` / `marginBottom` behaviour when the reserved lanes are disabled or the host cannot be measured.
- **Layering & colour**: top/bottom bullets render in a separate *front* layer placed above the chat content (`fixed.zIndex`, default `10` — the shell's overlay layer is `20` and its resize handles `11`, so dialogs stay on top). Scrolling bullets keep the original behind-the-UI layer, so nothing about them changed. A negative `fixed.zIndex` pushes the fixed bullets back behind the UI too. Both kinds share one palette: with `rainbow` on (the default) every top/bottom bullet picks a random colour from `colors` exactly like the scrolling ones, and with `rainbow: false` they use `fixed.color` (default white).
- ⚠️ **The numbers are reasonable defaults, not verified official bilibili values** (`fontSize: 25`, `marginTop: 16`, `marginBottom: 160`, `gap: 4`, `durationMs: 4500`, `maxCount: 3`) — marked *TBC* below. Tune them in `danmaku.fixed` / `DANMAKU_FIXED_DEFAULTS`.
- ⚠️ **Default distribution changed**: with no `types` in your config, all three types are enabled at `scroll 2 : top 1 : bottom 1`, so top/bottom bullets now appear alongside the scrolling ones. To keep the pre-v0.19 look exactly, set `"top": { "enabled": false }` and `"bottom": { "enabled": false }` (or switch them off on the settings page).


## Browser Tab Title

Optionally rotate the browser tab title while a turn is running:

```json
"title": {
    "enabled": true,
    "templates": ["⏳ {phaseLabel} {elapsed}", "🤔 {phaseLabel}… {elapsed}"], // rotated every intervalMs
    "idleTemplate": "💤 dsh 空闲",   // "" = restore the original title when idle
    "intervalMs": 8000
}
```

Templates support the same placeholders as phrases. When no turn is active the title shows `idleTemplate`, or the original title if it is `""`. `title: false` disables it entirely.

## Presets & Scheduling

Named presets can carry their own `config` and `phrases`; the editor on the settings page switches between them and a time schedule can switch the active preset automatically:

```json
{
    "activePreset": "work",
    "presets": [
        { "id": "work", "label": { "zh": "工作模式", "en": "Work" },
          "config": { "intervalMs": 12000, "gradient": false },
          "phrases": { "zh": { "thinking": ["正在认真写代码…"] } } },
        { "id": "fun", "label": { "zh": "摸鱼模式", "en": "Fun" },
          "phrases": { "zh": { "thinking": ["正在摸鱼…"] } } }
    ],
    "schedule": [
        { "preset": "work", "days": ["mon", "tue", "wed", "thu", "fri"], "from": "09:00", "to": "18:00" },
        { "preset": "fun",  "days": ["sat", "sun"], "from": "00:00", "to": "23:59" }
    ]
}
```

- `presets[]`: each has an `id` (required), optional `label` (string or `{zh, en}`), optional `config` (merged over the top-level config) and optional `phrases` (used instead of the top-level phrases). A preset may be an id-only "shell" that just switches back to the base library.
- `activePreset`: preset id, or `null`/absent to use the top-level `config` / `phrases`.
- `schedule[]`: rules with `preset`, `days` (`mon`…`sun`, omitted = every day), `from` / `to` (`HH:MM`). Overnight windows (e.g. `22:00`–`06:00`) are supported. While a rule matches, that preset is used; otherwise `activePreset` applies. The schedule is re-evaluated every minute and applies live.
- Settings-page edits always target the selected preset (or the base library when "Default" is selected); "Set active" writes `activePreset`; the schedule rules are edited as a list on the same page.

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
- the bank is the **highest-precedence phrase layer**: the effective document is merged as bundled `config.example.json` → `config.json` → settings store → external bank, and packs are merged per `id`, so declaring one pack leaves the other 11 untouched. To hand a pack back to the settings page, delete that pack from the bank file;
- the built-in bank stays the fallback: with no such file the plugin behaves exactly as before, and a corrupt file keeps the last successfully loaded copy in service while recording the error (`externalBankStatus()`);
- verify it on a single process: `node scripts/verify-phrase-hot-reload.cjs` applies the plugin, starts a real HTTP server, GETs the route, rewrites the bank file twice and GETs again — all without a restart.

### Auto-updating the bank

Since **v0.21.0** the node half also refreshes the bank from upstream by itself: every **6 hours** it fetches the repo's `config.example.json` from the `main` branch (default source: `https://cdn.jsdelivr.net/gh/01Virex/dsh-status-rotator@main/config.example.json`, picked over `raw.githubusercontent.com` for reachability) and caches it at `$DSH_HOME/status-rotator/bank.remote.json`. The response goes through the same validation as any other bank layer, only `packs` / `phrases` are kept, and the cache is rewritten atomically **only when the content actually changed** — so a merged phrase PR (or the weekly star-pack refresh) reaches a running install **without a restart, a reinstall or another npm release**. Two environment variables control it:

- `DSH_STATUS_ROTATOR_BANK_URL` — upstream address (your own mirror, a `raw.githubusercontent.com` URL, …); `off` or empty disables auto-update;
- `DSH_STATUS_ROTATOR_BANK_INTERVAL_MS` — check interval in ms (`0` disables); unset = 6 hours.

Precedence on load is **bundled `config.example.json` → `config.json` → auto-updated bank → settings store → local bank file**: upstream changes apply to every pack you have not explicitly customized, while a pack you edited on the settings page (or declared in the local bank file) keeps winning. A brand-new pack added upstream is merged in but stays off until an `enabledPacks` entry ships with a release — the auto-updated layer deliberately carries no `config` / `enabledPacks`. For the same reason a settings save computes its diff against everything *below* the settings layer, so auto-updated phrases are never frozen into `settings.yaml` as if you had written them.

Failures never take the bank down: an unreachable CDN, an HTTP error, invalid JSON or an empty document is recorded in `remoteBankStatus()` and the last successfully fetched copy keeps serving (that is what the on-disk cache is for). Note that this is, by default, a periodic HTTPS request from your machine to jsDelivr — set `DSH_STATUS_ROTATOR_BANK_URL=off` (or the interval to `0`) to keep the plugin fully local.

```
$ node scripts/verify-bank-auto-update.cjs
```

(Single process, local upstream: it serves A, switches to B, then returns 500, and asserts the served bank follows A → B, that a hand-written local bank still wins, and that the last good copy survives the outage.)

**Persistent storage since v0.6.1**: saved edits are written into the **official dsh settings store** (`$DSH_HOME/settings.yaml`, namespace `status-rotator`) — the same store the rest of dsh uses for its settings, which **survives plugin upgrades**. Upgrading via npm or a release package will no longer wipe your gradient/phrases/presets (previously `config.json` lived inside the plugin directory and was deleted on upgrade). The plugin-directory `config.json` remains as a compatibility mirror and fallback; a one-time import migrates an existing `config.json` into the settings store on first start.

**The settings store holds only the diff (since v0.19.1, and it actually converges since v0.19.2)**: the namespace persists just the parts that differ from the bundled `config.example.json`, so the phrase bank stays in the package instead of being copied into `settings.yaml`. On load the effective document is merged as **bundled defaults → plugin-directory `config.json` → auto-updated bank → settings store (your diff) → external bank (when one exists — see above)**. Arrays of objects carrying a unique `id` (phrase packs, presets) are compared **per id**, so editing one pack stores only that pack — the settings page submits the whole document, and a wholesale array would write all 12 packs back. An existing install whose settings section already holds the whole bank is collapsed on first start: any entry that also exists in the bundled bank (whitespace-insensitive) is dropped as stale bundled data, and only entries you actually wrote are kept. Measured on a real machine: 82,966 B → 1,586 B with zero phrases lost (idempotent).

> Version history lives in [CHANGELOG.md](./CHANGELOG.md) (including the 0.16.1 fix for a silent `settingsNamespace()` regression). After upgrading the plugin, **restart `dsh web` once** so the node half picks up the new code; the client half only needs a page refresh.

```json
{
    "config": { "intervalMs": 10000, "typeSpeedMs": 30, "longAfterMs": 60000, "reloadIntervalMs": 15000, "liveTickMs": 1000, "weightedRandom": true, "debug": false, "fontWeight": "inherit", "gradient": { "enabled": true, "colors": ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"], "speed": 4 }, "title": { "enabled": false, "templates": ["⏳ {phaseLabel} {elapsed}", "🤔 {phaseLabel}… {elapsed}"], "idleTemplate": "💤 dsh 空闲", "intervalMs": 8000 }, "danmaku": { "enabled": true, "intervalMs": 2500, "speedMs": 18000, "fontSizeMin": 14, "fontSizeMax": 30, "rainbow": true, "colors": ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"], "color": "#ffffff", "opacity": 0.3, "maxCount": 12, "zIndex": -1, "scope": "all", "marginTop": 16, "marginBottom": 160 } },
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
| `gradient` | see above | Rainbow gradient: `false` / `true` / `{enabled, mode, direction, colors, dayColors, speed}` (`mode`: auto follows light/dark, day / night forces one; `direction`: rtl default / ltr left-to-right) |
| `title` | see above | Tab title rotation: `false` / `{enabled, templates, idleTemplate, intervalMs}` |
| `danmaku` | see above | Bullet-screen comments: `false` / `{enabled, intervalMs, speedMs, fontSizeMin, fontSizeMax, rainbow, colors, color, opacity, maxCount, zIndex, scope, marginTop, marginBottom}` |
| `phrases` | from config file | The phrases (Chinese/English × three phases; partial entries allowed, missing ones fall back to other sources) |
| `packs` | none | Modular phrase packs: `[{ id, label?, phrases? }]`, merged into the effective bank in order (deduped by text) |
| `enabledPacks` | null (all) | Which packs are enabled; `null`/absent = all, `[]` = core bank only. The shipped default lists the ten non-star ids, so `star-ask` / `star-route` start off |
| `presets` | none | Named phrase banks, each with optional `config` / `phrases` |
| `activePreset` | null | Which preset is active (`null` = use the top-level config/phrases) |
| `schedule` | none | Time rules that switch the active preset automatically |

**Value guards**: numeric fields are clamped on both save and load (rotation interval ≥ 250 ms, typewriter ≤ 1000 ms/char, danmaku spawn interval ≥ 200 ms, concurrent bullets ≤ 60, layer ±1000 …); colors accept only `#rrggbb` / `rgb()` / `hsl()` / CSS color names, and invalid values are dropped and flagged in the settings page. Colors are interpolated into an injected `<style>` and numbers feed `setInterval` directly — that is why the guards exist.

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

- **Changes save themselves**: toggles and selects write immediately, text and number fields write 400ms after you stop typing (a preset rename writes on blur) — there is no save button and no "saved" chatter; only a write failure shows up in the toolbar (marked red), leaving your edits in place and retried on your next change;
- Every write sends the full JSON to `/plugins/dsh-status-rotator/config.json`; the node half validates it and **writes it back atomically**, and already-open pages hot-apply it immediately without a refresh;
- Switching the edit target flushes the current drafts first, and "Reload" does the same before reading from disk — edits are never silently dropped;
- Numeric fields are validated as you type (the same ranges the node half enforces) — out-of-range values are marked red, and a **Reset** action appears whenever a value differs from its default;
- The footer links straight to [github.com/01Virex/dsh-status-rotator](https://github.com/01Virex/dsh-status-rotator), so the page always has a way back to the source.

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
├── config.example.json     # complete template (default config + all 1078 phrases in 12 packs, committed)
├── config.json             # local personalized config (gitignored)
├── gen-config.cjs          # script that initializes config.json
├── cordis.patch.yml        # dsh bundle patch manifest (referenced by package.json dsh.bundle.patch)
├── scripts/
│   ├── fetch-qq-group.cjs  # fetches QQ group members and generates the phrase config
│   ├── check-bank-memes.mjs # dev-only bank audit (dups / length / ellipsis / series share)
│   ├── danmaku-mount-test.html # dev-only browser regression page for the danmaku mount point
│   ├── label-layout-test.html  # dev-only: status-line layout (width lock / clipping / color fallback / settings render)
│   ├── live-pending-test.html  # dev-only: {pending} live refresh (pending-interaction events → label)
│   ├── run-danmaku-mount-test.cjs # dev-only: drives any regression page (--page=danmaku|label|pending)
│   ├── probe-danmaku-live.cjs # dev-only: inspects the live dsh web page (mount point / paint order)
│   ├── package-release.cjs # packages release files
│   ├── phrase-bot.cjs      # phrase-submission bot (parse form / validate / apply / open PR)
│   ├── smoke-test.cjs      # pure-function smoke tests (npm test)
│   ├── update-star-pack.cjs # rebuilds star-ask / star-route from the stargazer list
│   ├── verify-phrase-hot-reload.cjs # dev-only: proves the external bank hot-reloads in one process
│   ├── verify-bank-auto-update.cjs # dev-only: proves the bank auto-updates from a local upstream in one process
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

Want to see your phrase in the default bank? Open the **Phrase Submission (词库投稿)** form from the repo's [New Issue](https://github.com/01Virex/dsh-status-rotator/issues/new/choose) page and fill in three things:

1. **Language** (zh / en / both), **group** (thinking / running / long / all three) and a **target pack** (which phrase pack the submission lands in — default `community`);
2. **Phrases**, one per line (up to 60, all [template placeholders](#template-placeholders) supported);
3. (Optional) a signature, recorded in the PR but never written into the phrase bank.

A **phrase bot** then takes over automatically:

- **Validates**: language/group/format, ≤200 chars per phrase, no HTML tags / ad links / control characters, submission checkboxes, deduplication against the existing bank;
- **Normalizes** to the default-bank style (`scripts/unify-ellipsis.cjs` rules): `...` → `…`, trailing `…` appended;
- **Comments** on the issue with the result, a preview table and a **"Try it now" JSON** (paste into Settings → Status Texts → Save, or into localStorage `dsh-status-rotator.config` — visible immediately, no need to wait for a merge);
- **Opens a PR**: on success the bot opens a ready-to-merge PR editing `config.example.json` (tagged `词库投稿`, linked from the issue) — the maintainer just clicks 🟢 Merge and the phrases ship to every user with the next npm release.

Submissions only append string entries to the **community pack's** arrays (`packs[].id = "community"` — see [Phrase Packs](#phrase-packs)) — the core bank and all code stay untouched, no risk to your local config. Rejected submissions get a ❌ comment listing the reasons; just fix and resubmit through the form. Merged submissions are credited in [CONTRIBUTORS.md](./CONTRIBUTORS.md). Implementation: [.github/workflows/phrase-submit.yml](.github/workflows/phrase-submit.yml) and [`scripts/phrase-bot.cjs`](scripts/phrase-bot.cjs).

## Testing

`npm test` (or `node scripts/smoke-test.cjs`) loads `lib/client.js` in a Node sandbox and asserts the pure logic — placeholder interpolation, elapsed formatting, clock parsing, config/preset/schedule normalization, schedule matching, and the node half's validation — no browser needed. The same suite runs automatically in CI on every push/PR (see [.github/workflows/test.yml](.github/workflows/test.yml)).

The danmaku mount logic, the status-line layout (typewriter width lock, long-phrase clipping, invalid-color fallback) and the live `{pending}` refresh all depend on the live DOM, which pure-function tests cannot cover, so there are three real-browser regression pages: [`scripts/danmaku-mount-test.html`](./scripts/danmaku-mount-test.html) (four mount-timing scenarios, plus a top/bottom danmaku scenario added in v0.19 via `?modes=1` that asserts centring, stacking direction and gap, hold time, same-type cap, white-text stroke and coexistence with the scrolling type), [`scripts/label-layout-test.html`](./scripts/label-layout-test.html) (width lock, clipping, color fallback, settings render) and [`scripts/live-pending-test.html`](./scripts/live-pending-test.html) (pending 0 → 1 → 0 → 1 through the real plugin, plus the no-service fallback). `npm run test:browser` drives all three headlessly through CDP (needs a local Edge/Chrome); `npm run test:browser:label` / `npm run test:browser:pending` run one page alone. To drive the danmaku page by hand, `frameDelay` / `panelDelay` are how many ms each layer renders *after* the plugin (negative = never):

```bash
msedge --headless=new --disable-gpu --virtual-time-budget=9000 \
       --dump-dom "file:///<repo>/scripts/danmaku-mount-test.html?frameDelay=1200&panelDelay=600"
```

When danmaku is invisible in a running GUI, `node scripts/probe-danmaku-live.cjs "http://127.0.0.1:3080/?token=..."` attaches a headless browser to that page and reports where the layer is mounted, its z-index, the bullet count, and whether a bullet actually paints above the background panel (paint-order check).

For phrase-bank maintenance there is also `node scripts/check-bank-memes.mjs` (dev-only, not shipped to npm): it reports per-group sizes (core + packs), duplicate detection, missing-ellipsis and over-length entries, and the share of series like the 反代/路由 families — pass a candidate JSON as the second argument to compare it against the bank before merging.

## Uninstall

Remove the `status-rotator` line from `cordis.patch.yml` and restart `dsh web`.

## Contributing

Issues and pull requests are welcome. The easiest way to add phrases: edit the `phrases` field in `config.json` or `config.example.json` directly — no code changes needed. Or use the **[phrase-submission form](#contributing-phrases-via-github-issues)** and let the bot validate and open the PR for you.

## Credits

This project wouldn't exist without the help of its contributors — see [CONTRIBUTORS.md](./CONTRIBUTORS.md).

## License

[MIT](./LICENSE)
