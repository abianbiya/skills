import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	discoverSpecflows,
	inferPhase,
	parseGate,
	parseStatus,
	parseTasks,
	splitFrontmatter,
	type Gate,
	type PhaseInput,
	type SpecflowStatus,
} from "./parse.js";

let root: string;
let specflowDir: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "specflow-pi-"));
	specflowDir = join(root, ".specflow");
	await mkdir(join(specflowDir, "specs"), { recursive: true });
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

async function writeSpec(
	dir: string,
	files: { requirements?: string; design?: string; tasks?: string },
): Promise<string> {
	await mkdir(dir, { recursive: true });
	if (files.requirements !== undefined) await writeFile(join(dir, "requirements.md"), files.requirements);
	if (files.design !== undefined) await writeFile(join(dir, "design.md"), files.design);
	if (files.tasks !== undefined) await writeFile(join(dir, "tasks.md"), files.tasks);
	return dir;
}

function flatSpec(name: string): string {
	return join(specflowDir, "specs", name);
}
function legacySpec(kind: "active" | "completed" | "archived", name: string): string {
	return join(specflowDir, "specs", kind, name);
}

const REQUIREMENTS = "---\nstatus: draft\n---\n\n# Requirements\n\n- AC1: WHEN x, THE SYSTEM SHALL y.\n";
const TASKS_BODY = [
	"# Implementation Plan",
	"",
	"## Overview",
	"",
	"- [ ] Unnumbered prerequisite checkbox is not a task",
	"",
	"## 1. Work group",
	"",
	"- [x] 1.1 First executable task",
	"  - Do the thing",
	"  - *Requirements: 1.1, 1.2*",
	"",
	"- [ ] 1.2 Second executable task",
	"  - Depends on: 1.1",
	"",
	"```",
	"- [x] 9.9 This checkbox lives inside a fenced block",
	"```",
	"",
	"  - [x] 3.3 Indented sub-row is a detail, not a task",
	"",
	"## 2. Another group",
	"",
	"- [x] 2.1 Top-level in a later group",
].join("\n");
const TASKS_WITH_FRONTMATTER = `---\nstatus: active\ngate: review\n---\n\n${TASKS_BODY}`;

describe("splitFrontmatter", () => {
	test("splits closed frontmatter from body", () => {
		const r = splitFrontmatter("---\nstatus: active\n---\n\n# Body\n");
		expect(r.frontmatter).toBe("status: active");
		expect(r.body).toBe("\n# Body\n");
	});
	test("keeps whole content as body when frontmatter is absent or unclosed", () => {
		expect(splitFrontmatter("# No fm\n").frontmatter).toBe("");
		expect(splitFrontmatter("# No fm\n").body).toBe("# No fm\n");
		const unclosed = splitFrontmatter("---\nstatus: active\n\n# Body\n");
		expect(unclosed.frontmatter).toBe("");
		expect(unclosed.body).toBe("---\nstatus: active\n\n# Body\n");
	});
	test("handles CRLF line endings", () => {
		const r = splitFrontmatter("---\r\nstatus: active\r\n---\r\nbody");
		expect(r.frontmatter).toBe("status: active");
		expect(r.body).toBe("body");
	});
});

describe("parseStatus", () => {
	test("valid statuses pass through", () => {
		expect(parseStatus("status: active")).toBe("active");
		expect(parseStatus("status: completed")).toBe("completed");
		expect(parseStatus("status: archived")).toBe("archived");
	});
	test("quoted values are unwrapped", () => {
		expect(parseStatus('status: "active"')).toBe("active");
		expect(parseStatus("status: 'archived'")).toBe("archived");
	});
	test("invalid values and missing keys are distinguished", () => {
		expect(parseStatus("status: draft")).toBe("unknown");
		expect(parseStatus("gate: review")).toBeUndefined();
		expect(parseStatus("")).toBeUndefined();
	});
});

describe("parseGate", () => {
	test("review is the only defined value", () => {
		expect(parseGate("gate: review")).toBe("review");
		expect(parseGate('gate: "review"')).toBe("review");
	});
	test("absent and unknown values yield null", () => {
		expect(parseGate("")).toBeNull();
		expect(parseGate("status: active")).toBeNull();
		expect(parseGate("gate: approved")).toBeNull();
		expect(parseGate("gate: REVIEW")).toBeNull(); // case-sensitive scalar
	});
});

