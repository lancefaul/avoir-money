import { PrismaClient, Prisma } from '@prisma/client';
import { decimalPrecisionExtension } from './decimal-precision.js';

export { Prisma };

/**
 * The client is extended with `decimalPrecisionExtension`, which converts JS
 * numbers bound to Decimal columns into `Prisma.Decimal` before the query is
 * issued. Without it a clean 2-decimal value is written at 16 significant
 * digits (9.79 -> 9.789999999999999). See decimal-precision.ts.
 */
function createPrismaClient() {
  return new PrismaClient({
    log: process.env['NODE_ENV'] === 'development' ? ['query', 'error', 'warn'] : ['error'],
  }).$extends(decimalPrecisionExtension);
}

export type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as typeof globalThis & {
  prisma: ExtendedPrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma;
}
