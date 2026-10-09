# README demonstrations

These assets show `lib/client.js` running in the minimal DSH host provided by
`scripts/readme-demo.html`. They are plugin previews, not screenshots of a full
DSH application. The phrase bank is a small, custom English example shared by both
READMEs. The animated demonstrations use no user conversation or external screenshot.

README image URLs are absolute and pinned to the fork's asset commit. This keeps
the same previews available on GitHub and the npm package page, without reading
the upstream branch's older animations or depending on a mutable preview branch.

## Desktop installation screenshot

`desktop-npm-install.png` is the user's supplied, clear screenshot of the
DSH Desktop 0.2.0-rc.2 Add plugin dialog with `dsh-status-rotator` entered.
It is retained at its original pixel size, without resizing or recompression.
The other three desktop screenshots were removed at the user's request.

The user already had the plugin installed. This image documents the npm
installation UI, not a new installation acceptance run. It contains no account
details or conversation lists, and no UI labels or controls were replaced.

## Animated demonstrations

| Asset | Purpose | Motion |
| --- | --- | --- |
| `status-preview.gif` | Phrase rotation, typewriter output, light/dark gradients and official sway | 12.04 seconds, 25 fps; official at 0.25 cycles/s |
| `whale-motions.gif` | Official sway / flipping tail / sway / twist in a two-by-two board | 4.04 seconds, 25 fps; official at 0.25 cycles/s, others at 0.5 |
| `appearance-themes.png` | All five built-in themes, read from `plugin.__test.themeById` | Static capture at 2x pixel density; status rows enlarged 1.5x |
| `danmaku-preview.png` | Real scrolling and fixed danmaku above the status row | Static capture at 2x pixel density; enlarged text and opacity 0.8 |
| `*.svg` | Editable static fallback with the actual painted contour | No animation |
| `status-preview.png` / `whale-motions.png` | Exact first-frame browser capture | No animation |

Visual direction: a quiet status-row specimen for DSH users; `#f5f7fb` canvas,
`#ffffff` / `#171a23` theme surfaces, `#24314a` text and the plugin's blue, purple
and teal gradients. System fonts, 14px corners and fixed icon containers keep the
focus on phrase changes and contour deformation.

## Regenerate

Use Node.js with Playwright available (locally installed or supplied through
`NODE_PATH`), a Chromium browser and `ffmpeg` on `PATH`:

```sh
node scripts/render-readme-demo.cjs
```

Set `DSH_README_BROWSER` to an executable path if automatic browser discovery
does not find your browser. Alternatively, open `scripts/readme-demo.html` to
inspect the live status preview; add `?view=variants` for the four-action
comparison, `?view=themes` for the theme board, or `?view=danmaku` for danmaku.
Use `--variants-only` or `--stills-only` to regenerate only those assets.

The renderer controls the actual plugin timers and CSS animation timeline,
captures frames in the browser, then uses a shared ffmpeg palette with no dither
and rectangle deltas. This preserves SVG contour keyframes and real typewriter
behavior; a generic SVG-layer entrance renderer cannot reproduce either.
SVG fallbacks are exported from the same live DOM. Temporary frames are removed
after rendering. Each GIF has a 2 MiB budget and a 40ms entry-frame hold at the
end, so its last and first frames match exactly.

All four actions are included in v0.35.0. The old “Original wag” label has been
replaced by “Flipping tail”; only the 150-frame official action is labeled
“Official sway”. The motion contours use the same implementation and reference
provenance documented in `docs/whale-tail-reference.md`.
