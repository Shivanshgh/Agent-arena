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

  // 224.0.0.0/4: Multicast & 240.0.0.0/4: Reserved
  if (b0 >= 224) return true;

  return false;
}

/**
 * Checks if an IPv6 address is private, loopback, or unique-local
 */
export function isPrivateOrReservedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // ::1 loopback
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;

  // :: unspecified
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;

  // Link-local fe80::/10
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true;
  }

  // Unique local fc00::/7 (fc00:: to fdff::)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }

  // IPv4-mapped IPv6: ::ffff:192.168.x.x
  if (normalized.includes('::ffff:')) {
    const v4Part = normalized.split('::ffff:')[1];
    if (v4Part && net.isIPv4(v4Part)) {
      return isPrivateOrReservedIPv4(v4Part);
    }
    return true;
  }

  return false;
}

/**
 * Validates a target URL against SSRF attacks.
 * Resolves DNS to prevent DNS rebinding to internal or cloud metadata IPs.
 */
export async function validateEndpointForSsrf(
  urlString: string,
  options: { allowLocal?: boolean } = {}
): Promise<SsrfValidationResult> {
  const allowLocal = options.allowLocal ?? (process.env.ALLOW_LOCAL_TEST_AGENTS === 'true' || process.env.NODE_ENV !== 'production');
  const isProduction = process.env.NODE_ENV === 'production';

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  // 1. Protocol check
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: `Unsupported protocol ${parsed.protocol}. Only HTTP and HTTPS are permitted.` };
  }

  // In production, require HTTPS
  if (isProduction && parsed.protocol !== 'https:') {
    return { valid: false, reason: 'HTTPS is required in production environments.' };
  }

  const hostname = parsed.hostname.toLowerCase();

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
