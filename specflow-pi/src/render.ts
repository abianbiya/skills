/**
 * render.ts — pure selection and rendering helpers for the specflow panel and
 * document viewer. Declared fork of speclet-tui/src/render.ts (AC7): the panel
 * is phase-oriented rather than task-oriented, so StyleKind, the widget layout,
 * and the listing differ. Generic text primitives come from ./shared.js.
 */

import { join } from "node:path";
import { padVisible, stripControlSequences, visibleLen } from "./shared.js";
import { dependencyGraph, nextTask, traceCriteria } from "./trace.js";
import type { SpecflowPhase, SpecflowSpec, SpecflowStatus, SpecflowTask } from "./parse.js";

export type Truncate = (line: string, width: number) => string;

/** Panel budget (AC1): rule + heading + phase rail, far under the cap. */
export const DEFAULT_MAX_LINES = 6;

/** Semantic parts of the panel, each styleable independently. */
export type StyleKind =
	| "heading" // "Specflow: {name}"
	| "meta" // " · {status} · {done}/{total}"
	| "phase" // "Phase 3/4 Tasks"
	| "gate" // " · awaiting your review"
	| "next" // "Next: 2.1 Wire the Fastify hook"
	| "warn" // "⚠ 1 unclaimed AC"
	| "body" // unstyled popup body
	| "more" // popup overflow indicator
	| "rule"; // separator line opening the panel

export type Styler = (text: string, kind: StyleKind) => string;

export const plainStyler: Styler = (text) => text;

const INDENT = "  "; // left margin so the panel reads as its own block

/**
 * Selection rank, lowest wins (AC1): gate-paused specs first, then in-progress
 * (a spec with unknown status ranks as in-progress), completed, archived.
 */
const STATUS_RANK: Record<SpecflowStatus, number> = {
	active: 1,
	unknown: 1,
	completed: 2,
	archived: 3,
};

function rank(spec: SpecflowSpec): number {
	return spec.gate !== null ? 0 : STATUS_RANK[spec.status];
}

/**
 * Pick the spec the panel shows. A pinned directory wins while it still
 * exists; otherwise rank by gate/status, then newest document mtime, then name
 * ascending.
 */
export function selectActive(specs: SpecflowSpec[], pinned?: string): SpecflowSpec | undefined {
	if (pinned !== undefined) {
		const hit = specs.find((s) => s.dir === pinned);
		if (hit) return hit;
	}
	const sorted = [...specs].sort((a, b) => {
		const r = rank(a) - rank(b);
		if (r !== 0) return r;
		if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
		return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
	});
	return sorted[0];
}

/** Human label for the inferred phase; the gate badge never replaces it (AC1). */
export function phaseLabel(phase: SpecflowPhase): string {
	switch (phase) {
		case 1:
			return "Phase 1/4 Requirements";
		case 2:
			return "Phase 2/4 Design";
		case 3:
			return "Phase 3/4 Tasks";
		case 4:
			return "Phase 4/4 Execution";
		case "done":
			return "Done";
		case "archived":
			return "Archived";
	}
}

/** " · {done}/{total}" when tasks exist, plus the read-failure marker. */
function metaSuffix(spec: SpecflowSpec): string {
	const count = spec.total > 0 ? ` · ${spec.done}/${spec.total}` : "";
	return `${count}${spec.error ? " · unreadable" : ""}`;
}

/**
 * The next-action row (AC4): the task to run now, why nothing can run, or that
 * work is finished. Undefined when the spec declares no tasks (requirements-only
 * specs have nothing actionable to report).
 */
export function nextActionLine(spec: SpecflowSpec): string | undefined {
	if (spec.tasks.length === 0) return undefined;
	if (spec.tasks.every((t) => t.done)) return "All tasks done";

	const next = nextTask(spec);
	if (next) return `Next: ${next.id} ${next.title}`;

	const deps = dependencyGraph(spec);
	const blocked = deps.blocked[0];
	if (blocked) {
		const title = spec.tasks.find((t) => t.id === blocked.id)?.title;
		return `Waiting: ${blocked.id}${title ? ` ${title}` : ""} (blocked by ${blocked.by.join(", ")})`;
	}
	const dangling = deps.dangling[0];
	if (dangling) {
		return `Waiting: ${dangling.id} (unknown dependency ${dangling.missing.join(", ")})`;
	}
	return "No runnable task";
}

/**
 * The single traceability warning row (AC5): unclaimed requirements, orphaned
 * citations, and dangling dependencies, or undefined when the spec is consistent.
 */
export function traceWarningLine(spec: SpecflowSpec): string | undefined {
	const trace = traceCriteria(spec);
	const deps = dependencyGraph(spec);
	const parts: string[] = [];
	if (trace.unclaimed.length > 0) parts.push(`${trace.unclaimed.length} unclaimed AC`);
	if (trace.orphan.length > 0) {
		parts.push(`${trace.orphan.length} orphan ${trace.orphan.length === 1 ? "criterion" : "criteria"}`);
	}
	if (deps.dangling.length > 0) parts.push(`${deps.dangling.length} dangling dep`);
	return parts.length > 0 ? `⚠ ${parts.join(" · ")}` : undefined;
}

