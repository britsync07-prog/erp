-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AutomationRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL DEFAULT 'demo-org',
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "condition" TEXT,
    "action" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_AutomationRule" ("action", "condition", "id", "isEnabled", "name", "trigger") SELECT "action", "condition", "id", "isEnabled", "name", "trigger" FROM "AutomationRule";
DROP TABLE "AutomationRule";
ALTER TABLE "new_AutomationRule" RENAME TO "AutomationRule";
CREATE INDEX "AutomationRule_orgId_trigger_idx" ON "AutomationRule"("orgId", "trigger");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
