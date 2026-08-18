# dsh-status-rotator

> **English** | [中文](./README_ZH.md)

Replaces the `Deep diving...` status line in the DeepSeek Harness (dsh) Web UI's turn footer with your own text: phase-aware switching, typewriter output, animated rainbow gradient (optional), and timed rotation. The elapsed-time clock (which appears after 15 seconds) is untouched.

## Installation

Two ways to install: the recommended `dsh plugin add` command, or the manual copy. Either way, you need to restart `dsh web` once after first install.

### Option A: `dsh plugin add` (recommended)

The plugin's `package.json` declares a `dsh.bundle.patch` manifest, so it's recognized automatically after install — no extra flags needed. The command syntax is `dsh plugin --profile <name> add <package>` (e.g. `--profile web`):

- **From npm** (easiest): `dsh plugin --profile web add dsh-status-rotator`
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

## Features

- **Phase-aware**: three sets of phrases — `thinking` (just started) / `running` (after 15s) / `long` (past the threshold). Switches immediately when the clock appears or the timeout hits, no need to wait for the rotation interval;
- **Typewriter effect**: phrases are typed out character by character, speed configurable, 0 disables it;
- **Rainbow gradient**: text rendered with an animated gradient, colors and speed configurable, can be turned off with one switch;
- **Phrases separated from code**: all phrases live in `config.json`, editing them requires zero code and no restart;
- **Settings page**: a new "Status Texts" page in DSH's Settings, with visual editing for the Chinese/English × three-phase phrase banks, saves take effect immediately;
- **Auto-loading**: the node half registers an HTTP route to serve `config.json`, works out of the box with no localStorage or deployment needed;
- **Hot reload**: while the page stays open it re-reads `config.json` periodically, and re-reads immediately when you switch back to the tab — no refresh needed to apply new phrases;
- **Multilingual**: phrases switch live between Chinese and English following Settings → Language, unknown languages fall back to Chinese;
- **Zero-intrusion targeting**: locates TurnStatus precisely by `role="status"` + `aria-live="polite"`, so it never touches code snippets in the chat history or other aria-live regions, and never touches the clock.

## Phase Awareness

Phrases are split into three groups based on turn progress (determined by whether a clock has appeared in the TurnStatus element and its reading):

| Phase | Trigger | Default duration |
|---|---|---|
| `thinking` | Turn just started, no clock | 0 ~ 15s |
| `running` | Clock visible, under the limit | 15s ~ `longAfterMs` |
| `long` | Clock past `longAfterMs` | ≥ 60s |

Phase changes swap the phrase immediately without waiting for the rotation interval. If a phase has no phrase group, it falls back automatically (running → thinking → any non-empty group).

## Rainbow Gradient

Status text is shown with an animated rainbow gradient by default (applies to the text only, not the clock). Can be disabled or re-colored in the config:

```json
"gradient": {
    "enabled": false,                          // false to disable; true for default colors
    "colors": ["#ff5f6d", "#00ff88", "#4da6ff"], // gradient color sequence (at least 2, first/last cycle)
    "speed": 4                                 // animation speed (seconds per cycle)
}
```

## Configuration

Phrases are fully separated from the source code and live in JSON config files. There are two config files at the project root:

- **`config.example.json`** — the complete template committed to the repo: default config + all phrases (bilingual, split into three phases);
- **`config.json`** — your local personalized config, initialized by `node gen-config.cjs` (only created when missing, never overwrites your changes). It's in `.gitignore`, so edit freely without polluting git.

**Auto-loading (default)**: the plugin's node half registers an HTTP route (`/plugins/dsh-status-rotator/config.json`) that serves the `config.json` next to the plugin (read from disk on every request). The browser fetches it automatically by default, and **while the page stays open it re-reads every `reloadIntervalMs`, plus immediately when you switch back to the tab**, so as long as `config.json` sits in the plugin directory, phrase edits take effect **without a refresh or restart**. The only restart of `dsh web` needed is on first install.

```json
{
    "config": { "intervalMs": 10000, "typeSpeedMs": 30, "longAfterMs": 60000, "reloadIntervalMs": 15000, "debug": false, "gradient": { "enabled": true, "colors": ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"], "speed": 4 } },
    "phrases": { "zh": { "thinking": ["…"], "running": ["…"], "long": ["…"] }, "en": { "thinking": ["…"], "running": ["…"], "long": ["…"] } }
}
```

| Key | Default | Description |
|---|---|---|
| `intervalMs` | 10000 | Rotation interval (ms) |
| `typeSpeedMs` | 30 | Typewriter delay per character (ms), 0 disables the typewriter |
| `longAfterMs` | 60000 | Threshold for entering the `long` phase |
| `reloadIntervalMs` | 15000 | Interval for auto re-reading `config.json` while the page is open (ms), 0 disables |
| `debug` | false | Console diagnostic logs |
| `gradient` | see above | Rainbow gradient: `false` / `true` / `{enabled, colors, speed}` |
| `phrases` | from config file | The phrases (Chinese/English × three phases; partial entries allowed, missing ones fall back to other sources) |

Phrase source priority, highest first:

