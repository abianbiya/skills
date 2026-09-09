import { describe, test, expect } from "bun:test";
import { selectActive, renderWidgetLines, renderDetailsLines, renderScrollbar, wrapText, listText, pickerOptions, plainStyler, type Truncate } from "./render.js";
import type { SpecletFile } from "./speclet.js";

/** Reference truncation: display-width aware slice (CJK wide = 2 columns), ANSI-escape transparent like pi-tui's truncateToWidth. */
const ANSI_RE = /\x1b\[[0-9;:?]*[ -/]*[@-~]/g;
const refCharW = (ch: string) =>
	ch.codePointAt(0)! > 0x1100 && /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uff60]/.test(ch) ? 2 : 1;
const referenceTruncate: Truncate = (line, width) => {
	const stripped = line.replace(ANSI_RE, "");
	const visibleWidth = [...stripped].reduce((acc, ch) => acc + refCharW(ch), 0);
	if (visibleWidth <= width) return line; // styled text passes through untouched
	let out = "";
	let w = 0;
	for (const ch of stripped) {
		if (w + refCharW(ch) > width) break;
		out += ch;
		w += refCharW(ch);
	}
	return out;
};

function file(overrides: Partial<SpecletFile> = {}): SpecletFile {
	return {
		path: `/x/${overrides.filename ?? "a.md"}`,
		filename: "a.md",
		name: "A",
		status: "draft",
		tasks: [],
		mtimeMs: 0,
		...overrides,
	};
}

describe("selectActive", () => {
	test("ranks in-progress > approved > draft > done > unknown", () => {
		const files = [
			file({ filename: "done.md", status: "done" }),
			file({ filename: "draft.md", status: "draft" }),
			file({ filename: "inprogress.md", status: "in-progress" }),
			file({ filename: "unknown.md", status: "unknown" }),
			file({ filename: "approved.md", status: "approved" }),
		];
		expect(selectActive(files)?.filename).toBe("inprogress.md");
		const noInProgress = files.filter((f) => f.status !== "in-progress");
		expect(selectActive(noInProgress)?.filename).toBe("approved.md");
		expect(selectActive(noInProgress.filter((f) => f.status !== "approved"))?.filename).toBe("draft.md");
		expect(
			selectActive(noInProgress.filter((f) => f.status !== "approved" && f.status !== "draft"))?.filename,
		).toBe("done.md");
		expect(selectActive(files.filter((f) => f.status === "unknown"))?.filename).toBe("unknown.md");
	});

	test("ties break by newest mtime then filename ascending", () => {
		const files = [
			file({ filename: "b.md", mtimeMs: 100 }),
			file({ filename: "a.md", mtimeMs: 100 }),
			file({ filename: "c.md", mtimeMs: 200 }),
		];
		expect(selectActive(files)?.filename).toBe("c.md");
		expect(selectActive(files.filter((f) => f.filename !== "c.md"))?.filename).toBe("a.md");
	});

	test("pin wins while present; falls back when it disappears", () => {
		const files = [file({ filename: "a.md" }), file({ filename: "b.md", status: "in-progress" })];
		expect(selectActive(files, "a.md")?.filename).toBe("a.md");
		expect(selectActive(files.filter((f) => f.filename !== "a.md"), "a.md")?.filename).toBe("b.md");
	});

	test("empty input yields undefined", () => {
		expect(selectActive([])).toBeUndefined();
	});
});

