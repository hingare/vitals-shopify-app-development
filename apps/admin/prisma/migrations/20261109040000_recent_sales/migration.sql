-- CreateTable
CREATE TABLE "RecentSale" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "imageUrl" TEXT,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecentSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecentSale_shopId_soldAt_idx" ON "RecentSale"("shopId", "soldAt");

-- AddForeignKey
ALTER TABLE "RecentSale" ADD CONSTRAINT "RecentSale_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

