-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "aiSettings" JSONB,
ADD COLUMN     "chatSeenAt" TIMESTAMP(3),
ADD COLUMN     "mcpId" TEXT,
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SeoMetaChange" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeoMetaChange_pkey" PRIMARY KEY ("id")
);

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
    "mediaKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "AiGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewSummary" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "pros" JSONB NOT NULL,
    "cons" JSONB NOT NULL,
    "reviewCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatConversation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "visitorKey" TEXT NOT NULL,
    "email" TEXT,
    "customerId" TEXT,
    "pagePath" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "status" TEXT NOT NULL DEFAULT 'open',
    "unread" INTEGER NOT NULL DEFAULT 0,
    "preview" TEXT NOT NULL DEFAULT '',
    "lastAuthor" TEXT NOT NULL DEFAULT 'visitor',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visitorSeenAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "alertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "customerId" TEXT,
    "device" TEXT NOT NULL DEFAULT 'desktop',
    "width" INTEGER,
    "height" INTEGER,
    "entryPath" TEXT NOT NULL DEFAULT '/',
    "pages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "firstEventAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "chunks" INTEGER NOT NULL DEFAULT 0,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "rawBytes" INTEGER NOT NULL DEFAULT 0,
    "parts" INTEGER NOT NULL DEFAULT 0,
    "storedBytes" INTEGER NOT NULL DEFAULT 0,
    "stopped" TEXT,
    "lastChunkAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordingChunk" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordingChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpClient" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "authMethod" TEXT NOT NULL DEFAULT 'none',
    "secretHash" TEXT,
    "logoUri" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpAuthRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "state" TEXT,
    "codeChallenge" TEXT NOT NULL,
    "scopes" TEXT[],
    "resource" TEXT NOT NULL,
    "shopId" TEXT,
    "codeHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "grantId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpAuthRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpGrant" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "clientId" TEXT,
    "name" TEXT NOT NULL,
    "scopes" TEXT[],
    "resource" TEXT,
    "accessHash" TEXT,
    "accessExpiresAt" TIMESTAMP(3),
    "refreshHash" TEXT,
    "refreshPrevHash" TEXT,
    "refreshedAt" TIMESTAMP(3),
    "keyHint" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpAction" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "grantId" TEXT,
    "assistant" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeoMetaChange_shopId_resourceId_field_key" ON "SeoMetaChange"("shopId", "resourceId", "field");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_shopId_meter_month_key" ON "UsageCounter"("shopId", "meter", "month");

-- CreateIndex
CREATE INDEX "AiGeneration_shopId_toolId_createdAt_idx" ON "AiGeneration"("shopId", "toolId", "createdAt");

-- CreateIndex
CREATE INDEX "AiGeneration_shopId_targetId_idx" ON "AiGeneration"("shopId", "targetId");

-- CreateIndex
CREATE INDEX "AiGeneration_batchId_idx" ON "AiGeneration"("batchId");

-- CreateIndex
CREATE INDEX "AiGeneration_createdAt_idx" ON "AiGeneration"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewSummary_shopId_productId_key" ON "ReviewSummary"("shopId", "productId");

-- CreateIndex
CREATE INDEX "ChatConversation_shopId_lastMessageAt_idx" ON "ChatConversation"("shopId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatConversation_shopId_visitorKey_key" ON "ChatConversation"("shopId", "visitorKey");

-- CreateIndex
CREATE INDEX "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Recording_shopId_createdAt_idx" ON "Recording"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "Recording_createdAt_idx" ON "Recording"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Recording_shopId_keyHash_key" ON "Recording"("shopId", "keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingChunk_recordingId_seq_key" ON "RecordingChunk"("recordingId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "McpClient_clientId_key" ON "McpClient"("clientId");

-- CreateIndex
CREATE INDEX "McpClient_createdAt_idx" ON "McpClient"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "McpAuthRequest_codeHash_key" ON "McpAuthRequest"("codeHash");

-- CreateIndex
CREATE INDEX "McpAuthRequest_createdAt_idx" ON "McpAuthRequest"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "McpGrant_accessHash_key" ON "McpGrant"("accessHash");

-- CreateIndex
CREATE UNIQUE INDEX "McpGrant_refreshHash_key" ON "McpGrant"("refreshHash");

-- CreateIndex
CREATE UNIQUE INDEX "McpGrant_refreshPrevHash_key" ON "McpGrant"("refreshPrevHash");

-- CreateIndex
CREATE INDEX "McpGrant_shopId_createdAt_idx" ON "McpGrant"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "McpAction_shopId_status_createdAt_idx" ON "McpAction"("shopId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "McpAction_createdAt_idx" ON "McpAction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_mcpId_key" ON "Shop"("mcpId");

-- AddForeignKey
ALTER TABLE "SeoMetaChange" ADD CONSTRAINT "SeoMetaChange_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewSummary" ADD CONSTRAINT "ReviewSummary_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingChunk" ADD CONSTRAINT "RecordingChunk_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpGrant" ADD CONSTRAINT "McpGrant_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpAction" ADD CONSTRAINT "McpAction_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

