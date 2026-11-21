import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const expected = { hostname: '127.0.0.1', port: '5432', database: 'agentarena_test', username: 'postgres' };
const url = new URL(process.env.DATABASE_URL || '');
if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== expected.hostname || url.port !== expected.port || decodeURIComponent(url.pathname.replace(/^\//, '')) !== expected.database || decodeURIComponent(url.username) !== expected.username || (new URLSearchParams(url.search).get('schema') || 'public') !== 'public') {
  throw new Error('Refusing snapshot: DATABASE_URL must target postgres@127.0.0.1:5432/agentarena_test, schema public.');
}

const httpTables = ['User', 'AuthSession', 'Agent', 'BenchmarkTask', 'BenchmarkRun', 'AgentExecution', 'ExecutionEvaluation', 'AgentTask'];
const modelTables = ['ProviderCredential', 'ModelConnection', 'ModelExecution', 'ModelEvaluation'];
const tables = process.argv.includes('--all') ? [...httpTables, ...modelTables] : httpTables;
const prisma = new PrismaClient();

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

try {
  await prisma.$connect();
  const [server] = await prisma.$queryRaw`SELECT current_database() AS database, current_user AS username, current_schema() AS schema`;
  if (server.database !== expected.database || server.username !== expected.username || server.schema !== 'public') throw new Error('Connected server identity mismatch.');
  const result = {};
  for (const table of tables) {
    const rows = await prisma.$queryRawUnsafe(`SELECT to_jsonb(t) AS row_data FROM "${table}" AS t ORDER BY t."id"`);
    const preserved = rows.map(({ row_data }) => {
      const row = { ...row_data };
      // The reviewed additive migration assigns this new field to old tasks.
      if (table === 'BenchmarkTask') delete row.evaluationStrategy;
      return canonical(row);
    });
    const digest = createHash('sha256').update(JSON.stringify(preserved)).digest('hex');
    result[table] = { count: preserved.length, digest };
  }
  console.log(JSON.stringify({ database: expected.database, schema: 'public', tables: result }));
} finally {
  await prisma.$disconnect();
}
