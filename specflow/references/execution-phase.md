# Execution Phase

## Overview

Execute implementation tasks one at a time, validating each against requirements and design specifications before marking complete. This phase ensures traceability and quality throughout implementation.

**Key Principle:** Execute ONE task at a time, validate against specs, mark complete, then STOP.

## Prerequisites

- All three spec documents must exist and be approved:
  - `.specflow/project.md` (project-level context)
  - `.specflow/specs/active/{feature_name}/requirements.md`
  - `.specflow/specs/active/{feature_name}/design.md`
  - `.specflow/specs/active/{feature_name}/tasks.md`
- Check `.specflow/specs/completed/` for related specs that may provide context

---

## Step 1: Read All Specs (Mandatory)

Before executing ANY task, read all relevant documents:

```markdown
1. project.md - Understand project conventions, tech stack, patterns
2. requirements.md - Understand WHAT to build and WHY
3. design.md - Understand HOW to build (architecture, patterns)
4. tasks.md - Understand WHAT task to execute next
5. Related specs (if referenced) - Check completed/ for context
```

**Why this matters:**
- Project.md defines conventions and standards to follow
- Requirements define acceptance criteria for validation
- Design defines architecture and patterns to follow
- Tasks define execution order and dependencies
- Related specs provide context from previous work

Read all specs at the start of an execution session. Re-read only if the session was interrupted and context was lost.


---

## Step 2: Identify Next Task

Scan tasks.md to find the first unchecked task:

```markdown
First unchecked box: - [ ] {task number} {task description}
```

### If user specifies a task number:
- Jump to that specific task
- Verify it's unchecked
- Check that dependencies (previous tasks) are complete

### Sub-task handling:
```markdown
- [ ] 1. Parent Task
  - [ ] 1.1 Sub-task A  ← Execute this first
  - [ ] 1.2 Sub-task B  ← Then this
- [ ] 2. Next Parent    ← Only after 1.1 and 1.2 complete
```

**Rule:** Complete all sub-tasks before marking parent complete.

---

## Step 3: Execute the Task

Implement the task following these guidelines:

### 3.1 Check Requirements Reference

Find which requirements this task addresses:
```markdown
- [ ] 2.1 Implement User model - _Requirements: 1.1, 1.2_
```

Read those specific requirements and their acceptance criteria.

### 3.2 Follow Design Patterns

Check design.md for:
- Component architecture (which layer/module?)
- Data models (correct schema?)
- Interfaces (correct method signatures?)
- Error handling strategy

### 3.3 Match Codebase Conventions

- Follow existing code style
- Use established patterns
- Maintain consistency

### 3.4 Write Tests

If task involves testable logic:
- Write unit tests for new functionality
- Cover happy path and error cases
- Ensure tests pass before proceeding

---

## Step 4: Validate Implementation

**DO NOT mark task complete until validation passes.**

### Level 1: Requirements Validation

For each requirement ID referenced in the task:

1. **Locate the requirement** in requirements.md
2. **Check each acceptance criterion:**

```markdown
✓ WHEN user enters valid credentials THEN system SHALL authenticate
  → Does code authenticate valid credentials? YES/NO
  
✓ IF authentication fails THEN system SHALL display error message
  → Does code return error on invalid credentials? YES/NO
```

3. **Validation checklist:**
- [ ] All acceptance criteria from referenced requirements implemented
- [ ] Edge cases from requirements handled
- [ ] Error conditions addressed
- [ ] Success conditions work correctly


### Level 2: Design Validation

Verify implementation follows design.md:

**Architecture:**
- [ ] Code is in correct layer (frontend/backend/data)
- [ ] Code is in correct module/package
- [ ] Proper separation of concerns

**Data Models:**
- [ ] Correct schema/structure used
- [ ] Proper relationships maintained
- [ ] Required fields present

**Interfaces:**
- [ ] Correct method signatures
- [ ] Expected parameters
- [ ] Return types match

**Patterns:**
- [ ] API endpoints match design
- [ ] Error handling follows strategy
- [ ] State management matches specification

### Level 3: Quality Validation

**Testing:** Run the project's test command (from project.md or package.json/Makefile/etc.)
- [ ] Tests exist for new functionality
- [ ] All tests passing

**Linting:** Run the project's lint command
- [ ] No linting errors

**Type Checking (if applicable):** Run the project's type check command
- [ ] No type errors

**Functionality:**
- [ ] Code runs without errors
- [ ] No console errors or warnings

---

## Step 5: Mark Task Complete

Only after ALL validation levels pass:

```markdown
Before:  - [ ] 1.1 Create User model
After:   - [x] 1.1 Create User model
```

Update the tasks.md file with the completed checkbox.

---

## Step 6: Report and STOP

Report completion to user:

```markdown
Completed task {number}: {description}

Requirements Validation:
- REQ-{ID}: {brief verification}
- All acceptance criteria satisfied

Design Validation:
- Follows {architecture pattern}
- Uses {specified technology}
- Implements {interface} correctly

Quality Validation:
- Tests passing ({X} tests)
- Linting passed
- No errors or warnings

Implementation:
- {file path}: {brief description}

Ready for next task when you are.
```

**STOP HERE.** Do not proceed to next task without user approval.


---

## Special Cases

### Case 1: Task References Multiple Requirements

```markdown
- [ ] 1.3 Implement login endpoint - Requirements: 1.1, 1.2, 2.1
```

Validate against ALL referenced requirements before marking complete.

### Case 2: Blocked Task

If task cannot be completed due to:
- Missing dependency
- Unclear requirement
- Technical blocker

**Action:**
1. Report the blocker clearly
2. Suggest resolution options
3. Do NOT mark task complete
4. Wait for user guidance

### Case 3: Task Needs Clarification

If task description is ambiguous:

1. Check requirements.md for context
2. Check design.md for architectural guidance
3. If still unclear, ask user for clarification
4. Optionally update tasks.md with clarified description
5. Then proceed with execution

### Case 4: Validation Fails

**DO NOT mark task complete.**

```markdown
Task {number} validation failed:

Issues found:
- Requirement 1.2 criterion 2 not satisfied
- Tests failing: 3/10 tests fail
- Linting errors: 5 style violations

Fixing issues...
```

Fix all issues, then re-validate before marking complete.

### Case 5: All Tasks Complete

When no unchecked tasks remain:

```markdown
All implementation tasks completed.

Summary:
- {X} tasks completed
- All requirements addressed
- All tests passing

Next step: use "complete spec" to move this to completed/ and make it reference documentation.
```

