# Tasks Phase

## Overview

Create an actionable implementation plan with a checklist of coding tasks that a code-generation LLM can execute in a test-driven manner.

## Prerequisites

- Design document must exist and be **approved**
- Read both `.specflow/specs/active/{feature_name}/requirements.md` and `.specflow/specs/active/{feature_name}/design.md` before starting

## Document Location

Create `.specflow/specs/active/{feature_name}/tasks.md`

---

## Step 1: Task Generation Principles

Convert the feature design into prompts for a code-generation LLM. Follow these principles:

### DO
- Prioritize best practices and clean code
- Ensure incremental progress (no big jumps in complexity)
- Emphasize test-driven development where appropriate
- Make each task build on previous tasks
- Reference specific requirements for traceability
- Ensure all code is integrated (no orphaned code)

### DON'T
- Include non-coding activities
- Create tasks that can't be verified through code
- Skip testing steps
- Leave code hanging without integration

---

## Step 2: Document Structure

### Complete Template

```md
# Implementation Plan: [Feature Name]

## Overview

[Brief summary of the implementation approach and key milestones]

---

## Phase 1: Foundation

### 1. Project Structure and Core Interfaces

- [ ] 1.1 Create directory structure
  - Create feature directory with subdirectories for models, services, repositories, and API components
  - Add module entry points for clean imports
  - _Requirements: 1.1_

- [ ] 1.2 Define core interfaces and types
  - Write interfaces/schemas for all entities
  - Define service contracts with method signatures
  - Create shared type definitions
  - Write unit tests for validation logic
  - _Requirements: 1.1, 1.2_

---

## Phase 2: Data Layer

### 2. Data Models and Validation

- [ ] 2.1 Implement [Entity] model
  - Create model class with properties
  - Implement validation methods
  - Add factory methods for creation
  - Write unit tests for validation logic
  - _Requirements: 2.1_

- [ ] 2.2 Implement [Entity] repository
  - Create repository interface
  - Implement CRUD operations
  - Add query methods
  - Write integration tests for database operations
  - _Requirements: 2.1, 2.2_


---

## Phase 3: Business Logic

### 3. Service Implementation

- [ ] 3.1 Implement [Feature] service
  - Create service class implementing interface
  - Implement core business logic methods
  - Add input validation
  - Handle error cases
  - Write unit tests with mocked dependencies
  - _Requirements: 3.1, 3.2_

- [ ] 3.2 Add service integration
  - Wire up service with repository
  - Implement dependency injection
  - Write integration tests for full flow
  - _Requirements: 3.1_

---

## Phase 4: API Layer

### 4. API Endpoints

- [ ] 4.1 Implement [POST/GET/etc] [endpoint] endpoint
  - Create route handler
  - Implement request validation
  - Add response formatting
  - Handle error responses
  - Write API tests
  - _Requirements: 4.1_

- [ ] 4.2 Add authentication/authorization
  - Implement auth middleware
  - Add permission checks
  - Write auth tests
  - _Requirements: 4.2_

---

## Phase 5: Integration

### 5. Wire Everything Together

- [ ] 5.1 Complete integration
  - Connect all layers
  - Verify dependency injection
  - Run full integration tests
  - _Requirements: All_

- [ ] 5.2 Final verification
  - Run all tests
  - Check code coverage
  - Verify linting passes
  - _Requirements: All_

---

## Notes

- Each task should be completable in isolation
- Run tests after each task before proceeding
- If a task fails, fix before moving to next task
```

---

## Task Structure Rules

### Hierarchy
- **Maximum 2 levels** of hierarchy
- **Top-level items** (phases/epics) for grouping related work
- **Sub-tasks** use decimal notation (1.1, 1.2, 2.1)
- Keep structure as simple as possible


### Task Formatting

Each task MUST include:

| Element | Description | Example |
|---------|-------------|---------|
| **Checkbox** | Track completion | `- [ ]` |
| **Number** | Unique identifier | `1.1`, `2.3` |
| **Title** | Clear action description | "Implement User model with validation" |
| **Sub-bullets** | Specific steps | "Write User class with validation methods" |
| **Requirements** | Traceability reference | `_Requirements: 1.2, 3.1_` |

### Task Quality Checklist

Each task must be:
- [ ] **Specific**: Clear about what code to write/modify
- [ ] **Testable**: Can verify completion through tests
- [ ] **Incremental**: Builds on previous work
- [ ] **Atomic**: Completes one logical unit of work
- [ ] **Traceable**: References specific requirements

---

## Excluded Task Types

These tasks should **NEVER** appear in the implementation plan:

| Excluded Activity | Why Excluded |
|-------------------|--------------|
| User acceptance testing | Requires human users |
| Deployment to production/staging | Infrastructure task |
| Performance metrics gathering | Post-deployment activity |
| Manual E2E testing | Cannot be automated by coding agent |
| User training | Non-coding activity |
| Documentation creation | Unless specifically requested |
| Business process changes | Organizational task |
| Marketing/communication | Non-coding activity |

**Rule of thumb:** If a coding agent cannot complete it by writing/modifying/testing code, exclude it.

---

## Step 3: Review Process

After creating/updating tasks:

1. **Present the document** with summary of phases and total task count
2. **Ask explicitly:** "Do the tasks look good?"
3. **Handle feedback:**
   - Make requested modifications
   - Ask for approval again after each iteration
4. **After approval:**
   - Inform user: "You can begin executing tasks. Start with task 1.1."
   - Remind: "Execute one task at a time, then verify before proceeding."

---

## Workflow Completion

After tasks are approved, proceed to Phase 4: Execution. Once all tasks are complete, proceed to Phase 5: Lifecycle to mark the spec as complete.

```
The implementation plan is complete and approved. 

Ready to begin execution:
- Execute one task at a time
- Each task will be validated against requirements and design
- Tasks are marked complete only after validation passes

After all tasks are done:
- Use "complete spec" to move to completed/ directory
- The spec becomes reference documentation

Would you like to start with task 1.1?
```

