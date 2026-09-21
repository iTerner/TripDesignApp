import type { MiddlewareHandler } from "hono";

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "no-referrer");
  c.header("x-frame-options", "DENY");
  c.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  c.header("permissions-policy", "geolocation=(), camera=(), microphone=(), payment=()");
  c.header("cache-control", "no-store");
};
