-- CreateTable
CREATE TABLE "AppError" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastShop" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "AppError_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppError_fingerprint_key" ON "AppError"("fingerprint");

-- CreateIndex
CREATE INDEX "AppError_resolvedAt_lastSeenAt_idx" ON "AppError"("resolvedAt", "lastSeenAt");

-- CreateIndex
CREATE INDEX "AppError_notifiedAt_idx" ON "AppError"("notifiedAt");

-- CreateIndex
CREATE INDEX "AppError_lastSeenAt_idx" ON "AppError"("lastSeenAt");
