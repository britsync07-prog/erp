-- AlterTable
ALTER TABLE "PurchaseRequirement" ADD COLUMN "orderId" TEXT;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN "deliveryAddress" TEXT;

-- CreateTable
CREATE TABLE "StockGuard" (
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("productId", "warehouseId")
);

-- CreateIndex
CREATE INDEX "PurchaseRequirement_orderId_idx" ON "PurchaseRequirement"("orderId");
