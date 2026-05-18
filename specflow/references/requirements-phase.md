# Requirements Phase

## Overview

Transform a rough feature idea into structured requirements using user stories and EARS acceptance criteria.

## Prerequisites

- Read `.specflow/project.md` for project-level context (tech stack, conventions, patterns)
- This provides consistency across all specs

## Document Location

Create `.specflow/specs/active/{feature_name}/requirements.md`

---

## Grilling Mode (Optional)

Analyze the feature idea and surface the questions that would most change the spec if answered differently. Questions are contextual — they emerge from reasoning about the specific feature, not a fixed template. Present them as a single block, each paired with your recommendation and brief reasoning.

### What to Look For

- **Ambiguities** — things the user stated that could be interpreted multiple ways
- **Race conditions and concurrency** — what happens when two users do the same thing simultaneously?
- **Edge cases** — what happens at the boundaries of the happy path?
- **Hidden decisions** — assumptions you're about to bake into the spec that the user might not share
- **Integration constraints** — third-party systems that impose rules the user may not have considered

**Example (billiard booking app with Midtrans payment):**

```
1. Race conditions on table booking
   If two users book the same table at the same time, how should this be handled?
   My recommendation: hold the slot only after payment confirms — first completed payment wins,
   the second gets "table unavailable" immediately. This avoids double-bookings at the cost of
   no soft-hold during checkout. Does that match your expectation?

2. Booking cancellation and refunds
   Can users cancel a booking, and what's the refund policy?
   My assumption: cancellable up to X hours before the slot, with a configurable refund window.
   You'll want to define this clearly since it directly affects the Midtrans flow.

3. Table availability unit
   Is a booking per-table or per-time-slot across all tables?
   My assumption: per-table — users pick a specific table and a time slot.
   Is that right, or do users just book "a table" and one gets assigned?
```

After the user answers, use their confirmed intent as the foundation for requirements.md — then continue to Step 1.

---

## Step 1: Initial Generation

Generate requirements from the rough idea **WITHOUT asking sequential questions first** (unless grilling mode was requested).

### Consider These Aspects:
- **Functional requirements**: What the system must do
- **Non-functional requirements**: Performance, security, scalability
- **Edge cases**: Error states, boundary conditions
- **User experience**: Accessibility, usability
- **Technical constraints**: Platform limitations, integrations
- **Success criteria**: How to measure feature completion

---

## Step 2: Document Structure

### Complete Template

```md
# Requirements Document: [Feature Name]

## Introduction

[2-3 paragraph summary covering:]
- What the feature does
- Why it's needed (business value)
- Who will use it (target users)
- High-level scope boundaries

## Requirements

### Requirement 1: [Descriptive Name]

**User Story:** As a [role], I want [feature], so that [benefit]

#### Acceptance Criteria

1. WHEN [trigger event occurs] THEN the system SHALL [expected behavior]
2. IF [precondition exists] THEN the system SHALL [expected behavior]
3. [system] SHALL [always-applicable behavior]

#### Notes
- [Optional implementation hints]
- [Related dependencies or constraints]

---

### Requirement 2: [Descriptive Name]

**User Story:** As a [role], I want [feature], so that [benefit]

#### Acceptance Criteria

1. WHEN [event] AND [condition] THEN the system SHALL [response]
2. WHEN [event] THEN the system SHALL [response]

---

## Out of Scope

- [Explicitly list what this feature does NOT include]
- [Helps prevent scope creep]

## Assumptions

- [List assumptions made during requirements gathering]
- [Technical assumptions about existing infrastructure]

## Dependencies

- [Other features or systems this depends on]
- [External services or APIs required]
```

---

## EARS Format Reference

EARS (Easy Approach to Requirements Syntax) provides consistent, testable requirements.

### Pattern Types

| Pattern | Template | Use Case | Example |
|---------|----------|----------|---------|
| **Ubiquitous** | The system SHALL [response] | Always applies | The system SHALL encrypt all user passwords |
| **Event-Driven** | WHEN [event] THEN the system SHALL [response] | Triggered by specific events | WHEN user clicks Submit THEN the system SHALL validate the form |
| **Conditional** | IF [condition] THEN the system SHALL [response] | State-dependent behavior | IF user is authenticated THEN the system SHALL display the dashboard |
| **Combined** | WHEN [event] AND IF [condition] THEN the system SHALL [response] | Complex triggers | WHEN payment fails AND IF retry count < 3 THEN the system SHALL retry the transaction |
| **Optional** | WHERE [feature included] the system SHALL [response] | Feature variations | WHERE premium plan active the system SHALL enable advanced analytics |

### Writing Good EARS Criteria

**DO:**
- Use active voice ("the system SHALL")
- Be specific and measurable
- Include one behavior per criterion
- Reference testable outcomes

**DON'T:**
- Use vague terms ("quickly", "easily", "user-friendly")
- Combine multiple behaviors in one criterion
- Leave ambiguous conditions

---

## Step 3: Review Process

After creating/updating requirements:

1. **Present the document** with a summary of what's covered
2. **Ask explicitly:** "Do the requirements look good? If so, we can move on to the design."
3. **Handle feedback:**
   - Make requested modifications
   - Ask for approval again after each iteration
4. **Only proceed** to Design phase after explicit approval ("yes", "approved", "looks good", etc.)

