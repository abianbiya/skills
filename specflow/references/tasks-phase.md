# Phase 3: Tasks

Use approved requirements and design to create or update `tasks.md` in the active feature directory. Follow the [planning approval gate](../SKILL.md#core-contract).

Initialize or preserve [lifecycle metadata](lifecycle-phase.md#metadata) when writing the plan.

## Plan Contract

Include a short implementation overview and groups of incremental coding tasks. Use at most two hierarchy levels: top-level groups and decimal task IDs such as `1.1`, `1.2`, `2.1`.

Each task has a checkbox, unique number, action title, scope sub-bullets, and explicit [requirement/criterion references](requirements-phase.md#document-content). Enumerate IDs instead of using `All`, so task context and validation are bounded. Include relevant design section names in the scope when they are not evident from traceability.

```markdown
## 1. [Work group]

- [ ] 1.1 [One logical implementation outcome]
  - Depends on: none
  - [Code to create or modify and integration points]
  - [Tests or verification required by the design]
  - _Requirements: 1.1, 1.2_
```

Tasks must be specific, testable, traceable, and small enough to validate individually. Order dependencies before dependent work, integrate code rather than leaving orphaned components, and include testing with test-driven development where appropriate.

## Dependency Flow

Every task declares `Depends on: none` or explicit prerequisite task IDs. These edges define the execution flow; list prerequisites before dependents and reject missing IDs, self-dependencies, and cycles before seeking plan approval. Dependencies refer to validated, integrated outcomes, not merely work started.

For example, `1.1: none`, `1.2: 1.1`, `1.3: 1.1`, `1.4: 1.2, 1.3` means 1.1 first, then 1.2 and 1.3, then 1.4. Tasks 1.2 and 1.3 are dependency-independent and candidates for parallel execution under the [execution rules](execution-phase.md#parallel-execution-optional). Avoid maintaining a second ordering diagram.

For older plans without dependency fields, retain listed sequential order and infer prerequisites conservatively from scope; missing fields do not mean independence. Clarify uncertainty before execution and add explicit dependencies through plan review before parallelizing.

Exclude deployment, human acceptance/manual E2E testing, post-deployment metrics gathering, training, business-process changes, and marketing. Documentation tasks are allowed only when explicitly requested.

Present the plan with its groups and task count for review. After approval, route execution requests to [Phase 4](execution-phase.md); execution scope and stopping rules live there and in the root contract.
