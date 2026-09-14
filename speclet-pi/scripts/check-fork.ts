#!/usr/bin/env bun
/**
 * check-fork.ts — prepublish guard for the package↔dev-source mapping.
 *
 * The extension this package ships is a copy of the dev tree, so the two can
 * drift invisibly (that is exactly what happened before this guard existed:
 * `src/{render,speclet}.ts` silently missed a refactor and the package would
 * have shipped a divergent build). Unlike specflow-pi, nothing here is a
 * *deliberate* fork — speclet-pi mirrors the dev sources 1:1 — so the contract
 * is stronger and mechanical:
 *
 * 1. every file under `speclet-tui/src/` exists here with identical bytes
 *    (missing, extra, or changed files are all drift);
 * 2. `extensions/index.ts` equals `speclet-tui/index.ts` after rewriting the
 *    three `./src/...` imports to `../src/...` — the only difference that is
 *    allowed, because this package's extension sits one directory deeper.
 *
 * The bundled skill tree is guarded separately by `scripts/sync-skill.ts`.
 * Wired into prepublishOnly; exits non-zero naming every drifted path.
 */

import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(pkgRoot, "..");
const devRoot = join(repoRoot, "speclet-tui");

const problems: string[] = [];

/** Files only ever produced by the build, never authored in the dev tree. */
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

// 1. src/ must mirror speclet-tui/src/ exactly, both directions.
const devSrc = await walk(join(devRoot, "src"));
const pkgSrc = await walk(join(pkgRoot, "src"));
const devSet = new Set(devSrc);
const pkgSet = new Set(pkgSrc);

for (const rel of devSrc) {
	if (!pkgSet.has(rel)) {
		problems.push(`missing here: src/${rel} (exists as ${relative(repoRoot, join(devRoot, "src", rel))})`);
		continue;
	}
	const [want, got] = await Promise.all([
		readFile(join(devRoot, "src", rel)),
		readFile(join(pkgRoot, "src", rel)),
	]);
	if (!want.equals(got)) problems.push(`differs from dev: src/${rel}`);
}
for (const rel of pkgSrc) {
	if (!devSet.has(rel)) problems.push(`extra here (not in ${relative(repoRoot, devRoot)}/src): src/${rel}`);
}

// 2. the packaged extension is the dev extension with only its import depth adapted.
const [devIndex, pkgIndex] = await Promise.all([
	readFile(join(devRoot, "index.ts"), "utf8"),
	readFile(join(pkgRoot, "extensions", "index.ts"), "utf8"),
]);
const adapted = devIndex.replace(/from "\.\/src\//g, 'from "../src/');
if (adapted !== pkgIndex) {
	const devLines = adapted.split("\n");
	const pkgLines = pkgIndex.split("\n");
	const firstDiff = devLines.findIndex((l, i) => l !== pkgLines[i]);
	problems.push(
		firstDiff === -1
			? `extensions/index.ts has ${pkgLines.length - devLines.length} extra line(s) the dev index.ts does not have`
			: `extensions/index.ts is not the dev index.ts with adapted imports ` +
				`(first difference at line ${firstDiff + 1}: expected ${JSON.stringify(devLines[firstDiff])}, ` +
				`found ${JSON.stringify(pkgLines[firstDiff])})`,
	);
}

if (problems.length > 0) {
	console.error(`extension drift detected (${problems.length}):`);
	for (const p of problems) console.error(`  ${p}`);
	console.error("run: bun run scripts/sync-extension.ts");
	process.exit(1);
}
console.log(`extension in sync with dev sources (${devSrc.length} src files + extensions/index.ts)`);
