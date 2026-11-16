import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const email = process.argv[2]?.trim().toLowerCase();
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
if (!email) throw new Error('Usage: node scripts/promote-admin.mjs <registered-email>');
const prisma = new PrismaClient();
try {
  const result = await prisma.user.updateMany({ where: { email }, data: { role: 'ADMIN' } });
  if (!result.count) throw new Error('No registered user has that email.');
  console.log('Administrator role granted.');
} finally {
  await prisma.$disconnect();
}
