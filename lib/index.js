/**
 * dsh-status-rotator — node half.
 *
 * The browser half (lib/client.js) swaps the "Deep diving..." turn-status
 * label. This node half makes the phrase config load AUTOMATICALLY: it
 * registers an exact HTTP route `/plugins/dsh-status-rotator/config.json`
 * that streams the package's config.json (falling back to config.example.json),
 * and the browser half fetches that URL by default. No manual localStorage or
 * deployment step is needed — drop config.json next to this package, restart
 * `dsh web`, hard-refresh.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Cordis plugin name. */
const name = "status-rotator";
/** Needs the web server to expose the config route. */
const inject = ["webServer"];

const here = dirname(fileURLToPath(import.meta.url));
/** config.json sits at the package root, one level above lib/. */
const CONFIG_PATH = join(here, "..", "config.json");
const EXAMPLE_PATH = join(here, "..", "config.example.json");

async function serveConfig(req, res) {
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.writeHead(405);
		res.end();
		return;
	}
	for (const path of [CONFIG_PATH, EXAMPLE_PATH]) {
		try {
			const body = await readFile(path);
			res.writeHead(200, {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-cache"
			});
			res.end(body);
			return;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
	res.writeHead(404);
	res.end();
}

function apply(ctx) {
	// dsh 的 ctx.effect 会立即执行回调,回调返回值才是卸载时的清理函数。
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/plugins/dsh-status-rotator/config.json",
		handler: serveConfig
	}), "status-rotator: config.json route");
}

export { apply, inject, name };
