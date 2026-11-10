import { klaviyo } from "./klaviyo";
import { mailchimp } from "./mailchimp";
import { omnisend } from "./omnisend";
import type { EmailToolAdapter } from "./types";

/** সংযোগ করা যায় এমন ইমেইল টুল। নতুন টুল: একটা অ্যাডাপ্টার ফাইল আর এখানে এক লাইন। */
export const EMAIL_TOOLS = { klaviyo, mailchimp, omnisend } satisfies Record<
  string,
  EmailToolAdapter
>;
export type EmailToolId = keyof typeof EMAIL_TOOLS;
export const EMAIL_TOOL_IDS = Object.keys(EMAIL_TOOLS) as EmailToolId[];

export function isEmailToolId(value: unknown): value is EmailToolId {
  return typeof value === "string" && value in EMAIL_TOOLS;
}

export { IntegrationError, timedFetch } from "./types";
export type { Contact, ContactEvent, EmailToolAdapter, FetchFn, ProviderList } from "./types";
export { KLAVIYO_REVISION } from "./klaviyo";
export { mailchimpBase, mailchimpEventName, memberHash } from "./mailchimp";
export { OMNISEND_VERSION } from "./omnisend";
export {
  SMS_GATEWAYS,
  buildCustomUrl,
  isPrivateAddress,
  normalizePhone,
  sendSms,
  smsSegments,
} from "./sms";
export type { SmsConfig, SmsGatewayId, SmsResult } from "./sms";