describe("renderWidgetLines", () => {
	const rule = (width: number) => ` ${"─".repeat(width - 2)}`;
	const spec = file({
		name: "My Feature",
		status: "in-progress",
		tasks: [
			{ id: "1", title: "First", done: true },
			{ id: "2", title: "Second", done: false },
			{ id: "3", title: "Third", done: false },
		],
	});

	test("heading shows name, done/total, status; rows keep task order; rule closes the panel", () => {
		expect(renderWidgetLines(spec, 200, 12, referenceTruncate)).toEqual([
			rule(200),
			"  Speclet: My Feature (1/3) · in-progress",
			"  ● 1 First",
			"  ○ 2 Second",
			"  ○ 3 Third",
		]);
	});

	test("zero-task speclet renders heading with 0/0 plus rule", () => {
		const empty = file({ name: "Empty", status: "draft", tasks: [] });
		expect(renderWidgetLines(empty, 80, 12, referenceTruncate)).toEqual([
			rule(80),
			"  Speclet: Empty (0/0) · draft",
		]);
	});

	test("overflow reserves exactly one row for the exact +N count; rule stays last", () => {
		const many = file({
			name: "M",
			status: "draft",
			tasks: Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), title: `T${i + 1}`, done: false })),
		});
		const lines = renderWidgetLines(many, 200, 12, referenceTruncate);
		expect(lines).toHaveLength(12);
		expect(lines[0]).toBe(rule(200));
		expect(lines[1]).toBe("  Speclet: M (0/20) · draft");
		expect(lines[11]).toBe("  +11 more");
		expect(lines[10]).toBe("  ○ 9 T9"); // first 9 rows shown, 10th reserved for marker
		expect(lines[1]).toContain("(0/20)"); // hidden tasks still counted in progress
	});

	test("exactly-fitting list has no overflow row", () => {
		const exactly = file({
			name: "E",
			status: "draft",
			tasks: Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), title: `T${i + 1}`, done: true })),
		});
		const lines = renderWidgetLines(exactly, 200, 12, referenceTruncate);
		expect(lines).toHaveLength(12);
		expect(lines[0]).toBe(rule(200));
		expect(lines[11]).toBe("  ● 10 T10");
	});

	test("truncates to width including Unicode wide characters", () => {
		const wide = file({ name: "広い", status: "draft", tasks: [{ id: "1", title: "學習計畫", done: false }] });
		const lines = renderWidgetLines(wide, 20, 12, referenceTruncate);
		const displayWidth = (line: string) => {
			let w = 0;
			for (const ch of line) {
				const wide2 = ch.codePointAt(0)! > 0x1100 && /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uff60]/.test(ch);
				w += wide2 ? 2 : 1;
			}
			return w;
		};
		for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(20);
		// narrow width cuts but keeps valid prefix ending before overflow
		const heading = lines[1];
		expect(heading.startsWith("  Speclet: 広")).toBe(true);
	});

	test("resizes: same spec renders progressively narrower, rule tracks width", () => {
		const wide = renderWidgetLines(spec, 200, 12, referenceTruncate);
		const narrow = renderWidgetLines(spec, 12, 12, referenceTruncate);
		expect(wide[1]).toBe("  Speclet: My Feature (1/3) · in-progress");
		expect(narrow[1].length).toBeLessThan(wide[1].length);
		expect(narrow.every((l) => l.length <= 12)).toBe(true);
		expect(narrow[0]).toBe(rule(12));
		expect(wide[0]).toBe(rule(200));
	});

	test("applies the styler per semantic part (ANSI, like the theme)", () => {
		const codes = { heading: "31", meta: "90", doneGlyph: "32", openGlyph: "2", taskDone: "90", taskOpen: "37", more: "2", rule: "90" };
		const styled = renderWidgetLines(
			spec,
			200,
			12,
			referenceTruncate,
			(text, kind) => `\x1b[${codes[kind]}m${text}\x1b[0m`,
		);
		const bare = (s: string) => s.replace(ANSI_RE, "");
		expect(bare(styled[0])).toBe(` ${"─".repeat(198)}`);
		expect(bare(styled[1])).toBe("  Speclet: My Feature (1/3) · in-progress");
		expect(styled[0]).toMatch(/^\x1b\[90m ─+\x1b\[0m$/);
		expect(styled[1]).toContain("\x1b[31m  Speclet: My Feature\x1b[0m");
		expect(styled[1]).toContain("\x1b[90m (1/3) · in-progress\x1b[0m");
		expect(styled[2]).toContain("\x1b[32m●\x1b[0m");
		expect(styled[2]).toContain("\x1b[90mFirst\x1b[0m");
		expect(styled[3]).toContain("\x1b[2m○\x1b[0m");
		expect(styled[3]).toContain("\x1b[37mSecond\x1b[0m");
	});
});

