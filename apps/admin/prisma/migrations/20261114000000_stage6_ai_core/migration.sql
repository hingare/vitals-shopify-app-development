-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "aiSettings" JSONB,
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "meter" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiGeneration" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "targetId" TEXT,
    "batchId" TEXT,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "previous" JSONB,
    "error" TEXT,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "AiGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_shopId_meter_month_key" ON "UsageCounter"("shopId", "meter", "month");

-- CreateIndex
CREATE INDEX "AiGeneration_shopId_toolId_createdAt_idx" ON "AiGeneration"("shopId", "toolId", "createdAt");

-- CreateIndex
CREATE INDEX "AiGeneration_shopId_targetId_idx" ON "AiGeneration"("shopId", "targetId");

-- CreateIndex
CREATE INDEX "AiGeneration_batchId_idx" ON "AiGeneration"("batchId");

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

