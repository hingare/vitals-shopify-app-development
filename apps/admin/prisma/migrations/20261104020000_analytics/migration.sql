-- CreateTable
CREATE TABLE "DailyToolStat" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "addToCarts" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "DailyToolStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyToolStat_shopId_toolId_date_key" ON "DailyToolStat"("shopId", "toolId", "date");

-- AddForeignKey
ALTER TABLE "DailyToolStat" ADD CONSTRAINT "DailyToolStat_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

