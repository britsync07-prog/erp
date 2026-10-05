-- AlterTable
ALTER TABLE "PurchaseRequirement" ADD COLUMN "poId" TEXT;

-- CreateIndex
CREATE INDEX "PurchaseRequirement_poId_idx" ON "PurchaseRequirement"("poId");
