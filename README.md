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

## Installation

Uses [`npx skills`](https://github.com/vercel-labs/skills) — a universal CLI for installing agent skills from any GitHub repo.

**Install all skills:**
```bash
npx skills add abianbiya/skills
```

**Install a specific skill:**
```bash
npx skills add abianbiya/skills -s specflow
```

**Install globally** (available across all projects):
```bash
npx skills add abianbiya/skills -s specflow -g
```

### Update

Re-run the same command to pull the latest version.

### Manual install (fallback)

```bash
npx degit abianbiya/skills/specflow ~/.claude/skills/specflow
```

---

## How to Use

Once installed, invoke the skill with its slash command in Claude Code:

```
/specflow <your feature idea>
```

Each skill contains a `SKILL.md` (the core instructions) and a `references/` directory with detailed phase guidance.

---

## Author

Built by [Abi Anbiya](https://github.com/abianbiya) — Software Developer at Universitas Negeri Semarang, exploring AI-assisted software development.
