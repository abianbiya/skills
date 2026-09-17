import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, rename, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpecflowController } from "./controller.js";

let root: string;
let dir: string;

/** Fixture writer: specs/<feature>/<file> relative to the specflow dir. */
async function writeSpec(rel: string, content: string): Promise<string> {
	const path = join(dir, rel);
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(path, content);
	return path;
}

const TASKS_ACTIVE = ["---", "status: active", "---", "", "## Tasks", "", "- [ ] 1. Do the thing", "  - Criteria: AC1", "- [x] 2. Done thing", ""].join("\n");
const REQUIREMENTS = "# Feature\n\n## Requirements\n\n- AC1: it works\n";

function harness(intervalMs = 25) {
	const updates: number[] = [];
	const diagnostics: string[] = [];
	const controller = new SpecflowController(dir, {
		onUpdate: () => updates.push(updates.length + 1),
		onDiagnostic: (m) => diagnostics.push(m),
	}, intervalMs);
	return { controller, updates, diagnostics };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "specflow-ctl-"));
	dir = join(root, ".specflow");
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("SpecflowController.scan", () => {
	test("a missing .specflow directory is not an error and yields no specs", async () => {
		const { controller, diagnostics } = harness();
		await controller.scan();
		expect(controller.specs).toEqual([]);
		expect(controller.active()).toBeUndefined();
		expect(diagnostics).toEqual([]);
	});

	test("discovers flat and legacy specs and exposes the ranking winner", async () => {
		await writeSpec("specs/active-flat/tasks.md", TASKS_ACTIVE);
		// legacy layout: no frontmatter, status inferred from the containing directory
		await writeSpec("specs/archived/older/tasks.md", "# Old\n");
		const { controller } = harness();
		await controller.scan();
		expect(controller.specs.map((s) => s.name).sort()).toEqual(["active-flat", "older"]);
		expect(controller.specs.find((s) => s.name === "older")?.status).toBe("archived");
		// archived ranks below in-progress even though it is the newest on disk
		expect(controller.active()?.name).toBe("active-flat");
	});

	test("a requirements-only spec is eligible", async () => {
		await writeSpec("specs/req-only/requirements.md", REQUIREMENTS);
		const { controller } = harness();
		await controller.scan();
		expect(controller.specs.map((s) => s.name)).toEqual(["req-only"]);
	});

	test("an unreadable tasks.md is reported once as a diagnostic, never thrown", async () => {
		const path = await writeSpec("specs/broken/tasks.md", TASKS_ACTIVE);
		await chmod(path, 0o000);
		const { controller, diagnostics } = harness();
		await controller.scan();
		await controller.scan();
		expect(controller.specs.map((s) => s.name)).toEqual(["broken"]);
		expect(diagnostics.length).toBe(1); // reported once, not once per scan
	});

	test("an unreadable non-task document still lists the spec without a diagnostic", async () => {
		// Discovery only needs tasks.md's content; requirements.md is read by the
		// viewer, which reports the failure on open (AC4) instead of on every poll.
		const path = await writeSpec("specs/quiet/requirements.md", REQUIREMENTS);
		await writeSpec("specs/quiet/tasks.md", TASKS_ACTIVE);
		await chmod(path, 0o000);
		const { controller, diagnostics } = harness();
		await controller.scan();
		expect(controller.specs.map((s) => s.name)).toEqual(["quiet"]);
		expect(diagnostics).toEqual([]);
	});
});

describe("SpecflowController pinning", () => {
	test("a pin survives refreshes but clears when the spec disappears", async () => {
		await writeSpec("specs/one/tasks.md", TASKS_ACTIVE);
		await writeSpec("specs/two/tasks.md", TASKS_ACTIVE);
		const { controller } = harness();
		await controller.scan();
		const two = controller.specs.find((s) => s.name === "two");
		controller.pin(two!.dir);
		await controller.scan();
		expect(controller.active()?.name).toBe("two");

		await rm(join(dir, "specs/two"), { recursive: true, force: true });
		await controller.scan();
		expect(controller.pinned).toBeUndefined();
		expect(controller.active()?.name).toBe("one");
	});

	test("hide and show are session-scoped state changes", async () => {
		await writeSpec("specs/one/tasks.md", TASKS_ACTIVE);
		const { controller } = harness();
		await controller.scan();
		expect(controller.hidden).toBe(false);
		controller.hide();
		expect(controller.hidden).toBe(true);
		controller.show();
		expect(controller.hidden).toBe(false);
	});
});

