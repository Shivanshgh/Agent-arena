import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { Readable } from 'node:stream';

/** Connect directly to an IP already checked by SSRF validation. For HTTPS,
 * keep the original hostname for SNI and certificate verification. */
export function requestPinned(urlString: string, resolvedIp: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(urlString);
  const ip = resolvedIp.replace(/^\[|\]$/g, '');
  const family = net.isIP(ip);
  if (!family) return Promise.reject(new Error('SSRF validation did not provide a valid destination IP.'));

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const secure = url.protocol === 'https:';
  if (!secure && url.protocol !== 'http:') return Promise.reject(new Error('Unsupported agent URL protocol.'));
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  headers.host = url.host;

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const cleanup = () => init.signal?.removeEventListener('abort', abort);
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const options: https.RequestOptions = {
      protocol: url.protocol,
      hostname: ip,
      port: url.port ? Number(url.port) : secure ? 443 : 80,
      method: init.method || 'GET',
      path: `${url.pathname}${url.search}`,
      headers,
      agent: false,
      ...(secure ? { rejectUnauthorized: true, ...(net.isIP(hostname) ? {} : { servername: hostname }) } : {}),
    };
    const req = (secure ? https.request : http.request)(options, incoming => {
      const status = incoming.statusCode || 502;
      if (status >= 300 && status < 400) {
        incoming.destroy();
        fail(new Error('Agent redirects are not permitted.'));
        return;
      }
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) for (const item of value) responseHeaders.append(name, item);
        else responseHeaders.set(name, String(value));
      }
      settled = true;
      incoming.once('close', cleanup);
      const noBody = init.method === 'HEAD' || status === 204 || status === 205 || status === 304;
      resolve(new Response(noBody ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
        status, statusText: incoming.statusMessage, headers: responseHeaders,
      }));
    });

    const abort = () => req.destroy(new DOMException('The operation was aborted.', 'AbortError'));
    if (init.signal?.aborted) { abort(); return; }
    init.signal?.addEventListener('abort', abort, { once: true });
    req.once('socket', socket => socket.once('connect', () => {
      const remote = socket.remoteAddress?.replace(/^::ffff:/i, '').toLowerCase();
      const expected = ip.replace(/^::ffff:/i, '').toLowerCase();
      if (remote !== expected) req.destroy(new Error('Connected agent IP did not match the validated destination.'));
    }));
    req.once('error', fail);
    if (typeof init.body === 'string') req.end(init.body);
    else req.end();
  });
}