describe("renderDetailsLines", () => {
	const header = "Speclet: My Feature · in-progress · 1/3";
	const body = Array.from({ length: 30 }, (_, i) => `body line ${i + 1}`);

	test("header, blank separator, body window at offset, indicator when overflowing", () => {
		const lines = renderDetailsLines(header, body, 200, 12, 0, referenceTruncate);
		expect(lines).toHaveLength(12);
		expect(lines[0]).toBe(header);
		expect(lines[1]).toBe("");
		expect(lines[2]).toBe("body line 1");
		expect(lines[10]).toBe("body line 9");
		expect(lines[11]).toBe("lines 1–9 of 30 · ↑↓ scroll · esc close");
	});

	test("scroll offset moves the window", () => {
		const lines = renderDetailsLines(header, body, 200, 12, 15, referenceTruncate);
		expect(lines[2]).toBe("body line 16");
		expect(lines[10]).toBe("body line 24");
		expect(lines[11]).toBe("lines 16–24 of 30 · ↑↓ scroll · esc close");
	});

	test("offset clamps to the last full window", () => {
		const lines = renderDetailsLines(header, body, 200, 12, 999, referenceTruncate);
		expect(lines[2]).toBe("body line 22");
		expect(lines[10]).toBe("body line 30");
		expect(lines[11]).toContain("22–30");
	});

	test("fitting content hides the indicator", () => {
		const small = ["a", "b", "c"];
		const lines = renderDetailsLines(header, small, 200, 12, 0, referenceTruncate);
		expect(lines).toEqual([header, "", "a", "b", "c"]);
	});

	test("degenerate height still renders at least one body row", () => {
		const lines = renderDetailsLines(header, body, 200, 2, 0, referenceTruncate);
		expect(lines[2]).toBe("body line 1");
		expect(lines.at(-1)).toContain("1–1 of 30");
	});

	test("indent pads all content lines", () => {
		const lines = renderDetailsLines(header, ["x"], 200, 12, 0, referenceTruncate, plainStyler, { indent: "  " });
		expect(lines[0]).toBe(`  ${header}`);
		expect(lines[2]).toBe("  x");
	});

	test("scrollbar column is appended per overflow row at the window position", () => {
		const bar = renderScrollbar(30, 5, 0);
		const lines = renderDetailsLines(header, body, 200, 8, 0, referenceTruncate, plainStyler, { scrollbar: bar });
		expect(lines[2]).toBe("body line 1 " + bar[0]);
		expect(lines.at(-1)).toContain("1–5 of 30");
	});

	test("plainBody skips styling of markdown-rendered lines; header still styled", () => {
		const lines = renderDetailsLines(header, ["# Md Title"], 200, 12, 0, referenceTruncate, (t, k) => `<${k}>${t}</${k}>`, {
			plainBody: true,
		});
		expect(lines[0]).toBe(`<heading>${header}</heading>`);
		expect(lines[2]).toBe("# Md Title");
	});

	test("headerPreStyled passes the header through verbatim", () => {
		const styled = `\x1b[31m${header}\x1b[0m`;
		const lines = renderDetailsLines(styled, ["x"], 200, 12, 0, referenceTruncate, plainStyler, { headerPreStyled: true });
		expect(lines[0]).toBe(styled);
	});

	test("styles header as heading, body text, indicator as more", () => {
		const lines = renderDetailsLines(header, ["x"], 200, 12, 0, referenceTruncate, (t, k) => `${k}:${t}`);
		expect(lines[0]).toBe(`heading:${header}`);
		expect(lines[2]).toBe("taskOpen:x");
	});

	test("border frames the content at full width", () => {
		const lines = renderDetailsLines(header, ["a", "b"], 30, 12, 0, referenceTruncate, plainStyler, { border: true });
		expect(lines[0]).toMatch(/^\u250c\u2500+\u2510$/); // ┌──┐
		expect(lines.at(-1)).toMatch(/^\u2514\u2500+\u2518$/); // └───┘
		expect(lines.every((l) => l.length === 30)).toBe(true);
		expect(lines[1].startsWith("\u2502 ")).toBe(true);
		expect(lines[1].endsWith(" \u2502")).toBe(true);
		expect(lines[3]).toContain(" a ");
	});

	test("truncates to width including the indicator", () => {
		const lines = renderDetailsLines(header, body, 30, 12, 0, referenceTruncate);
		expect(lines.every((l) => l.length <= 30)).toBe(true);
	});
});

