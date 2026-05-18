# Laralag Architecture Reference

## Package Location

Installed via Composer at `vendor/abianbiya/laralag/`.
GitHub: https://github.com/abianbiya/laralag

Do not modify files under `vendor/` — changes are overwritten on `composer update`.

## Directory Structure

All paths below are relative to `vendor/abianbiya/laralag/`.

```
src/
├── Commands/
│   ├── GenerateModule.php          # CRUD generator (lag:module)
│   ├── GenerateApiModule.php       # API generator (lag:api)
│   ├── GenerateMigration.php       # Migration generator (lag:migration)
│   ├── LaralagInstall.php          # Installation (lag:install)
│   ├── RunLaralagSeeder.php        # Seeder runner (lag:seed)
│   └── SyncPermission.php          # Permission sync (lag:sync-permission)
├── Controllers/
│   └── HomeController.php          # Dashboard & role switching
├── Helpers/
│   ├── AutoloadHelper.php          # Global helpers: can(), get(), actionButton(), tanggal(), rupiah(), setting()
│   └── Logger.php                  # Activity logging trait
├── Livewire/
│   ├── Auth/
│   │   ├── Login.php               # Login with role selection
│   │   ├── Register.php            # Registration with avatar upload
│   │   ├── ForgetPassword.php      # Password reset email
│   │   └── NewPassword.php         # Password reset form
│   ├── Forms/LoginForm.php         # Rate-limited login form
│   └── Actions/Logout.php          # Session invalidation
├── Middleware/
│   └── CheckPermission.php         # Route permission guard
├── Modules/                        # Built-in CRUD modules
│   ├── User/
│   ├── Role/
│   ├── Permission/
│   ├── Menu/
│   ├── MenuGroup/
│   ├── Module/
│   ├── RoleUser/
│   ├── Scope/
│   ├── Log/
│   ├── PermissionRole/
│   ├── ConfigGroup/                # Config group CRUD (config-group.*)
│   └── Config/                     # Settings page + config item CRUD (configitem.*)
├── Seeders/                        # Initial data seeders
├── Traits/
│   ├── HasPermissions.php          # RBAC trait for User model
│   ├── HasAuditTrail.php           # Auto-fills created_by/updated_by/deleted_by
│   └── IntrospectTable.php         # DB table introspection for generators
├── View/Components/
│   └── Sidebar.php                 # Permission-filtered sidebar
├── LaralagServiceProvider.php      # Service provider
└── LaralagFacade.php               # Facade
```

## Service Provider Registration

LaralagServiceProvider registers:
- Asset publishing to `public/lag`
- Config publishing `config/laralag.php`
- View namespace: `Laralag`
- Migration loading
- Route loading
- Livewire component registration (auth.login, auth.register, auth.forget-password, auth.new-password)
- Module loader (package + app modules from `app/Modules/`)
- Route middleware: `permission` => CheckPermission
- Gate authorization via hasPermission

## Module Pattern

Each module (both built-in and generated) follows:
```
{ModuleName}/
├── Controllers/{ModuleName}Controller.php
├── Models/{ModuleName}.php
├── Views/
│   ├── {slug}.blade.php          # Index/list
│   ├── {slug}_detail.blade.php   # Show
│   ├── {slug}_create.blade.php   # Create form
│   └── {slug}_update.blade.php   # Edit form
└── routes.php
```

Generated modules go to `app/Modules/` and are auto-loaded by appModuleLoader().

## Database Conventions

- All tables use UUID primary keys
- All tables include: `created_at`, `updated_at`, `deleted_at` (soft deletes)
- All tables include audit columns: `created_by`, `updated_by`, `deleted_by`
- Models use traits: `SoftDeletes`, `HasUuids`, `HasAuditTrail`

## RBAC Flow

```
User Login → Role Selection → Permissions cached in session
  → CheckPermission middleware validates per-route
  → Sidebar component filters menus by permissions
  → actionButton() helper checks can($route)
```

Session keys:
- `active_role` / `active_role_name` - current role
- `active_scope` / `active_scope_name` - optional scope
- `active_permissions` - array of permission slugs
- `user_role_list` - available roles for switching

## Menu Hierarchy

```
MenuGroup (sections in sidebar)
  └── Menu (navigation items with icons)
       └── Module (sub-items linked to routes + permissions)
```

Display filtered by: `is_tampil` flag AND user's active permissions.

## setting() Helper

Global function defined in `vendor/abianbiya/laralag/src/Helpers/AutoloadHelper.php`. Full documentation in the main skill guide (Config Management Module section).

```php
setting('key')            // returns current_value ?? default_value
setting('key', 'default') // with explicit fallback
```

Caches all config rows under `'laralag-config'` for 1 hour; cache cleared automatically on `ConfigController::update()`.

## Config Options (config/laralag.php)

| Key | Default | Purpose |
|-----|---------|---------|
| `permissions.ignored_routes` | `['front.index', 'landing.index']` | Routes exempt from permission check |
| `home_route` | `'dashboard.index'` | Post-login redirect |
| `landing_route` | `'home.index'` | Landing page route |
| `has_landing` | `false` | Show landing or redirect to login |
| `dashboard_blade` | `''` | Custom dashboard template |
| `custom_login_blade` | `''` | Custom login view |
| `custom_register_blade` | `''` | Custom register view |
| `app_name` | `env('APP_NAME', 'Laralag')` | Application name |
| `app_short_name` | `env('APP_SHORT_NAME', 'LAG')` | Short name for logo |
| `theme_customizer_enabled` | `env('THEME_CUSTOMIZER_ENABLED', false)` | Enable theme customizer |
| `use_bootstrap_pagination` | `true` | Bootstrap vs Tailwind pagination |

## Route Structure

### Public
- `GET /login` - Livewire Login
- `GET /register` - Livewire Register
- `GET /forget-password` - Password reset
- `GET /new-password/{email?}/{token?}` - New password
- `GET /logout` - Logout
- `GET /index/{locale}` - Language switching

### Protected
- `GET /dashboard` - Dashboard (name: `dashboard.index`)
- `GET /change/role/{slugRole}/{scope?}` - Role switching
- Module CRUD routes: `GET|POST|PATCH|DELETE /{slug}/*` with permission middleware
