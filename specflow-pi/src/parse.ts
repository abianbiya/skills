/**
 * parse.ts — discovery and parsing of `.specflow/**` specs (pure where
 * possible; only discoverSpecflows touches the filesystem).
 *
 * Ground truth (specflow/references/tasks-phase.md:14-19 and live specs):
 * - tasks.md has NO `## Tasks` section; executable tasks (`- [x] 1.1 Title`)
 *   live under h2 work-group headings (`## 1. [Work group]`, `## Phase N: ...`).
 * - Task ids are dotted and hierarchical (`N`, `N.M`, `N.M.K`); unnumbered
 *   checkbox rows (prerequisites, parent groups) are NOT executable tasks.
 * - Status and gate are frontmatter scalars in tasks.md (`status:`,
 *   `gate: review`); legacy specs infer status from specs/active|completed|archived/.
 *
 * Forked from speclet-tui/src/speclet.ts (fence masking, frontmatter scalar
 * parsing, task row/detail capture); diverged for the multi-document spec model.
 */

import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { stripControlSequences } from "./shared.js";

export type SpecflowStatus = "active" | "completed" | "archived" | "unknown";
export type SpecflowPhase = 1 | 2 | 3 | 4 | "done" | "archived";
export type Gate = "review" | null;

export interface SpecflowTask {
	id: string;
	title: string;
	done: boolean;
	details?: string[];
}

export interface SpecflowSpec {
	/** Absolute path of the spec directory. */
	dir: string;
	/** Directory basename = display name. */
	name: string;
	status: SpecflowStatus;
	statusSource: "frontmatter" | "directory" | "none";
	/** Lives under specs/active|completed|archived/. */
	legacy: boolean;
	/** Absolute paths of present documents (present keys only). */
	docs: { requirements?: string; design?: string; tasks?: string };
	/** AC ids DEFINED in requirements.md (e.g. ["AC1","AC2"]); [] when absent or unreadable. */
	criteria: string[];
	tasks: SpecflowTask[];
	done: number;
	total: number;
	phase: SpecflowPhase;
	gate: Gate;
	/** Newest document mtime. */
	mtimeMs: number;
	/** Read/parse failure: spec is still listed. */
	error?: string;
}

export interface DiscoveryResult {
	specs: SpecflowSpec[];
	/** Missing .specflow directory is NOT an error (panel hides); other failures are reported here. */
	dirError?: string;
}

const VALID_STATUSES = ["active", "completed", "archived"] as const;
const LEGACY_DIRS = ["active", "completed", "archived"] as const;
const DOC_NAMES = ["requirements.md", "design.md", "tasks.md"] as const;

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
function fenceMask(lines: string[]): boolean[] {
	const mask: boolean[] = new Array(lines.length).fill(false);
	let active: string | undefined;
	for (let i = 0; i < lines.length; i++) {
		const next = fenceTransition(lines[i], active);
		mask[i] = active !== undefined || next !== undefined;
		active = next;
	}
	return mask;
}

/**
 * Split a document into raw frontmatter (between the first `---` line and its
 * closing `---`) and the body after it. Absent or unclosed frontmatter yields
 * an empty frontmatter and keeps the whole content as body.
 */
export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
	const lines = content.split(/\r?\n/);
	if ((lines[0]?.trim() ?? "") !== "---") return { frontmatter: "", body: content };
	let close = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === "---") {
			close = i;
			break;
		}
	}
	if (close === -1) return { frontmatter: "", body: content };
	return {
		frontmatter: lines.slice(1, close).join("\n"),
		body: lines.slice(close + 1).join("\n"),
	};
}

