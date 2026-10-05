-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CreditNoteLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "noteId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    CONSTRAINT "CreditNoteLine_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "CreditNote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CreditNoteLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CreditNoteLine" ("description", "id", "noteId", "quantity", "unitPriceCents") SELECT "description", "id", "noteId", "quantity", "unitPriceCents" FROM "CreditNoteLine";
DROP TABLE "CreditNoteLine";
ALTER TABLE "new_CreditNoteLine" RENAME TO "CreditNoteLine";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
