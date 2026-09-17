import { describe, test, expect } from "bun:test";
import type { SpecflowPhase, SpecflowSpec, SpecflowStatus } from "./parse.js";
import {
	actionOptions,
	documentOptions,
	isFinished,
	listText,
	nextActionLine,
	phaseLabel,
	pickerOptions,
	plainStyler,
	renderDetailsLines,
	renderWidgetLines,
	selectActive,
	taskOptions,
	traceWarningLine,
	visibleSpecs,
	type Truncate,
} from "./render.js";

const truncate: Truncate = (line, width) => (line.length <= width ? line : line.slice(0, width));

/** Minimal spec fixture; `dir` follows `name` unless the override sets it. */
function spec(over: Partial<SpecflowSpec> = {}): SpecflowSpec {
	const merged = {
		name: "demo",
		status: "active" as SpecflowStatus,
		statusSource: "frontmatter" as const,
		legacy: false,
		docs: {},
		tasks: [],
		criteria: [],
		done: 0,
		total: 0,
		phase: 1 as SpecflowPhase,
		gate: null,
		mtimeMs: 0,
		...over,
	};
	return { dir: `/r/.specflow/specs/${merged.name}`, ...merged } as SpecflowSpec;
}

describe("isFinished and visibleSpecs", () => {
	test("completed and archived are retired; active and unknown are not", () => {
		expect(isFinished(spec({ status: "completed" }))).toBe(true);
		expect(isFinished(spec({ status: "archived" }))).toBe(true);
		expect(isFinished(spec({ status: "active" }))).toBe(false);
		// unreadable/legacy spec: must keep surfacing rather than disappear
		expect(isFinished(spec({ status: "unknown", error: "EACCES" }))).toBe(false);
	});

	test("a spec with every task checked but still active is not retired", () => {
		const allChecked = spec({
			status: "active",
			phase: 4,
			tasks: [{ id: "1", title: "t", done: true, details: [] }],
			done: 1,
			total: 1,
		});
		expect(isFinished(allChecked)).toBe(false); // only the status transition retires a spec
	});

	test("visibleSpecs drops retired specs unless the toggle is on", () => {
		const specs = [
			spec({ name: "running", status: "active" }),
			spec({ name: "shipped", status: "completed" }),
			spec({ name: "old", status: "archived" }),
		];
		expect(visibleSpecs(specs, false).map((s) => s.name)).toEqual(["running"]);
		expect(visibleSpecs(specs, true).map((s) => s.name)).toEqual(["running", "shipped", "old"]);
	});
});

describe("selectActive", () => {
	test("gate-paused spec outranks an in-progress one", () => {
		const paused = spec({ name: "paused", gate: "review", status: "active" });
		const running = spec({ name: "running", status: "active", phase: 4, mtimeMs: 99 });
		expect(selectActive([running, paused])?.name).toBe("paused");
	});

	test("unknown status ranks alongside in-progress, above completed and archived", () => {
		const unknown = spec({ name: "unknown", status: "unknown" });
		const completed = spec({ name: "completed", status: "completed", phase: "done" });
		const archived = spec({ name: "archived", status: "archived", phase: "archived" });
		expect(selectActive([archived, completed, unknown])?.name).toBe("unknown");
		expect(selectActive([archived, completed])?.name).toBe("completed");
	});

	test("ties break on newest mtime, then name ascending", () => {
		const older = spec({ name: "aaa", mtimeMs: 1 });
		const newer = spec({ name: "zzz", mtimeMs: 2 });
		expect(selectActive([older, newer])?.name).toBe("zzz");
		const b = spec({ name: "bbb", mtimeMs: 5 });
		const a = spec({ name: "aaa", mtimeMs: 5 });
		expect(selectActive([b, a])?.name).toBe("aaa");
	});

	test("a pin wins while the spec still exists, otherwise ranking reapplies", () => {
		const wanted = spec({ name: "wanted", status: "archived", phase: "archived" });
		const other = spec({ name: "other", status: "active" });
		expect(selectActive([wanted, other], wanted.dir)?.name).toBe("wanted");
		expect(selectActive([other], wanted.dir)?.name).toBe("other");
	});

	test("no specs selects nothing", () => {
		expect(selectActive([])).toBeUndefined();
	});
});