function frontmatterScalar(frontmatter: string, key: string): string | undefined {
	for (const line of frontmatter.split(/\r?\n/)) {
		const m = line.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`));
		if (!m) continue;
		let value = m[1];
		const q = value.match(/^(["'])(.*)\1\s*$/);
		if (q) value = q[2];
		return value;
	}
	return undefined;
}

/**
 * The `status:` scalar from tasks.md frontmatter: active|completed|archived,
 * anything else => "unknown", no key => undefined (caller falls back to the
 * legacy parent directory, then "none").
 */
export function parseStatus(frontmatter: string): SpecflowStatus | undefined {
	const value = frontmatterScalar(frontmatter, "status");
	if (value === undefined) return undefined;
	return (VALID_STATUSES as readonly string[]).includes(value) ? (value as SpecflowStatus) : "unknown";
}

/** The `gate:` scalar from tasks.md frontmatter; `review` is the only defined value, anything else => null. */
export function parseGate(frontmatter: string): Gate {
	const value = frontmatterScalar(frontmatter, "gate");
	return value === "review" ? "review" : null;
}

const TASK_RE = /^- \[([xX ])\] (\d+(?:\.\d+)*)(?:[.)])?[ \t]+(.*)$/;

/**
 * AC criteria DEFINITIONS in requirements.md: the `ACn` token must BEGIN a
 * definition position — after optional leading whitespace, an optional list
 * marker (`-`, `*`, `+`), then an optional bold marker. Matches `- AC1: WHEN
 * ...` (list item, at any indentation), `* **AC2** WHEN ...` and `**AC3** WHEN
 * ...` (bold label), and `AC4: text` (line start). A prose mention such as
 * "see AC1 above" or "(AC1)" mid-sentence is NOT a definition and never
 * matches, because the AC token must still come first after the optional
 * bullet/bold. Fenced blocks are ignored.
 */
const CRITERIA_DEF_RE = /^\s*(?:[-*+]\s+)?(?:\*\*)?(AC\d+)\b/;

/** Defined AC ids in first-appearance order, deduplicated. Never throws. */
function extractCriteria(content: string): string[] {
	const lines = content.split(/\r?\n/);
	const mask = fenceMask(lines);
	const seen = new Set<string>();
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (mask[i]) continue;
		const m = lines[i].match(CRITERIA_DEF_RE);
		if (m && !seen.has(m[1])) {
			seen.add(m[1]);
			out.push(m[1]);
		}
	}
	return out;
}

/**
 * Executable task rows across the WHOLE tasks.md body: top-level (column-0)
 * numbered checkbox rows with a dotted id (`1`, `1.1`, `1.1.2`), optionally
 * closed by `.` or `)`. Unnumbered checkbox rows (prerequisites, parent group
 * boxes) are ignored; fenced blocks are ignored; indented rows directly below
 * a task are captured as its details (description, requirements references).
 */
export function parseTasks(body: string): SpecflowTask[] {
	const lines = body.split(/\r?\n/);
	const mask = fenceMask(lines);
	const tasks: SpecflowTask[] = [];
	let current: SpecflowTask | undefined;
	let capturing = false; // details are the indented rows DIRECTLY below a task row
	for (let i = 0; i < lines.length; i++) {
		if (mask[i]) continue;
		if (lines[i].trim() === "") {
			capturing = false;
			continue;
		}
		const m = lines[i].match(TASK_RE);
		if (m) {
			current = {
				id: m[2],
				done: m[1] !== " ",
				title: stripControlSequences(m[3].trim()),
				details: [],
			};
			tasks.push(current);
			capturing = true;
			continue;
		}
		if (current && capturing && /^\s+\S/.test(lines[i])) {
			const detail = stripControlSequences(lines[i].trim());
			if (detail) current.details!.push(detail);
		}
	}
	return tasks;
}

export interface PhaseInput {
	status: SpecflowStatus;
	hasRequirements: boolean;
	hasDesign: boolean;
	hasTasks: boolean;
	total: number;
	gate: Gate;
}

/**
 * Workflow phase: archived/completed win outright; a spec with executable
 * tasks is Phase 3 (Tasks) while gated, Phase 4 (Executing) once cleared;
 * otherwise the newest missing document decides (design => 2, else 1). A
 * metadata-only tasks.md never reads as Phase 3/4.
 */
export function inferPhase(input: PhaseInput): SpecflowPhase {
	if (input.status === "archived") return "archived";
	if (input.status === "completed") return "done";
	if (input.hasTasks && input.total > 0) return input.gate === "review" ? 3 : 4;
	if (input.hasDesign) return 2;
	return 1;
}

async function docMtime(path: string): Promise<number> {
	try {
		const st = await lstat(path);
		return st.isFile() ? st.mtimeMs : 0;
	} catch {
		return 0;
	}
}

async function readDoc(path: string): Promise<{ content: string } | { error: string }> {
	try {
		const st = await lstat(path);
		if (!st.isFile()) return { error: `${basename(path)} is not a regular file` };
		return { content: await readFile(path, "utf8") };
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return { error: "vanished" };
		return { error: String(e) };
	}
}

async function parseSpecDir(dir: string, parentName: string): Promise<SpecflowSpec> {
	const spec: SpecflowSpec = {
		dir,
		// Stripped at the source: `name` reaches the panel heading and popup header,
		// which render it raw, so control sequences must never survive parsing (F1).
		name: stripControlSequences(basename(dir)),
		status: "unknown",
		statusSource: "none",
		legacy: (LEGACY_DIRS as readonly string[]).includes(parentName),
		docs: {},
		criteria: [],
		tasks: [],
		done: 0,
		total: 0,
		phase: 1,
		gate: null,
		mtimeMs: 0,
	};

	let entries: Awaited<ReturnType<typeof readdir>>;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (e) {
		spec.error = String(e);
		return spec;
	}
	const present = new Set<string>();
	for (const entry of entries) {
		if (entry.isFile() && (DOC_NAMES as readonly string[]).includes(entry.name)) {
			present.add(entry.name);
		}
	}

	let errors: string[] = [];
	for (const doc of DOC_NAMES) {
		if (!present.has(doc)) continue;
		const path = join(dir, doc);
		const key = doc.replace(/\.md$/, "") as keyof SpecflowSpec["docs"];
		spec.docs[key] = path;
		const mtime = await docMtime(path);
		if (mtime > spec.mtimeMs) spec.mtimeMs = mtime;
		if (doc === "requirements.md") {
			const read = await readDoc(path);
			if ("content" in read) spec.criteria = extractCriteria(read.content);
			// unreadable/missing requirements.md: criteria stays [], no error field
			// (discovery needs nothing else from it; the viewer reports read failures).
			continue;
		}
		if (doc !== "tasks.md") continue;
		const read = await readDoc(path);
		if ("error" in read) {
			if (read.error !== "vanished") errors.push(read.error);
			continue;
		}
		const { frontmatter, body } = splitFrontmatter(read.content);
		const fmStatus = parseStatus(frontmatter);
		if (fmStatus !== undefined) {
			spec.status = fmStatus;
			spec.statusSource = "frontmatter";
		} else if (spec.legacy) {
			spec.status = parentName as SpecflowStatus;
			spec.statusSource = "directory";
		}
		spec.gate = parseGate(frontmatter);
		spec.tasks = parseTasks(body);
		spec.total = spec.tasks.length;
		spec.done = spec.tasks.filter((t) => t.done).length;
	}

	if (spec.statusSource === "none" && spec.legacy) {
		// Legacy spec whose tasks.md is missing, unreadable, or status-less: infer from the parent directory.
		spec.status = parentName as SpecflowStatus;
		spec.statusSource = "directory";
	}

	if (errors.length > 0) spec.error = errors.join("; ");
	spec.phase = inferPhase({
		status: spec.status,
		hasRequirements: spec.docs.requirements !== undefined,
		hasDesign: spec.docs.design !== undefined,
		hasTasks: spec.docs.tasks !== undefined,
		total: spec.total,
		gate: spec.gate,
	});
	return spec;
}

/**
 * Discover every spec under `<cwd>/.specflow`: recursive walk; a directory is
 * a spec iff it DIRECTLY contains any of requirements.md / design.md /
 * tasks.md (never descended into). Covers flat `specs/{feature}/` and legacy
 * `specs/{active|completed|archived}/{feature}/`. Symlinked directories and
 * documents are skipped (speclet.ts convention). Results are sorted by name.
 */
export async function discoverSpecflows(specflowDir: string): Promise<DiscoveryResult> {
	let rootEntries: Awaited<ReturnType<typeof readdir>>;
	try {
		rootEntries = await readdir(specflowDir, { withFileTypes: true });
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return { specs: [] };
		return { specs: [], dirError: `cannot read .specflow directory: ${String(e)}` };
	}

	const specs: SpecflowSpec[] = [];
	const dirErrors: string[] = [];

	async function visit(dir: string): Promise<void> {
		let entries: Awaited<ReturnType<typeof readdir>>;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch (e) {
			dirErrors.push(`cannot read ${dir}: ${String(e)}`);
			return;
		}
		const subdirs = entries.filter((d) => d.isDirectory() && !d.isSymbolicLink());
		const docNames = entries.filter((d) => d.isFile() && (DOC_NAMES as readonly string[]).includes(d.name));
		if (docNames.length > 0) {
			// The spec's containing directory decides legacy inference: specs/{feature} => "specs",
			// specs/{active|completed|archived}/{feature} => the legacy kind.
			specs.push(await parseSpecDir(dir, basename(dirname(dir))));
			return; // never descend into a spec directory
		}
		for (const subdir of subdirs) await visit(join(dir, subdir.name));
	}

	for (const entry of rootEntries) {
		if (entry.isDirectory() && !entry.isSymbolicLink()) {
			await visit(join(specflowDir, entry.name));
		}
	}

	specs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return { specs, dirError: dirErrors.length > 0 ? dirErrors.join("; ") : undefined };
}
