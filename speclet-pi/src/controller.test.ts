import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
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
		await writeFile(tmp, "---\nstatus: done\n---\n# A\n");
		const { rename } = await import("node:fs/promises");
		await rename(tmp, join(specDir, "a.md"));
		await controller.scan();
		expect(controller.active()?.status).toBe("done");
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
		controller.start();
		await writeSpec("a.md", "# A\n");
		await new Promise((r) => setTimeout(r, 400)); // generous window: 20 ticks at the 20 ms interval
		const seen = controller.active()?.filename;
		const updateCount = updates.length;
		controller.stop(); // stop clears files; assert on pre-stop observations
		expect(seen).toBe("a.md");
		expect(updateCount).toBeGreaterThan(1); // initial hidden + appearance
	}, 2000);

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
