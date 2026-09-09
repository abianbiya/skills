import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, symlink, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	discoverSpeclets,
	fenceMask,
	parseFrontmatterStatus,
	parseSpeclet,
	parseTasks,
	parseSections,
	criteriaIds,
	resolveCriteria,
	stem,
	findLevelOneHeading,
	stripControlSequences,
} from "./speclet.js";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "speclet-tui-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

// Frontmatter must be the first thing in the file.
const HEADER = "---\nstatus: in-progress\n---\n\n# My Feature\n";

describe("fenceMask", () => {
	test("masks fenced lines for backticks and tildes", () => {
		const lines = ["a", "```", "fenced # Not a heading", "```", "b", "~~~", "also fenced", "~~~", "c"];
		expect(fenceMask(lines)).toEqual([false, true, true, true, false, true, true, true, false]);
	});
	test("fence of the other character type does not close an open fence", () => {
		const lines = ["~~~", "x", "```", "y", "```", "z", "~~~", "after"];
		expect(fenceMask(lines)).toEqual([true, true, true, true, true, true, true, false]);
	});
});

describe("findLevelOneHeading", () => {
	test("first h1 outside fences wins; fenced headings ignored", () => {
		const lines = ["```md", "# Fake", "```", "## Sub", "# Real Name", "text"];
		expect(findLevelOneHeading(lines)).toBe("Real Name");
	});
	test("undefined when only h2 exists", () => {
		expect(findLevelOneHeading(["## Tasks", "- [ ] 1. A"])).toBeUndefined();
	});
});

describe("parseFrontmatterStatus", () => {
	const fm = (...body: string[]) => ["---", ...body, "---", "# T"].map((l) => l);

	test("valid scalar values", () => {
		expect(parseFrontmatterStatus(fm("status: draft"))).toBe("draft");
		expect(parseFrontmatterStatus(fm("status: in-progress"))).toBe("in-progress");
	});
	test("quoted values", () => {
		expect(parseFrontmatterStatus(fm('status: "done"'))).toBe("done");
		expect(parseFrontmatterStatus(fm("status: 'approved'"))).toBe("approved");
	});
	test("invalid value becomes unknown flag", () => {
		expect(parseFrontmatterStatus(fm("status: banana"))).toBe("unknown");
	});
	test("missing status key and missing frontmatter return undefined", () => {
		expect(parseFrontmatterStatus(fm("title: x"))).toBeUndefined();
		expect(parseFrontmatterStatus(["# T"])).toBeUndefined();
	});
	test("unclosed frontmatter is malformed: undefined status", () => {
		expect(parseFrontmatterStatus(["---", "status: draft", "# T"])).toBeUndefined();
	});
});

describe("parseTasks", () => {
	test("parses numbered checkbox rows with x/X state", () => {
		const lines = [
			"# T",
			"## Tasks",
			"- [ ] 1. First task",
			"- [x] 2. Second task",
			"- [X] 3. Third task",
		];
		expect(parseTasks(lines)).toEqual([
			{ id: "1", title: "First task", done: false, details: [] },
			{ id: "2", title: "Second task", done: true, details: [] },
			{ id: "3", title: "Third task", done: true, details: [] },
		]);
	});
	test("section ends at next h1 or h2", () => {
		const lines = ["## Tasks", "- [ ] 1. A", "## Notes", "- [ ] 2. B", "# Elsewhere", "- [ ] 3. C"];
		expect(parseTasks(lines)).toEqual([{ id: "1", title: "A", done: false, details: [] }]);
	});
	test("indented detail rows are captured per task", () => {
		const lines = [
			"## Tasks",
			"- [ ] 1. Real task",
			"  - Add the thing",
			"  - Criteria: AC1",
			"\t- [ ] 5. Indented pseudo-task stays out of titles",
			"    Depends on: 1",
		];
		const tasks = parseTasks(lines);
		expect(tasks).toHaveLength(1);
		expect(tasks[0].title).toBe("Real task");
		expect(tasks[0].details).toEqual([
			"- Add the thing",
			"- Criteria: AC1",
			"- [ ] 5. Indented pseudo-task stays out of titles",
			"Depends on: 1",
		]);
	});

	test("tasks without detail rows get empty details", () => {
		const lines = ["## Tasks", "- [x] 1. Lone task"];
		expect(parseTasks(lines)[0].details).toEqual([]);
	});

	test("fenced indented rows are not captured as details", () => {
		const lines = ["## Tasks", "- [ ] 1. Real", "```", "  - fake detail", "```", "- [ ] 2. Second"];
		const tasks = parseTasks(lines);
		expect(tasks[0].details).toEqual([]);
		expect(tasks[1].title).toBe("Second");
	});
	test("fenced examples are ignored", () => {
		const lines = [
			"## Tasks",
			"- [ ] 1. Real",
			"```",
			"- [ ] 9. Fake in fence",
			"~~~",
			"- [ ] 8. Fake in tilde fence",
			"~~~",
			"```",
			"- [x] 2. Also real",
		];
		expect(parseTasks(lines)).toEqual([
			{ id: "1", title: "Real", done: false, details: [] },
			{ id: "2", title: "Also real", done: true, details: [] },
		]);
	});
	test("missing Tasks section means zero tasks", () => {
		expect(parseTasks(["# T", "some prose"])).toEqual([]);
	});
	test("number is a label, not an array position", () => {
		const lines = ["## Tasks", "- [ ] 41. Forty-first"];
		expect(parseTasks(lines)[0].id).toBe("41");
	});
});