describe("SpecflowController.onUpdate", () => {
	test("fires only when the rendered content changes", async () => {
		await writeSpec("specs/one/tasks.md", TASKS_ACTIVE);
		const { controller, updates } = harness();
		await controller.scan();
		const afterFirst = updates.length;
		await controller.scan(); // identical content
		expect(updates.length).toBe(afterFirst);
		controller.hide(); // visibility is part of the signature
		expect(updates.length).toBe(afterFirst + 1);
	});

	test("fires when only the gate changes", async () => {
		await writeSpec("specs/one/tasks.md", TASKS_ACTIVE);
		const { controller, updates } = harness();
		await controller.scan();
		const before = updates.length;
		await writeSpec("specs/one/tasks.md", TASKS_ACTIVE.replace("status: active", "status: active\ngate: review"));
		await controller.scan();
		expect(controller.active()?.gate).toBe("review");
		expect(updates.length).toBe(before + 1);
	});
});

describe("SpecflowController polling (AC6)", () => {
	test("reflects a created spec, an atomic replace, and a deletion within a second", async () => {
		const { controller } = harness(25);
		await controller.scan();
		controller.start();
		try {
			await writeSpec("specs/new/tasks.md", TASKS_ACTIVE);
			await wait(400);
			expect(controller.specs.map((s) => s.name)).toEqual(["new"]);

			// atomic replace (write temp + rename over the target)
			const target = join(dir, "specs/new/tasks.md");
			const tmp = `${target}.tmp`;
			await writeFile(tmp, TASKS_ACTIVE.replace("- [ ] 1. Do the thing", "- [x] 1. Do the thing"));
			await rename(tmp, target);
			await wait(400);
			expect(controller.active()?.done).toBe(2);

			await rm(join(dir, "specs/new/tasks.md"), { force: true });
			await controller.scan();
			expect(controller.specs).toEqual([]);
		} finally {
			controller.stop();
		}
	});

	test("stop() halts polling and clears session state", async () => {
		await writeSpec("specs/one/tasks.md", TASKS_ACTIVE);
		const { controller } = harness(25);
		await controller.scan();
		controller.start();
		await wait(60);
		controller.stop();
		expect(controller.specs).toEqual([]);
		expect(controller.pinned).toBeUndefined();

		await writeSpec("specs/late/tasks.md", TASKS_ACTIVE);
		await wait(200);
		expect(controller.specs).toEqual([]); // no ticks after stop
	});

	test("a scan started before stop() cannot apply its result", async () => {
		await writeSpec("specs/one/tasks.md", TASKS_ACTIVE);
		const { controller } = harness();
		const pending = controller.scan();
		controller.stop();
		await pending;
		expect(controller.specs).toEqual([]);
	});
});

describe("retired specs stay hidden until the picker asks for them", () => {
	const COMPLETED = ["---", "status: completed", "---", "", "## Tasks", "", "- [x] 1. Shipped thing", ""].join("\n");
	const ARCHIVED = ["---", "status: archived", "---", "", "## Tasks", "", "- [x] 1. Abandoned thing", ""].join("\n");

	test("completed and archived specs are not selected", async () => {
		await writeSpec("specs/shipped/tasks.md", COMPLETED);
		await writeSpec("specs/old/tasks.md", ARCHIVED);
		const { controller } = harness();
		await controller.scan();
		expect(controller.specs).toHaveLength(2); // still discovered, just not shown
		expect(controller.active()).toBeUndefined();
	});

	test("an active spec still wins while a retired one is hidden", async () => {
		await writeSpec("specs/running/tasks.md", TASKS_ACTIVE);
		await writeSpec("specs/shipped/tasks.md", COMPLETED);
		const { controller } = harness();
		await controller.scan();
		controller.pin(controller.specs.find((s) => s.name === "shipped")!.dir);
		expect(controller.active()?.name).toBe("running"); // a retired pin resolves to nothing
	});

	test("setShowFinished reveals a retired spec and drops its pin when switched off", async () => {
		await writeSpec("specs/running/tasks.md", TASKS_ACTIVE);
		await writeSpec("specs/shipped/tasks.md", COMPLETED);
		const { controller } = harness();
		await controller.scan();
		controller.setShowFinished(true);
		controller.pin(controller.specs.find((s) => s.name === "shipped")!.dir);
		expect(controller.active()?.name).toBe("shipped");

		controller.setShowFinished(false);
		expect(controller.pinned).toBeUndefined();
		expect(controller.active()?.name).toBe("running");
	});

	test("stop() clears the finished toggle", async () => {
		await writeSpec("specs/shipped/tasks.md", COMPLETED);
		const { controller } = harness();
		await controller.scan();
		controller.setShowFinished(true);
		controller.stop();
		expect(controller.showFinished).toBe(false);
	});
});