describe("parseTasks", () => {
	test("parses dotted ids, done state, and details across work groups", () => {
		const tasks = parseTasks(TASKS_BODY);
		expect(tasks.map((t) => t.id)).toEqual(["1.1", "1.2", "2.1"]);
		expect(tasks[0]!.done).toBe(true);
		expect(tasks[1]!.done).toBe(false);
		expect(tasks[0]!.title).toBe("First executable task");
		expect(tasks[0]!.details).toEqual(["- Do the thing", "- *Requirements: 1.1, 1.2*"]);
		expect(tasks[1]!.details).toEqual(["- Depends on: 1.1"]);
	});
	test("ignores unnumbered checkboxes and fenced checkbox-looking lines", () => {
		const tasks = parseTasks(TASKS_BODY);
		expect(tasks.some((t) => t.title.includes("prerequisite"))).toBe(false);
		expect(tasks.some((t) => t.id === "9.9")).toBe(false);
	});
	test("indented rows are details, never tasks", () => {
		const tasks = parseTasks(TASKS_BODY);
		expect(tasks.some((t) => t.id === "3.3")).toBe(false);
	});
	test("accepts speclet-style separators and returns [] without tasks", () => {
		expect(parseTasks("- [x] 1. Plain integer task\n").map((t) => t.id)).toEqual(["1"]);
		expect(parseTasks("- [x] 2) Paren task\n").map((t) => t.id)).toEqual(["2"]);
		expect(parseTasks("# no tasks here\n")).toEqual([]);
		expect(parseTasks("")).toEqual([]);
	});
});

describe("inferPhase", () => {
	const base: PhaseInput = {
		status: "active",
		hasRequirements: true,
		hasDesign: true,
		hasTasks: true,
		total: 3,
		gate: null,
	};
	const phase = (over: Partial<PhaseInput>) => inferPhase({ ...base, ...over });

	test("archived and completed win outright", () => {
		expect(phase({ status: "archived" })).toBe("archived");
		expect(phase({ status: "completed" })).toBe("done");
	});
	test("tasks: gate set => 3, cleared => 4", () => {
		expect(phase({ gate: "review" as Gate })).toBe(3);
		expect(phase({ gate: null })).toBe(4);
	});
	test("metadata-only tasks.md (total 0) never reads as 3/4", () => {
		expect(phase({ total: 0, gate: "review" as Gate })).toBe(2);
		expect(phase({ total: 0 })).toBe(2);
	});
	test("design => 2, requirements-only => 1, regardless of requirements presence", () => {
		expect(phase({ hasTasks: false, hasDesign: true })).toBe(2);
		expect(phase({ hasTasks: false, hasDesign: false })).toBe(1);
		expect(phase({ hasTasks: false, hasDesign: false, hasRequirements: false })).toBe(1);
	});
});

