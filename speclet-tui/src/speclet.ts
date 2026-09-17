/**
 * speclet.ts — discovery and parsing of `.speclet/*.md` files (pure where
 * possible; only discoverSpeclets touches the filesystem).
 *
 * Grammar handled (see .speclet/speclet-tui.md AC6/AC9):
 * - Name: first level-1 heading outside code fences, else filename stem.
 * - Status: frontmatter scalar `status:` (draft|approved|in-progress|done|archived),
 *   optionally quoted; anything else is `unknown`.
 * - Tasks: top-level numbered checkbox rows `- [ ]|x|X N. Title` inside the
 *   `## Tasks` section, ending at the next level-1 or level-2 heading.
 *   Fenced examples and indented detail rows are ignored.
 */

import { stripControlSequences } from "./shared.js";
import { readdir, readFile, lstat } from "node:fs/promises";
import { join } from "node:path";

export { stripControlSequences };

export type SpecletStatus = "draft" | "approved" | "in-progress" | "done" | "archived" | "unknown";

export interface SpecletTask {
	id: string;
	title: string;
	done: boolean;
	/** Indented detail rows under the checkbox line (description, `Criteria:`, `Depends on:`), control-stripped. */
	details?: string[];
}

export interface SpecletFile {
	path: string;
	filename: string;
	name: string;
	status: SpecletStatus;
	tasks: SpecletTask[];
	mtimeMs: number;
	/** Present when the file could not be read; tasks/status fall back to unknown/empty. */
	error?: string;
}

export interface DiscoveryResult {
	files: SpecletFile[];
	/** Missing directory is not an error (panel hides); other failures are reported here. */
	dirError?: string;
}

const VALID_STATUSES = ["draft", "approved", "in-progress", "done", "archived"] as const;

/**
 * Fence state machine: returns the active fence marker (first char repeated
 * to the opening length) after this line. A closing fence must use the same
 * character type as the opener; opening fence lines are themselves masked.
 */
