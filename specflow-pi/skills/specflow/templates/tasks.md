---
status: active
gate: review
---

# {Feature name} — approved-scope plan

## Outcome
{One sentence describing the user outcome.}

## Experience/reference
{Path or description.}

Provenance: sample | simulated | live

## Effective settings
- Assurance: {1–10}
- Delivery target: {prototype | mvp | production}
- Review cadence: {milestone | task}
- Planning detail: {concise | detailed}

## 1. {First demonstrable milestone outcome}

- [ ] 1.1 {One logical implementation outcome}
  - Scope: {code/data behavior included in the approved slice}
  - Criteria: AC1
  - Verify: {meaningful checks and user-path evidence}

- [ ] 1.2 {Demonstrate the user outcome}
  - Depends on: 1.1
  - Criteria: AC1
  - Verify: {normal-path integration, experience review, and evidence boundary}

**Milestone demo:** {short walkthrough}

**Milestone limits:** {what is not yet delivered or verified}

## 2. {Next in-scope milestone — repeat only when the scope needs another increment}

- [ ] 2.1 {Executable outcome for the next agreed slice}
  - Depends on: 1.2
  - Criteria: AC2, AC3
  - Verify: {focused checks and integration with earlier work}

## Final integration and handoff — part of the last milestone

- [ ] {Next task ID} {Join the complete app and prepare user instructions}
  - Depends on: {all required prior tasks}
  - Criteria: {criteria covered by the end-to-end journey}
  - Verify: {fresh start, representative data, main journey, important states}

Include documentation, sample data, setup/access steps, or other handoff work when the delivery requires it. For a one-milestone plan, put final integration and handoff tasks in milestone 1. Do not create empty milestone sections or tasks for inapplicable work.

## Deferred roadmap — outside the approved delivery target

- {Future outcome and the trigger to reconsider it.}

## Decisions to resolve

- Proposed: {choice awaiting confirmation, if any.}
- Open: {material question still requiring discovery, if any.}

## Approval

- Assignment mode: {implementation | planning | prototype | evaluation}
- Approved artifact/reference: {path or description}
- Plan baseline: {this file/revision or other stable identifier}
- Effective settings: {repeat the selected values}
- Included scope: {exact scope}
- Deferred: {explicit deferrals}
- Execution authority requested: {none | all in-scope tasks through handoff | exact milestone/task range}
- User approval recorded: {not yet approved | approved as requested | approved bounded scope | declined/changed; record exact user decision and date/session when known}
- Authorized execution: {none until approval is recorded | all in-scope tasks through handoff | exact approved milestone/task range}
- Orchestration: {serial | parallel allowed for independent tasks; delegation boundary}
- Separately gated actions: {deployment, paid services, publication, destructive production changes, or none}
- Validation boundary: {concrete evidence boundary}
- Provenance and limitations: {sample/live/unverified details}
- Pending decision: {state the exact plan/decision and requested execution authority, or none}
