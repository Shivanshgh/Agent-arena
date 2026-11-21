import dns from 'dns';
import net from 'net';

export interface SsrfValidationResult {
  valid: boolean;
  reason?: string;
  resolvedIp?: string;
}

/**
 * Checks if an IPv4 address is in private, link-local, loopback, or reserved range
 */
export function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed IPv4 is treated as unsafe
  }

  const [b0, b1] = parts;

  // 0.0.0.0/8: Current network
  if (b0 === 0) return true;

  // 10.0.0.0/8: Private
  if (b0 === 10) return true;

  // 127.0.0.0/8: Loopback
  if (b0 === 127) return true;

  // 169.254.0.0/16: Link-local & Cloud Metadata (169.254.169.254)
  if (b0 === 169 && b1 === 254) return true;

  // 172.16.0.0/12: Private
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

  // 192.168.0.0/16: Private
  if (b0 === 192 && b1 === 168) return true;

  // 192.0.0.0/24: IETF
  if (b0 === 192 && b1 === 0) return true;

  // Shared, documentation, and benchmarking ranges are not globally routable.
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true; // 100.64.0.0/10
  if (b0 === 192 && b1 === 0 && parts[2] === 2) return true; // 192.0.2.0/24
  if (b0 === 198 && b1 === 18) return true; // 198.18.0.0/15
  if (b0 === 198 && b1 === 19) return true;
  if (b0 === 198 && b1 === 51 && parts[2] === 100) return true; // 198.51.100.0/24
  if (b0 === 203 && b1 === 0 && parts[2] === 113) return true; // 203.0.113.0/24

  // 224.0.0.0/4: Multicast & 240.0.0.0/4: Reserved
  if (b0 >= 224) return true;

  return false;
}

/**
 * Checks if an IPv6 address is private, loopback, or unique-local
 */
export function isPrivateOrReservedIPv6(ip: string): boolean {
  if (!net.isIPv6(ip)) return true;
  try { return BLOCKED_IPV6.check(ip, 'ipv6'); } catch { return true; }
}

const BLOCKED_IPV6 = new net.BlockList();
for (const [subnet, prefix] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96],
  ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) BLOCKED_IPV6.addSubnet(subnet, prefix, 'ipv6');

/**
 * Validates a target URL against SSRF attacks.
 * Resolves DNS to prevent DNS rebinding to internal or cloud metadata IPs.
 */
export async function validateEndpointForSsrf(
  urlString: string,
  options: { allowLocal?: boolean } = {}
): Promise<SsrfValidationResult> {
  const isProduction = process.env.NODE_ENV === 'production';
  // Local fixtures are never allowed in production, even if an environment
  // variable or caller accidentally opts in.
  const allowLocal = !isProduction && (options.allowLocal ?? (process.env.ALLOW_LOCAL_TEST_AGENTS === 'true' || process.env.NODE_ENV !== 'production'));

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'Credentials must not be embedded in agent endpoint URLs.' };
  }

  // 1. Protocol check
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: `Unsupported protocol ${parsed.protocol}. Only HTTP and HTTPS are permitted.` };
  }

  // In production, require HTTPS
  if (isProduction && parsed.protocol !== 'https:') {
    return { valid: false, reason: 'HTTPS is required in production environments.' };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  // 2. Known dangerous hostnames & metadata services
  const blockedHostnames = [
    'metadata.google.internal',
    'metadata.internal',
    'instance-data',
    '169.254.169.254',
    '100.100.100.200',
  ];

  if (blockedHostnames.includes(hostname)) {
    return { valid: false, reason: 'Access to cloud metadata endpoints is strictly forbidden (SSRF protection).' };
  }

  // 3. Check for raw IP addresses
  if (net.isIPv4(hostname)) {
    if (!allowLocal && isPrivateOrReservedIPv4(hostname)) {
      return { valid: false, reason: `Direct access to private or loopback IPv4 ${hostname} is blocked.` };
    }
    return { valid: true, resolvedIp: hostname };
  }

  if (net.isIPv6(hostname)) {
    if (!allowLocal && isPrivateOrReservedIPv6(hostname)) {
      return { valid: false, reason: `Direct access to private or loopback IPv6 ${hostname} is blocked.` };
    }
    return { valid: true, resolvedIp: hostname };
  }

  // Disallow localhost unless explicitly permitted in dev
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    if (!allowLocal) {
      return { valid: false, reason: 'Localhost and .localhost domains are blocked by SSRF protection.' };
    }
    return { valid: true, resolvedIp: '127.0.0.1' };
  }

  // 4. Resolve DNS to protect against DNS rebinding
  try {
    const lookupResults = await dns.promises.lookup(hostname, { all: true });
    if (!lookupResults || lookupResults.length === 0) {
      return { valid: false, reason: `Unable to resolve DNS for host: ${hostname}` };
    }

    const firstIp = lookupResults[0].address;

    for (const record of lookupResults) {
      const ip = record.address;
      if (record.family === 4) {
        if (!allowLocal && isPrivateOrReservedIPv4(ip)) {
          return { valid: false, reason: `DNS resolved host ${hostname} to protected IPv4 address ${ip}. Request rejected.` };
        }
      } else if (record.family === 6) {
        if (!allowLocal && isPrivateOrReservedIPv6(ip)) {
          return { valid: false, reason: `DNS resolved host ${hostname} to protected IPv6 address ${ip}. Request rejected.` };
        }
      }
    }

    return { valid: true, resolvedIp: firstIp };
  } catch (err: any) {
    return { valid: false, reason: `DNS lookup failed for ${hostname}: ${err.message}` };
  }
}
