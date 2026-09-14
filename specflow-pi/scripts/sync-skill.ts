#!/usr/bin/env bun
/**
 * sync-skill.ts — keeps the bundled SpecFlow skill tree in sync with the repo source.
 *
 * Copy mode (default): mirror the ENTIRE ../specflow/ tree (SKILL.md, references/**,
 * templates/**) into skills/specflow/, byte-for-byte, pruning dest files that no
 * longer exist in the source (a renamed reference must never linger) and removing
 * directories left empty by pruning.
 *
 * Check mode (--check): compare BOTH directions — a missing dest file, an extra
 * dest file, or differing bytes are each drift. Exits 1 naming every drifted
 * path; exits 0 with a short "in sync" line otherwise.
 *
 * Wired as `prepublishOnly` so `npm publish` can never ship a stale skill tree.
 */

import { copyFile, mkdir, readdir, readFile, rm, rmdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const pkgRoot = join(import.meta.dir, "..");
const sourceRoot = join(pkgRoot, "..", "specflow");
const destRoot = join(pkgRoot, "skills", "specflow");

/**
 * Recursive walk returning sorted relative file paths; empty/missing root yields
 * []. `.DS_Store` is macOS noise, never skill content, and its presence differs
 * between machines — ignoring it on both sides avoids false drift in --check. Pass
 * `includeJunk` only to find copies that need pruning.
 */
async function walk(root: string, includeJunk = false): Promise<string[]> {
	const out: string[] = [];
	async function rec(dir: string): Promise<void> {
		let entries: Awaited<ReturnType<typeof readdir>>;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (!includeJunk && entry.name === ".DS_Store") continue;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) await rec(path);
			else if (entry.isFile()) out.push(relative(root, path));
		}
	}
	await rec(root);
	return out.sort();
}

async function main(): Promise<void> {
	const check = process.argv.includes("--check");
	console.log(`sync-skill: mode ${check ? "check" : "copy"}`);

	const sourceFiles = await walk(sourceRoot);
	if (sourceFiles.length === 0) {
		console.error(`error: no source skill files found under ${sourceRoot}`);
		process.exit(1);
	}
	const destFiles = new Set(await walk(destRoot));
	const sourceSet = new Set(sourceFiles);

	if (check) {
		const drifted: string[] = [];
		for (const rel of sourceFiles) {
			if (!destFiles.has(rel)) {
				drifted.push(`missing in bundle: skills/specflow/${rel}`);
				continue;
			}
			const [src, dst] = await Promise.all([
				readFile(join(sourceRoot, rel)),
				readFile(join(destRoot, rel)),
			]);
			if (!src.equals(dst)) drifted.push(`differs from source: skills/specflow/${rel}`);
		}
		for (const rel of destFiles) {
			if (!sourceSet.has(rel)) drifted.push(`extra in bundle (not in source): skills/specflow/${rel}`);
		}
		if (drifted.length > 0) {
			console.error(
				`skill tree drift detected (${drifted.length} path${drifted.length === 1 ? "" : "s"}):`,
			);
			for (const d of drifted) console.error(`  ${d}`);
			console.error("run: bun run scripts/sync-skill.ts");
			process.exit(1);
		}
		console.log("bundled skill tree is in sync with source");
		return;
	}

	for (const rel of sourceFiles) {
		const dest = join(destRoot, rel);
		await mkdir(dirname(dest), { recursive: true });
		await copyFile(join(sourceRoot, rel), dest);
	}
	// Prune dest files absent from source, then remove directories left empty.
	for (const rel of destFiles) {
		if (!sourceSet.has(rel)) await rm(join(destRoot, rel));
	}
	// A .DS_Store already in the bundle is invisible to the walk above, so it would
	// never be pruned or reported; drop it explicitly.
	for (const rel of await walk(destRoot, true)) {
		if (rel.endsWith(".DS_Store")) await rm(join(destRoot, rel));
	}
	const destDirs: string[] = [];
	async function collectDirs(dir: string): Promise<void> {
		let entries: Awaited<ReturnType<typeof readdir>>;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				await collectDirs(path);
				destDirs.push(path);
			}
		}
	}
	await collectDirs(destRoot);
	// Deepest first so nested empties collapse bottom-up.
	for (const dir of destDirs.sort((a, b) => b.length - a.length)) {
		try {
			await rmdir(dir); // fails with ENOTEMPTY when still populated — intended
		} catch {
			/* keep non-empty directories */
		}
	}
	console.log(`copied ${sourceFiles.length} file(s): ${sourceRoot} -> ${destRoot}`);
}

await main();
