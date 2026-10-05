/*
  Warnings:

  - Added the required column `orgId` to the `AIAction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orgId` to the `AIRecommendation` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AIAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "input" JSONB,
    "result" JSONB,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DONE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_AIAction" ("createdAt", "id", "input", "level", "result", "status", "tool", "userId") SELECT "createdAt", "id", "input", "level", "result", "status", "tool", "userId" FROM "AIAction";
DROP TABLE "AIAction";
ALTER TABLE "new_AIAction" RENAME TO "AIAction";
CREATE INDEX "AIAction_orgId_createdAt_idx" ON "AIAction"("orgId", "createdAt");
CREATE TABLE "new_AIRecommendation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB,
    "actionLink" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_AIRecommendation" ("actionLink", "createdAt", "evidence", "id", "kind", "reason", "status", "title") SELECT "actionLink", "createdAt", "evidence", "id", "kind", "reason", "status", "title" FROM "AIRecommendation";
DROP TABLE "AIRecommendation";
ALTER TABLE "new_AIRecommendation" RENAME TO "AIRecommendation";
CREATE INDEX "AIRecommendation_orgId_status_createdAt_idx" ON "AIRecommendation"("orgId", "status", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