1. **localStorage single-text override** `dsh-status-rotator.texts[.<locale>]` / `texts`;
2. **localStorage full config** `dsh-status-rotator.config` (paste JSON, applies after refresh);
3. **External JSON**: `dsh-status-rotator.url` > `EXTERNAL_URL` constant > local auto-load (`/plugins/dsh-status-rotator/config.json`);
4. **Built-in defaults**: only `DEFAULT_CONFIG` at the top of `lib/client.js` (no phrases).

If a localStorage override matches, the external `config.json` is silently suppressed; the new version logs a `[status-rotator] ⚠ localStorage override active` warning in the browser console — when you see it, clear the corresponding key.

Old phrase-only external JSON (`{ "zh": [...], "en": [...] }` or `{ "thinking": [...] }`) is still supported and treated as a "phrases-only config".

Phrases switch live between Chinese and English following Settings → Language; unknown languages fall back to Chinese.

## Editing the Phrase Bank in the Settings Page

Open Settings in the bottom-left of DSH and a new **Status Texts** page appears in the navigation:

- **中文 / English** tabs, each with three text boxes for `thinking` / `running` / `long`, **one phrase per line**, blank lines are ignored;
- Each phase shows the current phrase count in real time;
- Basic settings (rotation interval, typewriter speed, long-task threshold, auto-reload interval) live on the same page;
- Clicking "Save Phrase Bank" makes the browser `PUT` the full JSON to `/plugins/dsh-status-rotator/config.json`; the node half validates it and **writes it back atomically**, and already-open pages hot-apply it immediately without a refresh;
- Submitted content is validated (phrases must be string arrays, etc.); invalid content returns 400 and shows an error on the page, so the config file can't be corrupted.

After upgrading to a version with the settings page, restart `dsh web` once (so the node half registers the write endpoint); everything after that can be done from the page.

## QQ Group Member Phrase Generator

To turn every member of a QQ group into a phrase like `正在路由（群成员）写代码...` (meaning "routing (group member) to write code..."), use `scripts/fetch-qq-group.cjs` to generate a standalone config file in one go — no need to type out the member list by hand.

Prerequisites: the bot is in the target group and you have a OneBot v11 compatible HTTP API (e.g. NapCat / LLOneBot / go-cqhttp / OpenShamrock).

```bash
# The default group is 684306814; generates config.qq684306814.json directly
node scripts/fetch-qq-group.cjs --url http://127.0.0.1:3000 --token your-token

# Directly replace the config.json the plugin actually uses (the old one is backed up as config.backup-<timestamp>.json)
node scripts/fetch-qq-group.cjs --url http://127.0.0.1:3000 --token your-token --activate

# No bot API? Save the member list as members.txt (one nickname per line) and generate from it
node scripts/fetch-qq-group.cjs --input members.txt
```

| Option | Default | Description |
|---|---|---|
| `-g, --group` | `684306814` | QQ group ID (also reads the `QQ_GROUP_ID` env var) |
| `-u, --url` | `http://127.0.0.1:3000` | OneBot HTTP URL (also reads `ONEBOT_HTTP_URL`) |
| `-t, --token` | empty | Access token (also reads `ONEBOT_ACCESS_TOKEN`) |
| `-a, --action` | `get_group_member_list` | Action path; frameworks with a prefix use `/api/...` |
| `-i, --input` | none | Local member list: txt (one per line) / json (array) / csv (first column) |
| `-o, --output` | `config.qq684306814.json` | Output file |
| `--activate` | off | Write back to `config.json` directly and back up the old file |
| `--dry-run` | off | Preview only, writes nothing |

The display name prefers the group card name, falling back to the nickname. The generated file contains only the `zh.thinking` group: per this plugin's fallback rules, the thinking phase uses it directly and the other phases fall back to the same group. Template: `config.qq684306814.example.json`; the generated `config.qq684306814.json` is gitignored.

## Project Structure

```
dsh-status-rotator/
├── lib/
│   ├── index.js            # node half: registers the HTTP route for config.json
│   └── client.js           # client half: status text replacement / gradient / typewriter
├── config.example.json     # complete template (default config + all phrases, committed)
├── config.qq684306814.example.json  # QQ group member phrase template (scripts/fetch-qq-group.cjs generates the real file)
├── config.json             # local personalized config (gitignored)
├── gen-config.cjs          # script that initializes config.json
├── scripts/
│   └── fetch-qq-group.cjs  # fetches QQ group members and generates the phrase config
├── package.json
├── README.md               # English docs
├── README_ZH.md            # Chinese docs
├── CONTRIBUTORS.md         # English contributors
├── CONTRIBUTORS_ZH.md      # Chinese contributors
└── LICENSE
```

## Uninstall

Remove the `status-rotator` line from `cordis.patch.yml` and restart `dsh web`.

## Contributing

Issues and pull requests are welcome. The easiest way to add phrases: edit the `phrases` field in `config.json` or `config.example.json` directly — no code changes needed.

## Credits

This project wouldn't exist without the help of its contributors — see [CONTRIBUTORS.md](./CONTRIBUTORS.md).

## License

[MIT](./LICENSE)