describe("discoverSpecflows", () => {
	test("missing .specflow directory is not an error", async () => {
		const r = await discoverSpecflows(join(root, "absent"));
		expect(r.specs).toEqual([]);
		expect(r.dirError).toBeUndefined();
	});

	test("flat layout: full spec with frontmatter status and gate", async () => {
		await writeSpec(flatSpec("alpha"), {
			requirements: REQUIREMENTS,
			design: "# Design\n",
			tasks: TASKS_WITH_FRONTMATTER,
		});
		const r = await discoverSpecflows(specflowDir);
		expect(r.dirError).toBeUndefined();
		expect(r.specs).toHaveLength(1);
		const s = r.specs[0]!;
		expect(s.name).toBe("alpha");
		expect(s.legacy).toBe(false);
		expect(s.status).toBe("active");
		expect(s.statusSource).toBe("frontmatter");
		expect(s.gate).toBe("review");
		expect(s.total).toBe(3);
		expect(s.done).toBe(2);
		expect(s.phase).toBe(3); // gate set while tasks exist
		expect(s.docs.requirements).toBe(join(flatSpec("alpha"), "requirements.md"));
		expect(s.mtimeMs).toBeGreaterThan(0);
	});

	test("gate cleared during execution infers Phase 4", async () => {
		await writeSpec(flatSpec("executing"), {
			requirements: REQUIREMENTS,
			design: "# Design\n",
			tasks: "---\nstatus: active\n---\n\n- [x] 1.1 Done task\n- [ ] 1.2 Open task\n",
		});
		const r = await discoverSpecflows(specflowDir);
		expect(r.specs[0]!.phase).toBe(4);
		expect(r.specs[0]!.gate).toBeNull();
	});

	test("legacy layout without frontmatter infers status from the parent directory", async () => {
		await writeSpec(legacySpec("active", "legacy-active"), {
			requirements: "# Requirements\n",
			design: "# Design\n",
			tasks: "# Plan\n\n- [ ] 1.1 Task one\n",
		});
		await writeSpec(legacySpec("completed", "legacy-done"), { tasks: "# Plan\n" });
		await writeSpec(legacySpec("archived", "legacy-arch"), { tasks: "# Plan\n" });
		const r = await discoverSpecflows(specflowDir);
		const byName = new Map(r.specs.map((s) => [s.name, s]));
		const a = byName.get("legacy-active")!;
		expect(a.legacy).toBe(true);
		expect(a.status).toBe("active");
		expect(a.statusSource).toBe("directory");
		expect(a.phase).toBe(4);
		expect(byName.get("legacy-done")!.status).toBe("completed");
		expect(byName.get("legacy-done")!.phase).toBe("done");
		expect(byName.get("legacy-arch")!.status).toBe("archived");
		expect(byName.get("legacy-arch")!.phase).toBe("archived");
	});

	test("legacy metadata takes precedence over the containing directory", async () => {
		await writeSpec(legacySpec("active", "mixed"), {
			tasks: "---\nstatus: archived\n---\n\n# Plan\n",
		});
		const r = await discoverSpecflows(specflowDir);
		expect(r.specs[0]!.status).toBe("archived");
		expect(r.specs[0]!.statusSource).toBe("frontmatter");
	});

	test("requirements-only spec is eligible and reads as Phase 1", async () => {
		await writeSpec(flatSpec("early"), { requirements: "# Requirements\n" });
		const r = await discoverSpecflows(specflowDir);
		const s = r.specs[0]!;
		expect(s.phase).toBe(1);
		expect(s.status).toBe("unknown");
		expect(s.statusSource).toBe("none");
		expect(s.total).toBe(0);
	});

	test("design-only spec reads as Phase 2", async () => {
		await writeSpec(flatSpec("design-only"), { design: "# Design\n" });
		const r = await discoverSpecflows(specflowDir);
		expect(r.specs[0]!.phase).toBe(2);
	});

	test("flat spec with missing status is unknown and never guessed", async () => {
		await writeSpec(flatSpec("no-status"), {
			requirements: "# R\n",
			design: "# D\n",
			tasks: "# Plan\n\n- [ ] 1.1 Task\n",
		});
		const r = await discoverSpecflows(specflowDir);
		expect(r.specs[0]!.status).toBe("unknown");
		expect(r.specs[0]!.statusSource).toBe("none");
	});

	test("flat spec with invalid status value is unknown (frontmatter source)", async () => {
		await writeSpec(flatSpec("bad-status"), {
			tasks: "---\nstatus: draft\n---\n\n- [ ] 1.1 Task\n",
		});
		const r = await discoverSpecflows(specflowDir);
		expect(r.specs[0]!.status).toBe("unknown");
		expect(r.specs[0]!.statusSource).toBe("frontmatter");
	});

	test("metadata-only tasks.md: listed, zero tasks, not Phase 3/4", async () => {
		await writeSpec(flatSpec("meta-only"), {
			requirements: "# R\n",
			design: "# D\n",
			tasks: "---\nstatus: active\ngate: review\n---\n",
		});
		const r = await discoverSpecflows(specflowDir);
		const s = r.specs[0]!;
		expect(s.tasks).toEqual([]);
		expect(s.total).toBe(0);
		expect(s.phase).toBe(2);
	});

	test("unknown gate value yields null gate", async () => {
		await writeSpec(flatSpec("odd-gate"), {
			requirements: "# R\n",
			design: "# D\n",
			tasks: "---\nstatus: active\ngate: waiting\n---\n\n- [ ] 1.1 Task\n",
		});
		const r = await discoverSpecflows(specflowDir);
		expect(r.specs[0]!.gate).toBeNull();
		expect(r.specs[0]!.phase).toBe(4);
	});

	test("legacy status regression: specs/archived/older infers from parent, not own name", async () => {
		// Regression for the visit() parentName bug: the spec's own basename ("older")
		// is not a legacy kind; only the CONTAINING directory ("archived") is.
		await writeSpec(legacySpec("archived", "older"), { tasks: "# Plan\n" });
		const r = await discoverSpecflows(specflowDir);
		expect(r.specs).toHaveLength(1);
		expect(r.specs[0]!.name).toBe("older");
		expect(r.specs[0]!.legacy).toBe(true);
		expect(r.specs[0]!.status).toBe("archived");
		expect(r.specs[0]!.statusSource).toBe("directory");
	});

	test("flat spec's containing directory (specs) is never a legacy kind", async () => {
		await writeSpec(flatSpec("plain"), { tasks: "# Plan\n" });
		const r = await discoverSpecflows(specflowDir);
		expect(r.specs[0]!.legacy).toBe(false);
		expect(r.specs[0]!.status).toBe("unknown");
		expect(r.specs[0]!.statusSource).toBe("none");
	});

	test("a directory named requirements.md does not create a phantom spec", async () => {
		await mkdir(join(specflowDir, "specs", "phantom", "requirements.md"), { recursive: true });
		const r = await discoverSpecflows(specflowDir);
		expect(r.specs).toEqual([]);
		expect(r.dirError).toBeUndefined();
	});

	test("non-spec directories are walked through; spec dirs are not descended into", async () => {
		await writeSpec(flatSpec("outer"), { requirements: "# R\n" });
		// A decoy nested INSIDE the spec dir must not create a second spec.
		await writeSpec(join(flatSpec("outer"), "notes", "deep"), { design: "# D\n" });
		// An empty directory chain yields nothing.
		await mkdir(join(specflowDir, "specs", "empty-feature"), { recursive: true });
		const r = await discoverSpecflows(specflowDir);
		expect(r.specs).toHaveLength(1);
		expect(r.specs[0]!.name).toBe("outer");
		expect(r.dirError).toBeUndefined();
	});

	test("results are sorted by name", async () => {
		await writeSpec(flatSpec("zeta"), { requirements: "# R\n" });
		await writeSpec(flatSpec("alpha"), { requirements: "# R\n" });
		await writeSpec(flatSpec("mid"), { requirements: "# R\n" });
		const r = await discoverSpecflows(specflowDir);
		expect(r.specs.map((s) => s.name)).toEqual(["alpha", "mid", "zeta"]);
	});

	test("unreadable .specflow directory reports dirError without crashing", async () => {
		await chmod(specflowDir, 0o000);
		try {
			const r = await discoverSpecflows(specflowDir);
			expect(r.specs).toEqual([]);
			expect(r.dirError).toBeDefined();
		} finally {
			await chmod(specflowDir, 0o755);
		}
	});

	test("unreadable tasks.md lists the spec with an error and unknown status", async () => {
		const dir = flatSpec("locked");
		await writeSpec(dir, { requirements: "# R\n", tasks: "---\nstatus: active\n---\n\n- [ ] 1.1 T\n" });
		await chmod(join(dir, "tasks.md"), 0o000);
		try {
			const r = await discoverSpecflows(specflowDir);
			expect(r.specs).toHaveLength(1);
			expect(r.specs[0]!.error).toBeDefined();
			expect(r.specs[0]!.status).toBe("unknown");
			expect(r.specs[0]!.total).toBe(0);
		} finally {
			await chmod(join(dir, "tasks.md"), 0o644);
		}
	});

	test("symlinked directories and documents are skipped", async () => {
		const outside = await mkdtemp(join(tmpdir(), "specflow-out-"));
		try {
			await writeSpec(join(outside, "linked-spec"), { requirements: "# R\n" });
			await mkdir(join(specflowDir, "specs"), { recursive: true });
			await symlink(join(outside, "linked-spec"), flatSpec("linked"));
			const r = await discoverSpecflows(specflowDir);
			expect(r.specs).toEqual([]);
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});
});

describe("spec.criteria (defined AC ids)", () => {
	const REQUIREMENTS_FULL = [
		"# Requirements",
		"",
		"- AC1: WHEN triggered, THE SYSTEM SHALL respond.",
		"* **AC2** WHEN disconnected, THE SYSTEM SHALL retry.",
		"**AC3** WHEN the session ends, THE SYSTEM SHALL clean up.",
		"AC4: Fallback behavior is defined on this line.",
		"",
		"Prose mentions never define: see AC1 above, and (AC2) mid-sentence.",
		"- see AC3 in the list prose below the marker",
		"",
		"```",
		"- AC5: example inside a fenced block is not a definition",
		"```",
		"",
		"- AC1: restated later — deduplicated, first position kept",
		].join("\n");

	test("extracts the three definition shapes, in order, deduplicated", async () => {
		await writeSpec(flatSpec("crit"), { requirements: REQUIREMENTS_FULL, tasks: "# Plan\n" });
		const r = await discoverSpecflows(specflowDir);
		expect(r.specs[0]!.criteria).toEqual(["AC1", "AC2", "AC3", "AC4"]);
	});

	test("missing, unreadable, or directory requirements.md yield [] without crash", async () => {
		await writeSpec(flatSpec("no-crit"), { tasks: "# Plan\n" });
		{
			const r = await discoverSpecflows(specflowDir);
			expect(r.specs[0]!.criteria).toEqual([]);
		}
		const dir2 = flatSpec("locked-crit");
		await writeSpec(dir2, { requirements: "- AC1: hidden\n", tasks: "# Plan\n" });
		await chmod(join(dir2, "requirements.md"), 0o000);
		try {
			const r2 = await discoverSpecflows(specflowDir);
			const s = r2.specs.find((x) => x.name === "locked-crit")!;
			expect(s.criteria).toEqual([]);
			expect(s.error).toBeUndefined(); // unreadable requirements is silent, per contract
		} finally {
			await chmod(join(dir2, "requirements.md"), 0o644);
		}
	});

	test("indented definitions match; prose still never does", async () => {
		// Regression: the anchor used to reject leading whitespace, silently
		// under-reporting criteria and manufacturing false orphan warnings.
		const indented = [
			"# Requirements",
			"",
			"  - AC5: indented bullet",
			"  AC6: indented bare",
			"\t- AC7: deeply indented bullet",
			"  **AC8** indented bold",
			"",
			"  prose that merely cites AC5 stays excluded",
			"  - prose after a bullet citing AC6 is excluded too",
			"\t(AC7) mid-sentence excluded",
		].join("\n");
		await writeSpec(flatSpec("indented"), { requirements: indented, tasks: "# Plan\n" });
		const r = await discoverSpecflows(specflowDir);
		expect(r.specs[0]!.criteria).toEqual(["AC5", "AC6", "AC7", "AC8"]);
	});

	test("a requirements.md directory is not a document (no phantom criteria)", async () => {
		await mkdir(join(specflowDir, "specs", "dir-doc", "requirements.md"), { recursive: true });
		await writeSpec(join(specflowDir, "specs", "dir-doc"), { tasks: "# Plan\n" });
		const r = await discoverSpecflows(specflowDir);
		expect(r.specs[0]!.criteria).toEqual([]);
		expect(r.specs[0]!.docs.requirements).toBeUndefined();
	});
});

describe("status type sanity", () => {
	test("SpecflowStatus set is closed", () => {
		const all: SpecflowStatus[] = ["active", "completed", "archived", "unknown"];
		expect(all).toHaveLength(4);
	});
});

describe("name sanitization (F1)", () => {
	test("a directory name carrying control sequences is stripped at the source", async () => {
		await writeSpec(flatSpec("evil\u001b[31mname"), { requirements: "# R\n" });
		const r = await discoverSpecflows(specflowDir);
		expect(r.specs.map((s) => s.name)).toEqual(["evilname"]);
		expect(r.specs[0].name).not.toContain("\u001b");
	});
});
