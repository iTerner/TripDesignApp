import type { ProviderId } from "@wayfare/domain";

const ZONE: Record<ProviderId, string> = { google: "America/Los_Angeles", openrouter: "UTC" };

function partsIn(zone: string, d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of f.formatToParts(d)) map[p.type] = p.value;
  return {
    y: Number(map.year),
    m: Number(map.month),
    d: Number(map.day),
    h: Number(map.hour) % 24,
    mi: Number(map.minute),
    s: Number(map.second),
  };
}

export function providerDayKey(provider: ProviderId, now: Date): string {
  const p = partsIn(ZONE[provider], now);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Next local midnight in the provider's reset zone, as an ISO instant. */
export function nextResetIso(provider: ProviderId, now: Date): string {
  const p = partsIn(ZONE[provider], now);
  const secondsSinceMidnight = p.h * 3600 + p.mi * 60 + p.s;
  const msToMidnight = (86400 - secondsSinceMidnight) * 1000 - now.getMilliseconds();
  return new Date(now.getTime() + msToMidnight).toISOString();
}
