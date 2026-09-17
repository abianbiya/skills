import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { chmod, mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SpecletController } from "./controller.js";

let dir: string;
let specDir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "speclet-tui-ctl-"));
	specDir = join(dir, ".speclet");
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

function writeSpec(filename: string, content: string) {
	return writeFile(join(specDir, filename), content);
}

async function fingerprint(): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	for (const name of (await readdir(specDir)).sort()) {
		const content = await readFile(join(specDir, name));
		out.set(name, createHash("sha256").update(content).digest("hex"));
	}
	return out;
}

function makeController(intervalMs = 500) {
	const updates: string[] = [];
	const diagnostics: string[] = [];
	const controller = new SpecletController(specDir, {
		onUpdate: () => {
			const a = controller.active();
			updates.push(a ? `${a.filename}:${a.status}` : "(hidden)");
		},
		onDiagnostic: (m) => diagnostics.push(m),
	}, intervalMs);
	return { controller, updates, diagnostics };
}

describe("SpecletController", () => {
	test("missing directory: no files, no diagnostic, panel hidden", async () => {
		const { controller, updates, diagnostics } = makeController();
		await controller.scan();
		expect(controller.files).toEqual([]);
		expect(controller.active()).toBeUndefined();
		expect(diagnostics).toEqual([]);
		expect(updates).toEqual(["(hidden)"]); // initial appearance event
	});

	test("new file triggers update once; identical rescans do not", async () => {
		await mkdir(specDir, { recursive: true });
		const { controller, updates } = makeController();
		await controller.scan();
		const afterEmpty = updates.length;

		await writeSpec("a.md", "# A\n");
		await controller.scan();
		expect(updates.length).toBe(afterEmpty + 1);
		expect(updates.at(-1)).toBe("a.md:unknown");

		await controller.scan(); // nothing changed
		expect(updates.length).toBe(afterEmpty + 1);
	});

	test("content edit (same byte size) is detected via re-read", async () => {
		await mkdir(specDir, { recursive: true });
		const { controller, updates } = makeController();
		await writeSpec("a.md", "## Tasks\n- [ ] 1. x\n");
		await controller.scan();

		// same-size edit: unchecked x -> checked y keeps byte count identical
		await writeSpec("a.md", "## Tasks\n- [x] 1. y\n");
		await controller.scan();
		const active = controller.active()!;
		expect(active.tasks[0]).toEqual({ id: "1", title: "y", done: true, details: [] });
		expect(updates.at(-1)).toBe("a.md:unknown");
	});

	test("status change re-ranks and triggers update", async () => {
		await mkdir(specDir, { recursive: true });
		const { controller, updates } = makeController();
		await writeSpec("a.md", "---\nstatus: draft\n---\n# A\n");
		await controller.scan();
		await writeSpec("a.md", "---\nstatus: in-progress\n---\n# A\n");
		await controller.scan();
		expect(updates.at(-1)).toBe("a.md:in-progress");
	});

	test("deletion and recreation of directory and files", async () => {
		await mkdir(specDir, { recursive: true });
		const { controller, updates } = makeController();
		await writeSpec("a.md", "# A\n");
		await controller.scan();
		expect(controller.files).toHaveLength(1);

		await rm(specDir, { recursive: true });
		await controller.scan();
		expect(controller.active()).toBeUndefined();

		await mkdir(specDir, { recursive: true });
		await writeSpec("b.md", "# B\n");
		await controller.scan();
		expect(controller.active()?.filename).toBe("b.md");
		expect(updates.at(-1)).toBe("b.md:unknown");
	});

	test("atomic replacement (write temp + rename) is picked up", async () => {
		await mkdir(specDir, { recursive: true });
		const { controller } = makeController();
		await writeSpec("a.md", "---\nstatus: draft\n---\n# A\n");
		await controller.scan();

		const tmp = join(dir, "a.md.tmp");
		await writeFile(tmp, "---\nstatus: approved\n---\n# A\n");
		const { rename } = await import("node:fs/promises");
		await rename(tmp, join(specDir, "a.md"));
		await controller.scan();
		expect(controller.active()?.status).toBe("approved");
	});

	test("pinned selection survives rescans and is dropped when file disappears", async () => {
		await mkdir(specDir, { recursive: true });
		const { controller } = makeController();
		await writeSpec("a.md", "# A\n");
		await writeSpec("b.md", "---\nstatus: in-progress\n---\n# B\n");
		await controller.scan();
		expect(controller.active()?.filename).toBe("b.md"); // ranking

		controller.pin("a.md");
		await controller.scan();
		expect(controller.active()?.filename).toBe("a.md"); // pin holds against ranking

		await rm(join(specDir, "a.md"));
		await controller.scan();
		expect(controller.active()?.filename).toBe("b.md"); // fell back
	});

	test("read failure produces one deduplicated diagnostic; refresh continues", async () => {
		await mkdir(specDir, { recursive: true });
		const { controller, diagnostics } = makeController();
		await writeSpec("bad.md", "# Bad\n");
		const { chmod } = await import("node:fs/promises");
		await chmod(join(specDir, "bad.md"), 0o000);
		try {
			await controller.scan();
			await controller.scan(); // second failure is deduplicated
			expect(diagnostics).toHaveLength(1);
			expect(diagnostics[0]).toContain("bad.md");

			await writeSpec("good.md", "# Good\n");
			await controller.scan(); // refresh continues after failures
			expect(controller.files.some((f) => f.filename === "good.md")).toBe(true);
		} finally {
			await chmod(join(specDir, "bad.md"), 0o644);
		}
	});

	test("poll loop refreshes from disk without overlapping", async () => {
		await mkdir(specDir, { recursive: true });
		const { controller, updates } = makeController(20);
		// Scan once BEFORE the file exists: otherwise the first tick can already see it
		// and the "hidden -> appearance" pair collapses into a single update (this used
		// to flake as `Expected: > 1, Received: 1` depending on which async op won).
		await controller.scan();
		const before = updates.length;
		controller.start();
		await writeSpec("a.md", "# A\n");
		// Wait for the appearance rather than sleeping a fixed window: a loaded machine
		// can starve a 20 ms timer past any fixed budget.
		const deadline = Date.now() + 1500;
		while (controller.active()?.filename !== "a.md" && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 10));
		}
		const seen = controller.active()?.filename;
		const updateCount = updates.length;
		controller.stop(); // stop clears files; assert on pre-stop observations
		expect(seen).toBe("a.md");
		expect(updateCount).toBeGreaterThan(before);
	}, 3000);

	test("stop invalidates in-flight scan: no update after shutdown", async () => {
		await mkdir(specDir, { recursive: true });
		const { controller, updates } = makeController();
		await writeSpec("a.md", "# A\n");
		const pending = controller.scan(); // in-flight
		controller.stop();
		await pending;
		const count = updates.length;
		await new Promise((r) => setTimeout(r, 30));
		expect(updates.length).toBe(count); // no stale repaint
		expect(controller.files).toEqual([]);
	});

	test("hide/show toggles visibility and fires updates even without content changes", async () => {
		await mkdir(specDir, { recursive: true });
		const { controller, updates } = makeController();
		expect(controller.hidden).toBe(false);
		await writeSpec("a.md", "# A\n");
		await controller.scan();
		const settled = updates.length;

		controller.hide();
		expect(controller.hidden).toBe(true);
		expect(updates.length).toBe(settled + 1); // repaint fired despite unchanged content

		await controller.scan(); // polling continues while hidden, no extra updates
		expect(updates.length).toBe(settled + 1);

		controller.show();
		expect(controller.hidden).toBe(false);
		expect(updates.length).toBe(settled + 2);
	});

	test("stop() resets visibility for the next session", async () => {
		const { controller } = makeController();
		controller.hide();
		controller.stop();
		expect(controller.hidden).toBe(false);
	});

	test("controller never writes to the speclet directory (AC7)", async () => {
		await mkdir(specDir, { recursive: true });
		await writeSpec("a.md", "# A\n---\nstatus: draft\n---\n## Tasks\n- [ ] 1. x\n");
		const before = await fingerprint();
		const { controller } = makeController(20);
		controller.start();
		controller.pin("a.md");
		await new Promise((r) => setTimeout(r, 80));
		controller.stop();
		const after = await fingerprint();
		expect(after).toEqual(before); // same files, same bytes
	});

	test("external edit is reflected within 1 second of the write (AC2)", async () => {
		await mkdir(specDir, { recursive: true });
		const { controller, updates } = makeController(); // production 500 ms interval
		controller.start();
		await writeSpec("a.md", "# A\n");
		// settle: wait until the file's initial appearance has been observed
		const settleAt = Date.now();
		while (!updates.some((u) => u.startsWith("a.md")) && Date.now() - settleAt < 2000) {
			await new Promise((r) => setTimeout(r, 25));
		}
		expect(updates.some((u) => u.startsWith("a.md"))).toBe(true);

		// timed external edit: the panel state must change in under 1000 ms
		const baseline = updates.length;
		const t0 = Date.now();
		await writeSpec("a.md", "# A changed\n");
		while (updates.length === baseline && Date.now() - t0 < 2000) {
			await new Promise((r) => setTimeout(r, 25));
		}
		const elapsed = Date.now() - t0;
		controller.stop();
		console.log(`AC2 measured latency: ${elapsed}ms`);
		expect(updates.length).toBeGreaterThan(baseline);
		expect(elapsed).toBeLessThan(1000); // AC2: within 1 second
	}, 5000);
});

