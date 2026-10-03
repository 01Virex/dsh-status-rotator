"""Trace the supplied 150-frame reference into code-native SVG poses (dev only).

Requires Pillow and numpy. No image is generated or modified for runtime use.
The checked-in reference retains its timing; duplicate poses share path strings.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
START = "\t\t\t// BEGIN GENERATED OFFICIAL TAIL"
END = "\t\t\t// END GENERATED OFFICIAL TAIL"


def contours(mask):
    edges = {}
    h, w = mask.shape
    for y, x in zip(*np.nonzero(mask)):
        if y == 0 or not mask[y - 1, x]:
            edges[(int(x), int(y))] = (int(x + 1), int(y))
        if x == w - 1 or not mask[y, x + 1]:
            edges[(int(x + 1), int(y))] = (int(x + 1), int(y + 1))
        if y == h - 1 or not mask[y + 1, x]:
            edges[(int(x + 1), int(y + 1))] = (int(x), int(y + 1))
        if x == 0 or not mask[y, x - 1]:
            edges[(int(x), int(y + 1))] = (int(x), int(y))
    loops = []
    while edges:
        first = next(iter(edges))
        p, loop = first, []
        while p in edges:
            loop.append(p)
            p = edges.pop(p)
            if p == first:
                break
        if len(loop) >= 20:
            loops.append(loop)
    return sorted(loops, key=lambda points: abs(area(points)), reverse=True)


def area(points):
    return sum(a[0] * b[1] - a[1] * b[0] for a, b in zip(points, points[1:] + points[:1])) / 2


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", nargs="?", default=str(ROOT / "assets/references/official-tail.gif"))
    args = parser.parse_args()
    source = Path(args.source)
    image = Image.open(source)
    shapes, timeline, durations, counts, overlaps = [], [], [], [], []
    baseline = None
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    for i in range(image.n_frames):
        image.seek(i)
        rgb = np.asarray(image.convert("RGB")).astype(int)
        mask = (rgb[:, :, 2] - rgb[:, :, 0] > 35) & (rgb[:, :, 0] < 160)
        loops = contours(mask)
        counts.append(len(loops))
        # The existing contours have their roots at y=270. Translate the supplied
        # 320px artwork by (16, 18), preserving every frame's deformation/scale.
        if len(loops) != 1:
            raise ValueError("Official reference must have one connected outline")
        points = np.asarray(loops[0], dtype=float)
        following = np.roll(points, -1, axis=0)
        lengths = np.linalg.norm(following - points, axis=1)
        distances = np.concatenate(([0], np.cumsum(lengths)))
        # Fixed correspondence keeps compact signed deltas and avoids tearing.
        sample_at = np.arange(256) * distances[-1] / 256
        sampled = np.column_stack([np.interp(sample_at, distances, np.append(points[:, axis], points[0, axis])) for axis in range(2)])
        if baseline is not None:
            shift = min(range(256), key=lambda j: np.square(np.roll(sampled, -j, axis=0) - baseline).sum())
            sampled = np.roll(sampled, -shift, axis=0)
        sampled = np.rint(sampled).astype(int)
        raster = Image.new("1", (mask.shape[1] * 4, mask.shape[0] * 4))
        ImageDraw.Draw(raster).polygon([tuple(point * 4) for point in sampled], fill=1)
        actual = np.asarray(raster)[2::4, 2::4]
        overlaps.append(float((actual & mask).sum() / (actual | mask).sum()))
        if baseline is None:
            baseline = sampled.copy()
        delta = (sampled - baseline).flatten()
        if delta.min() < -32 or delta.max() > 31:
            raise ValueError("Reference no longer fits the compact delta range")
        encoded = "".join(alphabet[int(n) + 32] for n in delta)
        if encoded not in shapes:
            shapes.append(encoded)
        timeline.append(shapes.index(encoded))
        durations.append(image.info.get("duration", 20))
    if len(set(durations)) != 1:
        raise ValueError("Reference no longer has uniform frame timing")
    block = "\n".join([START,
        f"\t\t\t// GIF89a: {image.n_frames} x {durations[0]}ms; sha256 {hashlib.sha256(source.read_bytes()).hexdigest()}.",
        "\t\t\tconst TAIL_OFFICIAL_BASE = " + json.dumps((baseline + [16, 18]).flatten().tolist(), separators=(",", ":")) + ";",
        "\t\t\tconst TAIL_OFFICIAL_DELTAS = [",
        *["\t\t\t\t" + json.dumps(p) + "," for p in shapes],
        "\t\t\t];",
        "\t\t\tconst TAIL_OFFICIAL_TIMELINE = " + json.dumps(timeline, separators=(",", ":")) + ";",
        "\t\t\tlet tailOfficialPoses = null;",
        "\t\t\tconst officialTailPoses = () => {",
        "\t\t\t\tif (!tailOfficialPoses) {",
        "\t\t\t\t\tconst alphabet = \"" + alphabet + "\";",
        "\t\t\t\t\tconst shapes = TAIL_OFFICIAL_DELTAS.map(encoded => {",
        "\t\t\t\t\t\tconst points = [];",
        "\t\t\t\t\t\tfor (let i = 0; i < encoded.length; i += 2) points.push((TAIL_OFFICIAL_BASE[i] + alphabet.indexOf(encoded[i]) - 32) + \" \" + (TAIL_OFFICIAL_BASE[i + 1] + alphabet.indexOf(encoded[i + 1]) - 32));",
        "\t\t\t\t\t\treturn \"M\" + points.join(\" L\") + \" Z\";",
        "\t\t\t\t\t});",
        "\t\t\t\t\ttailOfficialPoses = TAIL_OFFICIAL_TIMELINE.map(i => shapes[i]);",
        "\t\t\t\t}", "\t\t\t\treturn tailOfficialPoses;", "\t\t\t};", END])
    client = ROOT / "lib/client.js"
    text = client.read_text(encoding="utf-8")
    if START in text:
        before, remaining = text.split(START, 1)
        _, after = remaining.split(END, 1)
        text = before + block + after
    else:
        anchor = "\t\t\t// Matched junctions (zero-based):"
        index = text.index(anchor)
        text = text[:index] + block + "\n" + text[index:]
    client.write_text(text, encoding="utf-8", newline="\n")
    print(json.dumps({"frames": image.n_frames, "uniquePaths": len(shapes), "durationMs": sum(durations), "contoursPerFrame": sorted(set(counts)), "pathBytes": len(block), "minMaskIoU": min(overlaps), "meanMaskIoU": sum(overlaps) / len(overlaps)}, indent=2))
    if min(overlaps) < 0.92:
        raise ValueError("Traced contour deviates too far from supplied reference")


if __name__ == "__main__":
    main()
