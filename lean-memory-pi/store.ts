import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
// Reuse upstream's line-preserving mutations and entry-aware deletion, not its global runtime.
// pi-memory by Jay Zeng (MIT); see THIRD_PARTY_NOTICES.md.
import { forgetBlocks, parseScratchpad, scratchpadAdd, scratchpadClearDone, scratchpadToggle, serializeScratchpad } from "pi-memory";

const exec = promisify(execFile);
const MAX_FILE = 1024 * 1024;
export type Scope = "project" | "global";
export type Target = "long_term" | "daily";
export interface Project { root: string; id: string }
export interface Location { scope: Scope; dir: string; project?: Project }
export interface MemoryEntry { label: string; text: string }

function inside(root: string, path: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

export async function identifyProject(cwd: string, explicitRoot?: string): Promise<Project | undefined> {
	const canonicalCwd = await fs.realpath(cwd);
	let root: string;
	if (explicitRoot) {
		if (!isAbsolute(explicitRoot)) throw new Error("LEAN_MEMORY_PROJECT_ROOT must be an absolute path.");
		root = await fs.realpath(explicitRoot);
		if (!inside(root, canonicalCwd)) throw new Error("Current directory is outside LEAN_MEMORY_PROJECT_ROOT.");
	} else {
		// Ignore inherited Git routing variables: cwd alone determines the working tree.
		const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
		try {
			const { stdout } = await exec("git", ["-C", canonicalCwd, "rev-parse", "--show-toplevel"], { env, timeout: 3000, maxBuffer: 16384 });
			root = await fs.realpath(stdout.trim());
		} catch {
			return undefined; // Unidentified/non-Git/bare repository: global-only, never guess.
		}
		if (!inside(root, canonicalCwd)) return undefined;
	}
	return { root, id: createHash("sha256").update(root).digest("hex") };
}

export function today(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function validDate(value: string): string {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) {
		throw new Error("Invalid daily-log date; use YYYY-MM-DD.");
	}
	return value;
}

function targetFile(target: Target, date?: string): string {
	if (target === "long_term") return "MEMORY.md";
	if (target === "daily") return `daily/${validDate(date ?? today())}.md`;
	throw new Error("Unknown memory target.");
}

export function bounded(text: string, max: number): string {
	if (text.length <= max) return text;
	const end = text.lastIndexOf("\n", max);
	return `${end < 0 ? "" : text.slice(0, end)}\n[Content omitted; use memory_read with offset/limit or curate this file.]`;
}

// Character paging with a visible continuation marker, shared by file reads and listings.
function page(text: string, offset: number, limit: number): string {
	return text.slice(offset, offset + limit) + (text.length > offset + limit ? `\n[More: offset ${offset + limit}; ${text.length} characters total]` : "");
}

// The ambient prompt is cached per scope identity so one project's facts can never
// be served to another. Entries carry a generation: a snapshot that started before a
// mutation must not repopulate a stale entry when it finally resolves. Callers get
// the text they loaded, never a variable another invocation may have overwritten.
export class SnapshotCache {
	private generation = 0;
	private entries = new Map<string, { generation: number; text: string }>();

	invalidate(): void {
		this.generation++;
	}

	async get(key: string, load: () => Promise<string>): Promise<string> {
		const generation = this.generation;
		const hit = this.entries.get(key);
		if (hit?.generation === generation) return hit.text;
		const text = await load();
		if (generation === this.generation) this.entries.set(key, { generation, text });
		return text;
	}
}

function stamp(): string {
	const time = new Date().toTimeString().slice(0, 8);
	return `<!-- ${today()} ${time} [lean-memory] -->`;
}

function append(before: string, entry: string): string {
	return `${before}${before.trim() ? "\n\n" : ""}${entry}\n`;
}

function required(value: string | undefined): string {
	if (!value?.trim()) throw new Error("Non-empty text is required.");
	return value;
}

export class MemoryStore {
	readonly root: string;
	constructor(root = process.env.LEAN_MEMORY_DIR ?? join(homedir(), ".pi", "agent", "memory")) {
		if (!isAbsolute(root)) throw new Error("LEAN_MEMORY_DIR must be an absolute path.");
		this.root = resolve(root);
	}

	location(scope: Scope, project?: Project): Location {
		if (scope === "global") return { scope, dir: join(this.root, "global") };
		if (scope !== "project") throw new Error("Scope must be project or global.");
		if (!project) throw new Error("No project identified. Use scope: global explicitly, or set LEAN_MEMORY_PROJECT_ROOT for a non-Git project.");
		if (!/^[a-f0-9]{64}$/.test(project.id)) throw new Error("Invalid project identity.");
		return { scope, dir: join(this.root, "projects", project.id), project };
	}

	// Check every memory-owned component, not just the final filename. A symlink
	// must never route a project's read/write/search into another project's files.
	private async path(location: Location, file: string, create = false): Promise<string> {
		const expected = this.location(location.scope, location.project).dir;
		if (location.dir !== expected || isAbsolute(file) || file.split(/[\\/]/).some(p => p === ".." || p === ".")) {
			throw new Error("Invalid scoped memory path.");
		}
		if (create) await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
		const parts = relative(this.root, join(location.dir, file)).split(sep);
		let current = this.root;
		for (let i = 0;i < parts.length;i++) {
			current = join(current, parts[i]);
			try {
				const stat = await fs.lstat(current);
				if (stat.isSymbolicLink()) throw new Error(`Refusing memory symlink: ${current}`);
				if (i < parts.length - 1 && !stat.isDirectory()) throw new Error(`Not a memory directory: ${current}`);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				if (create && i < parts.length - 1) {
					try { await fs.mkdir(current, { mode: 0o700 }); }
					catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
					const stat = await fs.lstat(current);
					if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe memory directory: ${current}`);
				}
			}
		}
		return current;
	}

	async read(location: Location, file: string): Promise<string> {
		const path = await this.path(location, file);
		let handle;
		try { handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
		catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return ""; throw e; }
		try {
			const stat = await handle.stat();
			if (!stat.isFile() || stat.size > MAX_FILE) throw new Error(`Memory file exceeds 1 MiB or is not a regular file: ${path}`);
			return await handle.readFile("utf8");
		} finally { await handle.close(); }
	}

	private async atomic(location: Location, file: string, content: string): Promise<void> {
		if (Buffer.byteLength(content) > MAX_FILE) throw new Error("Memory file would exceed 1 MiB; archive/curate it first. Nothing written.");
		const path = await this.path(location, file, true);
		const temp = `${path}.${randomUUID()}.tmp`;
		const handle = await fs.open(temp, "wx", 0o600);
		try {
			try {
				await handle.writeFile(content, "utf8");
				await handle.sync();
			} finally { await handle.close(); }
			await fs.rename(temp, path);
			if (process.platform !== "win32") {
				const directory = await fs.open(dirname(path), "r");
				try { await directory.sync(); } finally { await directory.close(); }
			}
		} finally { await fs.rm(temp, { force: true }); }
	}

	private async locked<T>(location: Location, fn: () => Promise<T>): Promise<T> {
		const lock = await this.path(location, ".lock", true);
		const deadline = Date.now() + 5000;
		for (;;) {
			try { await fs.mkdir(lock, { mode: 0o700 }); break; }
			catch (e) {
				if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
				if (Date.now() >= deadline) throw new Error(`Memory busy: ${lock}. If a writer crashed, verify it stopped before removing this lock directory.`);
				await delay(25);
			}
		}
		try { return await fn(); }
		finally { await fs.rmdir(lock); }
	}

	async write(location: Location, target: Target, content: string, mode: "append" | "overwrite" = "append", date?: string): Promise<void> {
		required(content);
		if (mode !== "append" && mode !== "overwrite") throw new Error("Unknown write mode.");
		if (target === "daily" && mode === "overwrite") throw new Error("Daily logs are append-only.");
		const file = targetFile(target, date);
		await this.locked(location, async () => {
			const before = await this.read(location, file);
			if (mode === "overwrite" && before) await this.backup(location, file, before);
			await this.atomic(location, file, append(mode === "overwrite" ? "" : before, `${stamp()}\n${content}`));
		});
	}

	private async backup(location: Location, file: string, content: string): Promise<string> {
		const id = randomUUID();
		await this.atomic(location, `recovery/${id}.json`, JSON.stringify({ version: 1, scope: location.scope, projectId: location.project?.id, file, content }, null, 2));
		return id;
	}

	async scratchpad(location: Location, action: string, text?: string): Promise<string> {
		if (action === "list") return this.read(location, "SCRATCHPAD.md");
		return this.locked(location, async () => {
			const before = await this.read(location, "SCRATCHPAD.md");
			let after: string;
			if (action === "add") {
				required(text);
				if (/[\r\n]/.test(text!)) throw new Error("Scratchpad items must be a single line.");
				after = scratchpadAdd(before, text!, stamp());
			} else if (action === "done" || action === "undo") {
				const result = scratchpadToggle(before, required(text), action === "done");
				if (!result.matched) throw new Error("No matching scratchpad item in this scope.");
				after = result.content;
			} else if (action === "clear_done") {
				after = scratchpadClearDone(before).content;
				if (after !== before) await this.backup(location, "SCRATCHPAD.md", before);
			} else throw new Error("Unknown scratchpad action.");
			await this.atomic(location, "SCRATCHPAD.md", after);
			return after;
		});
	}

	async forget(location: Location, target: Target, match: string, date?: string): Promise<string | undefined> {
		required(match);
		const file = targetFile(target, date);
		return this.locked(location, async () => {
			const before = await this.read(location, file);
			const result = forgetBlocks(before, match);
			if (!result.removed.length) return undefined;
			const id = randomUUID();
			await this.atomic(location, `recovery/${id}.json`, JSON.stringify({ version: 1, scope: location.scope, projectId: location.project?.id, file, entries: result.removed }, null, 2));
			await this.atomic(location, file, result.content);
			return id;
		});
	}

	async restore(location: Location, id: string): Promise<void> {
		if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) throw new Error("Invalid recovery ID.");
		await this.locked(location, async () => {
			const raw = await this.read(location, `recovery/${id}.json`);
			if (!raw) throw new Error("Recovery record not found in this scope.");
			const r = JSON.parse(raw);
			if (!r || r.version !== 1 || r.scope !== location.scope || r.projectId !== location.project?.id || typeof r.file !== "string") throw new Error("Recovery scope mismatch.");
			if (r.file !== "MEMORY.md" && r.file !== "SCRATCHPAD.md") {
				const match = /^daily\/(\d{4}-\d{2}-\d{2})\.md$/.exec(r.file);
				if (!match) throw new Error("Invalid recovery target.");
				validDate(match[1]);
			}
			if (!Array.isArray(r.entries) || !r.entries.length || !r.entries.every((s: unknown) => typeof s === "string" && s.trim())) {
				throw new Error("This is a full-file backup, not a forget record; inspect it and merge manually to preserve later edits.");
			}
			const before = await this.read(location, r.file);
			const missing = (r.entries as string[]).filter(entry => !before.includes(entry));
			if (missing.length) await this.atomic(location, r.file, append(before, missing.join("\n\n")));
		});
	}

	async files(location: Location): Promise<{ files: string[]; truncated: boolean }> {
		const files: string[] = [];
		let visited = 0;
		let truncated = false;
		const walk = async (dir: string, depth: number) => {
			const path = await this.path(location, dir);
			let entries;
			try { entries = await fs.readdir(path, { withFileTypes: true }); }
			catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
			for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
				if (++visited > 1000) { truncated = true; break; }
				if (entry.name.startsWith(".") || entry.name === "recovery" || entry.isSymbolicLink()) continue;
				const file = dir ? `${dir}/${entry.name}` : entry.name;
				if (entry.isDirectory()) {
					if (depth < 3) await walk(file, depth + 1);
					else truncated = true;
				} else if (entry.isFile() && entry.name.endsWith(".md")) files.push(file);
			}
		};
		await walk("", 0);
		return { files, truncated };
	}

	async readTarget(location: Location, target: string, date?: string, offset = 0, limit = 4000): Promise<string> {
		if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 12000) throw new Error("Invalid read offset/limit.");
		if (target === "list") {
			const result = await this.files(location);
			return page(result.files.join("\n") + (result.truncated ? "\n[File listing truncated]" : ""), offset, limit);
		}
		const file = target === "scratchpad" ? "SCRATCHPAD.md" : targetFile(target as Target, date);
		return page(await this.read(location, file), offset, limit);
	}

	async snapshot(project?: Project): Promise<string> {
		const locations = [this.location("global"), ...(project ? [this.location("project", project)] : [])];
		const sections: string[] = [];
		for (const location of locations) {
			const memory = await this.read(location, "MEMORY.md");
			const scratch = parseScratchpad(await this.read(location, "SCRATCHPAD.md")).filter(item => !item.done);
			if (memory.trim()) sections.push(`### ${location.scope} facts\n${bounded(memory, 2400)}`);
			if (scratch.length) sections.push(`### ${location.scope} open tasks\n${bounded(serializeScratchpad(scratch), 800)}`);
		}
		return sections.join("\n\n");
	}

	// Read-only inventory for the /memory command. Same scope order as the ambient
	// snapshot, with counts so the list is useful before anything is opened.
	async overview(project?: Project): Promise<MemoryEntry[]> {
		const scopes: { scope: Scope; location: Location }[] = [
			...(project ? [{ scope: "project" as const, location: this.location("project", project) }] : []),
			{ scope: "global" as const, location: this.location("global") },
		];
		const entries: MemoryEntry[] = [];
		for (const { scope, location } of scopes) {
			const names = scope === "project"
				? { tasks: "Open tasks (this project)", facts: "Facts (this project)", files: "Files (this project)" }
				: { tasks: "Global open tasks", facts: "Global facts + safeguards", files: "Files (global)" };
			const tasks = parseScratchpad(await this.read(location, "SCRATCHPAD.md")).filter(item => !item.done);
			entries.push({
				label: `${names.tasks} · ${tasks.length}`,
				text: tasks.length ? bounded(serializeScratchpad(tasks), 4000) : "(no open tasks)",
			});
			const facts = await this.read(location, "MEMORY.md");
			entries.push({
				label: `${names.facts} · ${facts.trim() ? `${Buffer.byteLength(facts)} B` : "empty"}`,
				text: facts.trim() ? bounded(facts, 2400) : "(no facts)",
			});
			const listed = await this.files(location);
			entries.push({
				label: `${names.files} · ${listed.files.length}${listed.truncated ? "+" : ""}`,
				text: listed.files.length ? listed.files.join("\n") + (listed.truncated ? "\n[File listing truncated]" : "") : "(no files)",
			});
		}
		return entries;
	}

	async search(locations: Location[], query: string, limit = 3): Promise<{ results: { scope: Scope; file: string; score: number; snippet: string }[]; truncated: boolean }> {
		const terms = [...new Set(required(query).toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(Boolean))];
		if (!terms.length || terms.length > 20) throw new Error("Search requires 1–20 keyword terms.");
		if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("Search limit must be 1–10.");
		const results: { scope: Scope; file: string; score: number; snippet: string }[] = [];
		let truncated = false;
		let bytes = 0;
		scopes: for (const location of locations) {
			const listed = await this.files(location);
			truncated ||= listed.truncated;
			for (const file of listed.files) {
				const text = await this.read(location, file);
				bytes += Buffer.byteLength(text);
				// Stop the whole scan, not just this scope: the budget is global.
				if (bytes > 8 * MAX_FILE) { truncated = true; break scopes; }
				const lower = text.toLowerCase();
				const score = terms.filter(term => `${file.toLowerCase()}\n${lower}`.includes(term)).length;
				if (score !== terms.length) continue;
				const start = Math.max(0, lower.indexOf(terms[0]) - 150);
				results.push({ scope: location.scope, file, score, snippet: text.slice(start, start + 1000) });
			}
		}
		results.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
		return { results: results.slice(0, limit), truncated };
	}
}
