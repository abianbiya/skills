---
name: specflow
description: "Spec-driven development orchestrator for transforming feature ideas into structured requirements, designs, implementation plans, and validated execution. Use this skill when: (1) Creating a new feature spec from a rough idea, (2) Developing requirements documents with user stories and acceptance criteria, (3) Creating technical design documents with architecture and components, (4) Generating implementation task lists for coding agents, (5) Executing tasks with validation against specs, (6) Iterating on existing specs with user feedback, (7) Following a structured planning and execution workflow."
---

# SpecFlow

## Overview

Guide users through spec-driven development by transforming rough feature ideas into structured requirements, comprehensive designs, actionable implementation plans, and validated execution. This workflow creates three key documents that must be reviewed and approved sequentially, then supports task-by-task execution with validation.

**Key Principle:** Establish ground-truths with the user at each phase. Never proceed without explicit approval. During execution, always validate against specs before marking tasks complete.

---

## Quick Reference

### Entry Points

| User Intent | Action |
|-------------|--------|
| First spec / no project.md yet | Create .specflow/project.md first — see [references/project-setup.md](references/project-setup.md) |
| New feature idea / "new spec" | Start at Phase 1: Requirements (create in active/) |
| "Grill me" / "ask me questions first" | Grilling Mode at Phase 1: clarify before generating |
| "Grill the design" / "discuss architecture first" | Grilling Mode at Phase 2: align on key decisions before designing |
| Update requirements | Go to Phase 1: Requirements |
| Update design | Go to Phase 2: Design |
| Update tasks | Go to Phase 3: Tasks |
| Execute a task | Go to Phase 4: Execution (read all specs first) |
| "Execute next task" | Go to Phase 4: Execution |
| "Continue the spec" | Go to Phase 4: Execution (resume from last completed) |
| "Complete spec" / "mark spec done" | Move to completed/ (Phase 5: Lifecycle) |
| "Archive spec" | Move to archived/ (Phase 5: Lifecycle) |
| "List specs" / "show specs" | Show specs grouped by status (active/completed/archived) |
| "Validate implementation" | Go to Phase 4: Validation check |

### Directory Structure

```
.specflow/
├── project.md                         # Global project context (tech stack, conventions)
└── specs/
    ├── active/                        # Specs in development (Phases 1-4)
    │   └── {feature-name}/
    │       ├── requirements.md        # User stories + EARS acceptance criteria
    │       ├── design.md              # Architecture, components, data models
    │       └── tasks.md               # Implementation checklist for coding agents
    ├── completed/                     # Finished specs (reference documentation)
    │   └── {feature-name}/
    │       ├── requirements.md
    │       ├── design.md
    │       └── tasks.md               # Has completion timestamp
    └── archived/                      # Obsolete or abandoned specs
        └── {feature-name}/
            ├── requirements.mdare 
            ├── design.md
            └── tasks.md               # Has archive reason
```

**Naming:** Use kebab-case for feature names (e.g., `user-authentication`, `add-2fa-to-auth`)

---

## Grilling Mode (Optional)

An opt-in alignment session that runs before generating at Phase 1 or Phase 2. Instead of producing a document immediately, the agent analyzes the specific feature idea, identifies the ambiguities and decisions that would most change the spec if answered differently, and asks about those — each paired with a recommendation.

**Trigger phrases:** "grill me", "ask me questions first", "let's discuss this", "grill the design" (Phase 2 variant)

**Key principle:** Questions are contextual, not templated. The agent reasons about the feature and asks what actually matters for it — race conditions, data model forks, integration constraints, hidden assumptions. A booking app gets asked about concurrency and payment state; a reporting tool gets asked about data freshness and access control.

**Format:** Present all questions as a single block. For each, state the question, the recommendation, and brief reasoning. The user confirms or redirects — they don't have to answer from scratch.

Full guidance in [references/requirements-phase.md](references/requirements-phase.md) and [references/design-phase.md](references/design-phase.md).

---

