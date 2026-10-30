// Dev-only encoder. Runtime decoder: decodeWhaleTailPoses in lib/client.js.
const assert = require("node:assert/strict");
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function unsigned(value) {
	let out = "";
	do {
		const digit = value % 32;
		value = Math.floor(value / 32);
		out += alphabet[digit + (value ? 32 : 0)];
	} while (value);
	return out;
}

function pack(poses) {
	const values = [];
	let points;
	for (const pose of poses) {
		const contours = pose.split(" M").map(part => {
			assert.match(part, /^M?[-\d.]+ [\s\S]* Z$/);
			const coords = part.match(/-?\d+(?:\.\d+)?/g).map(Number);
			assert.equal(coords.length % 2, 0);
			let previous = [0, 0], delta = [0, 0];
			for (let i = 0; i < coords.length; i++) {
				const axis = i % 2, value = Math.round(coords[i] * 1000);
				const difference = value - previous[axis];
				values.push(difference - delta[axis]);
				previous[axis] = value; delta[axis] = difference;
			}
			return coords.length / 2;
		});
		if (points) assert.deepEqual(contours, points, "fixed contour point counts");
		else points = contours;
	}
	let data = "";
	for (let i = 0; i < values.length; i++) {
		const n = values[i];
		if (!n) {
			let end = i + 1;
			while (end < values.length && !values[end]) end++;
			data += "A" + unsigned(end - i); i = end - 1;
		} else data += unsigned((n < 0 ? -2 * n - 1 : 2 * n) + 1);
	}
	return { frames: poses.length, points, chunks: data.match(/.{1,160}/g) };
}

function render(poses) {
	const rows = ["// BEGIN GENERATED SMOOTH TAIL", "const TAIL_SMOOTH_DATA = {"];
	for (const name of ["wag", "sway", "twist"]) {
		const { frames, points, chunks } = pack(poses[name]);
		rows.push(`\t${name}: { frames: ${frames}, points: ${JSON.stringify(points)}, chunks: [`);
		rows.push(...chunks.map(chunk => "\t\t" + JSON.stringify(chunk) + ","));
		rows.push("\t] },");
	}
	rows.push("};", "const tailSmoothCache = {};", "const smoothTailPoses = name => tailSmoothCache[name] || (tailSmoothCache[name] = decodeWhaleTailPoses(TAIL_SMOOTH_DATA[name]));", "// END GENERATED SMOOTH TAIL");
	return rows.join("\n\t\t\t");
}

module.exports = { pack, render };
