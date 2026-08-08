import { readFileSync } from 'node:fs';
import pg from 'pg';

const envText = readFileSync(
  'E:/Dharmik-Makani/Projects/jobwork-process-webapp/backend/.env',
  'utf8',
);
const line = envText.split(/\r?\n/).find((l) => l.startsWith('MIGRATE_DATABASE_URL='));
const appLine = envText.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
const raw = (line ?? appLine).split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');

const url = new URL(raw);
url.searchParams.delete('sslmode');
const caPath = (envText.split(/\r?\n/).find((l) => l.startsWith('DATABASE_SSL_CA_PATH=')) ?? '')
  .split('=')
  .slice(1)
  .join('=')
  .trim();

const client = new pg.Client({
  connectionString: url.toString(),
  ssl: caPath
    ? {
        ca: readFileSync(
          'E:/Dharmik-Makani/Projects/jobwork-process-webapp/backend/' + caPath,
          'utf8',
        ),
        rejectUnauthorized: true,
      }
    : undefined,
});

await client.connect();

const show = async (label, sql) => {
  const r = await client.query(sql);
  console.log('\n=== ' + label + ' ===');
  console.table(r.rows);
};

await show(
  'limits',
  `select name, setting from pg_settings where name in ('max_connections','superuser_reserved_connections','reserved_connections')`,
);
await show(
  'by user/state',
  `select usename, state, count(*)::int as n,
          max(now() - state_change)::text as oldest_in_state
     from pg_stat_activity where datname = current_database()
    group by usename, state order by n desc`,
);
await show(
  'by application',
  `select coalesce(nullif(application_name,''),'(none)') as app, usename, state, count(*)::int as n
     from pg_stat_activity where datname = current_database()
    group by 1,2,3 order by n desc`,
);
await show('total', `select count(*)::int as total_conns from pg_stat_activity`);

await client.end();
