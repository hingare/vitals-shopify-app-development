import { describe, expect, it } from "vitest";
import { isPublicAddress, safeFetch } from "./safe-fetch.server";

describe("isPublicAddress", () => {
  it("blocks private, loopback, link-local and metadata addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "23.227.38.65", "2606:4700::1111"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });
});

describe("safeFetch", () => {
  it("refuses plain http, other ports, passwords and private IP links before connecting", async () => {
    await expect(safeFetch("http://example.com")).rejects.toThrow("Only https");
    await expect(safeFetch("https://example.com:8443/x")).rejects.toThrow("standard port");
    await expect(safeFetch("https://user:pw@example.com/")).rejects.toThrow("passwords");
    await expect(safeFetch("https://169.254.169.254/latest")).rejects.toThrow("Private");
    await expect(safeFetch("https://[::1]/")).rejects.toThrow("Private");
    await expect(safeFetch("not a url")).rejects.toThrow("valid URL");
  });

  it("refuses a host name that points to a private address", async () => {
    await expect(safeFetch("https://localhost/")).rejects.toThrow(/Blocked address|ENOTFOUND/);
  });
});
