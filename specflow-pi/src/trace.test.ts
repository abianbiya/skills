import { describe, test, expect } from "bun:test";
import {
	criteriaIdsOf,
	dependsOn,
	dependencyGraph,
	nextTask,
	traceCriteria,
} from "./trace.js";
import type { SpecflowSpec, SpecflowTask } from "./parse.js";

function task(id: string, done: boolean, details: string[] = []): SpecflowTask {
	return { id, title: `Task ${id}`, done, details };
}

function specOf(tasks: SpecflowTask[], criteria: string[] = []): SpecflowSpec {
	return {
		dir: "/specs/demo",
		name: "demo",
		status: "active",
		statusSource: "frontmatter",
		legacy: false,
		docs: { tasks: "/specs/demo/tasks.md" },
		criteria,
		tasks,
		done: tasks.filter((t) => t.done).length,
		total: tasks.length,
		phase: 4,
		gate: null,
		mtimeMs: 0,
	};
}

describe("criteriaIdsOf", () => {
	test("parses the exact row formats", () => {
		expect(criteriaIdsOf(task("1.1", false, ["- Criteria: AC1"]))).toEqual(["AC1"]);
		expect(criteriaIdsOf(task("1.1", false, ["- Criteria: AC1, AC2"]))).toEqual(["AC1", "AC2"]);
		expect(criteriaIdsOf(task("1.1", false, ["- Depends on: 1.1"]))).toEqual([]);
	});
	test("tolerates optional bullet, case-insensitive label, comma/space separation", () => {
		expect(criteriaIdsOf(task("1", false, ["criteria: ac1, ac2"]))).toEqual(["ac1", "ac2"]);
		expect(criteriaIdsOf(task("1", false, ["* CRITERIA:  AC1  AC2"]))).toEqual(["AC1", "AC2"]);
		expect(criteriaIdsOf(task("1", false, ["- Criteria: AC1; AC2"]))).toEqual(["AC1", "AC2"]);
	});
	test("ignores unrelated rows and empty details", () => {
		expect(criteriaIdsOf(task("1", false, ["- Do the thing", "- Depends on: 2.1"]))).toEqual([]);
		expect(criteriaIdsOf(task("1", false))).toEqual([]);
	});
});

describe("dependsOn", () => {
	test("parses dotted ids from the exact row format", () => {
		expect(dependsOn(task("2.1", false, ["- Depends on: 1.1"]))).toEqual(["1.1"]);
		expect(dependsOn(task("2.1", false, ["- Depends on: 1.1, 1.2"]))).toEqual(["1.1", "1.2"]);
		expect(dependsOn(task("2.1", false, ["depends on: 1.1 1.3"]))).toEqual(["1.1", "1.3"]);
		expect(dependsOn(task("2.1", false, ["- Criteria: AC1"]))).toEqual([]);
	});
});

describe("traceCriteria", () => {
	test("groups claimed criteria, lists unclaimed, and flags orphans", () => {
		const spec = specOf(
			[
				task("1.1", false, ["- Criteria: AC1"]),
				task("1.2", false, ["- Criteria: AC1, AC3"]),
				task("2.1", false, ["- Criteria: AC9"]),
			],
			["AC1", "AC2", "AC3"],
		);
		const t = traceCriteria(spec);
		expect(t.defined).toEqual(["AC1", "AC2", "AC3"]);
		expect(t.claimed).toEqual([
			{ id: "AC1", tasks: ["1.1", "1.2"] },
			{ id: "AC3", tasks: ["1.2"] },
		]);
		expect(t.unclaimed).toEqual(["AC2"]);
		expect(t.orphan).toEqual([{ id: "AC9", taskId: "2.1" }]);
	});

	test("no criteria declared but tasks citing them => everything is orphan", () => {
		const spec = specOf([task("1.1", false, ["- Criteria: AC1, AC2"])]);
		const t = traceCriteria(spec);
		expect(t.defined).toEqual([]);
		expect(t.claimed).toEqual([]);
		expect(t.unclaimed).toEqual([]);
		expect(t.orphan).toEqual([
			{ id: "AC1", taskId: "1.1" },
			{ id: "AC2", taskId: "1.1" },
		]);
	});

	test("a spec where every AC is claimable has empty unclaimed and orphan", () => {
		const spec = specOf(
			[task("1.1", false, ["- Criteria: AC2"]), task("1.2", false, ["- Criteria: AC1"])],
			["AC1", "AC2"],
		);
		const t = traceCriteria(spec);
		expect(t.unclaimed).toEqual([]);
		expect(t.orphan).toEqual([]);
		expect(t.claimed.map((c) => c.id)).toEqual(["AC1", "AC2"]); // defined order, not citation order
	});
});

