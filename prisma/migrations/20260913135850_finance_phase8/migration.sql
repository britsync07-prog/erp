-- AlterTable
ALTER TABLE "CreditNote" ADD COLUMN "returnId" TEXT;

-- CreateIndex
CREATE INDEX "CreditNote_returnId_idx" ON "CreditNote"("returnId");