describe("panel auto-hide when every speclet is finished", () => {
	const DONE = "---\nstatus: done\n---\n\n# Done spec\n\n## Tasks\n\n- [x] 1. Done thing\n";
	const ACTIVE = "---\nstatus: in-progress\n---\n\n# Active spec\n\n## Tasks\n\n- [ ] 1. Open thing\n";

	test("hidden while every speclet is done, visible as soon as one is not", async () => {
		await mkdir(specDir, { recursive: true });
		await writeSpec("a.md", DONE);
		const { controller } = makeController();
		await controller.scan();
		expect(controller.panelVisible()).toBe(false);

		await writeSpec("b.md", ACTIVE);
		await controller.scan();
		expect(controller.panelVisible()).toBe(true);

		await writeSpec("b.md", DONE); // back to all done
		await controller.scan();
		expect(controller.panelVisible()).toBe(false);
	});

	test("no speclet at all keeps it hidden", async () => {
		const { controller } = makeController();
		await controller.scan();
		expect(controller.panelVisible()).toBe(false);
	});

	test("an explicit reveal cannot resurrect a retired speclet; the finished toggle can", async () => {
		await mkdir(specDir, { recursive: true });
		await writeSpec("a.md", DONE);
		const { controller } = makeController();
		await controller.scan();
		expect(controller.panelVisible()).toBe(false);

		controller.reveal();
		expect(controller.panelVisible()).toBe(false); // "Show panel" is not the way back for a retired spec

		controller.setShowFinished(true);
		expect(controller.panelVisible()).toBe(true);

		controller.hide();
		expect(controller.panelVisible()).toBe(false);
		expect(controller.revealed).toBe(false);
	});

	test("show() (internal restore, e.g. after the inspector) does not override the auto-hide", async () => {
		await mkdir(specDir, { recursive: true });
		await writeSpec("a.md", DONE);
		const { controller } = makeController();
		await controller.scan();
		controller.show();
		expect(controller.panelVisible()).toBe(false);
	});

	test("revealing a done set fires an update so the widget is re-registered", async () => {
		await mkdir(specDir, { recursive: true });
		await writeSpec("a.md", DONE);
		const { controller, updates } = makeController();
		await controller.scan();
		const before = updates.length;
		controller.reveal();
		expect(updates.length).toBe(before + 1);
	});

	test("a pinned retired speclet needs the finished toggle, not just a reveal", async () => {
		await mkdir(specDir, { recursive: true });
		await writeSpec("a.md", DONE);
		const { controller } = makeController();
		await controller.scan();
		controller.pin("a.md");
		expect(controller.active()).toBeUndefined(); // retired specs leave the candidate set
		expect(controller.panelVisible()).toBe(false);
		controller.reveal();
		expect(controller.panelVisible()).toBe(false); // a reveal alone cannot show a retired spec
		controller.setShowFinished(true);
		expect(controller.active()?.filename).toBe("a.md");
		expect(controller.panelVisible()).toBe(true);
	});

	test("stop() clears the explicit reveal", async () => {
		await mkdir(specDir, { recursive: true });
		await writeSpec("a.md", DONE);
		const { controller } = makeController();
		await controller.scan();
		controller.reveal();
		controller.stop();
		expect(controller.revealed).toBe(false);
		expect(controller.panelVisible()).toBe(false);
	});

	test("an unreadable speclet keeps the panel visible rather than hiding the problem", async () => {
		await mkdir(specDir, { recursive: true });
		await writeSpec("a.md", DONE);
		await writeSpec("b.md", "---\nstatus: done\n---\n\n# B\n");
		await chmod(join(specDir, "b.md"), 0o000);
		const { controller } = makeController();
		await controller.scan();
		expect(controller.files.some((f) => f.error)).toBe(true);
		expect(controller.panelVisible()).toBe(true);
	});
});

