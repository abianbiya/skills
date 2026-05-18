# Phase 5: Lifecycle Management

This phase handles spec status transitions after the core workflow (Phases 1-4) is complete. Specs move through lifecycle states via directory organization, with metadata tracked in frontmatter.

---

## Lifecycle States

```
active/      → Specs currently being developed (Phases 1-4)
completed/   → All tasks done, serves as reference documentation
archived/    → Obsolete or abandoned specs, kept for historical reference
```

---

## Commands Overview

| Command | Purpose | From State | To State |
|---------|---------|------------|----------|
| "new spec" | Create new spec | - | active |
| "complete spec" | Mark all tasks done | active | completed |
| "archive spec" | Mark obsolete/abandoned | active or completed | archived |
| "list specs" | Show all specs by status | - | - |
| "continue spec" | Resume work on spec | active | active |

---

## Command: Complete Spec

**Trigger Phrases:**
- "complete the spec"
- "mark spec as complete"
- "finish the spec"
- "move spec to completed"

**Prerequisites:**
- Spec must be in `active/` directory
- All tasks in tasks.md should be checked (`- [x]`)

**Workflow:**

1. **Identify the spec**
   - If only one active spec exists, use it
   - If multiple active specs, ask user which one
   - If user specified name, find that spec


2. **Validate task completion**
   ```
   Read tasks.md
   Count total tasks: [ ] and [x]
   Count completed tasks: [x]
   
   If incomplete:
     → Warn: "X of Y tasks incomplete. Complete anyway? (yes/no)"
     → If no: exit
     → If yes: continue
   ```

3. **Add completion metadata**
   ```markdown
   ---
   status: completed
   created_at: YYYY-MM-DD
   completed_at: YYYY-MM-DD  # Today's date
   ---
   ```
   - If frontmatter doesn't exist, create it
   - If frontmatter exists, update it
   - Use ISO date format (YYYY-MM-DD)

4. **Move directory**
   ```
   From: .specflow/specs/active/{feature-name}/
   To:   .specflow/specs/completed/{feature-name}/
   ```
   - Use file system move operation
   - Preserve all files (requirements.md, design.md, tasks.md)

5. **Confirm to user**
   ```
   Spec '{feature-name}' completed.
   - Moved to: .specflow/specs/completed/{feature-name}/
   - Completed: {date}
   - This spec is now reference documentation
   ```

**Error Handling:**
- If spec not found: "No active spec named '{name}'. Use 'list specs' to see available specs."
- If already completed: "Spec '{name}' is already in completed/. Nothing to do."
- If move fails: "Failed to move spec. Check file permissions and try again."

---

## Command: Archive Spec

**Trigger Phrases:**
- "archive the spec"
- "archive {spec-name}"
- "move spec to archived"
- "mark spec as obsolete"

**Prerequisites:**
- Spec must be in `active/` or `completed/` directory

**Workflow:**

1. **Identify the spec**
   - Check both active/ and completed/ directories
   - If user specified name, find that spec
   - If ambiguous, ask user to clarify

2. **Prompt for reason**
   ```
   "Why are you archiving this spec?"
   
   Common reasons:
   - Superseded by another spec
   - Feature abandoned
   - Requirements changed
   - Merged into another feature
   ```
   - Wait for user response
   - Store reason for metadata


3. **Add archive metadata**
   ```markdown
   ---
   status: archived
   created_at: YYYY-MM-DD
   completed_at: YYYY-MM-DD  # If was completed
   archived_at: YYYY-MM-DD   # Today's date
   archive_reason: "User's reason here"
   ---
   ```

4. **Move directory**
   ```
   From: .specflow/specs/{active|completed}/{feature-name}/
   To:   .specflow/specs/archived/{feature-name}/
   ```

5. **Confirm to user**
   ```
   Spec '{feature-name}' archived.
   - Moved to: .specflow/specs/archived/{feature-name}/
   - Reason: {archive_reason}
   - Archived: {date}
   ```

**Error Handling:**
- If spec not found: "No spec named '{name}' in active/ or completed/."
- If already archived: "Spec '{name}' is already archived."
- If no reason provided: Prompt again or use default "No reason provided"

---

## Command: List Specs

**Trigger Phrases:**
- "list specs"
- "show all specs"
- "what specs exist"
- "show completed specs"
- "show active specs"

**Workflow:**

1. **Scan directories**
   ```
   active/     → List all subdirectories
   completed/  → List all subdirectories
   archived/   → List all subdirectories (optional)
   ```

2. **Read metadata** (optional, for enhanced display)
   - Read tasks.md frontmatter for dates
   - Count tasks: total vs completed
   - Extract archive reason if archived

3. **Display grouped by status**
   ```
   Spec Status Overview

   ACTIVE (2):
   - add-2fa-to-auth (3/5 tasks)
   - refactor-api-layer (0/8 tasks)

   COMPLETED (5):
   - user-authentication (completed 2024-01-15)
   - api-foundation (completed 2024-01-10)
   - database-schema (completed 2024-01-08)
   - email-notifications (completed 2024-01-12)
   - payment-integration (completed 2024-01-14)

   ARCHIVED (1):
   - old-auth-flow (archived 2024-01-16: "Superseded by user-authentication")
   ```

