-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CreditNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "returnId" TEXT,
    "totalCents" INTEGER NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CreditNote" ("createdAt", "createdById", "customerId", "id", "number", "reason", "returnId", "status", "totalCents") SELECT "createdAt", "createdById", "customerId", "id", "number", "reason", "returnId", "status", "totalCents" FROM "CreditNote";
DROP TABLE "CreditNote";
ALTER TABLE "new_CreditNote" RENAME TO "CreditNote";
CREATE INDEX "CreditNote_returnId_idx" ON "CreditNote"("returnId");
CREATE UNIQUE INDEX "CreditNote_number_key" ON "CreditNote"("number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
