-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN "unit_cost" REAL;

-- Las ventas anteriores no guardaban el costo: se usa el costo actual del producto como aproximación
UPDATE "sale_items" SET "unit_cost" = (SELECT "cost" FROM "products" WHERE "products"."id" = "sale_items"."product_id");
