---
name: laralag
description: "Expert guide for the Laralag Laravel package — CRUD generator and access management system. Use when: (1) Generating modules with lag:module, lag:api, lag:migration, (2) Working with RBAC (roles, permissions, scopes, CheckPermission middleware), (3) Managing menus/menu groups/modules in sidebar, (4) Modifying built-in modules (User, Role, Permission, Menu, MenuGroup, Module, RoleUser, Scope, Log, PermissionRole, ConfigGroup, Config), (5) Writing code following Laralag conventions, (6) Managing application settings via Config/ConfigGroup modules or setting() helper, (7) Using HasPermissions, HasAuditTrail, IntrospectTable traits, (8) Customizing stub templates, (9) Livewire auth flows, (10) Debugging permissions. Triggers: 'laralag', 'lag:module', 'lag:api', 'lag:migration', 'lag:install', 'lag:seed', 'lag:sync-permission', 'HasPermissions', 'HasAuditTrail', 'CheckPermission', 'actionButton', 'MenuGroup', 'setting()', 'ConfigGroup', 'config_group'."
---

# Laralag Development Guide

## Package Location

```
packages/abianbiya/laralag/
```

Generated app modules go to `app/Modules/`.

## Quick Reference

### Artisan Commands

```bash
lag:install                                          # Full setup: migrate + publish + seed
lag:module {Name} [--no-menu] [--menuOnly] [--api] [--table=] [--hasFile] [--force]  # Generate CRUD
lag:api {Name} [--force]                             # Generate API controller
lag:migration {Name} [--table=]                      # Generate migration with UUID + audit
lag:seed                                             # Run all Laralag seeders
lag:sync-permission                                  # Sync route permissions to DB
```

### Defaults

`lag:module` by default:
- Creates menu entry (prompts for MenuGroup selection) — skip with `--no-menu`
- Assigns all generated permissions to the Root role (slug: `root`)
- Runs `php artisan optimize` after generation

### Standard Workflow

```bash
php artisan lag:migration Product         # 1. Create migration
# Edit migration, add columns
php artisan migrate                       # 2. Run migration
php artisan lag:module Product --api      # 3. Generate CRUD + menu + Root perms + optimize
```

## Architecture

See [references/architecture.md](references/architecture.md) for full directory structure, service provider, config options, route structure, and module pattern.

Key points:
- Modules follow: `{Name}/Controllers/`, `{Name}/Models/`, `{Name}/Views/`, `{Name}/routes.php`
- All models use `SoftDeletes`, `HasUuids`, `HasAuditTrail`
- All tables have UUID PKs + `created_by`/`updated_by`/`deleted_by` audit columns
- Views extend `Laralag::layouts.master`
- Forms use spatie/laravel-html builder + TomSelect for selects

## Naming Conventions

| Module arg (StudlyCase) | URL slug (kebab-case) | Table (snake_case plural) | Permission/route prefix |
|---|---|---|---|
| `Product` | `product` | `products` | `product` |
| `OrderItem` | `order-item` | `order_items` | `order-item` |
| `UserProfile` | `user-profile` | `user_profiles` | `user-profile` |

- Module name argument must be **StudlyCase**
- Generated URLs, route names, and permission slugs use **kebab-case**
- Tables are inferred as **snake_case plural** — override with `--table=`

## Code Generation

See [references/generators.md](references/generators.md) for complete command reference, stub templates, placeholder tokens, and generated code patterns.

Key conventions when writing or modifying generated code:

### Controller Pattern
- Use `Logger` trait for audit logging
- `$log` and `$title` properties for module identification
- Search via `whereAny([columns], 'LIKE', '%'.$request->cari.'%')`
- Forms as array: `$forms = ['field' => ['Label', html()->input(...)]]`
- Validate in `store()`/`update()`, redirect with success message
- Paginate with 10 items

### Model Pattern
- Traits: `SoftDeletes`, `HasUuids`, `HasAuditTrail`
- Define `$table` and `$fillable`
- Relations: `belongsTo` for FK columns, method name = column without `_id`

### View Pattern
- Index: table with search, pagination, action buttons via `actionButton()`
- Detail: table rows of field-value pairs
- Create/Edit: loop `$forms` array, TomSelect for selects
- All extend `Laralag::layouts.master`, use `@section('content')`

### Route Pattern
- `Route::controller(XController::class)->middleware(['web','auth'])->group(...)`
- Each route has `->middleware('permission:{slug}.{action}')` and `->name('{slug}.{action}')`
- Standard 7 CRUD routes: index, create, store, show, edit, update, destroy
- API routes use `['api', 'auth:sanctum']` middleware with `api/` prefix

### File Upload (`--hasFile`)
Adds file upload scaffolding to the module:
- Forms get `enctype="multipart/form-data"` and a file input field
- Controller `store()`/`update()` handle `$request->file()` and store via `Storage::disk('public')->put()`
- Detail view displays the stored file path as a link
- The file path column must already exist in your migration before generating

## RBAC System

See [references/rbac.md](references/rbac.md) for complete RBAC, menu, auth, and helper function reference.

Key points:
- User model must `use HasPermissions`
- Permissions stored in session after login (not checked from DB per-request)
- Route protection: `->middleware('permission:product.index')`
- Gate: `can('product.index')` in views/controllers
- Sidebar auto-filters by user's active permissions
- Scopes enable multi-tenant role assignment (optional)
- 7 standard permissions per module: index, create, store, show, edit, update, destroy
- **Permission session cache:** permissions load at login — after changing role permissions the user must re-login or switch roles via `/change/role/{slug}` for changes to take effect
- Helpers: `can()`, `get()`, `actionButton()`, `tanggal()`, `waktu()`, `rupiah()`, `customButton()`

