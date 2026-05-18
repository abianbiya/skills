# Laralag RBAC & Menu System Reference

## Database Schema

### Tables
```
users          - System users (UUID PK, username, email, name, identitas)
role           - Role definitions (slug, nama, tags)
permission     - Individual permissions (slug, nama, group, action)
scope          - Organizational boundaries (slug, nama, akronim, kode)
permission_role - Role ↔ Permission junction (permission_id, role_id)
role_user       - User ↔ Role junction (user_id, role_id, scope_id nullable)
menu_group     - Sidebar sections (nama, nama_en, urutan, is_tampil)
menu           - Navigation items (menu_group_id, nama, icon, urutan, is_tampil)
module         - Sub-items (menu_id, nama, routing, permission, urutan, is_tampil)
log            - Audit trail (user_id, aktivitas, route, action, context, data, ip)
```

## RBAC Components

### HasPermissions Trait (User model)

Apply to User model: `use HasPermissions;`

**Relations:**
- `roles()` - belongsToMany Role via role_user with scope_id
- `roleUsers()` - hasMany RoleUser

**Key Methods:**
```php
$user->hasPermission('product.index');     // Check permission (from session)
$user->setActiveRole('admin', 'sales');    // Set active role + scope in session
$user->syncPermission($role);              // Load permissions into session
$user->getActiveRole();                    // Get current role slug
$user->getActiveRoleName();                // Get current role name
$user->getActiveScope();                   // Get current scope slug
$user->getActiveScopeName();               // Get scope acronym
$user->getRoleList();                      // Array of user's roles for dropdown
$user->setRoleList();                      // Populate role list in session
$user->assignRole('admin', 'sales');       // Create role-user association
$user->revokeRole('admin', 'sales');       // Soft-delete role-user association
```

**Session Keys:**
| Key | Type | Content |
|-----|------|---------|
| `active_role` | string | Current role slug |
| `active_role_name` | string | Display name |
| `active_scope` | string | Scope slug (optional) |
| `active_scope_name` | string | Scope acronym |
| `active_permissions` | array | Permission slugs |
| `user_role_list` | array | Available roles for switching |

### CheckPermission Middleware

Registered as `permission` middleware in service provider.

**Usage in routes:**
```php
Route::get('/product', 'index')->middleware('permission:product.index');
```

**Flow:**
1. Check if user is authenticated (redirect to login if not)
2. Extract permission slug from middleware parameter
3. Call `$user->hasPermission($slug)` (checks session)
4. Abort 403 if denied

### Gate Authorization

Service provider registers Gate:
```php
Gate::define('hasPermission', function($user, $permission) {
    return $user->hasPermission($permission);
});
```

### Permission Conventions

Per module, 7 standard permissions:
| Slug | Action | Indonesian Name |
|------|--------|----------------|
| `{module}.index` | index | Melihat daftar {Module} |
| `{module}.create` | create | Menambahkan {Module} |
| `{module}.store` | store | Menyimpan {Module} |
| `{module}.show` | show | Melihat detail {Module} |
| `{module}.edit` | edit | Mengedit {Module} |
| `{module}.update` | update | Memperbarui {Module} |
| `{module}.destroy` | destroy | Menghapus {Module} |

### Scope System

Scopes enable multi-tenant role assignment:
- Same user can have different roles per scope
- Example: "Manager" in "Sales" scope, "Viewer" in "Operations" scope
- Scope is optional - roles work without scopes
- Fields: `slug`, `nama`, `akronim`, `kode`

## Menu System

### Hierarchy
```
MenuGroup (sidebar section header)
  └── Menu (nav item with icon)
       └── Module (sub-item with route + permission)
```

### Sidebar Component (View/Components/Sidebar.php)

Loads menus filtered by user's active permissions:
```php
MenuGroup::with(['menu.module' => function($query) use ($permissions) {
    $query->whereIn('permission', $permissions->pluck('slug')->toArray());
}])
->whereHas('menu.module', function($query) use ($permissions) {
    $query->whereIn('permission', $permissions->pluck('slug')->toArray());
})
->where('is_tampil', 1)
->orderBy('urutan')
->get();
```

### Default Menu Structure (Seeded)

**Menu Utama** (Main Menu, urutan: 1)
- Dashboard, User Management, Role Management

**Pengaturan Aplikasi** (App Settings, urutan: 9)
- Menu Management, Module Management, Menu Groups

**Peralatan Sistem** (System Tools, urutan: 10)
- Activity Logs

### Adding Menu via Generator

```bash
php artisan lag:module Product
# Menu is created by default — no flag needed.
# Use --no-menu to skip, --menuOnly to create only the menu without generating module files.
# Prompts: "Select Menu Group (1-3):"
# Creates Menu entry and Module entry with permission link
```

### Manual Menu Management

Via admin UI at `/menu`, `/menugroup`, `/module`:
- CRUD operations for all menu entities
- Set ordering via `urutan` field
- Toggle visibility via `is_tampil`
- Link modules to routes and permissions

## Helper Functions

### AutoloadHelper.php

```php
can('product.index')                    // Gate check for permission
get('active_role')                      // Get session value
actionButton('product.edit', $id, 'Edit')  // Generate CRUD action button
customButton(...)                       // Custom button with icon/class
tanggal($date, $includeDay)            // Indonesian date format
waktu($datetime, $format)              // Indonesian datetime format
rupiah($amount)                        // Currency: Rp 1.000.000
```

### Logger Trait

```php
use Logger;

$this->log($request, 'Created product', 'product', $data);
// Records: user_id, name, activity, route, action, context, data, IP, user agent
```

## HasAuditTrail Trait

Auto-populates on model events:
- `creating` → `created_by` = Auth::id()
- `updating` → `updated_by` = Auth::id()
- `deleting` → `deleted_by` = Auth::id()
- `restoring` → clears `deleted_by`

## Initial Seeded Data

**Users:** admin (admin@mail.com)
**Roles:** Root (full access), Admin
**Permissions:** ~70+ permissions (7 per module x 10 modules)
**Role Assignments:** Root role gets all permissions, Admin user gets both roles

## Auth Flow (Livewire)

1. **Login** (`Livewire\Auth\Login`) - Validates, authenticates, sets first role as active, syncs permissions, redirects to `home_route`
2. **Register** (`Livewire\Auth\Register`) - Creates user with optional avatar upload, redirects to login
3. **Forget Password** (`Livewire\Auth\ForgetPassword`) - Sends reset email with token
4. **New Password** (`Livewire\Auth\NewPassword`) - Validates token, updates password
5. **Logout** (`Livewire\Actions\Logout`) - Invalidates session, regenerates token
6. **Role Switching** - `GET /change/role/{slugRole}/{scope?}` via HomeController
