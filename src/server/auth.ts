import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from './prisma';

const scrypt = (password: string, salt: Buffer, length: number) => new Promise<Buffer>((resolve, reject) => {
  scryptCallback(password, salt, length, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key as Buffer));
});
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-agentarena_session' : 'agentarena_session';

export interface AuthUser { id: string; email: string; role: 'USER' | 'ADMIN' }

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$32768$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    const [algorithm, nRaw, rRaw, pRaw, saltRaw, hashRaw, extra] = encoded.split('$');
    const N = Number(nRaw), r = Number(rRaw), p = Number(pRaw);
    if (algorithm !== 'scrypt' || extra !== undefined || N !== 32768 || r !== 8 || p !== 1) return false;
    const expected = Buffer.from(hashRaw, 'base64url');
    if (N !== 32768 || r !== 8 || p !== 1) return false;
    const actual = await scrypt(password, Buffer.from(saltRaw, 'base64url'), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function registerUser(email: string, password: string): Promise<AuthUser> {
  const passwordHash = await hashPassword(password);
  return prisma.user.create({ data: { email: normalizeEmail(email), passwordHash }, select: { id: true, email: true, role: true } });
}

export async function loginUser(email: string, password: string): Promise<{ user: AuthUser; token: string; expiresAt: Date } | null> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  // Perform a hash verification for unknown users too, reducing email enumeration timing differences.
  const valid = await verifyPassword(password, user?.passwordHash || 'scrypt$32768$8$1$MDEyMzQ1Njc4OWFiY2RlZg$' + 'A'.repeat(86));
  if (!user || !valid) return null;
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.authSession.create({ data: { tokenHash: hashToken(token), userId: user.id, expiresAt } });
  return { user: { id: user.id, email: user.email, role: user.role }, token, expiresAt };
}

export async function sessionUser(token: string): Promise<AuthUser | null> {
  const session = await prisma.authSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await prisma.authSession.delete({ where: { id: session.id } });
    return null;
  }
  return { id: session.user.id, email: session.user.email, role: session.user.role };
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export function cookieToken(req: Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      try { return decodeURIComponent(value.join('=')); } catch { return null; }
    }
  }
  return null;
}

export function setSessionCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`);
}

export function clearSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

export function authRateLimit() {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.authUser?.id ? `user:${req.authUser.id}` : `ip:${req.socket.remoteAddress || 'unknown'}`;
    const now = Date.now();
    if (hits.size > 5000) for (const [ip, hit] of hits) if (hit.resetAt <= now) hits.delete(ip);
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) hits.set(key, { count: 1, resetAt: now + 60_000 });
    else if (++entry.count > 10) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ success: false, error: 'Too many authentication attempts. Try again shortly.' });
    }
    next();
  };
}

export function createAuthMiddleware(allowedOrigins: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'OPTIONS' || req.path === '/health' || req.path === '/ready') return next();
    if (!['GET', 'HEAD'].includes(req.method)) {
      let origin = req.headers.origin || '';
      try { if (!origin && req.headers.referer) origin = new URL(req.headers.referer).origin; } catch { /* reject malformed referrers below */ }
      if (!origin || !allowedOrigins.includes(origin)) return res.status(403).json({ success: false, error: 'Request origin is not allowed.' });
    }
    if (req.path === '/auth/register' || req.path === '/auth/login') return next();
    const token = cookieToken(req);
    if (!token) return res.status(401).json({ success: false, error: 'Authentication required.' });
    try {
      const user = await sessionUser(token);
      if (!user) {
        clearSessionCookie(res);
        return res.status(401).json({ success: false, error: 'Session expired. Sign in again.' });
      }
      req.authUser = user;
      req.authToken = token;
      return next();
    } catch {
      return res.status(503).json({ success: false, error: 'Authentication service unavailable.' });
    }
  };
}