## Config Management Module

Laralag has a built-in database-backed settings system with two modules:

### ConfigGroup (`/config-group`)
Manages groups of settings. Each group has: `slug`, `nama`, `urutan`, `icon`, `is_tampil`.

- Route prefix: `config-group.*` (7 standard CRUD routes)
- **On create:** auto-generates `config-{slug}.index` and `config-{slug}.update` permissions and assigns them to the root role
- **On delete:** deletes associated `config` items and permissions

### Config Items (`/config-item/*`)
Individual settings within a group. Managed via `ConfigController` (not `ConfigGroupController`).

Fields: `config_group_id`, `key` (unique dot-notation e.g. `general.app_name`), `config_name`, `default_value`, `current_value`, `form_type`, `form_options` (JSON), `is_multiple`, `form_label`, `form_placeholder`, `form_help`, `validation_rules`, `urutan`, `is_tampil`.

Config item routes are in `src/Modules/Config/routes.php` and named `configitem.*`:
- `GET /config-item/create` → `configitem.create`
- `POST /config-item` → `configitem.store`
- `GET /config-item/{config}/edit` → `configitem.edit`
- `PATCH /config-item/{config}` → `configitem.update`
- `DELETE /config-item/{config}` → `configitem.destroy`

All `configitem.*` routes are gated under `config-group.*` permissions (same CRUD permission set).

Config item CRUD redirects back to `config-group.show` with the group's UUID.

### Settings Page (`/config`)
Tabbed UI showing one tab per ConfigGroup. Each tab contains a form with dynamically-rendered fields based on `form_type`. Only shows groups where user has `can('config-{slug}.index')`.

Routes:
- `GET /config` → `config.index` (permission: `config.index`)
- `POST /config/{group}` → `config.update` (permission checked in controller: `config-{slug}.update`)

Form types: `text`, `email`, `number`, `password`, `color`, `textarea`, `select`, `checkbox`, `toggle`, `file`.

### `setting()` Helper

```php
setting('general.app_name')         // returns current_value ?? default_value
setting('display.pagination', 10)   // with fallback default
```

- Caches all config values under key `'laralag-config'` for 1 hour
- Cache is cleared (`Cache::forget('laralag-config')`) on any `ConfigController::update()` call
- Defined in `src/Helpers/AutoloadHelper.php`

### Tables

**`config_group`**: id (uuid), slug (unique), nama, urutan, icon, is_tampil, audit cols, timestamps, soft deletes
**`config`**: id (uuid), config_group_id (uuid FK), key (unique), config_name, default_value, current_value, form_type, form_options (json), is_multiple, form_label, form_placeholder, form_help, validation_rules, urutan, is_tampil, audit cols, timestamps, soft deletes

### Permissions

Each config group slug generates two dynamic permissions: `config-{slug}.index` and `config-{slug}.update`.
Static permissions for the CRUD module itself: `config-group.index`, `config-group.create`, `config-group.store`, `config-group.show`, `config-group.edit`, `config-group.update`, `config-group.destroy`.
Settings page access: `config.index`.

---

## When Modifying the Package

### Adding a new built-in module
1. Create `src/Modules/{Name}/` with Controllers, Models, Views, routes.php
2. Follow existing module patterns (copy Role or User module)
3. Add seeder for initial data in `src/Seeders/`
4. Add permissions to `PermissionTableSeeder`
5. Add menu entries to `MenuTableSeeder` and `ModuleTableSeeder`

### Modifying stubs
- Stubs are at `resources/stubs/`
- Placeholder tokens are replaced by `GenerateModule` command
- Test changes by generating a module after editing

### Extending RBAC
- Add new session keys in `HasPermissions` trait
- Update `CheckPermission` middleware for new auth logic
- Update `Sidebar` component query for new visibility rules

### Adding application settings
Prefer the Config/ConfigGroup module over editing `config/laralag.php`:
1. Create a ConfigGroup via `/config-group/create`
2. Add Config Items via the group's detail page → "Tambah Config Item"
3. Read values in code with `setting('group-slug.key')`
4. The settings page at `/config` provides the admin UI for editing values

To add to `config/laralag.php` directly (for non-user-editable options):
- Add to `config/laralag.php`
- Reference via `config('laralag.your_key')`

---

## Debugging

### Permission denied (403)
1. Check the route middleware slug exactly matches: `->middleware('permission:product.index')`
2. Inspect the session: `dd(session('active_permissions'))` — the slug must appear in this array
3. Permissions are cached in session — after adding a permission to a role, the user must re-login or visit `/change/role/{slug}` to refresh
4. Run `php artisan lag:sync-permission` to ensure all route permissions exist in the database
5. Confirm the permission is assigned to the active role via the PermissionRole admin module

### Module not visible in sidebar
1. Check `is_tampil = 1` on the Menu, MenuGroup, and Module records
2. Confirm the Module's `permission` field matches a permission slug the user currently has
3. Verify the user's active role has the `{slug}.index` permission assigned

### Generated module returns 404
- Run `php artisan optimize` (or `php artisan route:clear && php artisan config:clear`) to rebuild caches
- Confirm `app/Modules/{Name}/routes.php` exists and was generated correctly

### `setting()` returns null
- Key must match the `key` column exactly (dot-notation, e.g., `'general.app_name'`)
- Use the second argument for a fallback: `setting('key', 'default')`
- Cache TTL is 1 hour — force a refresh with `Cache::forget('laralag-config')`
