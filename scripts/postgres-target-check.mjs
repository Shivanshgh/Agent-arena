import { PrismaClient } from '@prisma/client';

const expected = { hostname: '127.0.0.1', port: '5432', database: 'agentarena_test', username: 'postgres' };
const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) throw new Error('DATABASE_URL is not set.');
const url = new URL(rawUrl);
const actual = {
  hostname: url.hostname,
  port: url.port,
  database: decodeURIComponent(url.pathname.replace(/^\//, '')),
  username: decodeURIComponent(url.username),
  schema: new URLSearchParams(url.search).get('schema') || 'public',
};
if (!['postgres:', 'postgresql:'].includes(url.protocol) || actual.hostname !== expected.hostname || actual.port !== expected.port || actual.database !== expected.database || actual.username !== expected.username || actual.schema !== 'public') {
  throw new Error('Refusing database operation: DATABASE_URL must target postgres@127.0.0.1:5432/agentarena_test?schema=public.');
}

const prisma = new PrismaClient();
try {
  await prisma.$connect();
  const [server] = await prisma.$queryRaw`SELECT current_database() AS database, current_user AS username, current_schema() AS schema`;
  if (server.database !== expected.database || server.username !== expected.username || server.schema !== 'public') {
    throw new Error('Connected server identity does not match agentarena_test/public/postgres; refusing operation.');
  }
  console.log('PASS PostgreSQL connected to agentarena_test/public as postgres (127.0.0.1:5432).');
} catch (error) {
  const message = String(error?.message || error).replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgresql://[credentials-redacted]@').split('\n')[0];
  console.error(`FAIL PostgreSQL target check: ${error?.code || error?.name || 'Error'}: ${message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
