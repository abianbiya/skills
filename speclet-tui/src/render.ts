/**
 * render.ts — pure selection and rendering helpers. No imports: the widget's
 * width truncation is injected so tests can supply a reference implementation
 * and index.ts passes pi-tui's truncateToWidth.
 */

import { stripControlSequences, type SpecletFile } from "./speclet.js";

/** Lower rank wins. Mirrors AC1: in-progress, approved, draft, done, then unknown. */
const STATUS_RANK: Record<string, number> = {
	"in-progress": 0,
	approved: 1,
	draft: 2,
	done: 3,
	unknown: 4,
};

/**
 * Pick the speclet the panel shows. A pinned filename wins while it exists;
 * otherwise rank by status, then newest mtime, then filename ascending.
 */
export function selectActive(files: SpecletFile[], pinned?: string): SpecletFile | undefined {
	if (pinned !== undefined) {
		const hit = files.find((f) => f.filename === pinned);
		if (hit) return hit;
	}
	const sorted = [...files].sort((a, b) => {
		const r = STATUS_RANK[a.status] - STATUS_RANK[b.status];
		if (r !== 0) return r;
		if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
		return a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0;
	});
	return sorted[0];
}

export type Truncate = (line: string, width: number) => string;

export const DEFAULT_MAX_LINES = 12;

/** Semantic parts of the panel, each styleable independently. */
export type StyleKind =
	| "heading" // "Speclet: {name}"
	| "meta" // " ({done}/{total}) · {status}"
	| "doneGlyph"
	| "openGlyph"
	| "taskDone" // title of a completed task
	| "taskOpen" // title of a pending task
	| "more"
	| "rule"; // separator line opening the panel

export type Styler = (text: string, kind: StyleKind) => string;

export const plainStyler: Styler = (text) => text;

const INDENT = "  "; // left margin so the panel reads as its own block

/**
 * Render the panel lines for `spec` within `width`. Layout budget: at most
 * maxLines content rows — a separator rule, heading, up to N task rows, and
 * an optional `+N more` marker. Task order is retained and all tasks
 * count toward progress even when hidden. Styling is applied per part via
 * `styler` (default plain); `truncate` must be width-aware for the final text.
 */
export function renderWidgetLines(
	spec: SpecletFile,
	width: number,
	maxLines: number = DEFAULT_MAX_LINES,
	truncate: Truncate,
	styler: Styler = plainStyler,
): string[] {
	const done = spec.tasks.filter((t) => t.done).length;
	const heading =
		styler(`${INDENT}Speclet: ${spec.name}`, "heading") +
		styler(` (${done}/${spec.tasks.length}) · ${spec.status}`, "meta");
	const rule = truncate(styler(` ${"─".repeat(Math.max(0, width - 2))}`, "rule"), width);

	const rows = spec.tasks.map((t) =>
		truncate(
			`${INDENT}${styler(t.done ? "●" : "○", t.done ? "doneGlyph" : "openGlyph")} ${t.id} ${styler(
				t.title,
				t.done ? "taskDone" : "taskOpen",
			)}`,
			width,
		),
	);

	const budget = maxLines - 2; // rows that fit between the rule and heading
	let body: string[];
	if (rows.length <= budget) {
		body = rows;
	} else if (budget >= 2) {
		const visible = budget - 1; // reserve one row for the overflow marker
		body = [...rows.slice(0, visible), truncate(styler(`${INDENT}+${rows.length - visible} more`, "more"), width)];
	} else if (budget === 1) {
		body = [truncate(styler(`${INDENT}+${rows.length} more`, "more"), width)];
	} else {
		body = []; // degenerate budget: heading and rule only
	}
	// Opening rule separates the panel from the chat above; the editor's own
	// border already closes it below.
	return [rule, truncate(heading, width), ...body];
}

