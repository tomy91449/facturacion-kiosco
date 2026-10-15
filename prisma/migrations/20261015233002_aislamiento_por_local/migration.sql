-- Los datos cargados antes de esta migración se asignan a un "Local principal",
-- que se crea solo si existen productos, clientes o ventas y todavía no hay locales.
INSERT INTO "stores" ("name")
SELECT 'Local principal'
WHERE NOT EXISTS (SELECT 1 FROM "stores")
  AND (EXISTS (SELECT 1 FROM "products") OR EXISTS (SELECT 1 FROM "customers") OR EXISTS (SELECT 1 FROM "sales"));
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_customers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "store_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_customers" ("store_id", "address", "created_at", "email", "id", "name", "phone", "tax_id") SELECT (SELECT MIN("id") FROM "stores"), "address", "created_at", "email", "id", "name", "phone", "tax_id" FROM "customers";
DROP TABLE "customers";
ALTER TABLE "new_customers" RENAME TO "customers";
CREATE UNIQUE INDEX "customers_store_id_tax_id_key" ON "customers"("store_id", "tax_id");
CREATE TABLE "new_products" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "store_id" INTEGER NOT NULL,
    "barcode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "cost" REAL NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "min_stock" INTEGER NOT NULL DEFAULT 0,
    "category_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "products_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_products" ("store_id", "active", "barcode", "category_id", "cost", "created_at", "description", "id", "min_stock", "price", "stock", "updated_at") SELECT (SELECT MIN("id") FROM "stores"), "active", "barcode", "category_id", "cost", "created_at", "description", "id", "min_stock", "price", "stock", "updated_at" FROM "products";
DROP TABLE "products";
ALTER TABLE "new_products" RENAME TO "products";
CREATE INDEX "products_category_id_idx" ON "products"("category_id");
CREATE INDEX "products_store_id_active_stock_idx" ON "products"("store_id", "active", "stock");
CREATE UNIQUE INDEX "products_store_id_barcode_key" ON "products"("store_id", "barcode");
CREATE TABLE "new_sales" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "store_id" INTEGER NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customer_id" INTEGER,
    "total" REAL NOT NULL,
    "discount" REAL NOT NULL DEFAULT 0,
    "tax" REAL NOT NULL DEFAULT 0,
    "grand_total" REAL NOT NULL,
    "payment_method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sales_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_sales" ("store_id", "created_at", "customer_id", "date", "discount", "grand_total", "id", "notes", "payment_method", "status", "tax", "total") SELECT (SELECT MIN("id") FROM "stores"), "created_at", "customer_id", "date", "discount", "grand_total", "id", "notes", "payment_method", "status", "tax", "total" FROM "sales";
DROP TABLE "sales";
ALTER TABLE "new_sales" RENAME TO "sales";
CREATE INDEX "sales_store_id_date_idx" ON "sales"("store_id", "date");
CREATE INDEX "sales_date_idx" ON "sales"("date");
CREATE INDEX "sales_customer_id_idx" ON "sales"("customer_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