## Workflow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                       SPECFLOW WORKFLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Feature Idea] ──► PHASE 1: Requirements (in active/)          │
│                         │                                       │
│                         ▼                                       │
│                    Review & Approve ◄──── Feedback Loop         │
│                         │                                       │
│                         ▼                                       │
│                   PHASE 2: Design                               │
│                         │                                       │
│                         ▼                                       │
│                    Review & Approve ◄──── Feedback Loop         │
│                         │                                       │
│                         ▼                                       │
│                   PHASE 3: Tasks                                │
│                         │                                       │
│                         ▼                                       │
│                    Review & Approve ◄──── Feedback Loop         │
│                         │                                       │
│                         ▼                                       │
│                   PHASE 4: Execution                            │
│                         │                                       │
│              ┌──────────┴──────────┐                            │
│              ▼                     │                            │
│         Read All Specs             │                            │
│              │                     │                            │
│              ▼                     │                            │
│         Execute ONE Task           │                            │
│              │                     │                            │
│              ▼                     │                            │
│         Validate Against Specs     │                            │
│              │                     │                            │
│              ▼                     │                            │
│         Mark Complete & STOP       │                            │
│              │                     │                            │
│              ▼                     │                            │
│         [Wait for User] ───────────┘                            │
│              │                     (repeat for each task)       │
│              ▼                                                  │
│         [All Tasks Done]                                        │
│              │                                                  │
│              ▼                                                  │
│         PHASE 5: Lifecycle                                      │
│              │                                                  │
│         ┌────┴────┐                                             │
│         ▼         ▼                                             │
│    Complete    Archive                                          │
│         │         │                                             │
│         ▼         ▼                                             │
│   completed/  archived/                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Requirements Gathering

**Goal:** Transform a rough idea into structured requirements with user stories and EARS acceptance criteria.

**Reference:** [references/requirements-phase.md](references/requirements-phase.md)

### Quick Steps

1. **Optional: Grilling mode** — if requested, run Phase 1 question set before generating (see [references/requirements-phase.md](references/requirements-phase.md))
2. **Generate initial requirements** from the rough idea (or from grilling answers if grilled)
3. **Format document** with:
   - Introduction (what, why, who, scope)
   - Requirements with user stories
   - EARS acceptance criteria
   - Out of Scope section
   - Assumptions and Dependencies
4. **Ask for review:** "Do the requirements look good? If so, we can move on to the design."
5. **Iterate** until explicit approval received
6. **Only proceed** to Design after clear approval ("yes", "approved", "looks good")

### EARS Pattern Quick Reference

| Pattern | Template |
|---------|----------|
| Ubiquitous | The system SHALL [behavior] |
| Event-Driven | WHEN [event] THEN the system SHALL [behavior] |
| Conditional | IF [condition] THEN the system SHALL [behavior] |
| Combined | WHEN [event] AND IF [condition] THEN the system SHALL [behavior] |

---

## Phase 2: Design Document

**Goal:** Create a comprehensive technical design addressing all approved requirements.

**Reference:** [references/design-phase.md](references/design-phase.md)

### Quick Steps

