# Contributing to dsh-status-rotator

Thanks for wanting to help! This plugin replaces the DSH Web status line with configurable phrases, and it lives on contributions — code, phrases and bug reports all count. [中文版 →](./CONTRIBUTING_ZH.md)

## Ways to contribute

| What | How |
| --- | --- |
| **Phrases** (most common) | Use the **[phrase submission form](https://github.com/01Virex/dsh-status-rotator/issues/new?template=phrase-submit.yml)** — the bot validates it and opens a PR for you. Ad entries go through the same form by picking the `ads` target pack (**one line = one ad**, written as a progressive phrase + its source). Do **not** hand-edit `config.example.json` for this; the bot keeps counts and formatting in sync. |
| **Code / docs** | Fork → branch → PR (see below). |
| **Bugs** | Open an issue with your dsh version, the host profile, what you saw and any console output. |

## Development

There is **no build step** and no runtime dependency: the plugin is plain JS (`lib/index.js` = node half, `lib/client.js` = client half, `config.example.json` = the shipped phrase bank).

```bash
git clone https://github.com/<you>/dsh-status-rotator && cd dsh-status-rotator
npm test                                  # smoke: pure functions + bank integrity (~400 assertions)
node scripts/run-danmaku-mount-test.cjs --page=settings   # settings page in a real browser
node scripts/run-turn-process-test.cjs    # status-line scenarios (0.1.6 / 0.1.7 / 0.2.0 fixtures)
node scripts/verify-settings-survive-upgrade.cjs          # endpoint-level verifiers
```

`scripts/` is **dev-only** (it is not in `package.json` `files`). CI runs three jobs (see [`.github/workflows/test.yml`](./.github/workflows/test.yml)): `qc` (plugin manifest), `test` (smoke + verifiers) and `browser` (the browser harnesses). **All three must be green before a PR is merged.**

## Conventions that reviewers will check

- **Host generations**: the plugin must keep working on dsh ≤0.1.6 (`role="status"`), 0.1.7+ (`button[data-turn-process]`) **and** 0.2.0+ (`div[data-chat-running]`). Never key off hashed class names; prefer the stable attributes.
- **`<style>` ownership**: every element you create must go through `createOwnedStyle()` so it carries `data-plugin` — untagged styles get claimed by the host's module system and deleted (issue #94).
- **Settings**: a new key needs `DEFAULT_CONFIG`, `normalizeConfig()` (client) **and** the node-half sanitiser, plus membership in the settings page's `editorState` object — the signature and dependency arrays derive from it (issue #96).
- **Teardown**: anything you register (styles, observers, maps, timers) must be released on turn end and on unload; the leak scenario in `scripts/run-turn-process-test.cjs` watches container sizes (issue #87).
- **Bank style**: one phrase per line, ends with `…`, no `;` / `；`, no duplicates, no HTML; links only inside the `ads` pack.
- **Docs**: user-visible changes need a `CHANGELOG.md` entry, and `README.md` / `README_ZH.md` (plus `CONTRIBUTORS*.md` when you credit someone) stay in sync — the repo keeps Chinese/English pairs.

## PR flow

1. Branch from `main` (naming like `fix/…`, `feat/…`, `docs/…` is appreciated).
2. Make the change **plus** its regression coverage — a fix without a failing-before/passing-after test is hard to accept.
3. Open the PR: fill in the template, link the issue, and paste the **before/after evidence** (command + observed result).
4. CI runs; a maintainer reviews and squash-merges. Please keep the branch rebased if `main` moved (conflicting PRs cannot run CI at all on GitHub).
5. Releases are cut by the maintainer only (version bump + CHANGELOG + **`npm publish` first**, then tag/Release).
   The npm `stable` dist-tag is pointed at the new version automatically by `release.yml` once the Release is created; `latest` still comes from `npm publish`.

## Credits

Everyone who contributes code, phrases or a good bug report is listed in [CONTRIBUTORS.md](./CONTRIBUTORS.md) / [CONTRIBUTORS_ZH.md](./CONTRIBUTORS_ZH.md). Tell us how you want to be named.

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md). For vulnerabilities, please read [SECURITY.md](./SECURITY.md) instead of opening a public issue.