describe("stripControlSequences", () => {
	test("removes ANSI and control chars", () => {
		expect(stripControlSequences("\x1b[31mRed\x1b[0m Ti\x07tle\x1b]0;osc\x07")).toBe("Red Title");
	});
});

describe("parseSpeclet", () => {
	test("name from h1, status from frontmatter", () => {
		const f = parseSpeclet("/x/a.md", "a.md", `${HEADER}## Tasks\n- [ ] 1. Do it\n`, 5);
		expect(f.name).toBe("My Feature");
		expect(f.status).toBe("in-progress");
		expect(f.tasks).toHaveLength(1);
		expect(f.mtimeMs).toBe(5);
	});
	test("name falls back to filename stem", () => {
		const f = parseSpeclet("/x/b.md", "b.md", "## Tasks\n- [ ] 1. A\n", 0);
		expect(f.name).toBe("b");
	});
	test("malformed frontmatter does not block Tasks parsing", () => {
		const content = ["---", "status: [broken", "# Feat", "", "## Tasks", "- [x] 1. Done thing"].join("\n");
		const f = parseSpeclet("/x/c.md", "c.md", content, 0);
		expect(f.status).toBe("unknown");
		expect(f.tasks).toEqual([{ id: "1", title: "Done thing", done: true, details: [] }]);
	});
	test("YAML comment inside closed frontmatter never becomes the name", () => {
		const content = ["---", "# Internal metadata comment", "status: draft", "---", "", "# Real Feature", ""].join(
			"\n",
		);
		const f = parseSpeclet("/x/d.md", "d.md", content, 0);
		expect(f.name).toBe("Real Feature");
	});
	test("filename-derived stem names are sanitized for display", () => {
		const f = parseSpeclet("/x/e.md", "\x1b[31mevil.md", "## Tasks\n", 0);
		expect(f.name).toBe("evil");
		expect(f.filename).toBe("\x1b[31mevil.md"); // raw filename preserved for lookup
	});
});

describe("parseSections", () => {
	test("extracts Requirements and Design Notes bodies, headings excluded", () => {
		const content = [
			"---",
			"status: draft",
			"---",
			"# Feature",
			"",
			"## Requirements",
			"As a user, I want X.",
			"- AC1: WHEN ...",
			"",
			"## Design Notes",
			"- Keep it simple.",
			"",
			"## Tasks",
			"- [ ] 1. Do",
		].join("\n");
		const s = parseSections(content);
		expect(s.requirements).toEqual(["As a user, I want X.", "- AC1: WHEN ..."]);
		expect(s.design).toEqual(["- Keep it simple."]);
	});

	test("sections end at the next h1 or h2", () => {
		const content = ["## Requirements", "A", "# Elsewhere", "B", "## Design Notes", "C"].join("\n");
		const s = parseSections(content);
		expect(s.requirements).toEqual(["A"]);
		expect(s.design).toEqual(["C"]); // h1 does not swallow the later section
	});

	test("fenced examples and YAML comments do not leak into sections", () => {
		const content = ["---", "# note", "---", "## Requirements", "```", "## Design Notes (fake)", "```", "real line"].join("\n");
		const s = parseSections(content);
		expect(s.requirements).toEqual(["real line"]);
		expect(s.design).toEqual([]); // fake heading inside fence ignored
	});

	test("missing sections yield empty arrays", () => {
		expect(parseSections("# T\nsome prose")).toEqual({ requirements: [], design: [] });
	});

	test("unclosed frontmatter does not block section parsing", () => {
		const content = ["---", "status: [broken", "## Requirements", "R1"].join("\n");
		expect(parseSections(content).requirements).toEqual(["R1"]);
	});
});

