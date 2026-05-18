# AI Agent Skills

A curated collection of skills I've built and refined for Claude Code and AI coding agents. Each skill extends an agent's capabilities with specialized workflows, domain knowledge, and structured processes.

## What are skills?

Skills are instruction sets that activate when you invoke a slash command in Claude Code (e.g. `/specflow`). They give the agent a complete, opinionated workflow for a specific domain — so you don't have to re-explain the process every time.

## Available Skills

### [specflow](./specflow/)

Spec-driven development orchestrator. Transforms a rough feature idea into structured requirements, a technical design, an implementation task list, and guides execution task-by-task with validation at each step.

**Workflow:** Requirements → Design → Tasks → Execution → Lifecycle management

**Best for:** Any feature where you want to think before you code — especially mid-to-large features where scope creep and missed requirements are real risks.

---

## Coming Soon

| Skill | Description |
|-------|-------------|
| `myunnes-base` | Conventions, patterns, and domain knowledge for the UNNES base system |
| `laralag` | Expert guide for the Laralag Laravel package — CRUD generation and RBAC |

---

## How to Use

1. Copy a skill folder (e.g. `specflow/`) into your project's skill directory or your global Claude Code skills path
2. Invoke it with the matching slash command (e.g. `/specflow`)
3. Follow the prompts

Each skill folder contains a `SKILL.md` (the core instructions) and a `references/` directory with detailed phase guidance.

---

## Author

Built by [Abi Anbiya](https://github.com/abianbiya) — Software Developer at Universitas Negeri Semarang, exploring AI-assisted software development.