describe("retired speclets stay hidden until the picker asks for them", () => {
	const DONE = "---\nstatus: done\n---\n\n# Done spec\n\n## Tasks\n\n- [x] 1. Done thing\n";
	const ARCHIVED = "---\nstatus: archived\n---\n\n# Archived spec\n\n## Tasks\n\n- [x] 1. Archived thing\n";
	const ACTIVE = "---\nstatus: in-progress\n---\n\n# Active spec\n\n## Tasks\n\n- [ ] 1. Open thing\n";

	test("done and archived speclets are neither selected nor rendered", async () => {
		await mkdir(specDir, { recursive: true });
		await writeSpec("a.md", DONE);
		await writeSpec("b.md", ARCHIVED);
		const { controller } = makeController();
		await controller.scan();
		expect(controller.files).toHaveLength(2); // parsed, just not shown
		expect(controller.active()).toBeUndefined();
		expect(controller.panelVisible()).toBe(false);
	});

	test("an unfinished sibling still shows while a retired one is hidden", async () => {
		await mkdir(specDir, { recursive: true });
		await writeSpec("a.md", ACTIVE);
		await writeSpec("b.md", DONE);
		const { controller } = makeController();
		await controller.scan();
		controller.pin("b.md"); // a retired pin resolves to nothing, not to b.md
		expect(controller.active()?.filename).toBe("a.md");
		expect(controller.panelVisible()).toBe(true);
	});

	test("setShowFinished reveals retired speclets and drops a retired pin when switched off", async () => {
		await mkdir(specDir, { recursive: true });
		await writeSpec("a.md", ACTIVE);
		await writeSpec("b.md", DONE);
		const { controller } = makeController();
		await controller.scan();
		controller.setShowFinished(true);
		controller.pin("b.md");
		expect(controller.active()?.filename).toBe("b.md");

		controller.setShowFinished(false);
		expect(controller.pinned).toBeUndefined();
		expect(controller.active()?.filename).toBe("a.md");
	});

	test("archived speclets are read only while the toggle is on", async () => {
		await mkdir(join(specDir, "archive"), { recursive: true });
		await writeFile(join(specDir, "archive", "old.md"), ARCHIVED);
		const { controller } = makeController();
		await controller.scan();
		expect(controller.files).toEqual([]); // the poll never descends into the archive directory
		expect(controller.panelVisible()).toBe(false);

		controller.setShowFinished(true);
		await controller.scan();
		expect(controller.files.map((f) => f.filename)).toEqual(["old.md"]);
		expect(controller.active()?.status).toBe("archived");
		expect(controller.panelVisible()).toBe(true);
	});

	test("stop() clears the finished toggle", async () => {
		await mkdir(specDir, { recursive: true });
		await writeSpec("a.md", DONE);
		const { controller } = makeController();
		await controller.scan();
		controller.setShowFinished(true);
		controller.stop();
		expect(controller.showFinished).toBe(false);
	});
});