describe("phaseLabel", () => {
	test("covers every inferred phase", () => {
		expect(phaseLabel(1)).toBe("Phase 1/4 Requirements");
		expect(phaseLabel(2)).toBe("Phase 2/4 Design");
		expect(phaseLabel(3)).toBe("Phase 3/4 Tasks");
		expect(phaseLabel(4)).toBe("Phase 4/4 Execution");
		expect(phaseLabel("done")).toBe("Done");
		expect(phaseLabel("archived")).toBe("Archived");
	});
});

describe("renderWidgetLines", () => {
	test("renders rule, heading with status and count, and the phase rail", () => {
		const lines = renderWidgetLines(spec({ name: "specflow-pi", status: "active", done: 3, total: 6, phase: 4 }), 80, 6, truncate, plainStyler);
		expect(lines).toHaveLength(3);
		expect(lines[0].startsWith(" ─")).toBe(true);
		expect(lines[1]).toContain("Specflow: specflow-pi");
		expect(lines[1]).toContain("· active · 3/6");
		expect(lines[2]).toContain("Phase 4/4 Execution");
	});

	test("omits the count segment when no task is declared", () => {
		const lines = renderWidgetLines(spec({ phase: 1 }), 80, 6, truncate, plainStyler);
		expect(lines[1]).toContain("Specflow: demo · active");
		expect(lines[1]).not.toContain("0/0");
		expect(lines[2]).toContain("Phase 1/4 Requirements");
	});

	test("gate badge is orthogonal to the phase label and only when present", () => {
		const gated = renderWidgetLines(spec({ phase: 3, gate: "review" }), 80, 6, truncate, plainStyler);
		expect(gated[2]).toContain("Phase 3/4 Tasks");
		expect(gated[2]).toContain("awaiting your review");
		const clear = renderWidgetLines(spec({ phase: 3 }), 80, 6, truncate, plainStyler);
		expect(clear[2]).not.toContain("awaiting your review");
	});

	test("marks unreadable specs and honors the line budget", () => {
		const lines = renderWidgetLines(spec({ error: "EACCES", total: 2, done: 1 }), 80, 6, truncate, plainStyler);
		expect(lines[1]).toContain("unreadable");
		expect(renderWidgetLines(spec(), 80, 2, truncate, plainStyler)).toHaveLength(2);
	});

	test("truncates overlong lines to the panel width", () => {
		const lines = renderWidgetLines(spec({ name: "x".repeat(200) }), 40, 6, truncate, plainStyler);
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(40);
	});
});