**Variations:**
- "show active specs" → Only show active section
- "show completed specs" → Only show completed section
- "show archived specs" → Only show archived section


---

## Command: Continue Spec

**Trigger Phrases:**
- "continue the spec"
- "resume {spec-name}"
- "work on {spec-name}"
- "continue working on the spec"

**Workflow:**

1. **Identify the spec**
   - If user specified name, find in active/
   - If only one active spec, use it
   - If multiple, list and ask user to choose

2. **Determine current phase**
   ```
   Check which files exist:
   - Only requirements.md → Phase 1 (review requirements)
   - requirements.md + design.md → Phase 2 (review design)
   - requirements.md + design.md + tasks.md → Phase 4 (execute tasks)
   ```

3. **Load context**
   - Read project.md for conventions
   - Read requirements.md, design.md, tasks.md
   - Check for referenced specs in completed/

4. **Resume workflow**
   ```
   "Resuming '{feature-name}'..."
   
   Current status:
   - Phase: {phase}
   - Tasks: {completed}/{total}
   - Next: {next_action}
   
   Ready to continue!
   ```

5. **Proceed with appropriate phase**
   - If in Phase 4: Show next unchecked task
   - If in Phase 1-3: Resume review/approval cycle

---

## Frontmatter Format

Tasks.md frontmatter is added automatically during lifecycle transitions:

### Active Spec (optional frontmatter)
```markdown
---
status: active
created_at: 2024-01-10
---
```

### Completed Spec
```markdown
---
status: completed
created_at: 2024-01-10
completed_at: 2024-01-15
---
```

### Archived Spec
```markdown
---
status: archived
created_at: 2024-01-10
completed_at: 2024-01-15  # If was completed first
archived_at: 2024-01-20
archive_reason: "Superseded by new-auth-flow spec"
---
```

**Notes:**
- Frontmatter is YAML format between `---` delimiters
- Must be at the very top of tasks.md
- Dates use ISO format (YYYY-MM-DD)
- Status field matches directory location
- Archive reason is required for archived specs


---

## Integration with Phases 1-4

The lifecycle commands integrate with the existing workflow:

```
Phase 1: Requirements → Phase 2: Design → Phase 3: Tasks → Phase 4: Execute
                                                                    ↓
                                                            All tasks done?
                                                                    ↓
                                                            "complete spec"
                                                                    ↓
                                                            Move to completed/
                                                                    ↓
                                                            Becomes reference
```

**Key Points:**
- Lifecycle management happens AFTER Phase 4
- Specs stay in active/ during Phases 1-4
- Completion is explicit, not automatic
- Archived specs can be referenced but not modified

---

## Best Practices

1. **Complete specs promptly**
   - Mark specs complete when all tasks are done
   - Don't leave completed work in active/

2. **Archive thoughtfully**
   - Always provide a clear reason
   - Archive superseded specs to reduce clutter
   - Keep completed specs that may be referenced

3. **Reference completed specs**
   - Link to completed specs in new requirements
   - Use relative paths: `../completed/{spec-name}/`
   - Read completed specs for context during execution

4. **Use descriptive names**
   - Feature names should be clear and specific
   - Use kebab-case: `add-2fa-to-auth` not `auth2`
   - Avoid generic names like `update` or `fix`

5. **Maintain project.md**
   - Keep project.md up to date
   - Update when conventions change
   - Reference it in specs when relevant

---

## Examples

### Example 1: Complete a spec
```
User: "complete the 2fa spec"

AI: 
Found spec: add-2fa-to-auth
Checking tasks... 8/8 tasks complete
Adding completion metadata...
Moving to completed/

Spec 'add-2fa-to-auth' completed.
- Moved to: .specflow/specs/completed/add-2fa-to-auth/
- Completed: 2024-01-15
- This spec is now reference documentation
```

### Example 2: Archive an obsolete spec
```
User: "archive the old-auth-flow spec"

AI: "Why are you archiving this spec?"

User: "It was superseded by the new user-authentication spec"

AI:
Found spec in completed/: old-auth-flow
Adding archive metadata...
Moving to archived/

Spec 'old-auth-flow' archived.
- Moved to: .specflow/specs/archived/old-auth-flow/
- Reason: Superseded by the new user-authentication spec
- Archived: 2024-01-16
```


### Example 3: List all specs
```
User: "list specs"

AI:
Spec Status Overview

ACTIVE (2):
- add-2fa-to-auth (8/8 tasks) — ready to complete
- refactor-api-layer (3/12 tasks)

COMPLETED (3):
- user-authentication (completed 2024-01-15)
- api-foundation (completed 2024-01-10)
- email-notifications (completed 2024-01-12)

ARCHIVED (1):
- old-auth-flow (archived 2024-01-16: "Superseded by user-authentication")
```

