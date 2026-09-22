import { vi } from "vitest";
import { assertPublicUrl, isPublicIp } from "./ssrf";

test("refuses loopback, private, and non-http urls", async () => {
  const lookup = vi.fn(async () => ["8.8.8.8"]);
  await expect(assertPublicUrl("http://127.0.0.1/x", lookup)).rejects.toThrow();
  await expect(assertPublicUrl("http://10.1.1.1/", lookup)).rejects.toThrow();
  await expect(assertPublicUrl("http://[::1]/", lookup)).rejects.toThrow();
  await expect(assertPublicUrl("http://[::ffff:127.0.0.1]/x", lookup)).rejects.toThrow();
  await expect(assertPublicUrl("file:///etc/passwd", lookup)).rejects.toThrow(/http/);
  expect(lookup).not.toHaveBeenCalled();
});

test("allows a hostname whose lookup is a public address", async () => {
  const lookup = vi.fn(async () => ["8.8.8.8"]);
  await expect(assertPublicUrl("https://example.com/place", lookup)).resolves.toBeUndefined();
  expect(lookup).toHaveBeenCalledWith("example.com");
});

test("refuses a hostname when any resolved address is non-public", async () => {
  await expect(
    assertPublicUrl("https://example.com/place", async () => ["8.8.8.8", "10.1.1.1"]),
  ).rejects.toThrow();
});

test("isPublicIp rejects link-local and accepts a public resolver", () => {
  expect(isPublicIp("169.254.1.1")).toBe(false);
  expect(isPublicIp("1.1.1.1")).toBe(true);
  expect(isPublicIp("127.0.0.1")).toBe(false);
  expect(isPublicIp("10.1.1.1")).toBe(false);
  expect(isPublicIp("172.16.0.1")).toBe(false);
  expect(isPublicIp("192.168.1.1")).toBe(false);
  expect(isPublicIp("0.0.0.0")).toBe(false);
  expect(isPublicIp("::1")).toBe(false);
  expect(isPublicIp("fc00::1")).toBe(false);
  expect(isPublicIp("fd12:3456::1")).toBe(false);
  expect(isPublicIp("fe80::1")).toBe(false);
  expect(isPublicIp("::")).toBe(false);
  expect(isPublicIp("2001:4860:4860::8888")).toBe(true);
});
