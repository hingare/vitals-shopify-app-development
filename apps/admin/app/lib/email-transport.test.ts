import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  emailProvider,
  fromHeader,
  isSnsUrl,
  parseResendEvent,
  parseSesEvent,
  sendEmail,
  snsStringToSign,
  verifySns,
  verifySvix,
  type SnsMessage,
} from "./email-transport.server";

const mail = {
  fromName: 'Tom "the" Shop',
  to: "buyer@example.com",
  subject: "Hello",
  html: "<p>Hi</p>",
  text: "Hi",
  headers: { "List-Unsubscribe": "<https://app.test/e/u/t>" },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("emailProvider", () => {
  it("is off until a sender address and a provider key are both set", () => {
    expect(emailProvider({})).toBe("none");
    expect(emailProvider({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k" })).toBe("none");
    expect(emailProvider({ EMAIL_FROM: "a@b.com", EMAIL_PROVIDER: "resend" })).toBe("none");
    expect(
      emailProvider({ EMAIL_FROM: "a@b.com", EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k" }),
    ).toBe("resend");
    expect(
      emailProvider({
        EMAIL_FROM: "a@b.com",
        EMAIL_PROVIDER: "ses",
        AWS_ACCESS_KEY_ID: "a",
        AWS_SECRET_ACCESS_KEY: "b",
      }),
    ).toBe("ses");
  });
});

describe("sendEmail", () => {
  it("says so plainly when no provider is configured", async () => {
    const fetchFn = vi.fn();
    expect(await sendEmail(mail, {}, fetchFn)).toEqual({
      ok: false,
      error: "email_not_configured",
      permanent: true,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sends through Resend with the store name as the sender", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => json({ id: "re_1" }));
    const env = { EMAIL_FROM: "mail@send.test", EMAIL_PROVIDER: "resend", RESEND_API_KEY: "key" };
    const result = await sendEmail({ ...mail, replyTo: "help@shop.com" }, env, fetchFn);
    expect(result).toEqual({ ok: true, providerId: "re_1" });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer key");
    const body = JSON.parse(String(init?.body));
    expect(body.from).toBe('"Tom the Shop" <mail@send.test>');
    expect(body.to).toEqual(["buyer@example.com"]);
    expect(body.reply_to).toBe("help@shop.com");
    expect(body.headers["List-Unsubscribe"]).toBe("<https://app.test/e/u/t>");
  });

  it("retries rate limits and server errors, but not a rejected address", async () => {
    const env = { EMAIL_FROM: "mail@send.test", EMAIL_PROVIDER: "resend", RESEND_API_KEY: "key" };
    const limited = await sendEmail(mail, env, async () => json({ message: "slow down" }, 429));
    expect(limited).toMatchObject({ ok: false, permanent: false, error: "429 slow down" });
    const rejected = await sendEmail(mail, env, async () => json({ message: "bad to" }, 422));
    expect(rejected).toMatchObject({ ok: false, permanent: true });
    const network = await sendEmail(mail, env, async () => {
      throw new Error("ECONNRESET");
    });
    expect(network).toEqual({ ok: false, error: "ECONNRESET" });
  });

  it("sends through SES with a signed request and the configuration set", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => json({ MessageId: "ses-1" }));
    const env = {
      EMAIL_FROM: "mail@send.test",
      EMAIL_PROVIDER: "ses",
      AWS_ACCESS_KEY_ID: "AKID",
      AWS_SECRET_ACCESS_KEY: "secret",
      SES_REGION: "ap-southeast-1",
      SES_CONFIGURATION_SET: "events",
    };
    expect(await sendEmail(mail, env, fetchFn)).toEqual({ ok: true, providerId: "ses-1" });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe("https://email.ap-southeast-1.amazonaws.com/v2/email/outbound-emails");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/ap-southeast-1\/ses\/aws4_request/,
    );
    const body = JSON.parse(String(init?.body));
    expect(body.ConfigurationSetName).toBe("events");
    expect(body.Destination.ToAddresses).toEqual(["buyer@example.com"]);
    expect(body.Content.Simple.Headers).toEqual([
      { Name: "List-Unsubscribe", Value: "<https://app.test/e/u/t>" },
    ]);
  });
});

describe("fromHeader", () => {
  it("cannot be used to inject extra headers", () => {
    expect(fromHeader('Evil"\r\nBcc: x@y.com <', "a@b.com")).toBe('"EvilBcc: x@y.com" <a@b.com>');
    expect(fromHeader("", "a@b.com")).toBe("a@b.com");
  });
});

describe("Resend webhook", () => {
  const secret = `whsec_${Buffer.from("resend-secret").toString("base64")}`;
  const body = JSON.stringify({
    type: "email.bounced",
    data: { email_id: "re_1", to: ["a@b.com"] },
  });
  const now = 1_800_000_000_000;
  const timestamp = String(now / 1000);
  const signature = createHmac("sha256", Buffer.from("resend-secret"))
    .update(`msg_1.${timestamp}.${body}`)
    .digest("base64");

  it("accepts a correctly signed event", () => {
    const headers = { id: "msg_1", timestamp, signature: `v1,${signature}` };
    expect(verifySvix(secret, headers, body, now)).toBe(true);
    // কয়েকটা সই একসাথে এলেও (চাবি বদলের সময়) একটা মিললেই হয়
    expect(
      verifySvix(secret, { ...headers, signature: `v1,AAAA v1,${signature}` }, body, now),
    ).toBe(true);
  });

  it("rejects a changed body, a wrong secret, a missing header and an old event", () => {
    const headers = { id: "msg_1", timestamp, signature: `v1,${signature}` };
    expect(verifySvix(secret, headers, body.replace("re_1", "re_2"), now)).toBe(false);
    expect(verifySvix("whsec_b3RoZXI=", headers, body, now)).toBe(false);
    expect(verifySvix(secret, { ...headers, signature: null }, body, now)).toBe(false);
    expect(verifySvix(secret, headers, body, now + 6 * 60_000)).toBe(false);
  });

  it("reads delivered, bounced and complained, and ignores the rest", () => {
    expect(parseResendEvent(JSON.parse(body))).toEqual({
      type: "bounced",
      providerId: "re_1",
      recipients: ["a@b.com"],
    });
    expect(
      parseResendEvent({ type: "email.delivered", data: { email_id: "x", to: "a@b.com" } }),
    ).toMatchObject({ type: "delivered", recipients: ["a@b.com"] });
    expect(parseResendEvent({ type: "email.complained", data: { email_id: "x" } })?.type).toBe(
      "complained",
    );
    expect(parseResendEvent({ type: "email.opened", data: { email_id: "x" } })).toBeNull();
    expect(parseResendEvent({ type: "email.bounced", data: {} })).toBeNull();
    expect(parseResendEvent(null)).toBeNull();
  });
});

describe("SES events through SNS", () => {
  it("only trusts certificate and confirm links on Amazon's own SNS hosts", () => {
    expect(isSnsUrl("https://sns.us-east-1.amazonaws.com/cert.pem")).toBe(true);
    expect(isSnsUrl("https://sns.cn-north-1.amazonaws.com.cn/cert.pem")).toBe(true);
    expect(isSnsUrl("http://sns.us-east-1.amazonaws.com/cert.pem")).toBe(false);
    expect(isSnsUrl("https://sns.us-east-1.amazonaws.com.evil.com/cert.pem")).toBe(false);
    expect(isSnsUrl("https://evil.com/sns.us-east-1.amazonaws.com")).toBe(false);
    expect(isSnsUrl(undefined)).toBe(false);
  });

  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const signed = (msg: SnsMessage): SnsMessage => ({
    ...msg,
    SignatureVersion: "2",
    SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
    Signature: createSign("RSA-SHA256")
      .update(snsStringToSign(msg), "utf8")
      .sign(privateKey, "base64"),
  });
  const notification: SnsMessage = {
    Type: "Notification",
    MessageId: "id-1",
    TopicArn: "arn:aws:sns:us-east-1:1:ses",
    Message: "{}",
    Timestamp: "2026-01-01T00:00:00.000Z",
  };
  const cert = async () => new Response(pem);

  it("verifies the signature over the fields AWS signs", async () => {
    expect(snsStringToSign(notification)).toBe(
      "Message\n{}\nMessageId\nid-1\nTimestamp\n2026-01-01T00:00:00.000Z\nTopicArn\narn:aws:sns:us-east-1:1:ses\nType\nNotification\n",
    );
    expect(await verifySns(signed(notification), cert)).toBe(true);
  });

  it("rejects a changed message, a foreign certificate host and a missing signature", async () => {
    const good = signed(notification);
    expect(await verifySns({ ...good, Message: '{"x":1}' }, cert)).toBe(false);
    expect(await verifySns({ ...good, SigningCertURL: "https://evil.com/cert.pem" }, cert)).toBe(
      false,
    );
    expect(await verifySns({ ...good, Signature: undefined }, cert)).toBe(false);
    expect(await verifySns(good, async () => new Response("", { status: 500 }))).toBe(false);
  });

  it("reads delivery, permanent bounce and complaint", () => {
    const mailInfo = { messageId: "ses-1", destination: ["a@b.com"] };
    expect(parseSesEvent(JSON.stringify({ eventType: "Delivery", mail: mailInfo }))).toEqual({
      type: "delivered",
      providerId: "ses-1",
      recipients: ["a@b.com"],
    });
    expect(
      parseSesEvent(
        JSON.stringify({
          notificationType: "Bounce",
          mail: mailInfo,
          bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: "a@b.com" }] },
        }),
      ),
    ).toEqual({ type: "bounced", providerId: "ses-1", recipients: ["a@b.com"] });
    expect(
      parseSesEvent(
        JSON.stringify({
          eventType: "Complaint",
          mail: mailInfo,
          complaint: { complainedRecipients: [{ emailAddress: "a@b.com" }] },
        }),
      )?.type,
    ).toBe("complained");
  });

  it("ignores a temporary bounce, other events and broken JSON", () => {
    const mailInfo = { messageId: "ses-1" };
    expect(
      parseSesEvent(
        JSON.stringify({
          eventType: "Bounce",
          mail: mailInfo,
          bounce: { bounceType: "Transient" },
        }),
      ),
    ).toBeNull();
    expect(parseSesEvent(JSON.stringify({ eventType: "Open", mail: mailInfo }))).toBeNull();
    expect(parseSesEvent("not json")).toBeNull();
    expect(parseSesEvent(undefined)).toBeNull();
  });
});
