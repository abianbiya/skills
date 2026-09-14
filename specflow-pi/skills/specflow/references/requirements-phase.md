# Phase 1: Requirements

Use project context from `.specflow/project.md`; if missing, follow [project setup](project-setup.md). Create or update `requirements.md` in the active feature directory defined in [SKILL.md](../SKILL.md#directory-layout). Consult related completed specs when relevant, resolving status through [Lifecycle](lifecycle-phase.md#status-and-legacy-layout). Link to their actual paths (`../{feature-name}/` in the flat layout).

Generate an initial draft from the idea without a preliminary interview unless grilling is requested. Identify assumptions and unresolved information rather than silently inventing scope.

## Grilling (Optional)

When requested, surface contextual questions whose answers would materially change the spec: ambiguities, concurrency, edge cases, hidden decisions, or integration constraints. Present one block, each question paired with a recommendation and brief reasoning. Wait for answers before drafting; use the confirmed intent.

## Document Content

- Introduction: what, why, intended users, and scope.
- Numbered requirements, each with a descriptive name, a user story (As a role, I want a capability, so that a benefit), and numbered acceptance criteria. Optional notes capture constraints or dependencies.
- Out of Scope, Assumptions, and Dependencies sections.

Use stable references: `1` identifies Requirement 1; `1.2` identifies its second acceptance criterion. Preserve existing IDs when revising. Design and tasks use these same references.

## EARS Acceptance Criteria

Write specific, measurable outcomes with one behavior per criterion and unambiguous conditions.

| Pattern | Form |
|---------|------|
| Ubiquitous | The system SHALL [behavior] |
| Event-driven | WHEN [event] THEN the system SHALL [behavior] |
| Conditional | IF [condition] THEN the system SHALL [behavior] |
| Combined | WHEN [event] AND IF [condition] THEN the system SHALL [behavior] |
| Optional | WHERE [feature included] the system SHALL [behavior] |

Cover functional behavior, relevant performance/security/accessibility constraints, error and boundary cases, and success criteria. Keep scope explicit; propose a separate spec for unrelated expansion.

Present the draft with a coverage summary and apply the [planning approval gate](../SKILL.md#core-contract).
