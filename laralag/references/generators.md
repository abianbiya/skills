# Laralag Generators Reference

## Naming Conventions

| Module arg (StudlyCase) | URL slug (kebab-case) | Table (snake_case plural) | Permission/route prefix |
|---|---|---|---|
| `Product` | `product` | `products` | `product` |
| `OrderItem` | `order-item` | `order_items` | `order-item` |
| `UserProfile` | `user-profile` | `user_profiles` | `user-profile` |

- Module name must be **StudlyCase**; the generator derives all other forms automatically
- URLs, route names, and permission slugs use **kebab-case**
- Tables use **snake_case plural** — override with `--table=` when the inferred name differs

## Commands Overview

| Command | Signature | Purpose |
|---------|-----------|---------|
| `lag:install` | `lag:install` | Run migrations, publish assets/config, seed data |
| `lag:module` | `lag:module {name} {--no-menu} {--menuOnly} {--api} {--table=} {--hasFile} {--force}` | Generate full CRUD module (menu + Root perms + optimize by default) |
| `lag:api` | `lag:api {module} {--force}` | Generate API controller for existing module |
| `lag:migration` | `lag:migration {name} {--table=}` | Generate migration with UUID + audit columns |
| `lag:seed` | `lag:seed` | Run all Laralag seeders |
| `lag:sync-permission` | `lag:sync-permission` | Sync route permissions to database |

## lag:module - Full CRUD Generator

### Usage
```bash
php artisan lag:module Product                          # CRUD + menu + Root perms + optimize
php artisan lag:module Product --table=products --api   # With API controller
php artisan lag:module Product --no-menu                # Skip menu creation
php artisan lag:module Product --force                  # Overwrite existing
```

### Options
- `{name}` - Module name in StudlyCase (e.g., `Product`, `OrderItem`)
- `--no-menu` - Skip menu creation (menu is created by default)
- `--menuOnly` - Only create menu entry, skip module generation
- `--api` - Also generate API controller
- `--table=` - Override inferred table name
- `--hasFile` - Include file upload handling: adds `enctype="multipart/form-data"` to create/edit forms, a file input field, `Storage::disk('public')->put()` in `store()`/`update()`, and a file link in the detail view. The column that stores the file path must already exist in the migration before running the generator.
- `--force` - Overwrite existing files

### Default Behavior
1. Generates CRUD files (controller, model, views, routes)
2. Creates 7 permissions and **assigns them to the Root role** automatically
3. Creates menu entry (prompts for MenuGroup selection)
4. Runs `php artisan optimize` to rebuild caches

### Generated Files
```
app/Modules/{Name}/
├── Controllers/{Name}Controller.php   # Full CRUD with validation
├── Models/{Name}.php                  # Eloquent with relations
├── Views/
│   ├── {slug}.blade.php               # Index list
│   ├── {slug}_detail.blade.php        # Detail view
│   ├── {slug}_create.blade.php        # Create form
│   └── {slug}_update.blade.php        # Edit form
└── routes.php                         # CRUD routes with permissions
```

### What It Does
1. Introspects database table via `IntrospectTable` trait
2. Detects column types and generates appropriate form fields:
   - `varchar/string` → text input
   - `text` → rich editor textarea
   - `integer` → number input
   - `bigint` → numeric text (currency/nominal)
   - `date` → date picker
   - `datetime` → datetime picker
   - `tinyint` → select (Yes/No)
   - FK columns (`_id`/`_slug`) → select with related model data
3. Generates validation rules (required/nullable, types)
4. Creates 7 permissions: `{slug}.index`, `{slug}.create`, `{slug}.store`, `{slug}.show`, `{slug}.edit`, `{slug}.update`, `{slug}.destroy`
5. Assigns all permissions to the Root role via `PermissionRole`
6. Creates Menu and Module entries by default (skip with `--no-menu`)
7. Runs `php artisan optimize`

### Controller Pattern
```php
class ProductController extends Controller
{
    use Logger;

    private $log = 'Product';
    private $title = 'Product';

    public function index(Request $request) {
        $data = Product::whereAny(['name','description'], 'LIKE', '%'.$request->cari.'%')
            ->paginate(10);
        return view('Product::product', compact('data'));
    }

    public function create() {
        $forms = [
            'name' => ['Name', html()->text('name')->class('form-control')],
            'category_id' => ['Category', html()->select('category_id', Category::pluck('name','id'))
                ->class('form-control tomselect')],
        ];
        return view('Product::product_create', compact('forms'));
    }

    public function store(Request $request) {
        $request->validate([...]);
        Product::create($request->only([...]));
        return redirect()->route('product.index');
    }
    // ... show, edit, update, destroy
}
```

