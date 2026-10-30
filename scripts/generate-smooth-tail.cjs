// Dev-only: original keys -> cyclic 150-frame SVGs -> lossless packed data.
// python -m pip install -r scripts/smooth-tail-requirements.txt
// node scripts/generate-smooth-tail.cjs --check [--python=python3]
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { render } = require("./pack-whale-tail.cjs");
const { verify, parse, hash } = require("./verify-smooth-tail.cjs");
const keys = require("./fixtures/whale-tail-keys.json");
const expected = require("./fixtures/whale-tail-hashes.json");
const frames = 150, points = 256;
const rotate = (a, n) => a.slice(n).concat(a.slice(0, n));

function canonical(p) {
	const area = p.reduce((sum, a, i) => { const b = p[(i + 1) % p.length]; return sum + a[0] * b[1] - a[1] * b[0]; }, 0);
	if (area < 0) p = p.slice().reverse();
	let best = 0;
	for (let i = 1; i < p.length; i++) if ((p[i][0] - 130) ** 2 + (p[i][1] - 269) ** 2 < (p[best][0] - 130) ** 2 + (p[best][1] - 269) ** 2) best = i;
	return rotate(p, best);
}

function resample(p) {
	const lengths = p.map((a, i) => Math.hypot(a[0] - p[(i + 1) % p.length][0], a[1] - p[(i + 1) % p.length][1]));
	const total = lengths.reduce((a, b) => a + b, 0);
	let edge = 0, travel = 0;
	return Array.from({ length: points }, (_, i) => {
		const d = i * total / points;
		while (edge < p.length - 1 && travel + lengths[edge] < d) travel += lengths[edge++];
		const a = p[edge], b = p[(edge + 1) % p.length], t = lengths[edge] ? (d - travel) / lengths[edge] : 0;
		return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
	});
}

function linearLoop(poses) {
	const keys = poses.map(p => resample(canonical(parse(p)[0])));
	const num = x => String(Number(x.toFixed(3)));
	return Array.from({ length: frames }, (_, i) => {
		const u = i * keys.length / frames, j = Math.floor(u), t = u - j, a = keys[j], b = keys[(j + 1) % keys.length];
		return "M" + a.map((p, k) => p.map((v, axis) => num(v + (b[k][axis] - v) * t)).join(" ")).join(" L") + " Z";
	});
}

const generated = {};
for (const name of ["wag", "sway"]) generated[name] = linearLoop(rotate(keys[name].poses, keys[name].phase));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-smooth-tail-"));
try {
	const input = path.join(temporary, "keys.json"), output = path.join(temporary, "twist.json");
	fs.writeFileSync(input, JSON.stringify({ poses: rotate(keys.twist.poses, keys.twist.phase) }), "utf8");
	const python = (process.argv.find(a => a.startsWith("--python=")) || "").slice(9) || process.env.PYTHON || "python3";
	const result = spawnSync(python, [path.join(__dirname, "smooth-tail-twist.py"), "--input", input, "--output", output], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
	assert.equal(result.status, 0, result.error?.message || result.stderr);
	process.stdout.write(result.stdout);
	generated.twist = JSON.parse(fs.readFileSync(output, "utf8")).paths;
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
for (const name of Object.keys(generated)) assert.equal(hash(JSON.stringify(generated[name])), expected.hashes[name], name + ": approved-frame digest; review any generator/platform difference before accepting new geometry");

const client = path.join(__dirname, "../lib/client.js");
const source = fs.readFileSync(client, "utf8");
const pattern = /\/\/ BEGIN GENERATED SMOOTH TAIL[\s\S]*?\/\/ END GENERATED SMOOTH TAIL/;
assert(pattern.test(source), "generated block exists");
const patched = source.replace(pattern, render(generated));
verify(patched, generated);
if (process.argv.includes("--check")) assert.equal(patched, source, "generated material is reproducible");
else fs.writeFileSync(client, patched, "utf8");
console.log(process.argv.includes("--check") ? "PASS complete regeneration is byte-identical" : "Updated smooth-tail data in lib/client.js");