/**
 * Render the panel lines for `spec` within `width`: an opening rule, the
 * heading (name, frontmatter status, task count), the phase rail with the
 * optional review-gate badge, the next-action row, and at most one traceability
 * warning row (AC1, AC4, AC5). `truncate` must be width-aware for the final
 * text; `maxLines` caps the total returned rows.
 */
export function renderWidgetLines(
	spec: SpecflowSpec,
	width: number,
	maxLines: number = DEFAULT_MAX_LINES,
	truncate: Truncate,
	styler: Styler = plainStyler,
): string[] {
	const rule = truncate(styler(` ${"─".repeat(Math.max(0, width - 2))}`, "rule"), width);
	const heading =
		styler(`${INDENT}Specflow: ${spec.name}`, "heading") + styler(` · ${spec.status}${metaSuffix(spec)}`, "meta");
	const rail =
		`${INDENT}${styler(phaseLabel(spec.phase), "phase")}` +
		(spec.gate !== null ? styler(" · awaiting your review", "gate") : "");

	const lines = [rule, truncate(heading, width), truncate(rail, width)];
	const next = nextActionLine(spec);
	if (next) lines.push(truncate(styler(`${INDENT}${next}`, "next"), width));
	const warning = traceWarningLine(spec);
	if (warning) lines.push(truncate(styler(`${INDENT}${warning}`, "warn"), width));
	return lines.slice(0, Math.max(1, maxLines));
}

/** Wrap speclet's popup options verbatim so the popup code stays parallel. */export interface DetailsRenderOptions {
	/** Left padding for every content line (default: none). */
	indent?: string;
	/** One track character per visible body row, appended when content overflows. */
	scrollbar?: string[];
	/** Skip styling of body lines (for pre-rendered markdown output). */
	plainBody?: boolean;
	/** Header line arrives already styled — pass it through verbatim. */
	headerPreStyled?: boolean;
	/** Frame the popup in a terminal-style box (content truncated to the inner width). */
	border?: boolean;
}

/**
 * Render a document popup within `width` and `height` rows: heading, one blank
 * separator, a scroll window over `bodyLines` at `scrollOffset` (clamped,
 * optionally with a scrollbar column and left indent), and a dim indicator
 * line when content overflows. Declared fork of speclet's renderer.
 */
export function renderDetailsLines(
	header: string,
	bodyLines: string[],
	width: number,
	height: number,
	scrollOffset: number,
	truncate: Truncate,
	styler: Styler = plainStyler,
	opts: DetailsRenderOptions = {},
): string[] {
	const indent = opts.indent ?? "";
	const visibleRows = Math.max(1, height - 3); // header + blank separator + indicator
	const maxOffset = Math.max(0, bodyLines.length - visibleRows);
	const offset = Math.max(0, Math.min(scrollOffset, maxOffset));
	const window = bodyLines.slice(offset, offset + visibleRows);
	const headerLine = opts.headerPreStyled ? indent + header : styler(indent + header, "heading");
	const lines: string[] = [truncate(headerLine, width), ""];
	const bodyStyle = (l: string) => (opts.plainBody ? l : styler(l, "body"));

	if (bodyLines.length > visibleRows) {
		const bar = opts.scrollbar;
		window.forEach((l, i) => {
			const base = truncate(bodyStyle(indent + l), Math.max(1, width - indent.length - 2));
			lines.push(bar ? `${base} ${bar[offset + i] ?? " "}` : base);
		});
		const from = offset + 1;
		const to = Math.min(bodyLines.length, offset + visibleRows);
		lines.push(truncate(styler(`${indent}lines ${from}–${to} of ${bodyLines.length} · ↑↓ scroll · esc close`, "more"), width));
	} else {
		for (const l of window) lines.push(truncate(bodyStyle(indent + l), width - indent.length));
	}
	if (opts.border) {
		const inner = width - 4; // "│ " + content + " │"
		const framed = lines.map((l) => {
			const clipped = visibleLen(l) > inner ? truncate(l, inner) : l;
			return `│ ${padVisible(clipped, inner)} │`;
		});
		const edge = "─".repeat(inner + 2);
		return [`┌${edge}┐`, ...framed, `└${edge}┘`];
	}
	return lines;
}

/**
 * Textual listing used by /specflow outside interactive sessions (AC3). Labels
 * are disambiguated by path when two specs share a name (F2).
 */
export function listText(specs: SpecflowSpec[]): string {
	const names = displayNames(specs);
	return specs
		.map((s, i) => {
			const count = s.total > 0 ? ` · ${s.done}/${s.total}` : "";
			const gate = s.gate !== null ? " · awaiting review" : "";
			const err = s.error ? " (unreadable)" : "";
			return `${names[i]} · ${s.status}${count}${gate}${err}`;
		})
		.join("\n");
}

