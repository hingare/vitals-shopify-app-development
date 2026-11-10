import { describe, expect, it } from "vitest";
import { signV4 } from "./sigv4";

describe("signV4", () => {
  // AWS-এর ডকুমেন্টের উদাহরণ ("Signature Version 4 signing process": IAM ListUsers)
  it("matches the worked example in the AWS documentation", () => {
    const headers = signV4({
      method: "GET",
      url: "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
      region: "us-east-1",
      service: "iam",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      now: new Date("2015-08-30T12:36:00Z"),
    });
    expect(headers["x-amz-date"]).toBe("20150830T123600Z");
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, " +
        "SignedHeaders=content-type;host;x-amz-date, " +
        "Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
    );
  });

  it("signs the body, so a changed body gets a different signature", () => {
    const base = {
      method: "POST",
      url: "https://email.us-east-1.amazonaws.com/v2/email/outbound-emails",
      region: "us-east-1",
      service: "ses",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "secret",
      now: new Date("2026-01-01T00:00:00Z"),
    };
    const a = signV4({ ...base, body: '{"a":1}' }).authorization;
    const b = signV4({ ...base, body: '{"a":2}' }).authorization;
    expect(a).not.toBe(b);
  });

  it("adds the session token when temporary credentials are used", () => {
    const headers = signV4({
      method: "GET",
      url: "https://email.eu-west-1.amazonaws.com/",
      region: "eu-west-1",
      service: "ses",
      accessKeyId: "A",
      secretAccessKey: "B",
      sessionToken: "TOKEN",
    });
    expect(headers["x-amz-security-token"]).toBe("TOKEN");
    expect(headers.authorization).toContain("x-amz-security-token");
  });
});
