/**
 * speclet.json — the one user-facing setting this extension owns.
 *
 * The inspector shortcut is a pi keybinding registered at load time. It cannot be
 * remapped through pi's own `keybindings.json`, because that file only maps pi's
 * built-in actions (a closed union of `AppKeybinding` ids); a registered shortcut
 * key is a literal. Hence a small per-agent-dir file:
 *
 *   { "shortcut": "shift+up" }   // "" or null registers no shortcut at all
 *
 * Read and written through the active agent dir, so a profile can differ from the
 * default profile without copying settings around.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

/** Used when the config file does not exist, so nothing changes for anyone. */
export const DEFAULT_SHORTCUT = "shift+up";

const SPECIAL_KEYS = [
	"escape",
	"esc",
	"enter",
	"return",
	"tab",
	"space",
	"backspace",
	"delete",
	"insert",
	"clear",
	"home",
	"end",
	"pageUp",
	"pageDown",
	"up",
	"down",
	"left",
	"right",
	...Array.from({ length: 12 }, (_, index) => `f${index + 1}`),
];

const SYMBOL_KEYS = [
	"`", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/",
	"!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "+",
	"|", "~", "{", "}", ":", "<", ">", "?",
];

const MODIFIERS = ["ctrl", "shift", "alt", "super"];

export interface SpecletConfig {
	/** A pi key id (`shift+up`, `ctrl+alt+i`, …), or "" for no shortcut. */
	readonly shortcut: string;
}

export interface LoadedSpecletConfig {
	readonly config: SpecletConfig;
	/**
	 * True when the file actually expressed a preference. A configured shortcut is
	 * taken literally; only an unconfigured one falls back to another key when the
	 * host rejects the binding.
	 */
	readonly explicit: boolean;
	readonly path: string;
	readonly error?: string;
}

export function expandHome(path: string): string {
	return path === "~" || path.startsWith("~/")
		? resolve(homedir(), path.slice(2))
		: resolve(path);
}

export function specletConfigPath(): string {
	const agentDir = process.env.PI_CODING_AGENT_DIR;
	return agentDir
		? resolve(expandHome(agentDir), "speclet.json")
		: expandHome("~/.pi/agent/speclet.json");
}

/**
 * Canonical form of a key id, or undefined if it is not one.
 *
 * Mirrors pi-tui's `KeyId` grammar. Matching is case-insensitive so `Shift+PageUp`
 * works from the command line, but the result is the canonical spelling, because
 * that is the string pi matches against.
 */
export function normalizeShortcut(value: string): string | undefined {
	const parts = value.split("+").map((part) => part.trim());
	// Every segment must be present, so a leading/trailing "+" is a typo, not a key.
	if (parts.some((part) => part.length === 0)) return undefined;
	const base = parts.pop()!;
	const lowerBase = base.toLowerCase();
	const canonicalBase =
		SPECIAL_KEYS.find((key) => key.toLowerCase() === lowerBase) ??
		(SYMBOL_KEYS.includes(base) ? base : undefined) ??
		(/^[a-z0-9]$/.test(lowerBase) ? lowerBase : undefined);
	if (!canonicalBase) return undefined;
	const modifiers = parts.map((part) => part.toLowerCase());
	if (modifiers.some((modifier) => !MODIFIERS.includes(modifier)))
		return undefined;
	if (new Set(modifiers).size !== modifiers.length) return undefined;
	return [...modifiers, canonicalBase].join("+");
}

/** A `shortcut` value that disables the binding, spelled the friendly way. */
const DISABLED_WORDS = ["none", "off", "disabled", "no", "false"];

/** Parses a user-supplied value from the command line. "" means "no shortcut". */
export function parseShortcutInput(
	value: string,
): { shortcut: string } | { error: string } {
	const trimmed = value.trim();
	if (trimmed === "" || DISABLED_WORDS.includes(trimmed.toLowerCase()))
		return { shortcut: "" };
	const normalized = normalizeShortcut(trimmed);
	if (!normalized)
		return {
			error: `"${trimmed}" is not a key id. Use modifiers plus one key, e.g. shift+up, ctrl+alt+i, f8 — or "none" to remove the shortcut.`,
		};
	return { shortcut: normalized };
}

export function loadSpecletConfig(path = specletConfigPath()): LoadedSpecletConfig {
	const fallback = (error?: string, shortcut = ""): LoadedSpecletConfig => ({
		config: { shortcut },
		explicit: true,
		path,
		...(error ? { error } : {}),
	});

	if (!existsSync(path))
		return { config: { shortcut: DEFAULT_SHORTCUT }, explicit: false, path };

	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (error) {
		return fallback(
			`could not read ${path} (${error instanceof Error ? error.message : String(error)}); not registering a shortcut`,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		return fallback(
			`${path} is not valid JSON (${error instanceof Error ? error.message : String(error)}); not registering a shortcut`,
		);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
		return fallback(`${path} is not a JSON object; not registering a shortcut`);

	const value = (parsed as Record<string, unknown>).shortcut;
	// No opinion in the file: behave exactly as if there were no file.
	if (value === undefined)
		return { config: { shortcut: DEFAULT_SHORTCUT }, explicit: false, path };
	if (value === null || value === "")
		return fallback(undefined, "");
	if (typeof value !== "string")
		return fallback(`${path}: "shortcut" must be a string; not registering a shortcut`);

	const normalized = normalizeShortcut(value);
	// A typo must not silently fall back to a key the user was avoiding.
	if (!normalized)
		return fallback(`"${value}" from ${path} is not a key id; not registering a shortcut`);
	return { config: { shortcut: normalized }, explicit: true, path };
}

/**
 * Persist the shortcut, merging over whatever else the file holds.
 *
 * An invalid value is refused rather than written: a config that cannot be loaded
 * next start would silently disable the shortcut. A file we cannot parse is never
 * overwritten, and the result is 0600 in a 0700 directory.
 */
export async function saveShortcut(
	shortcut: string,
	path = specletConfigPath(),
): Promise<{ path: string; error?: string }> {
	const normalized = shortcut === "" ? "" : normalizeShortcut(shortcut);
	if (normalized === undefined)
		return { path, error: `refusing to write an invalid key id: "${shortcut}"` };

	let existing: Record<string, unknown> = {};
	if (existsSync(path)) {
		let raw: string;
		try {
			raw = await readFile(path, "utf8");
		} catch (error) {
			return {
				path,
				error: `could not read the existing config (${error instanceof Error ? error.message : String(error)}); not overwriting`,
			};
		}
		try {
			const parsed: unknown = JSON.parse(raw);
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
				return { path, error: "existing config is not a JSON object; not overwriting" };
			existing = parsed as Record<string, unknown>;
		} catch (error) {
			return {
				path,
				error: `existing config is not valid JSON (${error instanceof Error ? error.message : String(error)}); not overwriting`,
			};
		}
	}

	try {
		await mkdir(dirname(path), { recursive: true, mode: 0o700 });
		await writeFile(
			path,
			`${JSON.stringify({ ...existing, shortcut: normalized }, null, 2)}\n`,
			{ encoding: "utf8", mode: 0o600 },
		);
	} catch (error) {
		return {
			path,
			error: `could not write config: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	return { path };
}
