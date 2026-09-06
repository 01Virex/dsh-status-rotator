# dsh-status-rotator

> **English** | [中文](./README_ZH.md)

[![npm version](https://img.shields.io/npm/v/dsh-status-rotator?color=4a6cf7)](https://www.npmjs.com/package/dsh-status-rotator)
[![npm downloads](https://img.shields.io/npm/dt/dsh-status-rotator?color=4a6cf7)](https://www.npmjs.com/package/dsh-status-rotator)
[![GitHub stars](https://img.shields.io/github/stars/01Virex/dsh-status-rotator?color=4a6cf7)](https://github.com/01Virex/dsh-status-rotator)
[![license](https://img.shields.io/github/license/01Virex/dsh-status-rotator)](LICENSE)
[![status](https://img.shields.io/badge/status-stable-2ecc71)](https://www.npmjs.com/package/dsh-status-rotator)

```bash
# One-line install
dsh plugin --profile web add dsh-status-rotator
```

**v0.14.1 — stable release**

> ⭐ **If this made you smile, give it a star** — it keeps the memes flowing.

A [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) client plugin that replaces the hardcoded `Deep diving...` status line in the Web UI's turn footer with your own phrase bank: phase-aware switching, typewriter output, timed rotation, weighted random picking, template placeholders with live values, an animated rainbow gradient, video-site-style danmaku, and a real-time engine that feeds the phrases, the browser tab title and a floating status pill. The elapsed-time clock of the UI (which appears after 15 seconds) is left untouched.

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

- **Rainbow gradient** — text rendered with an animated gradient; colors and speed configurable, one switch to turn off;
- **Danmaku** — every phrase can also fly across the page as bullet-screen comments; random size, per-bullet random rainbow colors, adjustable opacity and z-index.

**Live**

- **Real-time status engine** — subscribes to the dsh session snapshot (session list, conversation snapshot, model RPC) with a DOM clock fallback — one source feeding phrases, tab title and pill;
- **Live status pill** — floating pill in the official `shell.overlay` seat, template-driven live info (`{model} · {phaseLabel} · {elapsed} · ⚡{tps} tok/s`), position/opacity configurable;
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
- **From a release package**: download the packaged tarball from the Release page, then `dsh plugin --profile web add /path/to/dsh-status-rotator-<version>.tgz`.

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

On first start the plugin serves the `config.json` sitting next to the package (all 886 default phrases are inside it — see [Phrase Bank](#phrase-bank)). To tweak phrases or options you can either edit that file (hot-reloaded while the page is open) or use the new **Status Texts** page in DSH Settings (bottom-left) — see [Settings Page](#settings-page).

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

The default bank ships **886 phrases**, split into **10 theme packs** (the core `phrases` table is empty — everything lives in packs, all enabled by default):

| Pack | zh | en | Total |
| --- | --- | --- | --- |
| `deepseek` DeepSeek 专场 | 103 | 111 | 214 |
| `coding` 写代码日常 | 84 | 81 | 165 |
| `daily` 日常 | 77 | 64 | 141 |
| `internet-memes` 网络梗 | 54 | 33 | 87 |
| `sysadmin` 系统管理 | 41 | 38 | 79 |
| `slacking` 摸鱼 | 36 | 29 | 65 |
| `math-physics` 数学与物理 | 31 | 18 | 49 |
| `western-ai` 西方 AI 圈 | 16 | 18 | 34 |
| `reverse-proxy` 反代 | 14 | 16 | 30 |
| `china-ai` 中国 AI 圈 | 12 | 10 | 22 |
| **total** | **468** | **418** | **886** |

- Most entries are zh/en mirrored pairs; recent community submissions are often zh-only — choose **zh + en (both)** in the submission form to get each phrase in both languages;
- 5 weighted showcase entries (see [Weighted Random](#weighted-random)) — most phrases are plain weight-1 strings;
- The bank grows through the community [phrase-submission form](#contributing-phrases-via-github-issues): validated and merged submissions are credited in [CONTRIBUTORS.md](./CONTRIBUTORS.md);
- Numbers are refreshed at each release; run `node scripts/check-bank-memes.mjs` locally to audit the current bank (duplicates, lengths, ellipsis, series share).

## Phrase Packs

The bank is composable from named packs layered on top of the core `phrases` table:

```jsonc
{
    "packs": [
        { "id": "community",
          "label": { "zh": "社区投稿", "en": "Community" },
          "phrases": { "zh": { "running": ["正在试用词库包…"] } } }
    ],
    "enabledPacks": ["community"]   // absent = all packs enabled
}
```

- Enabled packs merge into the effective bank **in order, deduped by text** — an entry already present in the core bank (or an earlier pack) is skipped, keeping its weight;
- `enabledPacks` absent/`null` = all packs on; `[]` = core bank only. Unknown ids in the list are ignored;
- Packs support the exact same entries as the core bank (strings or `{text, weight}`, per-phase groups, placeholders);
- The settings page shows every pack with a per-pack **enable toggle** and a **pack editor target**: pick a pack and the phrase library editor reads/writes that pack's phrases;
- The default config ships **10 packs** (`deepseek` / `western-ai` / `china-ai` / `coding` / `reverse-proxy` / `sysadmin` / `math-physics` / `slacking` / `internet-memes` / `daily`) — the core table is empty, so disabling a pack really removes that theme from the pool;
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
| `{pending}` | pending/approval interactions count (live engine) | `1` |
| `{tools}` | running tool names joined with `+` (live engine) | `bash+web_search` |
| `{running}` | `run` / `idle` (live engine) | `run` |
| `{locale}` | current UI language (`zh` / `en`) | `zh` |
| `{date}` | local date `YYYY-MM-DD` | `2026-08-07` |
| `{time}` | local time `HH:MM:SS` | `12:34:56` |

Placeholders that change over time (`{elapsed}`, `{date}`, `{time}`, `{tps}`, `{pending}`, `{tools}`, `{model}`, `{provider}`) are refreshed **live** every `liveTickMs` (default 1000 ms; `0` disables live refresh, they then update once per rotation). Unknown placeholders are left as-is, so `{...}` in a phrase is safe. The live values come from a **real-time status engine** that subscribes to the dsh session snapshot and model RPC, with a DOM clock fallback — if the session API is unavailable, they stay `—` but the plugin keeps working.

```json
"phrases": { "zh": { "thinking": ["正在写代码 {elapsed}…", "正在{phaseLabel}中 ({elapsed})…"] } }
```

## Rainbow Gradient

Status text is shown with an animated rainbow gradient by default (applies to the text only, not the clock). Can be disabled or re-colored in the config:

```json
"gradient": {
    "enabled": false,                          // false to disable; true for default colors
    "colors": ["#ff5f6d", "#00ff88", "#4da6ff"], // gradient color sequence (at least 2, first/last cycle)
    "speed": 4                                 // animation speed (seconds per cycle)
}
```

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
    "marginBottom": 160        // bottom padding (px), keeps the input area clear
}
```

- With `zIndex < 0` (default) the layer is mounted inside the dsh app frame and sits **between the app background and the chat content**: bullets are visible in the empty area and behind the conversation, never covering the chat bubbles or the sidebar. If your theme paints an opaque background that hides them, set a non-negative `zIndex` to float them above the UI instead — the layer never intercepts pointers (`pointer-events: none`).
- Bullets support the same placeholders as phrases (`{elapsed}`, `{model}`, `{phase}`…), rendered with the live engine values at spawn time.
- `danmaku: false` disables it entirely. `fontSizeMin` / `fontSizeMax` set the random size range (auto-corrected if reversed, clamped to 8–96 px).

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

## Live Status Pill

A floating pill (official `shell.overlay` seat — the documented place for status pills) shows live information driven by the same real-time engine:

```json
"pill": {
    "enabled": true,
    "template": "{model} · {phaseLabel} · {elapsed} · ⚡{tps} tok/s",
    "position": "right-bottom",   // right-bottom / left-bottom / right-top / left-top
    "opacity": 0.92
}
```

The template supports every phrase placeholder (including the live-engine ones: `{model}`, `{provider}`, `{tps}`, `{pending}`, `{tools}`). While a turn runs it ticks with: the **model name** (read from the official model-directory service, following session/model switches), the **phase** (`thinking`/`running`/`long`), the **elapsed time** and the streaming **tokens/s** — phase and elapsed are derived from the session snapshot (the turn's start moment is tracked by the engine itself, so it never depends on DOM structure); when idle it shows `— · 空闲 · 0秒 · ⚡0 tok/s`. `pill: false` disables it. If the session API is unavailable (older dsh), the DOM clock drives phase/elapsed as a fallback and the live fields show `—` — no crash, no errors.

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

**Persistent storage since v0.6.1**: saved edits are written into the **official dsh settings store** (`$DSH_HOME/settings.yaml`, namespace `status-rotator`) — the same store the rest of dsh uses for its settings, which **survives plugin upgrades**. Upgrading via npm or a release package will no longer wipe your gradient/phrases/presets (previously `config.json` lived inside the plugin directory and was deleted on upgrade). The plugin-directory `config.json` remains as a compatibility mirror and fallback; a one-time import migrates an existing `config.json` into the settings store on first start.

```json
{
    "config": { "intervalMs": 10000, "typeSpeedMs": 30, "longAfterMs": 60000, "reloadIntervalMs": 15000, "liveTickMs": 1000, "weightedRandom": true, "debug": false, "fontWeight": "inherit", "gradient": { "enabled": true, "colors": ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"], "speed": 4 }, "title": { "enabled": false, "templates": ["⏳ {phaseLabel} {elapsed}", "🤔 {phaseLabel}… {elapsed}"], "idleTemplate": "💤 dsh 空闲", "intervalMs": 8000 }, "pill": { "enabled": true, "template": "{model} · {phaseLabel} · {elapsed} · ⚡{tps} tok/s", "position": "right-bottom", "opacity": 0.92 }, "danmaku": { "enabled": true, "intervalMs": 2500, "speedMs": 18000, "fontSizeMin": 14, "fontSizeMax": 30, "rainbow": true, "colors": ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"], "color": "#ffffff", "opacity": 0.3, "maxCount": 12, "zIndex": -1, "scope": "all", "marginTop": 16, "marginBottom": 160 } },
    "phrases": { "zh": { "thinking": ["…"], "running": ["…"], "long": ["…"] }, "en": { "thinking": ["…"], "running": ["…"], "long": ["…"] } },
    "packs": [],            // optional, see "Phrase Packs" (default config ships 10 theme packs)
    "enabledPacks": null,   // null/absent = all packs, [] = core bank only
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
| `liveTickMs` | 1000 | Refresh interval for live placeholders (`{elapsed}` / `{date}` / `{time}` / `{tps}`…) in phrases, titles and the pill (ms), 0 disables |
| `weightedRandom` | true | Weighted random picking. `false` = fully uniform over phrases. Phrase entries may be `"text"` or `{ "text": "...", "weight": 3 }` (weight > 0, capped at 1000, invalid/missing = 1) |
| `debug` | false | Console diagnostic logs |
| `fontWeight` | `"inherit"` | Font weight of the status text, the live pill and the danmaku: a number (1–1000; typical 100–900) or a CSS keyword (`normal`/`bold`/`bolder`/`lighter`); `"inherit"` follows the UI (default; danmaku keeps its built-in 600) |
| `gradient` | see above | Rainbow gradient: `false` / `true` / `{enabled, colors, speed}` |
| `title` | see above | Tab title rotation: `false` / `{enabled, templates, idleTemplate, intervalMs}` |
| `pill` | see above | Live status pill: `false` / `{enabled, template, position, opacity}` |
| `danmaku` | see above | Bullet-screen comments: `false` / `{enabled, intervalMs, speedMs, fontSizeMin, fontSizeMax, rainbow, colors, color, opacity, maxCount, zIndex, scope, marginTop, marginBottom}` |
| `phrases` | from config file | The phrases (Chinese/English × three phases; partial entries allowed, missing ones fall back to other sources) |
| `packs` | none | Modular phrase packs: `[{ id, label?, phrases? }]`, merged into the effective bank in order (deduped by text) |
| `enabledPacks` | null (all) | Which packs are enabled; `null`/absent = all, `[]` = core bank only |
| `presets` | none | Named phrase banks, each with optional `config` / `phrases` |
| `activePreset` | null | Which preset is active (`null` = use the top-level config/phrases) |
| `schedule` | none | Time rules that switch the active preset automatically |

Phrase source priority, highest first:

1. **localStorage single-text override** `dsh-status-rotator.texts[.<locale>]` / `texts`;
2. **localStorage full config** `dsh-status-rotator.config` (paste JSON, applies after refresh);
3. **External JSON**: `dsh-status-rotator.url` > `EXTERNAL_URL` constant > local auto-load (`/plugins/dsh-status-rotator/config.json`);
4. **Built-in defaults**: only `DEFAULT_CONFIG` at the top of `lib/client.js` (no phrases).

If a localStorage override matches, the external `config.json` is silently suppressed; the new version logs a `[status-rotator] ⚠ localStorage override active` warning in the browser console — when you see it, clear the corresponding key.

Old phrase-only external JSON (`{ "zh": [...], "en": [...] }` or `{ "thinking": [...] }`) is still supported and treated as a "phrases-only config" (a flat array lands in the `thinking` group).

Phrases switch live between Chinese and English following Settings → Language; unknown languages fall back to Chinese.

## Settings Page

Open Settings in the bottom-left of DSH and a new **Status Texts** page appears in the navigation:

- **中文 / English** tabs, each with three text boxes for `thinking` / `running` / `long`, **one phrase per line**, blank lines are ignored; a line `text | weight` sets that phrase's weight;
- Each phase shows the current phrase count in real time;
- Basic settings (rotation interval, typewriter speed, long-task threshold, auto-reload interval, placeholder refresh interval, font weight, weighted-random toggle) live on the same page;
- **Live pill settings**: enable toggle, display template, position — the pill and the live-engine placeholders are configured in the same page;
- **Rainbow gradient settings**: enable toggle, color sequence, speed — no more manual `config.json` editing to turn the gradient off;
- **Danmaku settings**: enable toggle, spawn interval, cross duration, random font-size range, rainbow mode + palette, opacity, max concurrent bullets, layer z-index and phrase scope — everything editable without touching `config.json`;
- **Pack controls**: every pack has an enable toggle and an editor target; the phrase library editor reads/writes the selected pack (when the default bank is empty, the first pack is selected automatically);
- **Preset selector**: edit each preset's phrases/config independently; "Set active" writes `activePreset`; the currently effective preset (schedule included) is shown live;
- **Schedule editor**: add/remove weekday + time-window rules that switch presets automatically;
- Clicking "Save Phrase Bank" makes the browser `PUT` the full JSON to `/plugins/dsh-status-rotator/config.json`; the node half validates it and **writes it back atomically**, and already-open pages hot-apply it immediately without a refresh;
- Submitted content is validated (phrases must be string arrays, presets/schedule must match their shapes); invalid content returns 400 and shows an error on the page, so the config file can't be corrupted.

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
│   │   └── test.yml            # npm test on every push / PR
│   └── ISSUE_TEMPLATE/
│       └── phrase-submit.yml   # "Phrase Submission" form (auto-applies the 词库投稿 label)
├── lib/
│   ├── index.js            # node half: registers the HTTP route for config.json (GET/PUT, validated)
│   └── client.js           # client half: status text replacement / placeholders / gradient / title / danmaku / presets
├── config.example.json     # complete template (default config + all 886 phrases in 10 packs, committed)
├── config.json             # local personalized config (gitignored)
├── gen-config.cjs          # script that initializes config.json
├── cordis.patch.yml        # dsh bundle patch manifest (referenced by package.json dsh.bundle.patch)
├── scripts/
│   ├── fetch-qq-group.cjs  # fetches QQ group members and generates the phrase config
│   ├── check-bank-memes.mjs # dev-only bank audit (dups / length / ellipsis / series share)
│   ├── package-release.cjs # packages release files
│   ├── phrase-bot.cjs      # phrase-submission bot (parse form / validate / apply / open PR)
│   ├── smoke-test.cjs      # pure-function smoke tests (npm test)
│   └── unify-ellipsis.cjs  # default-bank ellipsis normalization / integrity check
├── package.json
├── README.md               # English docs
├── README_ZH.md            # Chinese docs
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

For phrase-bank maintenance there is also `node scripts/check-bank-memes.mjs` (dev-only, not shipped to npm): it reports per-group sizes (core + packs), duplicate detection, missing-ellipsis and over-length entries, and the share of series like the 反代/路由 families — pass a candidate JSON as the second argument to compare it against the bank before merging.

## Uninstall

Remove the `status-rotator` line from `cordis.patch.yml` and restart `dsh web`.

## Contributing

Issues and pull requests are welcome. The easiest way to add phrases: edit the `phrases` field in `config.json` or `config.example.json` directly — no code changes needed. Or use the **[phrase-submission form](#contributing-phrases-via-github-issues)** and let the bot validate and open the PR for you.

## Credits

This project wouldn't exist without the help of its contributors — see [CONTRIBUTORS.md](./CONTRIBUTORS.md).

## License

[MIT](./LICENSE)
