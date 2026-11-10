/**
 * ব্রাউজারেও নিরাপদ এমন ধ্রুবক (এখানে Node-এর কোনো মডিউল নেই), তাই অ্যাডমিন পেজের ফর্ম
 * `@app/integrations/constants` থেকে এগুলো আনতে পারে; বাকি প্যাকেজ শুধু সার্ভারে চলে।
 */
export const SMS_GATEWAYS = ["alpha-sms", "ssl-wireless", "bulksmsbd", "custom"] as const;
export type SmsGatewayId = (typeof SMS_GATEWAYS)[number];