/**
 * Display names for a whole discovery set: identical basenames (a flat spec next
 * to a legacy one, or under two intermediate directories) are disambiguated by
 * appending the shortest unique parent-path chain — the skill's own rule for
 * duplicates ("use actual paths to distinguish duplicates") — so a picker label
 * always maps back to exactly one spec directory.
 */
function displayNames(specs: SpecflowSpec[]): string[] {
	const names = specs.map((s) => stripControlSequences(s.name));
	const groups = new Map<string, number[]>();
	names.forEach((n, i) => groups.set(n, [...(groups.get(n) ?? []), i]));
	for (const [, idxs] of groups) {
		if (idxs.length < 2) continue;
		const parts = idxs.map((i) => specs[i].dir.split("/").filter(Boolean));
		for (let depth = 1; depth <= 8; depth++) {
			const chains = parts.map((p) => p.slice(Math.max(0, p.length - 1 - depth), p.length - 1).join("/"));
			if (new Set(chains).size === idxs.length) {
				idxs.forEach((i, k) => (names[i] = chains[k] ? `${names[i]} (${chains[k]})` : names[i]));
				break;
			}
		}
	}
	return names;
}

/**
 * Picker entries for /specflow: display label (sanitized, path-disambiguated
 * when duplicated) mapped to the raw spec directory, so selection never depends
 * on parsing presentation text — labels round-trip through ctx.ui.select even
 * when a name contains " · ".
 */
export function pickerOptions(specs: SpecflowSpec[]): { label: string; dir: string }[] {
	const names = displayNames(specs);
	return specs.map((s, i) => {
		const count = s.total > 0 ? ` · ${s.done}/${s.total}` : "";
		const gate = s.gate !== null ? " · awaiting review" : "";
		return {
			label: `${names[i]} · ${s.status}${count}${gate}`,
			dir: s.dir, // raw — used for lookup/pinning, never rendered
		};
	});
}

/**
 * Documents the viewer offers (AC4): the three spec documents plus the
 * project context file. Every candidate is listed whether or not it exists, so
 * opening a missing one reports the failure instead of hiding the option.
 */
export function documentOptions(spec: SpecflowSpec, projectFile: string): { label: string; path: string }[] {
	return [
		{ label: "requirements.md", path: spec.docs.requirements ?? join(spec.dir, "requirements.md") },
		{ label: "design.md", path: spec.docs.design ?? join(spec.dir, "design.md") },
		{ label: "tasks.md", path: spec.docs.tasks ?? join(spec.dir, "tasks.md") },
		{ label: "project.md", path: projectFile },
	];
}

/** One executable task in the /specflow task chooser (AC6, AC7). */
export interface TaskOption {
	label: string;
	task: SpecflowTask;
	ready: boolean;
}

/**
 * Unfinished tasks for the execution chooser, marked ▶ ready or ⏸ blocked with
 * the ids they wait on (AC7). Blocked tasks stay selectable — the agent decides
 * whether to run them — but the mark must not overstate what is runnable.
 */
export function taskOptions(spec: SpecflowSpec): TaskOption[] {
	const deps = dependencyGraph(spec);
	const ready = new Set(deps.ready);
	const blockedBy = new Map(deps.blocked.map((b) => [b.id, b.by]));
	return spec.tasks
		.filter((t) => !t.done)
		.map((task) => {
			const isReady = ready.has(task.id);
			const waiting = blockedBy.get(task.id);
			const why = isReady ? "" : ` (blocked by ${waiting && waiting.length > 0 ? waiting.join(", ") : "unknown dep"})`;
			return {
				label: `${isReady ? "▶" : "⏸"} ${stripControlSequences(task.id)} ${stripControlSequences(task.title)}${why}`,
				task,
				ready: isReady,
			};
		});
}

/** The action a /specflow menu entry performs (AC6). */
export type CockpitAction = "execute" | "approve" | "validate" | "document" | "toggle";

export interface ActionOption {
	label: string;
	action: CockpitAction;
}

/**
 * Actions offered for the active spec, in the order they are useful: run work,
 * clear a pending gate, validate, read a document, toggle the panel. Context-
 * sensitive entries (execute, approve) appear only when they can do something.
 */
export function actionOptions(spec: SpecflowSpec, hidden: boolean): ActionOption[] {
	const actions: ActionOption[] = [];
	if (spec.tasks.some((t) => !t.done)) actions.push({ label: "Execute a task…", action: "execute" });
	if (spec.gate !== null) actions.push({ label: "Approve gate and resume", action: "approve" });
	if (spec.tasks.length > 0) actions.push({ label: "Validate implementation", action: "validate" });
	actions.push({ label: "Open document…", action: "document" });
	actions.push({ label: hidden ? "Show panel" : "Hide panel", action: "toggle" });
	return actions;
}
