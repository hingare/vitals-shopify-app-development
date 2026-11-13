-- Shopify-র হিসাবে চেকআউট শেষ কবে বদলেছে: দেরিতে আসা পুরনো webhook নতুন তথ্যের উপর বসে না
ALTER TABLE "AbandonedCheckout" ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3);
