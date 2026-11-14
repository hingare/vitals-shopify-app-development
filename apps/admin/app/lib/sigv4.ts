import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 (Amazon SES-এ ইমেইল পাঠাতে আর R2/S3-তে ফাইল রাখতে লাগে)।
 * AWS SDK পুরোটা না এনে শুধু সই করার অংশ: কোনো বাড়তি প্যাকেজ নেই।
 * AWS-এর ডকুমেন্টের উদাহরণ দিয়ে টেস্ট করা (sigv4.test.ts)।
 */
export interface SigV4Input {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** body-র sha256 (hex) আগে থেকে জানা থাকলে, যেমন বাইনারি ফাইল (S3/R2) */
  payloadHash?: string;
  now?: Date;
}

const sha256 = (data: string) => createHash("sha256").update(data, "utf8").digest("hex");
const hmac = (key: Buffer | string, data: string) =>
  createHmac("sha256", key).update(data, "utf8").digest();

/** RFC 3986 অনুযায়ী (AWS যেভাবে চায়) */
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** সই করা header ফেরত দেয় (Authorization, x-amz-date সহ); এগুলো দিয়েই অনুরোধ পাঠাতে হবে */
export function signV4(input: SigV4Input): Record<string, string> {
  const url = new URL(input.url);
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const body = input.body ?? "";

  const headers: Record<string, string> = { host: url.host, "x-amz-date": amzDate };
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    headers[name.toLowerCase()] = value.trim().replace(/\s+/g, " ");
  }
  if (input.sessionToken) headers["x-amz-security-token"] = input.sessionToken;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const query = [...url.searchParams.entries()]
    .map(([k, v]) => [encode(k), encode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const path = url.pathname
    .split("/")
    .map((segment) => encode(decodeURIComponent(segment)))
    .join("/");

  const canonicalRequest = [
    input.method.toUpperCase(),
    path || "/",
    query,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash ?? sha256(body),
  ].join("\n");

  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), input.region), input.service),
    "aws4_request",
  );
  const signature = hmac(signingKey, stringToSign).toString("hex");

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