describe("listText / pickerOptions", () => {
	test("lists name · status · done/total · gate with the count omitted when absent", () => {
		const text = listText([
			spec({ name: "with-tasks", status: "active", done: 1, total: 4 }),
			spec({ name: "gate-only", status: "active", gate: "review", phase: 1 }),
			spec({ name: "broken", status: "unknown", error: "EACCES" }),
		]);
		expect(text.split("\n")).toEqual(["with-tasks · active · 1/4", "gate-only · active · awaiting review", "broken · unknown (unreadable)"]);
	});

	test("never lists anything when there are no specs", () => {
		expect(listText([])).toBe("");
	});

	test("the text listing disambiguates duplicate basenames too (F2)", () => {
		const text = listText([
			spec({ name: "foo", dir: "/r/.specflow/specs/foo", done: 0, total: 1 }),
			spec({ name: "foo", dir: "/r/.specflow/specs/archived/foo", status: "archived", phase: "archived" }),
		]);
		expect(text.split("\n")).toEqual(["foo (specs) · active · 0/1", "foo (archived) · archived"]);
	});

	test("picker labels are sanitized while the raw dir round-trips", () => {
		const raw = spec({ name: "evil \u001b[31mname" });
		const [option] = pickerOptions([raw]);
		expect(option.label).toBe("evil name · active");
		expect(option.dir).toBe(raw.dir);
		expect(pickerOptions([raw]).find((o) => o.label === option.label)?.dir).toBe(raw.dir);
	});

	test("a name containing ' · ' still round-trips through the label", () => {
		const odd = spec({ name: "a · b" });
		const options = pickerOptions([odd]);
		expect(options.find((o) => o.label === options[0].label)?.dir).toBe(odd.dir);
	});

	test("same basename in flat and legacy layouts yields distinct, pinnable labels (F2)", () => {
		const flat = spec({ name: "foo", dir: "/r/.specflow/specs/foo", status: "active" });
		const legacy = spec({ name: "foo", dir: "/r/.specflow/specs/active/foo", status: "active", legacy: true });
		const options = pickerOptions([flat, legacy]);
		expect(new Set(options.map((o) => o.label)).size).toBe(2);
		// every label maps back to exactly one directory
		for (const o of options) expect(options.filter((x) => x.label === o.label)).toHaveLength(1);
		expect(options.find((o) => o.label.includes("(specs)"))?.dir).toBe(flat.dir);
		expect(options.find((o) => o.label.includes("(active)"))?.dir).toBe(legacy.dir);
	});

	test("duplicate basenames in the same parent disambiguate deeper (F2)", () => {
		const a = spec({ name: "foo", dir: "/r/.specflow/specs/a/foo" });
		const b = spec({ name: "foo", dir: "/r/.specflow/specs/b/foo" });
		const options = pickerOptions([a, b]);
		expect(new Set(options.map((o) => o.label)).size).toBe(2);
	});

	test("distinct names are never decorated with a path suffix", () => {
		const options = pickerOptions([spec({ name: "one" }), spec({ name: "two" })]);
		expect(options.map((o) => o.label)).toEqual(["one · active", "two · active"]);
	});
});

describe("documentOptions", () => {
	test("offers the three spec documents plus project.md", () => {
		const options = documentOptions(spec({ name: "feat" }), "/r/.specflow/project.md");
		expect(options.map((o) => o.label)).toEqual(["requirements.md", "design.md", "tasks.md", "project.md"]);
		expect(options.map((o) => o.path)).toEqual([
			"/r/.specflow/specs/feat/requirements.md",
			"/r/.specflow/specs/feat/design.md",
			"/r/.specflow/specs/feat/tasks.md",
			"/r/.specflow/project.md",
		]);
	});

	test("prefers the discovered path when parse.ts reported one", () => {
		const options = documentOptions(
			spec({ name: "legacy", docs: { requirements: "/r/.specflow/specs/active/legacy/requirements.md" } }),
			"/r/.specflow/project.md",
		);
		expect(options[0].path).toBe("/r/.specflow/specs/active/legacy/requirements.md");
	});
});

describe("renderDetailsLines", () => {
	test("frames the popup and reports the scroll window when content overflows", () => {
		const body = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
		const lines = renderDetailsLines("feat · design.md", body, 40, 12, 0, truncate, plainStyler, {
			indent: "  ",
			scrollbar: Array.from({ length: 9 }, () => "░"),
			plainBody: true,
			border: true,
		});
		expect(lines[0].startsWith("┌")).toBe(true);
		expect(lines.at(-1)?.startsWith("└")).toBe(true);
		expect(lines.join("\n")).toContain("lines 1–9 of 40");
		expect(lines.join("\n")).toContain("feat · design.md");
	});

	test("no overflow indicator when the body fits", () => {
		const lines = renderDetailsLines("h", ["one"], 40, 12, 0, truncate, plainStyler, {});
		expect(lines.join("\n")).not.toContain("lines 1–");
	});

	test("clamps an out-of-range scroll offset", () => {
		const body = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
		const lines = renderDetailsLines("h", body, 60, 12, 999, truncate, plainStyler, {});
		expect(lines.join("\n")).toContain("lines 32–40 of 40");
	});
});

