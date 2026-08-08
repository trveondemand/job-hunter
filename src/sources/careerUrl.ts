import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const blockedHostnames = new Set(["localhost", "localhost.localdomain"]);

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && [0, 168].includes(b)) return false;
  if (a === 198 && [18, 19, 51].includes(b)) return false;
  if (a === 203 && b === 0) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return false;
  if (/^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized)) return false;
  if (normalized.startsWith("2001:db8:")) return false;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? isPublicIpv4(mapped) : true;
}

export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version === 6) return isPublicIpv6(address);
  return false;
}

export function normalizeCareerUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:") throw new Error("Career URL musí používat HTTPS.");
  if (url.username || url.password)
    throw new Error("Career URL nesmí obsahovat přihlašovací údaje.");
  if (url.port && url.port !== "443")
    throw new Error("Career URL nesmí používat nestandardní port.");
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export async function assertSafeCareerUrl(value: string): Promise<void> {
  const url = new URL(normalizeCareerUrl(value));
  const hostname = url.hostname.toLowerCase();
  if (
    blockedHostnames.has(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".localhost")
  ) {
    throw new Error("Career URL musí vést na veřejný web.");
  }

  if (isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) throw new Error("Career URL nesmí vést na privátní adresu.");
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error("Career URL se nepodařilo bezpečně přeložit na veřejnou adresu.");
  }
}
