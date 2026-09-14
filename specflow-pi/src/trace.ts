/**
 * trace.ts — pure derivations over a parsed spec: which requirements have
 * implementing tasks, which task can run next. No filesystem, no imports
 * except types from ./parse.js.
 *
 * Detail-row grammar (rows arrive control-stripped, leading bullet retained):
 *   "- Criteria: AC1" / "- Criteria: AC1, AC2" / "- Depends on: 1.1"
 * Tolerances: optional dash/bullet, case-insensitive label, comma- and/or
 * space-separated values, dotted ids (`1.1`, `2.3`).
 *
 * dependencyGraph classification (each unfinished task lands in exactly one
 * list, priority dangling > blocked > ready):
 * - dangling: cites a dependency id that does not exist — never treated as
 *   satisfied, never ready even if its other dependencies are done.
 * - blocked: all dependencies exist, at least one is unfinished.
 * - ready: all dependencies exist and are done (a task with no dependencies
 *   is ready).
 * A task depending on ITSELF is blocked-on-itself (the id exists and the task
 * is unfinished), never dangling. Done tasks are excluded from all lists.
 */

import type { SpecflowSpec, SpecflowTask } from "./parse.js";

const CRITERIA_ROW_RE = /^(?:[-*+]\s*)?criteria\s*:\s*(.+)$/i;
const DEPENDS_ROW_RE = /^(?:[-*+]\s*)?depends\s+on\s*:\s*(.+)$/i;

function rowValues(details: string[] | undefined, re: RegExp): string[] {
	const out: string[] = [];
	for (const raw of details ?? []) {
		const m = raw.match(re);
		if (!m) continue;
		for (const token of m[1].split(/[\s,;]+/)) {
			if (token) out.push(token);
		}
	}
	return out;
}

/** AC ids a task cites, from its `Criteria:` detail rows. */
export function criteriaIdsOf(task: SpecflowTask): string[] {
	return rowValues(task.details, CRITERIA_ROW_RE);
}

/** Dependency ids a task declares, from its `Depends on:` detail rows. */
export function dependsOn(task: SpecflowTask): string[] {
	return rowValues(task.details, DEPENDS_ROW_RE);
}

export interface CriteriaLink {
	id: string;
	/** Task ids citing this AC, in document order. */
	tasks: string[];
}

export interface CriteriaTrace {
	defined: string[];
	claimed: CriteriaLink[];
	/** Defined in requirements.md but cited by NO task — a requirement nothing implements. */
	unclaimed: string[];
	/** Cited by a task but not defined in requirements.md (typo or stale citation). */
	orphan: { id: string; taskId: string }[];
}

/** Which defined criteria tasks claim. `claimed` follows `defined` order. */
export function traceCriteria(spec: SpecflowSpec): CriteriaTrace {
	const defined = [...spec.criteria];
	const definedSet = new Set(defined);
	const byId = new Map<string, string[]>();
	const orphan: { id: string; taskId: string }[] = [];
	for (const task of spec.tasks) {
		for (const id of criteriaIdsOf(task)) {
			if (!definedSet.has(id)) {
				orphan.push({ id, taskId: task.id });
				continue;
			}
			let tasks = byId.get(id);
			if (!tasks) {
				tasks = [];
				byId.set(id, tasks);
			}
			if (!tasks.includes(task.id)) tasks.push(task.id);
		}
	}
	const claimed = defined
		.filter((id) => byId.has(id))
		.map((id) => ({ id, tasks: byId.get(id)! }));
	return {
		defined,
		claimed,
		unclaimed: defined.filter((id) => !byId.has(id)),
		orphan,
	};
}

export interface DependencyGraph {
	/** Unfinished, every dependency exists AND is done. */
	ready: string[];
	/** Unfinished, waiting on at least one unfinished dependency. */
	blocked: { id: string; by: string[] }[];
	/** Depends on ids that do not exist — never treated as satisfied. */
	dangling: { id: string; missing: string[] }[];
}

function tasksOf(spec: SpecflowTask[] | SpecflowSpec): SpecflowTask[] {
	return Array.isArray(spec) ? spec : spec.tasks;
}

/** Classify every unfinished task's dependencies (see module doc for the rules). */
export function dependencyGraph(spec: SpecflowTask[] | SpecflowSpec): DependencyGraph {
	const tasks = tasksOf(spec);
	const byId = new Map(tasks.map((t) => [t.id, t]));
	const ready: string[] = [];
	const blocked: { id: string; by: string[] }[] = [];
	const dangling: { id: string; missing: string[] }[] = [];
	for (const task of tasks) {
		if (task.done) continue;
		const deps = dependsOn(task);
		const missing = deps.filter((d) => !byId.has(d));
		if (missing.length > 0) {
			dangling.push({ id: task.id, missing });
			continue;
		}
		const waiting = deps.filter((d) => !byId.get(d)!.done);
		if (waiting.length > 0) blocked.push({ id: task.id, by: waiting });
		else ready.push(task.id);
	}
	return { ready, blocked, dangling };
}

/** First READY unfinished task in document order; undefined when none. */
export function nextTask(spec: SpecflowTask[] | SpecflowSpec): SpecflowTask | undefined {
	const tasks = tasksOf(spec);
	const ready = new Set(dependencyGraph(tasks).ready);
	return tasks.find((t) => !t.done && ready.has(t.id));
}