/** A task fixture whose detail rows are exactly what parse.ts stores. */
function task(id: string, done = false, details: string[] = []) {
	return { id, title: `${id} work`, done, details };
}

describe("nextActionLine (AC4)", () => {
	test("names the first ready task in document order", () => {
		const s = spec({
			tasks: [task("1.1"), task("1.2", false, ["- Depends on: 1.1"]), task("2.1")],
			total: 3,
		});
		expect(nextActionLine(s)).toBe("Next: 1.1 1.1 work");
	});

	test("skips a done task and reports the next ready one", () => {
		const s = spec({ tasks: [task("1.1", true), task("1.2")], done: 1, total: 2 });
		expect(nextActionLine(s)).toBe("Next: 1.2 1.2 work");
	});

	test("waits with the blocking ids when nothing is ready", () => {
		const s = spec({ tasks: [task("1.1"), task("2.1", false, ["- Depends on: 1.1"])], total: 2 });
		expect(nextActionLine(s)).toBe("Next: 1.1 1.1 work");
		// mutual dependency: every unfinished task waits, so nothing is runnable
		const cycle = spec({
			tasks: [task("1.1", false, ["- Depends on: 2.1"]), task("2.1", false, ["- Depends on: 1.1"])],
			total: 2,
		});
		expect(nextActionLine(cycle)).toBe("Waiting: 1.1 1.1 work (blocked by 2.1)");
	});

	test("names an unknown dependency instead of treating it as satisfied", () => {
		const s = spec({ tasks: [task("2.1", false, ["- Depends on: 9.9"])], total: 1 });
		expect(nextActionLine(s)).toBe("Waiting: 2.1 (unknown dependency 9.9)");
	});

	test("reports completion, and says nothing when the spec declares no tasks", () => {
		expect(nextActionLine(spec({ tasks: [task("1.1", true)], done: 1, total: 1 }))).toBe("All tasks done");
		expect(nextActionLine(spec({ total: 0 }))).toBeUndefined();
	});
});

describe("traceWarningLine (AC5)", () => {
	test("stays silent for a consistent spec", () => {
		const s = spec({ tasks: [task("1.1", false, ["- Criteria: AC1"])], criteria: ["AC1"], total: 1 });
		expect(traceWarningLine(s)).toBeUndefined();
	});

	test("counts unclaimed ACs, singulars an orphan criterion, and reports dangling deps", () => {
		expect(traceWarningLine(spec({ tasks: [task("1.1")], criteria: ["AC1", "AC2"], total: 1 }))).toBe(
			"⚠ 2 unclaimed AC",
		);
		expect(traceWarningLine(spec({ tasks: [task("1.1", false, ["- Criteria: AC7"])], criteria: [], total: 1 }))).toBe(
			"⚠ 1 orphan criterion",
		);
		expect(traceWarningLine(spec({ tasks: [task("2.1", false, ["- Depends on: 9.9"])], total: 1 }))).toBe(
			"⚠ 1 dangling dep",
		);
	});

	test("joins several problems into one line", () => {
		const s = spec({
			tasks: [task("1.1", false, ["- Criteria: AC7"]), task("2.1", false, ["- Depends on: 9.9"])],
			criteria: ["AC1"],
			total: 2,
		});
		expect(traceWarningLine(s)).toBe("⚠ 1 unclaimed AC · 1 orphan criterion · 1 dangling dep");
	});
});

