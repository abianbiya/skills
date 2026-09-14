#!/usr/bin/env bun
/**
 * check-fork.ts — enforces the extension source→dest mapping declared in AC7.
 *
 * | dest (this package)      | source (dev)              | rule                        |
 * |--------------------------|---------------------------|-----------------------------|
 * | src/shared.ts            | speclet-tui/src/shared.ts | verbatim, byte-identical    |
 * | extensions/index.ts      | speclet-tui/index.ts      | declared fork (adapt freely)|
 * | src/controller.ts        | speclet-tui/src/controller.ts | declared fork          |
 * | src/render.ts            | speclet-tui/src/render.ts | declared fork               |
 * | src/parse.ts             | speclet-tui/src/speclet.ts| declared fork               |
 *
 * Only the verbatim row is checked: a fork is *expected* to diverge, so
 * comparing it would fight every legitimate adaptation. The no-shortcut clause
 * is asserted by scanning the extension source, so AC7's coexistence promise is
 * falsifiable rather than review-only. `shared.ts` must not
 * diverge — it is the only module both extensions share by contract.
 *
 * Wired into prepublishOnly; exits non-zero naming the drifted path.
 */

import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(pkgRoot, "..");

const VERBATIM: { dest: string; source: string }[] = [
	{ dest: join(pkgRoot, "src", "shared.ts"), source: join(repoRoot, "speclet-tui", "src", "shared.ts") },
];

let drifted = 0;
for (const { dest, source } of VERBATIM) {
	const [want, got] = await Promise.all([readFile(source), readFile(dest)]);
	if (!want.equals(got)) {
		console.error(
			`drift detected: ${relative(repoRoot, dest)} differs from ${relative(repoRoot, source)}\n` +
				`run: cp ${relative(repoRoot, source)} ${relative(repoRoot, dest)}`,
		);
		drifted++;
	}
}

// AC7 coexistence clause: the fork must not claim a global key. speclet-tui owns
// `shift+up`; a second registration is a startup warning for everyone who has both.
const extensionSource = await readFile(join(pkgRoot, "extensions", "index.ts"), "utf8");
for (const call of extensionSource.matchAll(/pi\.registerShortcut\s*\(/g)) {
	const line = extensionSource.slice(0, call.index).split("\n").length;
	console.error(
		`forbidden shortcut registration: extensions/index.ts:${line} calls pi.registerShortcut — ` +
			`the specflow extension registers commands only (AC7)`,
	);
	drifted++;
}

if (drifted > 0) process.exit(1);
console.log(`fork contract holds (${VERBATIM.length} verbatim file, 0 shortcut registrations)`);