function fenceTransition(line: string, active: string | undefined): string | undefined {
	const m = line.match(/^\s*(`{3,}|~{3,})/);
	if (!m) return active;
	const ch = m[1][0];
	if (active === undefined) return ch.repeat(m[1].length);
	if (ch === active[0] && m[1].length >= active.length) return undefined;
	return active;
}

/** True for lines that are inside a fenced block (fence lines included). */
export function fenceMask(lines: string[]): boolean[] {
	const mask: boolean[] = new Array(lines.length).fill(false);
	let active: string | undefined;
	for (let i = 0; i < lines.length; i++) {
		const next = fenceTransition(lines[i], active);
		mask[i] = active !== undefined || next !== undefined;
		active = next;
	}
	return mask;
}

/** First level-1 heading (`# Title`) outside code fences, or undefined. */
export function findLevelOneHeading(lines: string[]): string | undefined {
	const mask = fenceMask(lines);
	for (let i = 0; i < lines.length; i++) {
		if (mask[i]) continue;
		const m = lines[i].match(/^#\s+(.+?)\s*$/);
		if (m) return stripControlSequences(m[1].trim());
	}
	return undefined;
}

/** Parse the restricted `status:` scalar from YAML frontmatter, if any. */
export function parseFrontmatterStatus(lines: string[]): SpecletStatus | undefined {
	if ((lines[0]?.trim() ?? "") !== "---") return undefined;
	let close = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === "---") {
			close = i;
			break;
		}
	}
	// Unclosed frontmatter is malformed: no recoverable status, but the rest of
	// the file stays parseable (caller keeps whole content).
	if (close === -1) return undefined;
	for (let i = 1; i < close; i++) {
		const m = lines[i].match(/^status:\s*(.+?)\s*$/);
		if (!m) continue;
		let value = m[1];
		const q = value.match(/^(["'])(.*)\1\s*$/);
		if (q) value = q[2];
		return (VALID_STATUSES as readonly string[]).includes(value) ? (value as SpecletStatus) : "unknown";
	}
	return undefined; // no status key
}

const TASK_RE = /^- \[([xX ])\] (\d+)[.)][ \t]*(.*)$/;

/** Extract `Criteria: AC1, AC2` ids from a task's detail rows (empty when absent). */
export function criteriaIds(details: string[] | undefined): string[] {
	if (!details) return [];
	const line = details.find((d) => /^criteria:/i.test(d.replace(/^-\s*/, "").trim()));
	const raw = (line ?? "").replace(/^-\s*/, "").replace(/^criteria:\s*/i, "");
	return raw
		.split(/[,;]\s*/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Map AC ids to their full `- ACn: text` lines from the Requirements section; null when unresolvable. */
export function resolveCriteria(ids: string[], requirementsLines: string[]): { id: string; text: string | null }[] {
	const map = new Map<string, string>();
	for (const line of requirementsLines) {
		const m = line.match(/^-\s*(AC\S+?):\s*(.+)$/);
		if (m) map.set(m[1], m[2]);
	}
	return ids.map((id) => ({ id, text: map.get(id) ?? null }));
}

/** Markdown body with a closed frontmatter block removed; unclosed frontmatter keeps the whole file. */
export function stripClosedFrontmatter(lines: string[]): string[] {
	if ((lines[0]?.trim() ?? "") !== "---") return lines;
	const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
	return close === -1 ? lines : lines.slice(close + 1);
}

function extractSection(lines: string[], mask: boolean[], name: string): string[] {
	const start = lines.findIndex((l, i) => !mask[i] && new RegExp(`^##\\s+${name}\s*$`, "i").test(l));
	if (start === -1) return [];
	const body: string[] = [];
	for (let i = start + 1; i < lines.length; i++) {
		if (mask[i]) continue;
		if (/^#{1,2}\s/.test(lines[i])) break;
		body.push(lines[i]);
	}
	while (body.length > 0 && body[0].trim() === "") body.shift();
	while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
	return body;
}

export interface SpecletSections {
	requirements: string[];
	design: string[];
}

/**
 * Raw lines of the `## Requirements` and `## Design Notes` sections, fence-aware,
 * each section ending at the next h1/h2, heading lines excluded, blank edges trimmed.
 * Missing sections yield empty arrays.
 */
export function parseSections(content: string): SpecletSections {
	const lines = stripClosedFrontmatter(content.split(/\r?\n/));
	const mask = fenceMask(lines);
	return {
		requirements: extractSection(lines, mask, "Requirements"),
		design: extractSection(lines, mask, "Design Notes"),
	};
}

/** Checkbox task rows in the `## Tasks` section with their indented detail rows captured per task. */
export function parseTasks(lines: string[]): SpecletTask[] {
	const mask = fenceMask(lines);
	const start = lines.findIndex((l, i) => !mask[i] && /^##\s+Tasks\s*$/i.test(l));
	if (start === -1) return [];
	const tasks: SpecletTask[] = [];
	let current: SpecletTask | undefined;
	for (let i = start + 1; i < lines.length; i++) {
		if (mask[i]) continue;
		if (/^#{1,2}\s/.test(lines[i])) break; // next h1 or h2 ends the section
		const m = lines[i].match(TASK_RE);
		if (m) {
			current = {
				id: m[2],
				done: m[1] !== " ",
				title: stripControlSequences(m[3].trim()),
				details: [],
			};
			tasks.push(current);
			continue;
		}
		if (current && /^\s+\S/.test(lines[i])) {
			const detail = stripControlSequences(lines[i].trim());
			if (detail) current.details!.push(detail); // indented description / Criteria: / Depends on:
		}
	}
	return tasks;
}

export function stem(filename: string): string {
	return filename.replace(/\.md$/i, "");
}

export function parseSpeclet(path: string, filename: string, content: string, mtimeMs: number): SpecletFile {
	const lines = content.split(/\r?\n/);
	const status = parseFrontmatterStatus(lines);
	// Markdown body starts after a *closed* frontmatter block so YAML comments
	// like `# internal note` can never become the displayed name. Unclosed
	// (malformed) frontmatter leaves the whole file parseable for recovery (AC9).
	const body = stripClosedFrontmatter(lines);
	const heading = findLevelOneHeading(body);
	return {
		path,
		filename,
		name: heading ?? stripControlSequences(stem(filename)),
		status: status ?? "unknown",
		tasks: parseTasks(body),
		mtimeMs,
	};
}

/**
 * Read every eligible speclet directly inside `dir`: regular `.md` files only
 * (symlinks excluded), `context.md` excluded, no subdirectory recursion. Files
 * that vanish mid-scan are omitted; other read failures become error entries.
 */
async function readSpecletDir(dir: string): Promise<DiscoveryResult> {
	let entries: Awaited<ReturnType<typeof readdir>>;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return { files: [] };
		return { files: [], dirError: `cannot read speclet directory ${dir}: ${String(e)}` };
	}

	const candidates = entries.filter(
		(d) => d.isFile() && d.name.toLowerCase().endsWith(".md") && d.name !== "context.md",
	);

	const settled = await Promise.all(
		candidates.map(async (d): Promise<SpecletFile | undefined> => {
			const path = join(dir, d.name);
			try {
				const [st, content] = await Promise.all([lstat(path), readFile(path, "utf8")]);
				// lstat on a symlink returns the link; isFile() would be false, so
				// re-check on the lstat result to exclude links discovered after readdir.
				if (!st.isFile()) return undefined;
				return parseSpeclet(path, d.name, content, st.mtimeMs);
			} catch (e) {
				if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined; // vanished mid-scan
				return {
					path,
					filename: d.name,
					name: stripControlSequences(stem(d.name)),
					status: "unknown" as SpecletStatus,
					tasks: [],
					mtimeMs: 0,
					error: String(e),
				};
			}
		}),
	);

	return { files: settled.filter((f): f is SpecletFile => f !== undefined) };
}

export interface DiscoveryOptions {
	/**
	 * Also list retired speclets from `{dir}/archive`. Off by default: the 500 ms
	 * poll must never pick them up, and only the picker's "Show finished" toggle
	 * asks for them. A missing archive directory is normal.
	 */
	includeArchive?: boolean;
}

/**
 * Discover speclets in `dir`; with `includeArchive`, also in `dir/archive`.
 * The main directory's error wins — an unreadable root is reported once, and
 * there is nothing to merge when the archive itself is unreadable.
 */
export async function discoverSpeclets(dir: string, options: DiscoveryOptions = {}): Promise<DiscoveryResult> {
	const main = await readSpecletDir(dir);
	if (!options.includeArchive || main.dirError) return main;
	const archived = await readSpecletDir(join(dir, "archive"));
	return {
		files: [...main.files, ...archived.files],
		dirError: archived.dirError,
	};
}