### Model Pattern
```php
class Product extends Model
{
    use SoftDeletes, HasUuids, HasAuditTrail;

    protected $table = 'products';
    protected $fillable = ['name', 'category_id', ...];

    public function category() {
        return $this->belongsTo(Category::class);
    }
}
```

### Route Pattern
```php
Route::controller(ProductController::class)->middleware(['web','auth'])->group(function() {
    Route::get('/product', 'index')->name('product.index')->middleware('permission:product.index');
    Route::get('/product/create', 'create')->name('product.create')->middleware('permission:product.create');
    Route::post('/product', 'store')->name('product.store')->middleware('permission:product.store');
    Route::get('/product/{product}', 'show')->name('product.show')->middleware('permission:product.show');
    Route::get('/product/{product}/edit', 'edit')->name('product.edit')->middleware('permission:product.edit');
    Route::patch('/product/{product}', 'update')->name('product.update')->middleware('permission:product.update');
    Route::delete('/product/{product}', 'destroy')->name('product.destroy')->middleware('permission:product.destroy');
});
```

## lag:api - API Controller Generator

### Usage
```bash
php artisan lag:api Product
php artisan lag:api Product --force
```

### Generated File
`app/Modules/{Name}/Controllers/Api{Name}Controller.php`

### API Controller Pattern
```php
class ApiProductController extends Controller
{
    public function index() {
        return response()->json([
            'success' => true,
            'message' => 'Product list',
            'data' => Product::paginate(20)
        ]);
    }

    public function store(Request $request) {
        $request->validate([...]);
        $item = Product::create($request->only([...]));
        return response()->json([...], 201);
    }
    // ... show, update, destroy
}
```

### API Routes (appended to routes.php)
```php
Route::prefix('api/product')->middleware(['api','auth:sanctum'])->group(function() {
    Route::get('/', [ApiProductController::class, 'index'])->name('api.product.index');
    Route::post('/', [ApiProductController::class, 'store'])->name('api.product.store');
    // ...
});
```

## lag:migration - Smart Migration Generator

### Usage
```bash
php artisan lag:migration Product
php artisan lag:migration OrderItem --table=order_items
```

### Generated Migration
```php
Schema::create('products', function (Blueprint $table) {
    $table->uuid('id')->primary();
    // TODO: Add your custom columns here
    $table->timestamps();
    $table->softDeletes();
    $table->string('created_by', 36)->nullable();
    $table->string('updated_by', 36)->nullable();
    $table->string('deleted_by', 36)->nullable();
});
```

## lag:sync-permission

Scans all routes with `permission:` middleware and creates/updates Permission records:
- Auto-identifies action types (index, create, store, show, edit, update, destroy)
- Auto-generates Indonesian names (e.g., "Melihat daftar Product")
- Groups permissions by resource

## Stubs

Located at `vendor/abianbiya/laralag/resources/stubs/` inside the package. Do not edit these directly — modify the generated output in `app/Modules/` instead. Stub list for reference:
- `controller.plain.stub` - Web CRUD controller
- `controller.api.stub` - API REST controller
- `model.plain.stub` - Eloquent model
- `blade.plain.stub` - Index/list view
- `detail.plain.stub` - Detail view
- `form.plain.stub` - Create/edit form
- `route.plain.stub` - Web routes
- `route.api.stub` - API routes
- `migration.create.stub` - Database migration

### Stub Placeholders
| Token | Replaced With |
|-------|--------------|
| `Kelas` / `DummyModel` | Model class name (StudlyCase) |
| `selug` / `dummy-slug` | URL slug (kebab/snake case) |
| `JudulKolom` | Table column headers |
| `IsiKolom` | Table column content |
| `JmlKolom` | Total column count |
| `DetailData` | Detail view rows |
| `SearchableColumn` | Searchable field list |
| `//FormValidation//` | Validation rules array |
| `//ModelField//` | Fillable field assignments |
| `FormAction` | Form action URL |
| `FormParam` | Form parameters |
| `FormMethod` | HTTP method override |

## Typical Workflow

```bash
# 1. Generate migration
php artisan lag:migration Product

# 2. Edit migration - add columns
# 3. Run migration
php artisan migrate

# 4. Generate full CRUD module with API (menu + Root perms + optimize auto-included)
php artisan lag:module Product --table=products --api

# 5. Access at /product (Root role already has all permissions)
```
