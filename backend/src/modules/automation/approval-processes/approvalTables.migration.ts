import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client as PgClient, type ClientConfig } from 'pg';
import { env } from '../../../config/env.ts';
import { prisma } from '../../../db/prisma.ts';

let tablesChecked = false;

function getMigrationClientConfig(): ClientConfig {
  const urlString = process.env.MIGRATE_DATABASE_URL || env.databaseUrl;
  const url = new URL(urlString);
  url.searchParams.delete('sslmode');

  const config: ClientConfig = {
    connectionString: url.toString(),
  };

  if (env.databaseSslCaPath && existsSync(env.databaseSslCaPath)) {
    config.ssl = {
      ca: readFileSync(resolve(process.cwd(), env.databaseSslCaPath), 'utf8'),
      rejectUnauthorized: true,
    };
  }

  return config;
}

/**
 * Ensures all approval process tables, indexes, and RLS policies are present in PostgreSQL.
 * Safe to call multiple times (idempotent).
 */
export async function ensureApprovalTables(): Promise<void> {
  if (tablesChecked) return;

  try {
    // Quick check if approval_processes already exists
    const checkResult = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'approval_processes'
      ) as "exists";
    `;

    if (checkResult[0]?.exists) {
      tablesChecked = true;
      return;
    }

    console.log('[ApprovalProcess] Approval tables not found. Running idempotent initialization...');

    const migrationPath = resolve(
      process.cwd(),
      'prisma/migrations/20260918110000_create_approval_process_tables/migration.sql',
    );

    if (!existsSync(migrationPath)) {
      console.warn(`[ApprovalProcess] Migration file not found at ${migrationPath}`);
      return;
    }

    const ddl = readFileSync(migrationPath, 'utf8');

    const client = new PgClient(getMigrationClientConfig());
    await client.connect();
    try {
      await client.query(ddl);
      console.log('[ApprovalProcess] Approval process tables and RLS policies initialized successfully.');
      tablesChecked = true;
    } finally {
      await client.end().catch(() => {});
    }
  } catch (error) {
    console.error('[ApprovalProcess] Error checking/initializing approval tables:', error);
    // Don't crash the server; mark checked so we don't spam errors on every request
    tablesChecked = true;
  }
}
