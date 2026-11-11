-- Back in Stock: প্রোডাক্ট বদলের প্রতিটা webhook-এ দেখা হয় সেই প্রোডাক্টের জন্য কেউ অপেক্ষায় আছে কিনা।
CREATE INDEX "StockAlert_shopId_productId_status_idx" ON "StockAlert"("shopId", "productId", "status");
