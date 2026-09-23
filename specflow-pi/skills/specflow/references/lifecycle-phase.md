# Lifecycle

## Status and legacy layout

Keep paths stable. For new flat specs, `tasks.md` frontmatter is authoritative and must contain `status: active`, `completed`, or `archived`. `gate: review` is optional and appears only while a real decision is pending. Discover older `specs/active|completed|archived/{feature}/` layouts; infer status from the legacy directory only when frontmatter is absent. Metadata takes precedence. Do not move, migrate, or silently relax existing specs.

A flat executable spec with missing or malformed lifecycle metadata is unknown and not runnable until corrected. A metadata-only `tasks.md` may record a pending review/evaluation and is not an approved task plan.

## Complete

When all tasks authorized by a whole-plan approval are done, verify the selected delivery target's agreed evidence and provide the final handoff; then mark the plan `completed` without waiting for a separate completion request. If only a task or bounded range was authorized, do not mark the whole plan completed.

A prototype may complete as a prototype, never as an operational product. For an MVP, passing automated checks without the real main journey is insufficient. Record owner acceptance separately: it may be pending after the user receives access and try instructions, unless the approved plan explicitly makes owner review a required blocking task. Report blockers without checking work on the user's behalf. Set completion metadata only when evidence supports it; include the delivered target, outcome, handoff path, and limitations. Do not infer deployment or publication authority.

## Archive

On request, archive in place with the user's reason. Preserve documents and metadata. Archived specs are history and are not edited or executed.

## Metadata

Use this frontmatter for new flat executable specs:

```yaml
---
status: active
gate: review
---
```

Rules:

| Field | Rule |
|---|---|
| `status` | Required for new flat executable specs; `active`, `completed`, or `archived` |
| `gate` | `review` only while an actual decision is pending; otherwise omit |
| `created_at` | Preserve or write only when known |
| `completed_at` | ISO date on completion; preserve on archive |
| `archived_at` | ISO date on archive |
| `archive_reason` | User-supplied reason when archiving |

Keep the effective settings, approval scope, validation boundary, evidence, limitations, and pending decision in the `Approval` section. A gate badge signals a decision, not permission to implement. Clear it only after that decision is recorded.

## List and resume

List by status with coding progress and acceptance state distinguished. On resume:

- intent unclear → staged interview appropriate to new-app discovery or existing-project evidence;
- experience unclear → concrete reference;
- scope/settings/evidence undecided → compact review packet;
- implementation authorized → continue the whole approved plan or the next authorized bounded task/range;
- coding done but acceptance incomplete → demonstrate the missing boundary;
- coding and authorized handoff complete → mark completed when the selected target's evidence supports it; record owner acceptance separately, even if pending.

Reuse approvals; do not request them again merely because a session restarted. A resumed evaluation remains evaluation work, not authority to build its example project.
