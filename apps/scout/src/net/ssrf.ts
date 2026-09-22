import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
blocked.addSubnet("0.0.0.0", 8, "ipv4");
blocked.addSubnet("10.0.0.0", 8, "ipv4");
blocked.addSubnet("127.0.0.0", 8, "ipv4");
blocked.addSubnet("169.254.0.0", 16, "ipv4");
blocked.addSubnet("172.16.0.0", 12, "ipv4");
blocked.addSubnet("192.168.0.0", 16, "ipv4");
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
blocked.addSubnet("fc00::", 7, "ipv6");
blocked.addSubnet("fe80::", 10, "ipv6");

const MAPPED_V4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

export function isPublicIp(ip: string): boolean {
  const mapped = MAPPED_V4.exec(ip);
  const candidate = mapped?.[1] ?? ip;
  const version = isIP(candidate);
  if (version === 0) {
    return false;
  }
  return !blocked.check(candidate, version === 4 ? "ipv4" : "ipv6");
}

function bareHost(hostname: string): string {
  const trimmed = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function defaultLookup(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

/** Refuse non-http(s) URLs and any host that resolves to a non-public address. */
export async function assertPublicUrl(
  url: string,
  resolveHost: (host: string) => Promise<string[]> = defaultLookup,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("refused: invalid url");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("refused: only http(s) urls are allowed");
  }
  const host = bareHost(parsed.hostname);
  if (host.length === 0) {
    throw new Error("refused: missing host");
  }
  const addresses = isIP(host) === 0 ? await resolveHost(host) : [host];
  if (addresses.length === 0) {
    throw new Error("refused: no addresses for host");
  }
  for (const address of addresses) {
    if (!isPublicIp(address)) {
      throw new Error("refused: non-public address");
    }
  }
}
