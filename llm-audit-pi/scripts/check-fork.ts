#!/usr/bin/env bun
/**
 * check-fork.ts — prepublish guard for the package↔dev-source mapping.
 *
 * The packaged extension is the dev extension copied verbatim, so the two can
 * drift invisibly and the published build would silently diverge from what is
 * actually being run and tested. The contract is mechanical:
 *
 * 1. `llm-audit/**` matches `~/.pi/agent/extensions/llm-audit/**` byte for byte
 *    in both directions — there is no allowed difference here, because this
 *    package ships the dev tree as-is (no import rewriting);
 * 2. the packaged entry point still default-exports a Pi extension factory;
 * 3. the packaged extension registers no keyboard shortcut, so installing it can
 *    never collide with another extension's keybinding;
 * 4. no packaged path contains a literal `~` segment. A stray "~" directory means
 *    something resolved a config path against the package instead of the user's
 *    home directory; because it is inert at runtime and mirrored into the package,
 *    the drift checks above cannot see it and it would ship silently.
 *
 * Wired into prepublishOnly; exits non-zero naming every drifted path.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceRoot, walk } from "./tree.ts";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const targetRoot = join(pkgRoot, "llm-audit");
const problems: string[] = [];

const devFiles = await walk(sourceRoot);
if (devFiles.length === 0) {
  console.error(`dev source not found or empty: ${sourceRoot}`);
  process.exit(1);
}
const pkgFiles = await walk(targetRoot);
const devSet = new Set(devFiles);
const pkgSet = new Set(pkgFiles);

for (const rel of devFiles) {
  if (!pkgSet.has(rel)) {
    problems.push(`missing here: llm-audit/${rel}`);
    continue;
  }
  const [want, got] = await Promise.all([
    readFile(join(sourceRoot, rel)),
    readFile(join(targetRoot, rel)),
  ]);
  if (!want.equals(got)) problems.push(`differs from dev source: llm-audit/${rel}`);
}
for (const rel of pkgFiles) {
  if (!devSet.has(rel)) problems.push(`extra here (not in dev source): llm-audit/${rel}`);
}
for (const rel of pkgFiles.filter((path) => path.split("/").includes("~"))) {
  problems.push(`literal home shortcut in packaged path: llm-audit/${rel}`);
}

const entry = pkgFiles.includes("index.ts")
  ? await readFile(join(targetRoot, "index.ts"), "utf8")
  : "";
if (!/export default function/.test(entry))
  problems.push(
    "llm-audit/index.ts does not default-export an extension factory (pi cannot load it)",
  );
for (const rel of pkgFiles.filter((path) => path.endsWith(".ts"))) {
  const text = rel === "index.ts" ? entry : await readFile(join(targetRoot, rel), "utf8");
  if (text.includes("registerShortcut"))
    problems.push(`llm-audit/${rel} registers a shortcut (would collide on install)`);
}

if (problems.length > 0) {
  console.error(`extension drift detected (${problems.length}):`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("run: bun run scripts/sync-audit.ts");
  process.exit(1);
}
console.log(
  `extension in sync with dev source (${devFiles.length} files, no shortcut registered)`,
);