describe("wrapText", () => {
	test("returns the line untouched when it fits", () => {
		expect(wrapText("short line", 40)).toEqual(["short line"]);
	});

	test("wraps on word boundaries with continuation indent", () => {
		const lines = wrapText("  - one two three four five six seven", 12);
		expect(lines[0]).toBe("  - one two");
		expect(lines[1]).toBe("    three");
		for (const l of lines) expect(l.length).toBeLessThanOrEqual(12);
		expect(lines.join(" ")).toContain("seven"); // no content lost
	});

	test("hard-breaks words longer than the width", () => {
		const lines = wrapText("abcdefghijklmno", 8);
		expect(lines[0]).toBe("abcdef");
		expect(lines.every((l) => l.length <= 8)).toBe(true);
		expect(lines.map((l) => l.trim()).join("")).toBe("abcdefghijklmno"); // no characters lost
	});

	test("preserves leading indent on the first line only", () => {
		const lines = wrapText("    aaaa bbbb cccc", 8);
		expect(lines[0].startsWith("    ")).toBe(true);
		expect(lines[1].startsWith("      ")).toBe(true); // indent + 2
	});

	test("multiple spaces collapse; empty line passes through", () => {
		expect(wrapText("", 10)).toEqual([""]);
		const lines = wrapText("a  b", 10);
		expect(lines.join(" ")).toContain("b");
	});
});

describe("renderScrollbar", () => {
	test("no scrollbar marks when content fits", () => {
		expect(renderScrollbar(3, 5, 0)).toEqual([" ", " ", " ", " ", " "]);
	});

	test("thumb at top for offset 0 and at bottom for max offset", () => {
		const top = renderScrollbar(30, 10, 0);
		expect(top[0]).toBe("█");
		expect(top[9]).toBe("░");
		const bottom = renderScrollbar(30, 10, 20);
		expect(bottom[9]).toBe("█");
		expect(bottom[0]).toBe("░");
	});

	test("thumb has at least size 1 and stays within the track", () => {
		const bar = renderScrollbar(1000, 3, 500);
		expect(bar).toHaveLength(3);
		expect(bar.filter((c) => c === "█").length).toBeGreaterThanOrEqual(1);
	});
});

describe("listText", () => {
	test("one line per file with status and progress", () => {
		const files = [
			file({ filename: "a.md", status: "draft", tasks: [{ id: "1", title: "A", done: false }] }),
			file({ filename: "b.md", status: "done", tasks: [] }),
		];
		expect(listText(files)).toBe("a.md · draft · 0/1\nb.md · done · 0/0");
	});

	test("filenames with escape sequences are sanitized in listings", () => {
		const files = [file({ filename: "\x1b[31mevil.md", status: "draft", tasks: [] })];
		const text = listText(files);
		expect(text).not.toContain("\x1b");
		expect(text).toContain("evil.md");
	});
});

describe("pickerOptions", () => {
	test("maps sanitized labels to raw filenames", () => {
		const files = [
			file({ filename: "a.md", status: "draft", tasks: [{ id: "1", title: "A", done: false }] }),
			file({ filename: "\x1b[31mevil.md", status: "done", tasks: [] }),
		];
		const options = pickerOptions(files);
		expect(options.map((o) => o.label)).toEqual(["a.md · draft · 0/1", "evil.md · done · 0/0"]);
		expect(options.map((o) => o.filename)).toEqual(["a.md", "\x1b[31mevil.md"]);
	});

	test("label for a filename containing ' · ' survives round-trip lookup", () => {
		const files = [file({ filename: "a · b.md", status: "draft", tasks: [] })];
		const options = pickerOptions(files);
		const choice = options.map((o) => o.label)[0]; // what ctx.ui.select returns
		const picked = options.find((o) => o.label === choice);
		expect(picked?.filename).toBe("a · b.md");
	});
});
