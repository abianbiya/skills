#!/usr/bin/env bun
/**
 * sync-extension.ts — the copy mode for scripts/check-fork.ts.
 *
 * Copies the dev extension into this package:
 *   speclet-tui/src/**      -> src/**                  (verbatim)
 *   speclet-tui/index.ts    -> extensions/index.ts      (import depth adapted ./src/ -> ../src/)
 *
 * Anything under src/ that no longer exists in the dev tree is pruned, so a
 * renamed or deleted module cannot linger in a published build. Run with
 * `--check` to only report (equivalent to check-fork.ts) — useful when you want
 * one command for both directions.
 */

import { copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const devRoot = join(pkgRoot, "..", "speclet-tui");
const check = process.argv.includes("--check");

const IGNORED = new Set([".DS_Store"]);

async function walk(root: string): Promise<string[]> {
	const out: string[] = [];
	async function rec(dir: string): Promise<void> {
		let entries: Awaited<ReturnType<typeof readdir>>;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (IGNORED.has(entry.name)) continue;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) await rec(path);
			else if (entry.isFile()) out.push(relative(root, path));
		}
	}
	await rec(root);
	return out.sort();
}

const devFiles = await walk(join(devRoot, "src"));
const pkgFiles = await walk(join(pkgRoot, "src"));
const devSet = new Set(devFiles);

let changed = 0;
let drifted = 0;

// src/** — verbatim in both directions
for (const rel of devFiles) {
	const [want, got] = await Promise.all([
		readFile(join(devRoot, "src", rel)),
		readFile(join(pkgRoot, "src", rel)).catch(() => null),
	]);
	if (got && want.equals(got)) continue;
	if (check) {
		console.error(`drift: src/${rel} ${got ? "differs from" : "missing vs"} ${relative(pkgRoot, join(devRoot, "src", rel))}`);
		drifted++;
		continue;
	}
	await mkdir(dirname(join(pkgRoot, "src", rel)), { recursive: true });
	await copyFile(join(devRoot, "src", rel), join(pkgRoot, "src", rel));
	changed++;
}
for (const rel of pkgFiles) {
	if (devSet.has(rel)) continue;
	if (check) {
		console.error(`drift: src/${rel} is not in ${relative(pkgRoot, devRoot)}/src`);
		drifted++;
		continue;
	}
	await rm(join(pkgRoot, "src", rel));
	changed++;
}

// extensions/index.ts — the dev index with adapted import depth
const devIndex = await readFile(join(devRoot, "index.ts"), "utf8");
const adapted = devIndex.replace(/from "\.\/src\//g, 'from "../src/');
const pkgIndex = await readFile(join(pkgRoot, "extensions", "index.ts"), "utf8").catch(() => null);
if (pkgIndex !== adapted) {
	if (check) {
		console.error("drift: extensions/index.ts is not the dev index.ts with adapted imports");
		drifted++;
	} else {
		await mkdir(dirname(join(pkgRoot, "extensions", "index.ts")), { recursive: true });
		await copyFile(join(devRoot, "index.ts"), join(pkgRoot, "extensions", "index.ts"));
		// re-write with the adapted imports (copyFile is verbatim)
		await Bun.write(join(pkgRoot, "extensions", "index.ts"), adapted);
		changed++;
	}
}

if (check) {
	if (drifted > 0) {
		console.error(`extension drift detected (${drifted}) — run: bun run scripts/sync-extension.ts`);
		process.exit(1);
	}
	console.log("extension in sync with dev sources");
} else {
	console.log(changed === 0 ? "extension already in sync" : `synced ${changed} file(s) from ${relative(pkgRoot, devRoot)}`);
}
