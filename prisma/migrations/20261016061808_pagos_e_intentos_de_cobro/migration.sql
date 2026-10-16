-- AlterTable
ALTER TABLE "stores" ADD COLUMN "transfer_alias" TEXT;
ALTER TABLE "stores" ADD COLUMN "transfer_holder" TEXT;

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sale_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amount" REAL NOT NULL,
    "reference" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "qr_data" TEXT,
    "failure_reason" TEXT,
    "expires_at" DATETIME,
    "created_by_id" INTEGER NOT NULL,
    "confirmed_by_id" INTEGER,
    "resolved_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "payment_intents_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payment_intents_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_reference_key" ON "payment_intents"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_idempotency_key_key" ON "payment_intents"("idempotency_key");

-- CreateIndex
CREATE INDEX "payment_intents_sale_id_idx" ON "payment_intents"("sale_id");

-- CreateIndex
CREATE INDEX "payment_intents_store_id_status_idx" ON "payment_intents"("store_id", "status");

-- CreateIndex
CREATE INDEX "payment_intents_status_idx" ON "payment_intents"("status");
