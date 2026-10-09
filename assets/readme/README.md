# README demonstrations

These assets show `lib/client.js` running in the minimal DSH host provided by
`scripts/readme-demo.html`. They are plugin previews, not screenshots of a full
DSH application. The phrase bank is a small, custom English example shared by both
READMEs. The animated demonstrations use no user conversation or external screenshot.

## Desktop installation screenshots

The four `desktop-*.png` files are real Windows window captures of DSH Desktop
0.2.0-rc.2, taken with the user's permission for the npm installation tutorial:

| Screenshot | Shows |
| --- | --- |
| `desktop-plugin-entry.png` | Plugin-page header and Add plugin button |
| `desktop-npm-install.png` | Add plugin dialog with `dsh-status-rotator` entered |
| `desktop-plugin-enabled.png` | Existing installed plugin with its enable switch on |
| `desktop-status-settings.png` | Status Texts settings and the whale-tail controls |

The user already had the plugin installed, so the dialog was closed without
reinstalling it. These captures document the installation UI and an existing
settings page, not a new npm installation acceptance run. The settings image
shows the user's existing custom parameters rather than factory defaults;
capturing it did not change those parameters.

Only the tutorial regions were cropped; conversation lists and account details
are excluded. No UI labels, package names or controls were replaced in the images.

## Animated demonstrations

| Asset | Purpose | Motion |
| --- | --- | --- |
| `status-preview.gif` | Phrase rotation, typewriter output, light/dark gradients and flipping tail | 6.04 seconds, 25 fps, wag at 1 cycle/s |
| `whale-motions.gif` | Flipping tail / sway / twist comparison | 4.04 seconds, 25 fps, each at 0.5 cycles/s |
| `*.svg` | Editable static fallback with the actual painted contour | No animation |
| `*.png` | Exact first-frame browser capture | No animation |

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
inspect the live status preview; add `?view=variants` for the motion comparison.

The renderer controls the actual plugin timers and CSS animation timeline,
captures frames in the browser, then uses a shared ffmpeg palette with no dither
and rectangle deltas. This preserves SVG contour keyframes and real typewriter
behavior; a generic SVG-layer entrance renderer cannot reproduce either.
SVG fallbacks are exported from the same live DOM. Temporary frames are removed
after rendering. Each GIF has a 2 MiB budget and a 40ms entry-frame hold at the
end, so its last and first frames match exactly.

Sway, twist and switching are included in v0.35.0. The comparison asset uses
the legacy label “Original wag” for the flipping tail; the official sway is a
separate action and is not shown in this three-action comparison. The motion contours use the same implementation and
reference provenance documented in `docs/whale-tail-reference.md`.
