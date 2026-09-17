/**
 * tree.ts — shared helpers for the sync/guard pair.
 *
 * Both scripts must agree on what counts as a file and where the dev tree lives,
 * otherwise the guard could bless something sync never writes (or vice versa).
 */

import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";

/** Never authored by hand, never worth comparing. */
export const IGNORED = new Set([".DS_Store"]);

/**
 * The installed dev extension is the source of truth. Overridable so the guard
 * can be exercised against a fixture without touching the real extension.
 */
export const sourceRoot =
  process.env.LLM_AUDIT_SOURCE ??
  join(homedir(), ".pi/agent/extensions/llm-audit");

/** Relative file paths under `root`, sorted, ignoring {@link IGNORED}. */
export async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string): Promise<void> {
    let entries;
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