describe("dependencyGraph", () => {
	test("chain 1.1 -> 2.1 -> 2.2: ready, blocked naming unfinished deps", () => {
		const spec = specOf([
			task("1.1", true), // done
			task("2.1", false, ["- Depends on: 1.1"]), // dep done => ready
			task("2.2", false, ["- Depends on: 2.1"]), // dep unfinished => blocked
		]);
		const g = dependencyGraph(spec);
		expect(g.ready).toEqual(["2.1"]);
		expect(g.blocked).toEqual([{ id: "2.2", by: ["2.1"] }]);
		expect(g.dangling).toEqual([]);
	});

	test("dangling: missing ids never count as satisfied", () => {
		const spec = specOf([task("1.1", false, ["- Depends on: 9.9"])]);
		const g = dependencyGraph(spec);
		expect(g.dangling).toEqual([{ id: "1.1", missing: ["9.9"] }]);
		expect(g.ready).toEqual([]);
	});

	test("done tasks are excluded from all lists", () => {
		const spec = specOf([
			task("1.1", true, ["- Depends on: 9.9"]), // done + dangling => nowhere
			task("1.2", true), // done, no deps => nowhere
		]);
		const g = dependencyGraph(spec);
		expect(g.ready).toEqual([]);
		expect(g.blocked).toEqual([]);
		expect(g.dangling).toEqual([]);
	});

	test("a task with both a missing and an unfinished dependency is dangling (priority)", () => {
		const spec = specOf([
			task("1.1", false),
			task("1.2", false, ["- Depends on: 1.1, 8.8"]),
		]);
		const g = dependencyGraph(spec);
		expect(g.dangling).toEqual([{ id: "1.2", missing: ["8.8"] }]);
		expect(g.blocked).toEqual([]);
	});

	test("a task depending on ITSELF is blocked-on-itself, never dangling", () => {
		const g = dependencyGraph(specOf([task("1.1", false, ["- Depends on: 1.1"])]));
		expect(g.blocked).toEqual([{ id: "1.1", by: ["1.1"] }]);
		expect(g.dangling).toEqual([]);
	});

	test("zero tasks => every list empty", () => {
		const g = dependencyGraph(specOf([]));
		expect(g.ready).toEqual([]);
		expect(g.blocked).toEqual([]);
		expect(g.dangling).toEqual([]);
	});
});

describe("nextTask", () => {
	test("returns the first READY unfinished task in document order", () => {
		const spec = specOf([
			task("1.1", true),
			task("2.2", false, ["- Depends on: 2.1"]), // blocked
			task("1.2", false), // ready, earlier than 2.1
			task("2.1", false, ["- Depends on: 1.1"]), // ready
		]);
		expect(nextTask(spec)!.id).toBe("1.2");
	});

	test("skips done and blocked tasks; undefined when nothing is ready", () => {
		const spec = specOf([
			task("1.1", true), // done => never next
			task("1.2", false, ["- Depends on: 9.9"]), // dangling => not ready
		]);
		expect(nextTask(spec)).toBeUndefined();
	});

	test("done-only and blocked-only specs have no next task", () => {
		expect(nextTask(specOf([task("1.1", true)]))).toBeUndefined();
		expect(nextTask(specOf([task("1.1", false, ["- Depends on: 1.2"])]))).toBeUndefined();
		expect(nextTask(specOf([]))).toBeUndefined();
	});
});
