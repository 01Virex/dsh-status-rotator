// Node-only regression: exact SVG strings, topology slots, codec and junctions.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { pack } = require("./pack-whale-tail.cjs");
const expected = require("./fixtures/whale-tail-hashes.json");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const parse = pose => pose.split(" M").map(part => {
	assert.match(part, /^M?[-\d.]+ [\s\S]* Z$/);
	const coords = part.match(/-?\d+(?:\.\d+)?/g).map(Number);
	assert(coords.every(Number.isFinite));
	return Array.from({ length: coords.length / 2 }, (_, i) => coords.slice(i * 2, i * 2 + 2));
});

function load(source) {
	let factory;
	vm.runInNewContext(source, { window: { __ModuleLoader__: { load: def => { factory = def.factory; } } } });
	const api = factory(() => ({}));
	assert.equal(typeof api.apply, "function");
	const decoder = api.__test.decodeWhaleTailPoses;
	assert.equal(typeof decoder, "function", "smooth-tail decoder is present (before: 24/24/36 frames)");
	const block = source.match(/\/\/ BEGIN GENERATED SMOOTH TAIL[\s\S]*?\/\/ END GENERATED SMOOTH TAIL/);
	assert(block, "generated smooth frames are present");
	const context = { decodeWhaleTailPoses: decoder };
	const poses = vm.runInNewContext(`(() => {${block[0]}\n; return Object.fromEntries(["wag", "sway", "twist"].map(name => [name, smoothTailPoses(name)]));})()`, context);
	const official = source.match(/\/\/ BEGIN GENERATED OFFICIAL TAIL[\s\S]*?\/\/ END GENERATED OFFICIAL TAIL/)[0];
	poses.official = vm.runInNewContext(`(() => {${official}\n; return officialTailPoses();})()`);
	return { poses, api, official, block: block[0] };
}

function verify(source, reference) {
	const { poses, api, official } = load(source);
	assert.equal(hash(official.replace(/\r\n/g, "\n")), expected.official, "official material is unchanged (checkout line endings normalized)");
	for (const name of ["wag", "sway", "twist", "official"]) {
		const frames = poses[name];
		assert.equal(frames.length, 150, name + " frame count");
		const counts = name === "twist" ? [1024, 256, 256, 256, 256, 256] : [256];
		for (const frame of frames) {
			const contours = parse(frame);
			assert.deepEqual(contours.map(p => p.length), counts);
			assert.equal(contours.map(p => "M" + p.map(v => v.join(" ")).join(" L") + " Z").join(" "), frame);
			assert(contours.flat().every(([x, y]) => x >= 0 && x <= 320 && y >= 0 && y <= 300));
		}
		if (name !== "official") {
			assert.equal(hash(JSON.stringify(frames)), expected.hashes[name], name + " exact approved SVGs");
			assert.equal(JSON.stringify(api.__test.decodeWhaleTailPoses(pack(frames))), JSON.stringify(frames), name + " lossless codec roundtrip");
			if (reference) assert.equal(JSON.stringify(frames), JSON.stringify(reference[name]), name + " all 150 reference strings");
		}
		console.log(`PASS ${name}: 150 frames; ${counts.join("+")} points; closed, finite, exact SVGs`);
	}
	const tiny = ["M0 0 L-0.001 0.001 L1.024 -1.024 Z M-2 -3 L-2 -3 L-2 -3 Z"];
	assert.equal(JSON.stringify(api.__test.decodeWhaleTailPoses(pack(tiny))), JSON.stringify(tiny));
	let bridges = 0;
	for (const from of Object.keys(poses)) for (const to of Object.keys(poses)) if (from !== to) {
		const frames = api.__test.whaleTailBridgeFrames(poses[from][0], poses[to][0]);
		assert.equal(frames.length, 6);
		assert.equal(frames[0], poses[from][0]);
		assert.equal(frames.at(-1), poses[to][0]);
		bridges++;
	}
	assert.equal(api.__test.whaleTailWagFrequency({enabled:true, mode:"fixed", fixedSpeed:0.25}, 0), 0.25);
	assert(source.includes("steps(1,end) infinite"), "per-pose discrete playback is retained");
	assert(source.includes("const divisor = from ? poses.length - 1 : poses.length"), "keyframes use the decoded frame count");
	assert(source.includes("4000 + Math.random() * 4000"), "random switch window stays 4–8 seconds");
	console.log(`PASS codec edge cases; official bytes; ${bridges} bridges; fixed 0.25 Hz = 4 s; random window`);
	return poses;
}

module.exports = { load, verify, parse, hash };
if (require.main === module) {
	const client = (process.argv.find(a => a.startsWith("--client=")) || "").slice(9) || path.join(__dirname, "../lib/client.js");
	const reference = (process.argv.find(a => a.startsWith("--reference=")) || "").slice(12);
	verify(fs.readFileSync(client, "utf8"), reference ? JSON.parse(fs.readFileSync(reference, "utf8")) : null);
}
