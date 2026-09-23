# Tasks: plan useful milestones

Prepare `tasks.md` from the outcome brief and experience direction. Use the frontmatter and structure in [templates/tasks.md](../templates/tasks.md).

Choose the planning boundary from the user's requested outcome. For a new app intended for full delivery at the selected target, plan all agreed work needed to reach that target as executable tasks before approval. The first milestone is the first demonstrable increment, not the only executable part of the plan. For a prototype, bounded feature, or explicitly limited first slice, plan only that scope. Keep wishlist and out-of-target work as roadmap bullets.

Organize in-scope work into useful delivery milestones. Every in-scope task, including later milestones, must have a concrete outcome, scope, acceptance links where applicable, prerequisites, and a meaningful verification or demonstration boundary. Give near-term and risky work the detail needed to execute safely; later in-scope work still needs enough detail to execute without another planning round, but avoid speculative low-level design. Milestones are progress checkpoints, not approval gates, unless the Approval section explicitly reserves a decision for the user.

For a new app, interview on what the complete target requires: repository/bootstrap work, each primary user journey, required data/integration paths, access and migration needs, end-to-end integration, packaging/documentation, and how the user will run, access, inspect, and try the result. Surface prerequisites, external dependencies, seed/sample data needs, and decisions about local versus live evidence when applicable. Do not ask about routine implementation details the approved design already resolves.

Break work into cohesive tasks that can be assigned and validated; use a few tasks by default, but add or combine tasks according to real dependencies and evidence needs rather than a fixed task cap. A single useful integration check may cover several criteria; do not create one test task per requirement. Include final end-to-end validation and user handoff tasks when they are part of the requested delivery.

Before presenting the full spec, check that project foundations and their decision states are recorded; primary behavior has clear acceptance criteria; the design establishes feasibility and important boundaries; every in-scope criterion is covered by task work or explicitly excluded; dependencies are complete and acyclic; integration, documentation, and handoff work are covered where applicable; open/proposed decisions are visible; and evidence claims match what can actually be demonstrated. Resolve inconsistencies or label them openly instead of hiding them to make the packet look complete.

Keep at most two hierarchy levels and stable task IDs. Each task should describe an observable implementation outcome, cite the relevant acceptance criteria, and state the smallest meaningful verification. Do not create separate tasks merely to mirror each requirement. For example:

```markdown
## Milestone 1 — Primary user journey

- [ ] 1.1 Deliver the first end-to-end journey
  - Scope: implement the approved flow using the selected stack and existing contracts.
  - Criteria: AC1, AC2
  - Verify: focused logic checks and the normal application path.

## Milestone 2 — Remaining agreed release behavior

- [ ] 2.1 Complete the remaining in-scope behavior
  - Depends on: 1.1
  - Criteria: AC3, AC4
  - Verify: relevant failure states and integration with milestone 1.

## Final integration and handoff

- [ ] 3.1 Verify the complete app and prepare run/try instructions
  - Depends on: 2.1
  - Criteria: AC1, AC2, AC3, AC4
  - Verify: fresh start, representative data, main journey, and handoff guide.
```

Omit `Depends on` for no prerequisite. Validate IDs and cycles; older `Depends on: none` means no prerequisite. Supporting tasks may pass local checks while milestone acceptance remains pending.

## Approval section

The single authoritative `Approval` section records:

- assignment mode;
- approved artifact/reference;
- effective settings;
- included scope and deferrals;
- exact execution authority requested for this review: none, all listed in-scope tasks through handoff, or a named bounded range;
- user approval recorded and the exact resulting authorized scope; before approval, authorization remains `none` even when a scope is requested;
- serial/parallel preference and whether bounded delegation is allowed;
- excluded actions and separately gated external steps;
- concrete validation boundary;
- provenance/evidence limitations;
- proposed decisions awaiting confirmation and material open decisions;
- pending decision and gate state.

When an actual decision is pending, use YAML frontmatter:

```yaml
---
status: active
gate: review
---
```

A combined packet replaces three separate gates by default. State the exact execution authority being requested before presenting the plan, separately from authority actually recorded after approval. The approval decision must accept, narrow, or decline that request; never infer permission from a review gate, a blank/ambiguous request, or the mere presence of executable tasks. When recording a decision, update the existing approval and authorized-execution fields in place; do not leave stale pending values or append duplicate labels. For whole-app delivery, one explicit approval may authorize all listed in-scope tasks through handoff within the target, exclusions, and assumptions. A task/range approval remains bounded to that selection. Keep separately requested gates and existing commitments. In evaluation/prototype mode, approval stays within that assignment and cannot authorize application implementation. Review cadence controls progress/checkpoint cadence inside already authorized work; it never grants authorization or creates a new approval gate.

Record owner acceptance separately from engineering completion. Deployment, paid/external actions, publication, destructive production changes, and release retain separate authorization requirements unless explicitly included in the approved scope. Test detail follows [configuration](configuration.md); there is no test-per-sentence requirement.
