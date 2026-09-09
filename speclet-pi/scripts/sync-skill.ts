#!/usr/bin/env bun
/**
 * sync-skill.ts — keeps the bundled skill in sync with the repo source.
 *
 * Copy mode (default): overwrite skills/speclet/SKILL.md from ../speclet/SKILL.md
 * Check mode (--check): exit 1 with a message if the bundled copy has drifted.
 *
 * Wired as `prepublishOnly` so `npm publish` can never ship a stale skill.
 */

import { copyFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(pkgRoot, "..", "speclet", "SKILL.md");
const bundled = join(pkgRoot, "skills", "speclet", "SKILL.md");

const [src, dst] = await Promise.all([
	readFile(source),
	process.argv.includes("--check") ? readFile(bundled) : Promise.resolve(null),
]);

if (process.argv.includes("--check")) {
	if (!src.equals(dst)) {
		console.error(
			`drift detected: ${bundled} differs from ${source}\nrun: bun run scripts/sync-skill.ts`,
		);
		process.exit(1);
	}
	console.log("bundled skill is in sync with source");
} else {
	await copyFile(source, bundled);
	console.log(`copied ${source} -> ${bundled}`);
}
