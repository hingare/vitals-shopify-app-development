-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "offerSettings" JSONB;

-- CreateTable
CREATE TABLE "OfferDailyStat" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "OfferDailyStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyAbStat" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "DailyAbStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfferDailyStat_shopId_offerId_date_key" ON "OfferDailyStat"("shopId", "offerId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyAbStat_shopId_group_date_key" ON "DailyAbStat"("shopId", "group", "date");

-- AddForeignKey
ALTER TABLE "OfferDailyStat" ADD CONSTRAINT "OfferDailyStat_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyAbStat" ADD CONSTRAINT "DailyAbStat_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

