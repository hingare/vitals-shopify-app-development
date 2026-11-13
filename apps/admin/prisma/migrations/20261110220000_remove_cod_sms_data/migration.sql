-- বাদ পড়া তিন টুলের (COD ফর্ম, WhatsApp অর্ডার বাটন, অর্ডার SMS) পড়ে থাকা তথ্য মুছে ফেলা হলো:
-- সেভ করা সেটিংস, SMS gateway-র সংযোগ (এনক্রিপ্ট করা চাবিসহ) আর SMS বার্তার সারি (ফোন নম্বর থাকে)।

DELETE FROM "ToolSetting" WHERE "toolId" IN ('cod-form', 'whatsapp-order', 'order-sms');

DELETE FROM "Integration" WHERE "provider" = 'sms';

DELETE FROM "Message" WHERE "channel" = 'sms';