describe("criteriaIds", () => {
	test("extracts ids from the Criteria detail row", () => {
		expect(criteriaIds(["- Add the thing", "- Criteria: AC1, AC5", "- Depends on: 2"])).toEqual(["AC1", "AC5"]);
	});
	test("empty when no criteria row", () => {
		expect(criteriaIds(["- just description"])).toEqual([]);
		expect(criteriaIds(undefined)).toEqual([]);
	});
});

describe("resolveCriteria", () => {
	const req = ["- AC1: WHEN triggered, THE SYSTEM SHALL act.", "- AC12: IF broken, THE SYSTEM SHALL heal."];
	test("resolves referenced ids to full criterion text", () => {
		expect(resolveCriteria(["AC1", "AC12"], req)).toEqual([
			{ id: "AC1", text: "WHEN triggered, THE SYSTEM SHALL act." },
			{ id: "AC12", text: "IF broken, THE SYSTEM SHALL heal." },
		]);
	});
	test("unresolvable ids fall back to null text", () => {
		expect(resolveCriteria(["AC9"], req)).toEqual([{ id: "AC9", text: null }]);
	});
});

describe("discoverSpeclets", () => {
	test("missing directory yields empty files without error", async () => {
		const r = await discoverSpeclets(join(dir, "nope"));
		expect(r.files).toEqual([]);
		expect(r.dirError).toBeUndefined();
	});

	test("includes regular md files, excludes context.md, subdirs and symlinks", async () => {
		await writeFile(join(dir, "a.md"), HEADER + "## Tasks\n- [ ] 1. A\n");
		await writeFile(join(dir, "context.md"), "# Context\n");
		await writeFile(join(dir, "notes.txt"), "nope");
		await mkdir(join(dir, "sub"));
		await writeFile(join(dir, "sub", "nested.md"), "# Nested\n");
		await writeFile(join(dir, "target.md"), "# Target\n");
		await symlink(join(dir, "target.md"), join(dir, "link.md"));

		const r = await discoverSpeclets(dir);
		const names = r.files.map((f) => f.filename).sort();
		expect(names).toEqual(["a.md", "target.md"]);
	});

	test("file with h2-only content parses with stem name and tasks", async () => {
		await writeFile(join(dir, "z.md"), "## Tasks\n- [x] 7. Zed\n");
		const r = await discoverSpeclets(dir);
		expect(r.files[0].name).toBe("z");
		expect(r.files[0].tasks).toEqual([{ id: "7", title: "Zed", done: true, details: [] }]);
	});

	test("unreadable file becomes an error entry without stopping others", async () => {
		await writeFile(join(dir, "bad.md"), HEADER);
		await writeFile(join(dir, "good.md"), "# Good\n");
		await chmod(join(dir, "bad.md"), 0o000);
		try {
			const r = await discoverSpeclets(dir);
			const bad = r.files.find((f) => f.filename === "bad.md");
			expect(bad?.error).toBeDefined();
			expect(bad?.tasks).toEqual([]);
			expect(r.files.some((f) => f.filename === "good.md")).toBe(true);
		} finally {
			await chmod(join(dir, "bad.md"), 0o644);
		}
	});

	test("file vanishing mid-scan is omitted, not an error", async () => {
		// Deterministic proxy: discover a directory containing a broken symlink,
		// which readdir lists but lstat/readFile cannot resolve as a regular file.
		await writeFile(join(dir, "real.md"), "# Real\n");
		await symlink(join(dir, "gone.md"), join(dir, "ghost.md"));
		const r = await discoverSpeclets(dir);
		expect(r.files.map((f) => f.filename)).toEqual(["real.md"]);
	});
});

describe("stem", () => {
	test("strips .md case-insensitively", () => {
		expect(stem("a.MD")).toBe("a");
		expect(stem("b.md")).toBe("b");
	});
});
