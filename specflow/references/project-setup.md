# Project Setup

## Overview

`.specflow/project.md` is the global context file for all specs in a project. It defines the tech stack, conventions, and patterns that every spec should follow. Read it before starting any spec work.

## When to Create

Create `.specflow/project.md` at the start of the first spec if it doesn't exist yet. Ask the user for the information needed to fill it out.

**Prompt to use:**
> "Before we start, I need a quick project context file so specs stay consistent. What's the tech stack, and are there any conventions I should follow (naming, testing approach, directory structure)?"

---

## Template

```markdown
# Project Context

## Tech Stack

- **Language:** [e.g. Python 3.11, TypeScript 5, PHP 8.2]
- **Framework:** [e.g. FastAPI, Next.js, Laravel]
- **Database:** [e.g. PostgreSQL, MySQL, MongoDB]
- **Testing:** [e.g. pytest, Jest, PHPUnit]
- **Linting/Formatting:** [e.g. ruff, ESLint + Prettier, PHP-CS-Fixer]
- **Package manager:** [e.g. pip/poetry, npm/pnpm, composer]

## Commands

- **Run tests:** `[command]`
- **Run linter:** `[command]`
- **Type check:** `[command]` *(if applicable)*
- **Start dev server:** `[command]` *(if applicable)*

## Directory Structure

[Brief description of the project layout, e.g.:]
```
src/
  features/     # Feature modules
  shared/       # Shared utilities
  tests/        # Test files
```

## Conventions

- **Naming:** [e.g. snake_case for files and functions, PascalCase for classes]
- **Module structure:** [e.g. each feature has models/, services/, routes/]
- **Error handling:** [e.g. raise custom exceptions, use Result types]
- **Testing style:** [e.g. unit tests alongside source, integration tests in tests/]

## Related Patterns

[Any architectural patterns used, e.g. repository pattern, CQRS, service layer, MVC]

## Notes

[Anything else specs should be aware of — existing auth setup, third-party integrations, etc.]
```

---

## Keeping project.md Current

Update it when:
- The tech stack changes
- New conventions are adopted
- A major refactor changes the directory structure

It's a living document — specs from 6 months ago may have relied on different conventions. If a completed spec contradicts project.md, trust project.md.
