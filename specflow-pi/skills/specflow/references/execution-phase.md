# Phase 4: Execution

## Session Context

Identify the active spec and verify the [planning approvals](../SKILL.md#core-contract). Project context must exist; all three planning documents must be approved.

At the start of an execution session, read `.specflow/project.md` and the feature's `requirements.md`, `design.md`, and `tasks.md` in full once. Load referenced completed-spec context only where relevant. Retain the requirement mapping, design structure, task order/dependencies, and project conventions in session context.

An execution session spans successive task requests for the same spec while that context remains available. A user-review pause does not start a new session. If context is lost or a different spec is selected, establish the full baseline again. If files change, refresh affected sections and dependencies; changes to approved planning content must pass the root approval gates before execution resumes.

## Task Scope and Delta Reads

For “execute next task,” select the first unchecked task in listed order whose declared dependencies are validated and integrated. For a specified task, verify that it is unchecked and its dependencies are complete. An explicit range such as “execute tasks 1.1–1.4” or list authorizes those tasks only, in dependency order, sequentially by default; do not silently add prerequisites or expand the range. Skip already checked tasks and report them as skipped.

For each task after the baseline, load only:

- Its current unchecked task line and scope/reference sub-bullets, plus dependency or parent status needed to select it.
- The referenced requirement IDs and their acceptance criteria, using the [ID convention](requirements-phase.md#document-content).
- The design sections it touches, including relevant shared interfaces and constraints.

Reuse unchanged project and broader spec context; do not reload entire documents per task. Resolve unclear scope from these excerpts before asking the user. Missing IDs, unmet dependencies, or remaining ambiguity block execution of that task.

Implement within this scope using the approved design and project conventions. Requirements and design are read-only during execution; route needed changes to their planning phase. Clarified task wording may be updated without silently changing approved scope.

## Parallel Execution (Optional)

Use subagents only within an explicitly authorized batch, when the user permits delegation and the harness supports it. Otherwise follow the same dependency flow sequentially. Only ready tasks with no dependency between them may run together.

The parent assigns bounded task scopes, relevant context excerpts, and file ownership. Use disjoint files where shared-tree parallel writers are permitted; otherwise use separate worktrees or run sequentially. Account for shared interfaces, generated files, and mutable test resources as well as dependency edges. Follow harness limits and repository delegation rules.

Children implement and return changes plus validation evidence; the parent owns integration, final validation, and `tasks.md` updates. A child report alone does not complete a task. Integrate and validate prerequisite results before launching dependents.

On an unresolved failure, stop dispatching new tasks, safely pause or collect already-running work, preserve edits, and report completed, failed, and unstarted tasks. Do not start dependents of failed work.

## Validation

Before changing a task checkbox, verify all three levels:

| Level | Evidence required |
|-------|-------------------|
| Requirements | Every referenced acceptance criterion passes, including its specified edge, error, and success cases. A whole-requirement reference includes all its criteria. |
| Design | Touched components/layers, schemas and relationships, interfaces, API behavior, error handling, and state management match the approved design. |
| Quality | Tests for new testable logic cover normal and error paths; project tests, lint, and applicable type checks pass; functionality runs without errors or warnings. Find commands in project context or repository configuration. |

If a task cannot independently satisfy its referenced criteria, resolve the task/spec mismatch through planning rather than claiming partial validation as a pass. If checks fail, fix within the authorized task and revalidate. If blocked or unable to run required checks, leave it unchecked, report the evidence and resolution options, and stop for user guidance. For a parallel batch, apply the failure handling above.

Only after all levels pass, change that task from `- [ ]` to `- [x]`. Complete children before checking a parent; check the parent's own scope too. In sequential execution, validate and update each task before starting the next; parallel execution follows the integration rules above.

For “validate implementation,” apply these same levels to the requested scope (the whole implementation if unspecified), using the session/delta context rules. Report findings without implementing fixes or changing checkboxes unless requested.

## Report and Stop

Report task IDs and outcomes, changed files, requirement/criterion evidence, design conformance, checks run and results, and any blockers or remaining work. For a batch, give one consolidated report with per-task results, including skipped or unexecuted tasks.

Stop after the default single task or the explicitly authorized batch and wait for the user before further execution. When all tasks are checked, report readiness for the explicit [complete spec](lifecycle-phase.md#complete) action; do not change its lifecycle status automatically.
