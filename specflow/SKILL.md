---
name: specflow
description: "Plan and implement features through approved requirements, design, and tasks. Use for spec-driven development with explicit review gates and validated execution."
---

# SpecFlow

## Core Contract

Work through Phase 1 (Requirements), Phase 2 (Design), Phase 3 (Tasks), then Phase 4 (Execution). Present each planning document for review and obtain explicit approval before advancing; revise and seek approval again after feedback. Existing files alone are not approval. When updating an earlier phase, reconcile affected downstream documents through the same gates before execution.

Phase 4 defaults to one task, followed by a report and a stop for user review. Only an explicitly requested task range or list authorizes a batch. Phase 5 manages completion, archiving, listing, and resumption; it is not an additional planning gate.

Load the relevant reference when entering a phase; reuse context already loaded and unchanged. Start the requested work without an unsolicited workflow explanation.

## Entry Points

| User intent | Route / reference |
|-------------|-------------------|
| First spec / missing project.md | [Project setup](references/project-setup.md), then requested phase |
| New feature / new spec / update requirements | [Phase 1: Requirements](references/requirements-phase.md) |
| Grill me / ask me questions first / let's discuss this | [Phase 1: Grilling](references/requirements-phase.md#grilling-optional) |
| Update design / grill the design / discuss architecture first | [Phase 2: Design](references/design-phase.md) |
| Update tasks | [Phase 3: Tasks](references/tasks-phase.md) |
| Execute a task / execute next task | [Phase 4: Execution](references/execution-phase.md) |
| Execute tasks 1.1–1.4 / an explicit task list | [Phase 4: Execution](references/execution-phase.md) within that scope |
| Execute an authorized batch in parallel | [Phase 4: Parallel execution](references/execution-phase.md#parallel-execution-optional) |
| Validate implementation | [Phase 4: Validation](references/execution-phase.md#validation) |
| Continue / resume spec | [Phase 5: Resume](references/lifecycle-phase.md#resume) to determine the current phase |
| Complete spec / mark spec done | [Phase 5: Complete](references/lifecycle-phase.md#complete) |
| Archive spec | [Phase 5: Archive](references/lifecycle-phase.md#archive) |
| List / show specs, optionally by status | [Phase 5: List](references/lifecycle-phase.md#list) |

## Directory Layout

```text
.specflow/
├── project.md
└── specs/
    └── {feature-name}/
        ├── requirements.md
        ├── design.md
        └── tasks.md
```

Use descriptive kebab-case feature names. Status lives in `tasks.md` frontmatter; paths stay stable. Older versions used `active/`, `completed/`, and `archived/` directories: preserve compatibility as described in [Lifecycle](references/lifecycle-phase.md#status-and-legacy-layout).
