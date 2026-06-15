import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrisma } from '../db.js';
import type { PrismaClient } from '@prisma/client';

export interface TestDb {
  prisma: PrismaClient;
  url: string;
  cleanup: () => Promise<void>;
}

export async function makeTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), '24pray-test-'));
  const file = join(dir, 'test.db');
  const url = `file:${file}`;
  // Apply migrations to the throwaway DB.
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'ignore',
  });
  const prisma = createPrisma(url);
  return {
    prisma,
    url,
    cleanup: async () => {
      await prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