1. **Read requirements.md** before starting
2. **Conduct research** as needed (summarize in conversation, don't create separate files)
3. **Optional: Grilling mode** — if requested, surface 3-4 key architectural decisions with recommendations before generating (see [references/design-phase.md](references/design-phase.md))
4. **Create design document** with:
   - Overview
   - Architecture (with Mermaid diagrams)
   - Components and Interfaces
   - Data Models
   - API Design (if applicable)
   - Error Handling
   - Testing Strategy
   - Security & Performance Considerations
   - Requirements Traceability
5. **Ask for review:** "Does the design look good? If so, we can move on to the implementation plan."
6. **Iterate** until explicit approval received

---

## Phase 3: Task List

**Goal:** Create an actionable implementation plan with coding tasks for a code-generation LLM.

**Reference:** [references/tasks-phase.md](references/tasks-phase.md)

### Quick Steps

1. **Read requirements.md and design.md** before starting
2. **Create implementation plan** with:
   - Phases grouping related work
   - Numbered checkbox tasks (max 2 levels: 1.1, 1.2, 2.1)
   - Each task references specific requirements
   - Each task is completable by a coding agent
3. **Exclude non-coding tasks:** No deployment, user testing, documentation, etc.
4. **Ask for review:** "Do the tasks look good?"
5. **After approval:** Proceed to Phase 4 for execution

---

## Phase 4: Execution

**Goal:** Execute tasks one at a time, validating each against requirements and design before marking complete.

**Reference:** [references/execution-phase.md](references/execution-phase.md)

### Execution Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                    EXECUTION CYCLE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. READ ALL SPECS (mandatory)                                  │
│     ├─► requirements.md (WHAT to build)                         │
│     ├─► design.md (HOW to build)                                │
│     └─► tasks.md (WHAT task is next)                            │
│                         │                                       │
│  2. IDENTIFY NEXT TASK                                          │
│     └─► Find first unchecked: - [ ] X.X Task description        │
│                         │                                       │
│  3. EXECUTE ONLY THAT TASK                                      │
│     └─► Implement following design patterns                     │
│                         │                                       │
│  4. VALIDATE (before marking complete)                          │
│     ├─► Requirements: All acceptance criteria satisfied?        │
│     ├─► Design: Architecture and patterns followed?             │
│     └─► Quality: Tests passing? Linting clean?                  │
│                         │                                       │
│  5. MARK COMPLETE                                               │
│     └─► Update: - [ ] → - [x]                                   │
│                         │                                       │
│  6. STOP AND REPORT                                             │
│     └─► Wait for user before next task                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Critical Execution Rules

| Rule | Description |
|------|-------------|
| **Read First** | ALWAYS read all 3 spec files before ANY execution |
| **One at a Time** | Execute exactly ONE task, then STOP |
| **Sub-tasks First** | If task has sub-tasks, complete those first |
| **Validate Before Marking** | Never mark complete without validation passing |
| **Wait for User** | After completing a task, wait for user review |

### Validation Checklist (Quick)

Before marking any task complete:

```markdown
Level 1: Requirements
- [ ] All referenced requirement IDs addressed
- [ ] All EARS acceptance criteria satisfied
- [ ] Edge cases handled

Level 2: Design  
- [ ] Component architecture followed
- [ ] Data models match specification
- [ ] Interfaces implemented correctly

Level 3: Quality
- [ ] Tests written and passing
- [ ] Linting passes
- [ ] No errors or warnings
```

### Completion Report Template

After each task:

```markdown
Completed task {number}: {description}

Requirements Validation:
- REQ-{ID}: {brief verification}

Design Validation:
- Follows {pattern} from design.md

Quality Validation:
- Tests passing
- No errors

Ready for next task when you are.
```

---

## Phase 5: Lifecycle Management

**Goal:** Manage spec status transitions after implementation is complete.

**Reference:** [references/lifecycle-phase.md](references/lifecycle-phase.md)

### Quick Commands

| Command | Purpose | Result |
|---------|---------|--------|
| "complete spec" | Mark all tasks done | Move to completed/ directory |
| "archive spec" | Mark obsolete/abandoned | Move to archived/ directory |
| "list specs" | Show all specs | Display grouped by status |

### When to Use

- **Complete:** All tasks in tasks.md are checked, feature is implemented
- **Archive:** Spec is obsolete, superseded, or abandoned
- **List:** See what specs exist and their current status

### Key Points

- Completed specs become reference documentation for future work
- Archived specs are kept for historical reference
- Specs can be referenced across lifecycle states
- Directory location indicates status (no metadata parsing needed)

**See [references/lifecycle-phase.md](references/lifecycle-phase.md) for detailed workflows and examples.**

---

## Critical Constraints

### DO
- Generate initial documents from rough ideas (don't ask 20 questions first)
- Ask for explicit approval at each phase transition
- Reference specific requirements in design and tasks
- Keep all research context in conversation (not separate files)
- Read .specflow/project.md before starting any spec work (for conventions and context)
- If .specflow/project.md doesn't exist, create it first by asking the user for tech stack and conventions
- Read ALL spec files before executing any task
- Validate every implementation against requirements and design
- Update checkboxes only after validation passes
- STOP after each task and wait for user
- Move specs to completed/ when all tasks are done
- Check completed/ specs for related context when creating new specs

### DON'T
- Proactively explain the specflow workflow before the user asks — just start generating
- Skip phases or combine multiple steps
- Proceed without explicit user approval
- Execute multiple tasks without stopping
- Mark tasks complete without validation
- Modify requirements.md or design.md during execution (read-only)
- Include non-coding tasks in the implementation plan
- Delete specs - archive them instead for historical reference
- Leave completed work in active/ directory

---

## Troubleshooting Quick Reference

| Issue | Solution |
|-------|----------|
| Requirements stalled | Suggest moving to different aspect, provide options, summarize gaps |
| Missing context | Ask targeted questions, suggest user provide examples, propose defaults |
| Scope creep | Redirect to original boundaries, add to "Out of Scope", suggest splitting |
| Design too complex | Break into smaller components, focus on core first, suggest phases |
| Research limitations | Document missing info, suggest alternatives, continue with available info |
| Tasks too large | Break down, add verification steps, ensure each is atomic |
| Can't find spec | Ask user for feature name, verify .specflow/specs/{name}/ exists |
| Task unclear | Check requirements.md and design.md for context, ask if still unclear |
| Validation fails | Fix issues before marking complete, report specific failures |
| Test failures | Debug and fix, do not proceed until tests pass |
| Dependency missing | Report blocker, suggest resolution, wait for user guidance |
