-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StockCount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "warehouseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockCount_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_StockCount" ("code", "createdAt", "createdById", "id", "status", "warehouseId") SELECT "code", "createdAt", "createdById", "id", "status", "warehouseId" FROM "StockCount";
DROP TABLE "StockCount";
ALTER TABLE "new_StockCount" RENAME TO "StockCount";
CREATE TABLE "new_StockCountLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "countId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "expectedQty" REAL NOT NULL,
    "countedQty" REAL,
    CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockCountLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_StockCountLine" ("countId", "countedQty", "expectedQty", "id", "productId") SELECT "countId", "countedQty", "expectedQty", "id", "productId" FROM "StockCountLine";
DROP TABLE "StockCountLine";
ALTER TABLE "new_StockCountLine" RENAME TO "StockCountLine";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
