# Contributors

> **English** | [中文](./CONTRIBUTORS_ZH.md)

Thanks to everyone who contributed code, ideas, or phrases to this project. Without your effort, this plugin wouldn't have grown into what it is today.

## Project Author

**[01Virex](https://github.com/01Virex)** (git alias Umamed26) — project founder and lead maintainer. Designed and implemented phase-aware phrase groups, the typewriter effect, the rainbow gradient, config/phrase separation, config auto-loading, and that phrase bank full of AI-community memes. Also shipped the **weighted-random phrase picker** (PR #15, v0.12.0) and the **meme-bank expansion batches 1-5** (PR #16, v0.13.0). Most recent: **v0.23.0**, which closed Issue #41 by making the gradient's flow direction configurable (`direction`: `rtl` default / `ltr` left-to-right, the same seamless loop played in reverse); before that came **v0.22.0** (day/night palettes that follow the interface theme, Issue #39), **v0.21.0** (the phrase bank refreshes itself from upstream every 6 hours), **v0.20.0** (external, writable bank layer with hot reload), **v0.19.0** (bilibili-style top/bottom danmaku) and **v0.18.0** (settings page restructured into four tabs, save-on-change, merging mrbbbaixue's PR #38), while **v0.17.3** fixed `{pending}` (it had been reading a field dsh no longer writes, so it always rendered `0`) and made the live placeholders re-render the moment their value changes instead of waiting for the next rotation.

## Contributors

### Code & Infrastructure

**[liceses](https://github.com/liceses)** — submitted **PR #1** (`fix: scope label takeover to role=status + aria-live=polite`, the precise status-label targeting fix, still in use today) and **PR #2** (`chore: declare dsh.bundle manifest`, enabling one-click install via `dsh plugin add`). Special thanks!

**[mrbbbaixue](https://github.com/mrbbbaixue)** — submitted **PR #13** (`fix: normalize abbreviations and brand/model capitalization in the default phrase bank`, e.g. `Deepseek` → `DeepSeek`), **PR #14** (`feat(settings): restyle the settings window controls and layout to match the official DSH settings pages` — 720px content column, hairline groups, official switches and pill buttons), **PR #37** (`chore(pill): remove the floating status Pill code kept as comments since 0.15.0` — over 160 lines of dead code dropped from `lib/client.js`, and the stalled listener mechanism that went with it was retired in v0.17.3) and **PR #38** (`feat(settings): four-tab settings page, aligned with the official spec, saving switched to write-on-change` — nine groups folded into Texts / Appearance / Behavior / Automation, plus preset create-rename-delete, live numeric validation with restore-default, schedule rules as cards, and five bug fixes including silently dropped drafts). Thanks for the UI upgrade and the cleanup!

### Ideas & Feedback

- **[fplj-fplj](https://github.com/fplj-fplj)** — suggested adjustable font weight for the status text (**Issue #12**, shipped in v0.10.0 as `config.fontWeight`, applied to the status text and the danmaku).
- **[Ztyss](https://github.com/Ztyss)** — reported **Issue #6**: the settings page had no switch to turn the rainbow gradient off, and upgrading the plugin wiped `config.json` (all custom settings). Both were fixed in **v0.6.1** — the settings-page gradient controls and the upgrade-safe settings store (`$DSH_HOME/settings.yaml`, official dsh namespace) exist because of this report.
- **[xiaijiangxue](https://github.com/xiaijiangxue)** — reported **Issue #39**: with a single bright gradient palette the status text washed out on the light (day) interface. Shipped in **v0.22.0** as two palettes — `dayColors` for the light theme and `colors` for the dark theme — plus `mode: auto / day / night`, so it follows the interface theme automatically or can be forced.
- **[xiaijiangxue](https://github.com/xiaijiangxue)** — reported **Issue #41**: the rainbow gradient always swept right to left, opposite to the left-to-right typewriter, and asked for a direction option. Shipped in **v0.23.0** as `gradient.direction` (`rtl` default / `ltr`), with a "Flow direction" select in the settings page and instant preview.

### Phrases & Community

Most of the phrase bank comes from members of QQ groups **641028237** and **1103406958** — thank you! Because the contributions were scattered across group chats, we can't reliably list everyone by name. If you contributed phrases and would like to be credited, please reach out to the maintainer ([01Virex](https://github.com/01Virex)) and we'll add you here.

- **deesnolem** — contributed phrases.
- **[NotUNperson](https://github.com/NotUNperson)** — contributed phrases.
- **[Fuhua-code](https://github.com/Fuhua-code)** — contributed phrases.
- **[rruixi](https://github.com/rruixi)** — contributed phrases.
- **[fplj-fplj](https://github.com/fplj-fplj)** — contributed phrases.
- **[milk dragon](https://github.com/1251639747jm-ctrl)** — contributed phrases.
- **[TanPowasd](https://github.com/TanPowasd)** — contributed phrases.
- **[dancha0fan](https://github.com/dancha0fan)** — contributed phrases.
- **[YunMeng-ink](https://github.com/YunMeng-ink)** — contributed phrases.
- **[achenjins](https://github.com/achenjins)** — contributed phrases.
- **[laszapens](https://github.com/laszapens)** — contributed phrases.
- **[hu-1145](https://github.com/hu-1145)** — contributed phrases.
- **[IThinkItsaName](https://github.com/IThinkItsaName)** — contributed phrases.
- **[xiaozi233](https://github.com/xiaozi233)** — contributed phrases.
- **[xialongxl](https://github.com/xialongxl)** — submitted the phrases merged as **PR #73** (from submission issue #72).
- **[Clmzz-gra](https://github.com/Clmzz-gra)** — submitted the phrases merged as **PR #75** (issue #74) and **PR #77** (issue #76).

## Real Contribution Stats (synced from the GitHub API)

> The data below comes from the public contributor API of [`01Virex/dsh-status-rotator`](https://github.com/01Virex/dsh-status-rotator) and has nothing to do with the "Cloud Contributors" meme zone above. Note that these stats only count commits — phrase-only contributors listed under "Phrases & Community" don't appear here.

| Contributor | Commits | Notes |
| --- | --- | --- |
| [Umamed26](https://github.com/Umamed26) | 108 | Project author's (01Virex) git alias; main development and maintenance (incl. PR #15 weighted-random, PR #16 meme-bank expansion, PR #35 modular phrase packs, PR #36 ten-pack bank restructuring, PR #40 day/night gradient for Issue #39, PR #42 gradient flow direction for Issue #41, and the recent #65 durable settings store, #66 star-workflow fork guard, #68 tab-title ownership + settings-page controls, #69 star-pack PR merge flow, #78 submission-branch conflict self-healing + duplicate-key guard, #81 semicolon filter) |
| [01Virex](https://github.com/01Virex) | 22 | Repo account, merged PRs and released |
| github-actions[bot] | 72 | Phrase-submission bot (validation, auto-PR, branch refresh), the star-pack refresh workflow, and the QC workflow iterations |
| [mrbbbaixue](https://github.com/mrbbbaixue) | 4 | PR #13 (default phrase-bank capitalization normalization) + PR #14 (settings window restyled to the official DSH style) + PR #37 (removing the dead Pill code) + PR #38 (four-tab settings page, write-on-change saving) |
| [liceses](https://github.com/liceses) | 2 | PR #1 (status label targeting) + PR #2 (dsh.bundle manifest) |

**208 commits** in total (synced 2026-09-25) — three real human contributors (**Umamed26**, **liceses**, **mrbbbaixue**), plus the repo account's merge/release commits and the phrase bot's own bank entries. Respect to everyone who seriously submits code ❤️

> Re-syncing is one API call: `https://api.github.com/repos/01Virex/dsh-status-rotator/contributors?per_page=100` returns `login` + `contributions` for every contributor (bot accounts included).

## Special Thanks

- **[DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness)** — for the extensible client plugin system that made this toy plugin possible;
- **[iiwish](https://github.com/iiwish)** — for **DSH Testkit** (Issue #5) lifecycle compatibility check: the findings shaped the plugin's host-safe activation design (no hard dependency on webServer/settings; stays alive in headless hosts and registers routes lazily);
- The news sources and creators behind every meme in the phrase bank — those phrases record the collective memory of the 2026 AI community.

## Cloud Contributors (meme zone · satire)

The following list is purely a joke. The real people behind these names have no actual contribution relationship with this project; if it offends you, it means you're being satirized:

- **梁蚊蜂** (Liang Wenfeng) — contributed the reputation swing from "Liang the Saint" to "Liang the ÷", plus the out-of-this-world tech of pixel-perfect screenshot comparisons;
- **崔添蚁** — contributed taking the heat before DeepSeek V4 Pro's official release;
- **杨植麟** (Yang Zhilin, Zhipu AI) — contributed prices benchmarked against ChatGPT;
- **张鹏** (Zhang Peng) — contributed the GLM Coding Plan that everyone kept missing out on;
- **林俊羊** — contributed the users' milk tea;
- **李燕宏** (Robin Li) — contributed the ERNIE Bot model;
- **马狮克** (Elon Musk) — contributed Grok's R18 content;
- **达狸奥** — contributed the "AI safety first" slogan;
- **奥特鳗** (OpenAI) — contributed the metamorphosis from non-profit to for-profit to being chased and bitten by Musk;
- **哈鲨比斯** (Demis Hassabis) — contributed the "fast and fast" Gemini model;
- **codex** — contributed the Responses API, making the whole internet lose it every time DeepSeek updates its docs;
- **claude code** — contributed the top-tier technology of banning Chinese IPs on sight;
- **dsh** — contributed the entire plugin system; without it this project wouldn't exist at all;
- **opencode** — contributed the most affordable OpenCode Go plan — Saint Dax!

> All of the above satire is purely a joke and has nothing to do with real people, real companies, or real products; any resemblance is because the internet remembers.

## How to Contribute

- **Submit phrases**: open the **「词库投稿 💬」** form from the Issues page — the bot validates, replies with a preview and a "try it now" JSON, and opens a ready-to-merge PR automatically; **one phrase per line** (an in-line `;` / `；` is rejected — see [Submitting Phrases via Issues](./README.md#contributing-phrases-via-github-issues)); you can also edit the `phrases` field in `config.json` / `config.example.json` directly;
- **Change behavior**: PRs are welcome at [01Virex/dsh-status-rotator](https://github.com/01Virex/dsh-status-rotator);
- **Report issues / request features**: open an Issue describing the dsh version, the symptom, and console output — feature suggestions are credited in the "Ideas & Feedback" section above.

Thanks again to every contributor ❤️
