import type { ActionFunctionArgs } from "react-router";
import { isSnsUrl, parseSesEvent, verifySns, type SnsMessage } from "../lib/email-transport.server";
import { applyDeliveryEvent } from "../lib/messages.server";
import { readText } from "../lib/request.server";

/**
 * Amazon SES-এর ঘটনা SNS হয়ে আসে। SES configuration set-এর event destination হিসেবে একটা SNS topic দিন,
 * আর সেই topic-এ HTTPS subscription: <অ্যাপের URL>/webhooks/email/ses
 * SES_SNS_TOPIC_ARN-এ সেই topic-এর ARN রাখুন: শুধু সেই topic-এর বার্তা নেওয়া হয় (অন্য কারও AWS অ্যাকাউন্ট থেকে
 * বানানো বার্তা নয়), আর প্রতিটা বার্তার সই AWS-এর সার্টিফিকেট দিয়ে যাচাই হয়।
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const topic = process.env.SES_SNS_TOPIC_ARN;
  if (!topic) return new Response("Not configured", { status: 503 });
  // SNS-এর বার্তা সর্বোচ্চ ২৫৬KB; JSON-এ মোড়ানোর পরও ১MB-এর নিচে থাকে
  const text = await readText(request, 1024 * 1024);
  if (text === null) return new Response("Too large", { status: 413 });
  let msg: SnsMessage;
  try {
    msg = JSON.parse(text) as SnsMessage;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (!msg || typeof msg !== "object") return new Response("Bad request", { status: 400 });
  if (msg.TopicArn !== topic) return new Response("Unknown topic", { status: 403 });
  if (!(await verifySns(msg))) return new Response("Bad signature", { status: 401 });

  if (msg.Type === "SubscriptionConfirmation") {
    // AWS-এর নিজের ঠিকানা হলেই কেবল নিশ্চিত করা হয়
    if (isSnsUrl(msg.SubscribeURL)) await fetch(msg.SubscribeURL as string).catch(() => undefined);
    return new Response(null, { status: 204 });
  }
  if (msg.Type === "Notification") {
    const event = parseSesEvent(msg.Message);
    if (event) await applyDeliveryEvent(event);
  }
  return new Response(null, { status: 204 });
};
