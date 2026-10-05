-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FulfilmentLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fulfilmentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "requiredQty" REAL NOT NULL,
    "pickedQty" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "FulfilmentLine_fulfilmentId_fkey" FOREIGN KEY ("fulfilmentId") REFERENCES "Fulfilment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FulfilmentLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_FulfilmentLine" ("fulfilmentId", "id", "pickedQty", "productId", "requiredQty") SELECT "fulfilmentId", "id", "pickedQty", "productId", "requiredQty" FROM "FulfilmentLine";
DROP TABLE "FulfilmentLine";
ALTER TABLE "new_FulfilmentLine" RENAME TO "FulfilmentLine";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
