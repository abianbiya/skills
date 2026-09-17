#!/usr/bin/env bun
/**
 * sync-audit.ts — mirror the dev extension tree into this package.
 *
 * The published package ships the extension **verbatim**: the manifest points at
 * `./llm-audit`, so `llm-audit/index.ts` is the entry point and no import
 * rewriting happens (unlike speclet-pi, whose entry sits one directory deeper).
 * That makes syncing a straight file copy and makes drift trivially detectable.
 *
 * Default mode repairs the package copy. `--check` only reports drift and exits
 * non-zero; that is the mode prepublishOnly runs.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceRoot, walk } from "./tree.ts";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const targetRoot = join(pkgRoot, "llm-audit");
const check = process.argv.includes("--check");

const files = await walk(sourceRoot);
if (files.length === 0) {
  console.error(`no files found at dev source: ${sourceRoot}`);
  process.exit(1);
}

const drifted: string[] = [];
for (const rel of files) {
  const to = join(targetRoot, rel);
  let current: Buffer | undefined;
  try {
    current = await readFile(to);
  } catch {
    current = undefined;
  }
  if (current?.equals(await readFile(join(sourceRoot, rel)))) continue;
  drifted.push(rel);
  if (!check) {
    await mkdir(dirname(to), { recursive: true });
    await writeFile(to, await readFile(join(sourceRoot, rel)));
  }
}

const extras = (await walk(targetRoot)).filter((rel) => !files.includes(rel));
for (const rel of extras) {
  drifted.push(`extra: ${rel}`);
  if (!check) await rm(join(targetRoot, rel));
}

if (check) {
  if (drifted.length > 0) {
    console.error(`llm-audit/ drift detected (${drifted.length}):`);
    for (const rel of drifted) console.error(`  ${rel}`);
    console.error("run: bun run scripts/sync-audit.ts");
    process.exit(1);
  }
  console.log(
    `llm-audit/ in sync with dev source (${files.length} files): ${sourceRoot}`,
  );
} else {
  console.log(
    `synced ${files.length} file(s) from ${sourceRoot} (${drifted.length} changed${extras.length ? `, ${extras.length} removed` : ""})`,
  );
}
