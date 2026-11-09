-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "ingestKey" TEXT,
ADD COLUMN     "pixelEndpoint" TEXT,
ADD COLUMN     "pixelId" TEXT;

-- CreateTable
CREATE TABLE "SpeedJob" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SpeedJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyStoreStat" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "visitors" INTEGER NOT NULL DEFAULT 0,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "productViews" INTEGER NOT NULL DEFAULT 0,
    "addToCarts" INTEGER NOT NULL DEFAULT 0,
    "checkouts" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "DailyStoreStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyTrafficStat" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "visitors" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyTrafficStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPageStat" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "path" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyPageStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorDay" (
    "shopId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "visitor" TEXT NOT NULL,

    CONSTRAINT "VisitorDay_pkey" PRIMARY KEY ("shopId","date","visitor")
);

-- CreateIndex
CREATE INDEX "SpeedJob_status_createdAt_idx" ON "SpeedJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SpeedJob_shopId_createdAt_idx" ON "SpeedJob"("shopId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyStoreStat_shopId_date_key" ON "DailyStoreStat"("shopId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyTrafficStat_shopId_date_source_device_key" ON "DailyTrafficStat"("shopId", "date", "source", "device");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPageStat_shopId_date_path_key" ON "DailyPageStat"("shopId", "date", "path");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_ingestKey_key" ON "Shop"("ingestKey");

-- AddForeignKey
ALTER TABLE "SpeedJob" ADD CONSTRAINT "SpeedJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyStoreStat" ADD CONSTRAINT "DailyStoreStat_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTrafficStat" ADD CONSTRAINT "DailyTrafficStat_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPageStat" ADD CONSTRAINT "DailyPageStat_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorDay" ADD CONSTRAINT "VisitorDay_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

