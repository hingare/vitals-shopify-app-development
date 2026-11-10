-- COD অর্ডার ফর্ম প্ল্যান থেকে বাদ গেছে, তাই তার দুটো টেবিল আর লাগে না।
-- আগের মাইগ্রেশন ডেভ ডাটাবেসে চলে গেছে বলে সেটা না বদলে এখানে আলাদা করে মোছা হলো।

-- DropForeignKey
ALTER TABLE "CodOrder" DROP CONSTRAINT "CodOrder_shopId_fkey";

-- DropForeignKey
ALTER TABLE "CodOtp" DROP CONSTRAINT "CodOtp_shopId_fkey";

-- DropTable
DROP TABLE "CodOrder";

-- DropTable
DROP TABLE "CodOtp";
