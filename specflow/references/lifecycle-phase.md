# Phase 5: Lifecycle

## Status and Legacy Layout

New specs use the flat [layout](../SKILL.md#directory-layout). `tasks.md` frontmatter status is authoritative: `active` for development, `completed` for implementation references, `archived` for obsolete or abandoned history. Before a new plan exists, treat the spec as active. Listing, resuming, and archiving are available before implementation finishes.

Older versions stored specs under `specs/active/`, `specs/completed/`, and `specs/archived/`. Discover both layouts; for legacy specs without status metadata, infer status from the containing directory. Metadata takes precedence if present. Update legacy specs in place without moving directories or migrating automatically. A flat spec with a task file but missing or invalid status needs clarification before a lifecycle write.

Resolve names across both layouts, using actual paths to distinguish duplicates. Use the sole eligible spec if unambiguous; otherwise ask which spec. Report missing specs or already-achieved states without changing anything.

## Complete

On an explicit completion request, verify the active spec's tasks are all checked and their completion is backed by [execution validation](execution-phase.md#validation). Unchecked or unvalidated work blocks completion; report what remains. This command does not implement tasks or check boxes on the user's behalf.

Set completion metadata in place. Confirm the spec path, status, and completion date. Completed specs remain available as reference documentation.

## Archive

On an archive request, set archive metadata on an active or completed spec in place. Use the user's reason if supplied; otherwise ask and wait for it. Confirm the spec path, status, reason, and archive date.

Archive rather than delete specs. Preserve all documents and historical metadata; lifecycle transitions do not move directories. Verify metadata after writing and report failures. Archived specs can be referenced but not modified.

## Metadata

Store lifecycle metadata in YAML frontmatter at the top of `tasks.md`, preserving unrelated fields and body. For an early archive with no task file, create a metadata-only `tasks.md`; this is not an approved implementation plan.

| Field | Rule |
|-------|------|
| status | Set `active` when creating a plan; preserve existing status on plan edits; set `completed` or `archived` only through the corresponding transition |
| created_at | Preserve if present; record only if the creation date is known |
| completed_at | Set to today's ISO date (YYYY-MM-DD) on completion; preserve on later archive |
| archived_at | Set to today's ISO date on archive |
| archive_reason | User-supplied reason, required on archive |

Use status resolution above for legacy plans. A metadata-only task file is not evidence of planning approval.

## List

Show specs grouped by active/completed/archived, or restrict to the requested status. Task counts, lifecycle dates, and archive reasons may supplement names. Distinguish executable-task progress from parent group checkboxes when reporting counts.

## Resume

Locate the active spec and determine progress from documents plus known approvals, not file existence alone. If approval is unknown, request review of the relevant document before advancing.

| State | Route |
|-------|-------|
| No requirements | Phase 1: [Requirements](requirements-phase.md) |
| Requirements awaiting approval | Phase 1 review |
| Requirements approved; design missing or awaiting approval | Phase 2: [Design](design-phase.md) / review |
| Design approved; tasks missing or awaiting approval | Phase 3: [Tasks](tasks-phase.md) / review |
| All three approved, work remains | Phase 4: [Execution](execution-phase.md), default next task |
| All tasks validated and checked | Report readiness for Complete; await explicit completion request |

Report the current phase, progress if available, and next action. Let the selected phase load its relevant context; resumption does not itself mandate full-document re-reading.
