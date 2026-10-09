# README demonstrations

These assets show `lib/client.js` running in the minimal DSH host provided by
`scripts/readme-demo.html`. They are plugin previews, not screenshots of a full
DSH application. The phrase bank is a small, custom English example shared by both
READMEs. No user conversation or external screenshot is used.

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
