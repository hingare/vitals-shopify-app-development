import type { ActionFunctionArgs } from "react-router";
import { parseResendEvent, verifySvix } from "../lib/email-transport.server";
import { applyDeliveryEvent } from "../lib/messages.server";

/**
 * Resend-এর ঘটনা (পৌঁছেছে, bounce, স্প্যাম অভিযোগ)। Resend-এর ড্যাশবোর্ডে এই ঠিকানা দিন:
 *   <অ্যাপের URL>/webhooks/email/resend   আর signing secret রাখুন RESEND_WEBHOOK_SECRET-এ।
 * সই না মিললে কিছুই করা হয় না।
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new Response("Not configured", { status: 503 });
  const body = await request.text();
  const ok = verifySvix(
    secret,
    {
      id: request.headers.get("svix-id") ?? "",
      timestamp: request.headers.get("svix-timestamp") ?? "",
      signature: request.headers.get("svix-signature") ?? "",
    },
    body,
  );
  if (!ok) return new Response("Bad signature", { status: 401 });
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const event = parseResendEvent(parsed);
  if (event) await applyDeliveryEvent(event);
  return new Response(null, { status: 204 });
};
