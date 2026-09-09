---
name: speclet
description: "Plan and implement small features in one spec file with a single approval gate. Use when a full SpecFlow workflow would be excessive."
---

# Speclet

One spec file, one approval gate, then validated execution of the full checklist. Keep the scope small; offer SpecFlow when risk, coupling, or migration complexity warrants separate requirements and design reviews. Do not switch workflows without the user's agreement.

## Planning and Approval

Use `.speclet/{feature-name}.md` with a descriptive kebab-case name. If `.speclet/context.md` exists, load it for project conventions; never create it automatically. Reuse unchanged context already in the session.

Start drafting without an unsolicited workflow explanation. Ask only questions whose answers materially change the spec, paired with recommendations. Capture requirements, testable acceptance criteria, design notes, and coding tasks together, then present the draft for explicit approval before implementation. Apply feedback and seek approval of the revised draft. A status label alone is not proof of user approval.

Use stable criterion IDs and task references. Put only the task number and a short action title on each checkbox line. Put a concise description, verification, criterion references, and any dependencies in indented sub-bullets below it; checklist interfaces display the title only. Tasks follow listed sequential order; add `Depends on: {task IDs}` when prerequisites are not obvious, and resolve missing or cyclic dependencies during planning. Keep deployment and documentation work out of the coding checklist.

## File Format

```markdown
---
status: draft
---
# {Feature Name}

## Requirements
As a {role}, I want {capability}, so that {benefit}.

### Acceptance Criteria
- AC1: WHEN {trigger}, THE SYSTEM SHALL {observable response}.
- AC2: IF {edge case}, THE SYSTEM SHALL {observable response}.

## Design Notes
- {Approach, key decisions, affected files/modules, and relevant checks}

## Tasks
- [ ] 1. {Short action title}
  - {Concise coding scope and verification}
  - Criteria: AC1
- [ ] 2. {Short action title}
  - {Concise coding scope and verification}
  - Criteria: AC2
  - Depends on: 1

## Outcome
{Validation evidence, approved deviations, surprises, and follow-ups}
```

Criteria use EARS-lite forms such as WHEN/IF/WHILE ... THE SYSTEM SHALL ..., with specific, measurable behavior. Keep the document proportionate to the feature rather than meeting fixed task or question counts.

## Execution

After approval, execute the full checklist sequentially unless the user requested narrower scope. Read the speclet once at execution start, then reuse unchanged context; refresh relevant changes or recover the full context if lost. Resume from the first unchecked task, checking its prerequisites. This lightweight workflow does not prescribe subagent orchestration.

For each task, verify its referenced criteria, conformance to design notes, and relevant project tests, lint, or type checks before checking its box. Include tests for changed testable behavior. Resolve tasks that cannot independently satisfy their criteria during planning rather than marking partial validation as a pass.

Fix validation failures within approved scope and revalidate. If blocked, required checks cannot run, or a material requirements/design change is needed, leave the task unchecked and stop with evidence and a proposed next step. Revisions to approved scope return to draft and require approval before execution resumes; Outcome cannot authorize deviations after the fact.

After all tasks pass, verify the acceptance criteria across the integrated feature, fill Outcome with actual results, and mark done. Report completed work, checks, and remaining follow-ups. For narrower execution requests, report and stop at the requested boundary.

## Status

Store status in YAML frontmatter: `draft` while awaiting approval, `approved` after explicit approval, `in-progress` when execution starts, and `done` only after full validation. Preserve unrelated metadata and content. Status changes keep the file at its current path.