/** One scrollbar track character per visible row: proportional thumb over a dim track. */
export function renderScrollbar(total: number, visible: number, offset: number): string[] {
	if (total <= 0 || visible <= 0) return [];
	if (total <= visible) return Array.from({ length: visible }, () => " ");
	const thumbSize = Math.max(1, Math.round((visible * visible) / total));
	const denom = total - visible;
	const thumbStart = Math.round((denom > 0 ? offset / denom : 0) * (visible - thumbSize));
	return Array.from({ length: visible }, (_, i) => (i >= thumbStart && i < thumbStart + thumbSize ? "█" : "░"));
}

export interface DetailsRenderOptions {
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

/** Visible length of a line: ANSI escapes stripped, code points counted as one column. */
function visibleLen(line: string): number {
	return [...line.replace(/\x1b\[[0-9;:?]*[ -/]*[@-~]/g, "")].length;
}

/** Right-pad a (possibly styled) line with spaces to the visible width. */
function padVisible(line: string, width: number): string {
	return line + " ".repeat(Math.max(0, width - visibleLen(line)));
}

/**
 * Word-wrap a line to the visible width: continuation lines get two-space
 * indent (original leading indent preserved on the first line), overlong
 * words are hard-broken. ANSI escapes survive inside their chunk; styled
 * spans broken across lines lose styling on the continuation (accepted).
 */
export function wrapText(line: string, width: number): string[] {
	if (width <= 0 || visibleLen(line) <= width) return [line];
	const firstIndent = (line.match(/^\s*/) ?? [""])[0];
	const contIndent = firstIndent + "  ";
	const usable = Math.max(1, width - contIndent.length);
	const out: string[] = [];
	let cur = firstIndent;
	let curLen = visibleLen(cur);
	let empty = cur.trim() === "";
	const newline = () => {
		cur = contIndent;
		curLen = visibleLen(cur);
		empty = true;
	};
	const emit = (s: string) => {
		out.push(s);
		newline();
	};
	for (const rawWord of line.slice(firstIndent.length).split(" ")) {
		if (rawWord === "") continue;
		let word = rawWord;
		while (visibleLen(word) > usable) {
			if (!empty) emit(cur);
			let cut = "";
			let w = 0;
			for (const ch of word) {
				const cw = visibleLen(ch);
				if (w + cw > usable) break;
				cut += ch;
				w += cw;
			}
			emit(cur + cut);
			word = word.slice(cut.length);
		}
		if (word === "") continue;
		const sep = empty ? 0 : 1;
		if (curLen + sep + visibleLen(word) <= width) {
			cur = empty ? cur + word : `${cur} ${word}`;
			curLen += sep + visibleLen(word);
			empty = false;
		} else {
			if (!empty) emit(cur);
			emit(cur + word);
		}
	}
	if (!empty) out.push(cur);
	else if (out.length === 0) out.push(cur);
	return out;
}

/**
 * Render the details popup for the speclet within `width` and `height` rows:
 * heading, one blank separator, a scroll window over `bodyLines` at
 * `scrollOffset` (clamped, optionally with a scrollbar column and left
 * indent), and a dim indicator line when content overflows.
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
	const bodyStyle = (l: string) => (opts.plainBody ? l : styler(l, "taskOpen"));

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

/** Textual listing used by /speclet outside interactive sessions. */
export function listText(files: SpecletFile[]): string {
	return files
		.map((f) => {
			const done = f.tasks.filter((t) => t.done).length;
			const err = f.error ? ` (unreadable)` : "";
			return `${stripControlSequences(f.filename)} · ${f.status} · ${done}/${f.tasks.length}${err}`;
		})
		.join("\n");
}

/**
 * Picker entries for /speclet: display label (sanitized) mapped to the raw
 * filename, so selection never depends on parsing presentation text — labels
 * can round-trip through ctx.ui.select even when a filename contains " · ".
 */
export function pickerOptions(files: SpecletFile[]): { label: string; filename: string }[] {
	return files.map((f) => {
		const done = f.tasks.filter((t) => t.done).length;
		return {
			label: `${stripControlSequences(f.filename)} · ${f.status} · ${done}/${f.tasks.length}`,
			filename: f.filename, // raw — used for lookup/pinning, never rendered
		};
	});
}
