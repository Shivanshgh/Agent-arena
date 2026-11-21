interface HeaderWriter { setHeader(name: string, value: string): unknown; }

export function setSecurityHeaders(
  response: HeaderWriter,
  options: { production: boolean; https: boolean },
): void {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('X-XSS-Protection', '1; mode=block');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!options.production) return;
  response.setHeader('Content-Security-Policy', [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'self'",
    "form-action 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:", "font-src 'self' data:", "connect-src 'self'", 'upgrade-insecure-requests',
  ].join('; '));
  if (options.https) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
