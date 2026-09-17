import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";
import {
	DEFAULT_SHORTCUT,
	loadSpecletConfig,
	normalizeShortcut,
	parseShortcutInput,
	saveShortcut,
	specletConfigPath,
} from "./config.js";

const tempDir = () => mkdtemp(join(tmpdir(), "speclet-config-"));

test("normalizes key ids to pi's canonical spelling", () => {
	assert.equal(normalizeShortcut("shift+up"), "shift+up");
	assert.equal(normalizeShortcut("Shift+Up"), "shift+up", "case-insensitive input");
	assert.equal(normalizeShortcut("alt+pageUp"), "alt+pageUp", "special keys keep camelCase");
	assert.equal(normalizeShortcut("ALT+pageup"), "alt+pageUp");
	assert.equal(normalizeShortcut("ctrl+alt+i"), "ctrl+alt+i");
	assert.equal(normalizeShortcut("f8"), "f8");
	assert.equal(normalizeShortcut("escape"), "escape");
	assert.equal(normalizeShortcut("  shift + up  "), "shift+up", "tolerates spaces");
});

test("rejects values that are not key ids", () => {
	for (const value of ["", "   ", "shift", "shift+", "+up", "hyper+up", "shift+shift+up", "ctrl+banana"]) {
		assert.equal(normalizeShortcut(value), undefined, `${JSON.stringify(value)} is not a key`);
	}
});

test("parses command input, including the ways to disable the shortcut", () => {
	assert.deepEqual(parseShortcutInput("shift+up"), { shortcut: "shift+up" });
	assert.deepEqual(parseShortcutInput("Ctrl+Alt+I"), { shortcut: "ctrl+alt+i" });
	for (const word of ["none", "OFF", "disabled", "false", ""]) {
		assert.deepEqual(parseShortcutInput(word), { shortcut: "" }, `${word} disables`);
	}
	const bad = parseShortcutInput("nope+nope");
	assert.ok("error" in bad && bad.error.includes("not a key id"), "explains the shape");
});

test("defaults to shift+up only when no config was written", () => {
	const loaded = loadSpecletConfig(join(tmpdir(), "speclet-does-not-exist", "speclet.json"));
	assert.equal(loaded.config.shortcut, DEFAULT_SHORTCUT);
	assert.equal(loaded.explicit, false, "so the host may still fall back");
});

test("reads an explicit shortcut and refuses to guess at a broken one", async () => {
	const dir = await tempDir();
	try {
		const path = join(dir, "speclet.json");
		await writeFile(path, JSON.stringify({ shortcut: "ctrl+alt+i" }));
		const ok = loadSpecletConfig(path);
		assert.equal(ok.config.shortcut, "ctrl+alt+i");
		assert.equal(ok.explicit, true);

		// "none" is an explicit decision: no shortcut, and no fallback either.
		await writeFile(path, JSON.stringify({ shortcut: "" }));
		const off = loadSpecletConfig(path);
		assert.equal(off.config.shortcut, "");
		assert.equal(off.explicit, true);
		assert.equal(off.error, undefined);

		// A typo must not silently bind a key the user was trying to avoid.
		await writeFile(path, JSON.stringify({ shortcut: "shift+banana" }));
		const typo = loadSpecletConfig(path);
		assert.equal(typo.config.shortcut, "");
		assert.match(typo.error ?? "", /not a key id/);

		// A file we cannot parse is reported, never silently replaced.
		await writeFile(path, "{ not json");
		const broken = loadSpecletConfig(path);
		assert.equal(broken.config.shortcut, "");
		assert.match(broken.error ?? "", /not valid JSON/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("writes the shortcut with the permissions a config file deserves", async () => {
	const dir = await tempDir();
	try {
		const path = join(dir, "nested", "speclet.json");
		const saved = await saveShortcut("Ctrl+Alt+I", path);
		assert.equal(saved.error, undefined);
		assert.equal(saved.path, path);
		assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
			shortcut: "ctrl+alt+i",
		});
		const mode = (await stat(path)).mode & 0o777;
		assert.equal(mode, 0o600, `config is private (got ${mode.toString(8)})`);

		// Saving again keeps the file loadable and merges over other keys.
		await writeFile(path, JSON.stringify({ shortcut: "shift+up", note: "keep me" }));
		await saveShortcut("f8", path);
		assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
			shortcut: "f8",
			note: "keep me",
		});

		// A value that would not load is refused rather than written.
		const refused = await saveShortcut("shift+banana", path);
		assert.match(refused.error ?? "", /invalid key id/);
		assert.equal(JSON.parse(await readFile(path, "utf8")).shortcut, "f8", "file untouched");

		// And an unparseable file is never overwritten.
		await writeFile(path, "{ broken");
		const guarded = await saveShortcut("shift+up", path);
		assert.match(guarded.error ?? "", /not valid JSON|not overwriting/);
		assert.equal(await readFile(path, "utf8"), "{ broken");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("reads from the active agent dir, expanding a tilde", async () => {
	const previous = process.env.PI_CODING_AGENT_DIR;
	try {
		process.env.PI_CODING_AGENT_DIR = "~/.pi/profiles/probe";
		const tilde = specletConfigPath();
		assert.ok(!tilde.includes(`${join("/", "~")}/`), "no literal ~ directory");
		assert.ok(tilde.endsWith("/.pi/profiles/probe/speclet.json"));
		process.env.PI_CODING_AGENT_DIR = "/tmp/plain-agent-dir";
		assert.equal(specletConfigPath(), "/tmp/plain-agent-dir/speclet.json");
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	}
});