describe("taskOptions (AC7)", () => {
	test("marks ready tasks and blocked ones with what they wait on, excluding done tasks", () => {
		const s = spec({
			tasks: [task("1.1", true), task("1.2"), task("2.1", false, ["- Depends on: 1.2"])],
			done: 1,
			total: 3,
		});
		const options = taskOptions(s);
		expect(options.map((o) => o.label)).toEqual([
			"▶ 1.2 1.2 work",
			"⏸ 2.1 2.1 work (blocked by 1.2)",
		]);
		expect(options.map((o) => o.ready)).toEqual([true, false]);
		expect(options.map((o) => o.task.id)).toEqual(["1.2", "2.1"]);
	});

	test("sanitizes ids and titles and marks an unknown dependency", () => {
		const evil = { id: "1.1", title: "evil\u001b[31mtitle", done: false, details: ["- Depends on: 9.9"] };
		const [option] = taskOptions(spec({ tasks: [evil], total: 1 }));
		expect(option.label).toBe("⏸ 1.1 eviltitle (blocked by unknown dep)");
		expect(option.label).not.toContain("\u001b");
	});

	test("no unfinished task yields no options", () => {
		expect(taskOptions(spec({ tasks: [task("1.1", true)], done: 1, total: 1 }))).toEqual([]);
	});
});

describe("actionOptions (AC6)", () => {
	test("offers execute, validate, document and toggle for a running spec", () => {
		const s = spec({ tasks: [task("1.1")], total: 1 });
		expect(actionOptions(s, false)).toEqual([
			{ label: "Execute a task…", action: "execute" },
			{ label: "Validate implementation", action: "validate" },
			{ label: "Open document…", action: "document" },
			{ label: "Hide panel", action: "toggle" },
		]);
	});

	test("adds approve only when a gate is pending", () => {
		const gated = spec({ tasks: [task("1.1")], total: 1, gate: "review", phase: 3 });
		expect(actionOptions(gated, true).map((a) => a.action)).toEqual([
			"execute",
			"approve",
			"validate",
			"document",
			"toggle",
		]);
		expect(actionOptions(gated, true).at(-1)?.label).toBe("Show panel");
	});

	test("hides execute and validate when there is no task work", () => {
		expect(actionOptions(spec({ total: 0 }), false).map((a) => a.action)).toEqual(["document", "toggle"]);
		expect(actionOptions(spec({ tasks: [task("1.1", true)], done: 1, total: 1 }), false).map((a) => a.action)).toEqual([
			"validate",
			"document",
			"toggle",
		]);
	});
});

describe("renderWidgetLines with the cockpit rows (AC4, AC5)", () => {
	test("adds the next-action row and the warning row within the budget", () => {
		const s = spec({
			tasks: [task("1.1", false, ["- Criteria: AC7"])],
			criteria: ["AC1"],
			total: 1,
			phase: 4,
		});
		const lines = renderWidgetLines(s, 90, 6, truncate, plainStyler);
		expect(lines).toHaveLength(5);
		expect(lines[3]).toBe("  Next: 1.1 1.1 work");
		expect(lines[4]).toBe("  ⚠ 1 unclaimed AC · 1 orphan criterion");
		expect(lines.every((l) => l.length <= 90)).toBe(true);
	});

	test("a consistent spec shows no warning row", () => {
		const s = spec({ tasks: [task("1.1", false, ["- Criteria: AC1"])], criteria: ["AC1"], total: 1 });
		const lines = renderWidgetLines(s, 90, 6, truncate, plainStyler);
		expect(lines).toHaveLength(4);
		expect(lines.some((l) => l.includes("⚠"))).toBe(false);
	});

	test("a requirements-only spec keeps the three base rows", () => {
		const lines = renderWidgetLines(spec({ phase: 1 }), 90, 6, truncate, plainStyler);
		expect(lines).toHaveLength(3);
	});

	test("respects a tighter cap than the number of rows available", () => {
		const s = spec({ tasks: [task("1.1", false, ["- Criteria: AC7"])], criteria: [], total: 1 });
		expect(renderWidgetLines(s, 90, 4, truncate, plainStyler)).toHaveLength(4);
		expect(renderWidgetLines(s, 90, 2, truncate, plainStyler)).toHaveLength(2);
	});
});
