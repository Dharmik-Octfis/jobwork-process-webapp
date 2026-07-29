import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, type ClientConfig } from 'pg';

/**
 * db-sync — move `prisma/schema` and the database toward each other without
 * ever destroying a row by accident.
 *
 * WHY THIS EXISTS
 * The two Prisma commands that keep a database "in sync" both delete data, and
 * both do it quietly:
 *
 *   `prisma db push`    Stateless. It diffs the schema FILES against the live
 *                       database and issues whatever DDL closes the gap —
 *                       ignoring `prisma/migrations` entirely. Anything in the
 *                       database but not in your schema files is, by
 *                       definition, something to remove. On 2026-07-25 a push
 *                       from a branch with stale schema files re-created
 *                       `memberships.role` with its default; the next migration
 *                       dropped it again and the dev database ended up with no
 *                       organization owners at all. No prompt appeared — adding
 *                       a column back is "non-destructive". See
 *                       `migrations/20260725140000_.../migration.sql:32`.
 *
 *   `prisma migrate dev` Offers to RESET the database whenever it detects
 *                       drift, and this dev database drifts routinely because
 *                       it is shared across branches.
 *
 * Neither is used here. The flow is:
 *
 *   npm run db:status              read-only. what is pending, what has drifted
 *   npm run db:draft -- <name>     write SQL to prisma/drafts. Applies nothing
 *   (review and hand-edit the SQL, which is the whole point)
 *   npm run db:promote             draft → prisma/migrations, if it passes
 *   npm run db:apply               backup → migrate deploy → generate → verify
 *
 * WHY DRAFTS LIVE OUTSIDE prisma/migrations
 * `prisma migrate deploy` is what CI and production run, and it applies every
 * directory under `prisma/migrations` without asking anything. So a generated,
 * unreviewed migration sitting there is already loaded: whatever guard runs on
 * a developer's laptop does not run on the deploy box. `db:draft` therefore
 * writes to `prisma/drafts/`, which nothing applies, and `db:promote` is the
 * one door into the deploy path.
 *
 * WHAT ACTUALLY PROTECTS THE DATA, in order of how much it is worth:
 *
 *   1. `db:draft` writes a file and stops. A human reads the SQL before any of
 *      it reaches the database. `migrate deploy` never resets and never
 *      improvises — it runs exactly the statements in that file.
 *   2. `db:promote` refuses to move a draft containing destructive SQL into the
 *      deploy path unless the file carries an `-- @destructive-ok: <reason>`
 *      line. The acknowledgement lives in git next to the statement it excuses,
 *      so "why did we drop that column" has an answer forever. A CLI flag would
 *      not; a y/n prompt would not. `db:apply` re-checks, as a second net.
 *   3. `db:apply` takes a `pg_dump` first. Belt for the braces.
 *
 * THE ANALYSER OVER-REPORTS ON PURPOSE. A false positive costs one comment
 * line. A false negative costs a column.
 */

const nodeRequire = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, '..');
const MIGRATIONS_DIR = join(BACKEND, 'prisma', 'migrations');
const DRAFTS_DIR = join(BACKEND, 'prisma', 'drafts');
const BACKUP_DIR = join(BACKEND, 'backups');

// ---------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------

const COLOR = !process.env['NO_COLOR'];
const paint = (code: string) => (s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = paint('31');
const yellow = paint('33');
const green = paint('32');
const cyan = paint('36');
const bold = paint('1');
const dim = paint('2');

function heading(text: string): void {
  console.log(`\n${bold(text)}`);
}

function die(message: string, ...detail: string[]): never {
  console.error(`\n${red('✖')} ${bold(message)}`);
  for (const line of detail) console.error(`  ${line}`);
  console.error('');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/**
 * The same role the Prisma CLI uses (`prisma.config.ts`): `postgres`, the table
 * owner, because reading `_prisma_migrations` and running DDL both need it.
 */
function databaseUrl(): string {
  const url = process.env['MIGRATE_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (!url) {
    die(
      'No database URL.',
      'Set MIGRATE_DATABASE_URL (preferred) or DATABASE_URL in backend/.env.',
    );
  }
  return url;
}

/** `user@host:port/database` — never the password. */
function describeTarget(url: string): string {
  const u = new URL(url);
  return `${u.username}@${u.hostname}:${u.port || '5432'}${u.pathname}`;
}

/**
 * Mirrors `src/db/prisma.ts`: `pg` parses `sslmode` out of the connection
 * string into its own SSL config, which REPLACES the `ssl` object and silently
 * drops our CA. Strip it and pass the Amazon bundle explicitly.
 */
function pgConfig(url: string): ClientConfig {
  const caPath = process.env['DATABASE_SSL_CA_PATH'];
  if (!caPath) return { connectionString: url };

  const parsed = new URL(url);
  parsed.searchParams.delete('sslmode');
  return {
    connectionString: parsed.toString(),
    ssl: { ca: readFileSync(resolve(BACKEND, caPath), 'utf8'), rejectUnauthorized: true },
  };
}

/**
 * Names in `_prisma_migrations` that finished and were not rolled back.
 *
 * Returns `null` when the answer cannot be established — an unreachable
 * database, a missing table on a brand-new one. Callers must then treat EVERY
 * migration as pending and scan them all, because "I could not tell" must not
 * read as "nothing to check".
 */
async function appliedMigrationNames(url: string): Promise<Set<string> | null> {
  const client = new Client(pgConfig(url));
  try {
    await client.connect();
    const res = await client.query<{ name: string }>(
      `SELECT migration_name AS name FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    );
    return new Set(res.rows.map((r) => r.name));
  } catch {
    return null;
  } finally {
    await client.end().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Running the Prisma CLI
// ---------------------------------------------------------------------------

/**
 * Spawn `prisma`'s entry point on this Node binary directly rather than through
 * `npx`. No shell, so a path containing a space (every Windows install) cannot
 * be re-split into arguments.
 */
function prismaBin(): string {
  const pkgPath = nodeRequire.resolve('prisma/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    bin?: string | Record<string, string>;
  };
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['prisma'];
  if (!rel) die('Could not locate the prisma CLI entry point in node_modules/prisma.');
  return join(dirname(pkgPath), rel);
}

/**
 * When capturing, stderr is captured too and only shown on failure — otherwise
 * Prisma's "Loaded Prisma config from ..." notice lands in the middle of a
 * report that is supposed to read as one thing.
 */
function runPrisma(args: string[], capture: boolean): { code: number; stdout: string } {
  const res = spawnSync(process.execPath, [prismaBin(), ...args], {
    cwd: BACKEND,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (res.error) die(`Failed to run prisma ${args[0] ?? ''}: ${res.error.message}`);
  const code = res.status ?? 1;
  if (capture && code !== 0 && res.stderr) process.stderr.write(res.stderr);
  return { code, stdout: res.stdout ?? '' };
}

/**
 * SQL that would make the target match `prisma/schema`.
 *
 * `--from-config-datasource` diffs against the LIVE DATABASE, which is the
 * right baseline for this repo: the dev database drifts, so a diff from
 * migration history would re-emit changes the database already has. Pass
 * `--from-migrations` when authoring against a clean database instead; it
 * replays history into a shadow database and needs SHADOW_DATABASE_URL.
 */
function diffToSchema(fromMigrations: boolean): string {
  const args = fromMigrations
    ? ['migrate', 'diff', '--from-migrations', 'prisma/migrations']
    : ['migrate', 'diff', '--from-config-datasource'];
  args.push('--to-schema', 'prisma/schema', '--script');

  if (fromMigrations) {
    const shadow = process.env['SHADOW_DATABASE_URL'];
    if (!shadow) {
      die(
        '--from-migrations needs a shadow database.',
        'Set SHADOW_DATABASE_URL to an EMPTY database the migrations can be replayed into.',
      );
    }
    args.push('--shadow-database-url', shadow);
  }

  const { code, stdout } = runPrisma(args, true);
  if (code !== 0) die('prisma migrate diff failed — see the output above.');

  // Prisma prints "Loaded Prisma config from ..." alongside the script.
  return stdout
    .split('\n')
    .filter((line) => !line.startsWith('Loaded Prisma config'))
    .join('\n')
    .trim();
}

/** True when the diff is comments and whitespace only. */
function isEmptySql(sql: string): boolean {
  return sql.split('\n').every((line) => line.trim() === '' || line.trim().startsWith('--'));
}

// ---------------------------------------------------------------------------
// The analyser
// ---------------------------------------------------------------------------

type Level = 'blocking' | 'warning';

interface Rule {
  id: string;
  level: Level;
  re: RegExp;
  why: string;
}

/**
 * `blocking` means `db:apply` refuses without an `@destructive-ok` line.
 * `warning` means it prints and proceeds.
 */
const RULES: Rule[] = [
  {
    id: 'DROP TABLE',
    level: 'blocking',
    re: /\bDROP\s+TABLE\b/gi,
    why: 'destroys the table and every row in it — and takes its RLS policy and grants with it',
  },
  {
    id: 'DROP COLUMN',
    level: 'blocking',
    re: /\bDROP\s+COLUMN\b/gi,
    why: 'destroys every value in that column; re-adding it later restores the column, not the data',
  },
  {
    id: 'TRUNCATE',
    level: 'blocking',
    re: /\bTRUNCATE\b/gi,
    why: 'empties the table',
  },
  {
    id: 'DELETE FROM',
    level: 'blocking',
    re: /\bDELETE\s+FROM\b/gi,
    why: 'removes rows',
  },
  {
    id: 'DROP SCHEMA',
    level: 'blocking',
    re: /\bDROP\s+SCHEMA\b/gi,
    why: 'destroys everything in the schema',
  },
  {
    id: 'DROP DATABASE',
    level: 'blocking',
    re: /\bDROP\s+DATABASE\b/gi,
    why: 'destroys the database',
  },
  {
    id: 'DROP POLICY',
    level: 'blocking',
    re: /\bDROP\s+POLICY\b/gi,
    why: 'removes an RLS policy — a tenant table with no policy leaks across tenants and nothing reports it',
  },
  {
    id: 'DISABLE RLS',
    level: 'blocking',
    re: /\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/gi,
    why: 'turns tenant isolation off for that table',
  },
  {
    id: 'NO FORCE RLS',
    level: 'blocking',
    re: /\bNO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY\b/gi,
    why: 'lets the table owner bypass the policy again',
  },
  {
    id: 'OWNER TO',
    level: 'warning',
    re: /\bOWNER\s+TO\b/gi,
    why: 'the table owner bypasses every RLS policy silently — check who this hands it to',
  },
  {
    id: 'COLUMN TYPE CHANGE',
    level: 'warning',
    re: /\bALTER\s+COLUMN\s+"?[\w$]+"?\s+(?:SET\s+DATA\s+)?TYPE\b/gi,
    why: 'an in-place cast can fail outright or silently truncate (varchar(n), numeric precision)',
  },
  {
    id: 'SET NOT NULL',
    level: 'warning',
    re: /\bSET\s+NOT\s+NULL\b/gi,
    why: 'fails if any existing row holds NULL — backfill first',
  },
  {
    id: 'DROP CONSTRAINT',
    level: 'warning',
    re: /\bDROP\s+CONSTRAINT\b/gi,
    why: 'no data is lost, but a rule that was being enforced stops being enforced',
  },
  {
    id: 'ADD UNIQUE',
    level: 'warning',
    re: /\b(?:ADD\s+(?:CONSTRAINT\s+"?[\w$]+"?\s+)?UNIQUE|CREATE\s+UNIQUE\s+INDEX)\b/gi,
    why: 'fails on existing duplicates; remember soft-deleted rows still occupy their unique key',
  },
];

interface Finding {
  id: string;
  level: Level;
  why: string;
  line: number;
}

/**
 * Blank out comments and single-quoted literals, preserving byte offsets and
 * newlines so a match index still maps to its real line.
 *
 * Dollar-quoted bodies (`$$ ... $$`) are deliberately NOT blanked: a DO block
 * can execute DDL, and this analyser is meant to over-report.
 */
function maskNoise(sql: string): string {
  const out = sql.split('');
  const n = sql.length;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  let i = 0;
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const nl = sql.indexOf('\n', i);
      const stop = nl === -1 ? n : nl;
      blank(i, stop);
      i = stop;
    } else if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
    } else if (sql[i] === "'") {
      let k = i + 1;
      while (k < n) {
        if (sql[k] === "'") {
          if (sql[k + 1] === "'") {
            k += 2;
            continue;
          }
          k += 1;
          break;
        }
        k += 1;
      }
      blank(i, k);
      i = k;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

function lineOf(sql: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < sql.length; i++) if (sql[i] === '\n') line += 1;
  return line;
}

/** Split on `;`, keeping each statement's offset so line numbers stay real. */
function statements(masked: string): { sql: string; offset: number }[] {
  const out: { sql: string; offset: number }[] = [];
  let start = 0;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === ';') {
      out.push({ sql: masked.slice(start, i), offset: start });
      start = i + 1;
    }
  }
  if (masked.slice(start).trim() !== '') out.push({ sql: masked.slice(start), offset: start });
  return out;
}

const DROP_COLUMN_NAME = /\bDROP\s+COLUMN\s+"?([A-Za-z_][\w$]*)"?/gi;
const ADD_COLUMN_NAME = /\bADD\s+COLUMN\s+"?([A-Za-z_][\w$]*)"?/gi;
const CREATE_TABLE_NAME = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w$]+)"?/gi;

function analyse(sql: string): Finding[] {
  const masked = maskNoise(sql);
  const findings: Finding[] = [];
  const seen = new Set<string>();

  const add = (f: Finding): void => {
    const key = `${f.id}@${f.line}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(f);
  };

  for (const rule of RULES) {
    for (const m of masked.matchAll(rule.re)) {
      add({ id: rule.id, level: rule.level, why: rule.why, line: lineOf(sql, m.index) });
    }
  }

  for (const stmt of statements(masked)) {
    // A chunk starts immediately after the previous `;`, so its offset points at
    // the newline and comment that precede the statement. Anchor findings at the
    // first real SQL character instead — in the masked text comments are already
    // blanked, so that is just the first non-whitespace byte. Without this the
    // annotation for statement N lands above statement N-1.
    const lead = stmt.sql.search(/\S/);
    const stmtLine = lineOf(sql, stmt.offset + (lead === -1 ? 0 : lead));

    // A DROP and an ADD of a column in the SAME statement is what `migrate
    // diff` emits for a RENAME. Prisma cannot see that `notes` became
    // `remarks` — it sees one column gone and another arrived, and the data
    // does not travel between them. This is the single most expensive mistake
    // this script exists to catch.
    const dropped = [...stmt.sql.matchAll(DROP_COLUMN_NAME)].map((m) => m[1] ?? '?');
    const added = [...stmt.sql.matchAll(ADD_COLUMN_NAME)].map((m) => m[1] ?? '?');
    if (dropped.length > 0 && added.length > 0) {
      add({
        id: 'LIKELY RENAME',
        level: 'blocking',
        why:
          `drops ${dropped.join(', ')} and adds ${added.join(', ')} in one statement. ` +
          'If this is a rename, replace it with ALTER TABLE ... RENAME COLUMN, or ' +
          'ADD + UPDATE-backfill + DROP. As written the old values are simply gone',
        line: stmtLine,
      });
    }

    // A new tenant table with no policy is unprotected and nothing tells you.
    for (const m of stmt.sql.matchAll(CREATE_TABLE_NAME)) {
      const table = m[1];
      if (!table || !/\borganization_id\b/i.test(stmt.sql)) continue;
      const enabled = new RegExp(
        `ALTER\\s+TABLE\\s+"?${table}"?[\\s\\S]*?ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        'i',
      );
      if (!enabled.test(masked)) {
        add({
          id: 'TENANT TABLE WITHOUT RLS',
          level: 'warning',
          why:
            `"${table}" has organization_id but this migration never enables RLS on it. ` +
            'Copy the policy statements from migrations/*_enable_rls and add it to ' +
            'TENANT_TABLES in src/db/rls.test.ts',
          line: lineOf(sql, m.index + stmt.offset),
        });
      }
    }
  }

  return findings.sort((a, b) => a.line - b.line);
}

const ACK_MARKER = /^[ \t]*--[ \t]*@destructive-ok:[ \t]*(\S.*)$/im;

/**
 * The reason someone wrote for accepting data loss, or `null` if there isn't
 * one.
 *
 * A `<placeholder>` does not count, and neither does a handful of characters.
 * The first version of this script printed the marker into every draft header
 * as a fill-in-the-blank template — which meant every draft acknowledged
 * itself and the gate never once fired. Generated files must therefore never
 * contain a literal example of the marker, and an unfilled one must not pass.
 */
function acknowledgement(sql: string): string | null {
  const reason = ACK_MARKER.exec(sql)?.[1]?.trim();
  if (!reason) return null;
  if (/^<.*>$/.test(reason)) return null;
  if (reason.length < 10) return null;
  return reason;
}

function printFindings(findings: Finding[], indent = '  '): void {
  for (const f of findings) {
    const tag = f.level === 'blocking' ? red('BLOCKING') : yellow('review  ');
    console.log(`${indent}${tag} ${dim(`line ${f.line}`)}  ${bold(f.id)} — ${f.why}`);
  }
}

// ---------------------------------------------------------------------------
// Migrations on disk
// ---------------------------------------------------------------------------

interface Migration {
  name: string;
  path: string;
  sql: string;
}

function migrationsOnDisk(): Migration[] {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, path: join(MIGRATIONS_DIR, d.name, 'migration.sql') }))
    .filter((m) => existsSync(m.path))
    .map((m) => ({ ...m, sql: readFileSync(m.path, 'utf8') }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Migrations on disk that the database has not recorded.
 *
 * When the applied set is unknown, every migration counts as pending. That
 * over-reports; the alternative under-reports, and this is the code path that
 * decides whether destructive SQL gets scanned.
 */
function pendingMigrations(all: Migration[], applied: Set<string> | null): Migration[] {
  if (applied === null) return all;
  return all.filter((m) => !applied.has(m.name));
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

/**
 * Password goes through the environment, not argv — argv is readable by every
 * other process on the machine.
 */
function pgToolEnv(url: string): NodeJS.ProcessEnv {
  const u = new URL(url);
  const caPath = process.env['DATABASE_SSL_CA_PATH'];
  return {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')),
    PGSSLMODE: u.searchParams.get('sslmode') ?? 'prefer',
    ...(caPath ? { PGSSLROOTCERT: resolve(BACKEND, caPath) } : {}),
  };
}

function findPgDump(): string | null {
  const candidates = [
    process.env['PG_DUMP'],
    'pg_dump',
    'pg_dump.exe',
    join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'pgAdmin 4', 'runtime', 'pg_dump.exe'),
  ].filter((c): c is string => typeof c === 'string' && c !== '');

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return candidate;
  }

  // `C:\Program Files\PostgreSQL\<major>\bin\pg_dump.exe`
  for (const root of ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL']) {
    if (!existsSync(root)) continue;
    for (const version of readdirSync(root).sort().reverse()) {
      const exe = join(root, version, 'bin', 'pg_dump.exe');
      if (existsSync(exe)) return exe;
    }
  }
  return null;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '');
}

/** Custom-format dump (`-Fc`), restorable with `pg_restore`, selectively. */
function backup(url: string, label: string): string | null {
  const exe = findPgDump();
  if (exe === null) return null;

  mkdirSync(BACKUP_DIR, { recursive: true });
  const file = join(BACKUP_DIR, `${timestamp()}-${label}.dump`);

  console.log(`  ${dim('pg_dump')} → ${cyan(file)}`);
  console.log(`  ${dim('a full dump over the network takes a while; leave it alone')}`);

  const res = spawnSync(exe, ['--format=custom', '--file', file], {
    env: pgToolEnv(url),
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  if (res.error || res.status !== 0) {
    die(
      'Backup failed — nothing was applied.',
      'Fix pg_dump (or pass --no-backup if you accept the risk) and run db:apply again.',
    );
  }
  return file;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdStatus(): Promise<void> {
  const url = databaseUrl();
  console.log(`\n${bold('Target')}  ${cyan(describeTarget(url))}`);

  const all = migrationsOnDisk();
  const applied = await appliedMigrationNames(url);
  const pending = pendingMigrations(all, applied);

  heading('Migrations');
  if (applied === null) {
    console.log(
      `  ${yellow('could not read _prisma_migrations')} — treating all ${all.length} as pending`,
    );
  } else {
    console.log(`  ${all.length} on disk, ${applied.size} applied`);

    // Recorded as applied but no longer on disk. Someone deleted or renamed a
    // migration directory after it ran, so this database's history and this
    // checkout's history are not the same history. `migrate deploy` tolerates
    // it, but a fresh database built from these files will NOT match this one.
    const onDisk = new Set(all.map((m) => m.name));
    const ghosts = [...applied].filter((name) => !onDisk.has(name)).sort();
    for (const name of ghosts) {
      console.log(`  ${yellow('applied but missing from disk')}  ${name}`);
    }
    if (ghosts.length > 0) {
      console.log(`  ${dim('a database rebuilt from prisma/migrations will not match this one')}`);
    }
  }
  if (pending.length === 0) {
    console.log(`  ${green('nothing pending')}`);
  } else {
    for (const m of pending) console.log(`  ${yellow('pending')}  ${m.name}`);
  }

  for (const m of pending) {
    const findings = analyse(m.sql);
    if (findings.length === 0) continue;
    console.log(`\n  ${bold(m.name)}${acknowledgement(m.sql) ? green('  [acknowledged]') : ''}`);
    printFindings(findings, '    ');
  }

  const drafts = draftsOnDisk();
  if (drafts.length > 0) {
    heading('Drafts — written, not promoted, applied by nothing');
    for (const d of drafts) {
      const blocking = analyse(d.sql).filter((f) => f.level === 'blocking').length;
      const state =
        blocking === 0
          ? green('ready to promote')
          : acknowledgement(d.sql)
            ? yellow(`${blocking} destructive, acknowledged`)
            : red(`${blocking} destructive, NOT acknowledged`);
      console.log(`  ${d.name}  ${state}`);
    }
    console.log(`  ${dim('promote with')} ${cyan('npm run db:promote')}`);
  }

  heading('Drift — schema files vs database');
  const sql = diffToSchema(false);
  if (isEmptySql(sql)) {
    console.log(`  ${green('in sync')}`);
  } else {
    const findings = analyse(sql);
    const blocking = findings.filter((f) => f.level === 'blocking').length;
    console.log(
      `  ${yellow('drifted')} — ${sql.split('\n').filter((l) => l.trim() !== '').length} lines of SQL would close the gap`,
    );
    printFindings(findings, '  ');
    console.log(
      `\n  Run ${cyan('npm run db:draft -- <name>')} to turn this into a draft you can edit.`,
    );
    if (blocking > 0) {
      console.log(
        `  ${red(`${blocking} statement(s) would destroy data as generated`)} — edit them before applying.`,
      );
    }
  }
  console.log('');
}

function cmdDraft(argv: string[]): void {
  const fromMigrations = argv.includes('--from-migrations');
  const rawName = argv.find((a) => !a.startsWith('-'));
  if (!rawName) {
    die('A migration name is required.', 'e.g. npm run db:draft -- rename_notes_to_remarks');
  }
  const name = rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  if (name === '') die('That name has no usable characters.');

  const sql = diffToSchema(fromMigrations);
  if (isEmptySql(sql)) {
    console.log(`\n${green('✔')} Schema files and database already agree — nothing to draft.\n`);
    return;
  }

  const findings = analyse(sql);
  const blocking = findings.filter((f) => f.level === 'blocking');
  const file = join(DRAFTS_DIR, `${timestamp()}_${name}.sql`);
  if (existsSync(file)) die(`${file} already exists — pick another name.`);

  const header = [
    `-- ${name}`,
    '--',
    '-- DRAFT — generated by `npm run db:draft`. Nothing applies this file: it is',
    '-- in prisma/drafts, not prisma/migrations, so `migrate deploy` cannot see it',
    '-- in any environment. `npm run db:promote` is the only way in.',
    '--',
    '-- `migrate diff` describes the SHAPE difference between the schema files and',
    '-- the database. It cannot know your INTENT, so it expresses a rename as a drop',
    '-- plus an add, and the data does not travel between them. Fix those by hand.',
    ...(blocking.length > 0
      ? [
          '--',
          `-- 🔴 ${blocking.length} statement(s) below destroy data as generated.`,
          '--    `npm run db:promote` will refuse this file until they are rewritten so',
          '--    the data survives — or until an acknowledgement line is added recording',
          '--    why the loss is fine. Run db:promote and it prints the exact line.',
          '--',
          '--    (No example of that line appears here on purpose: a template in the',
          '--    header would satisfy the check, and every draft would wave itself',
          '--    through.)',
        ]
      : []),
    '',
  ].join('\n');

  mkdirSync(DRAFTS_DIR, { recursive: true });
  writeFileSync(file, `${header}${annotate(sql, findings)}\n`, 'utf8');

  console.log(`\n${green('✔')} Draft written to ${cyan(file)}`);
  console.log(`  ${dim('nothing has touched the database, and nothing can apply this yet')}`);
  if (findings.length > 0) {
    console.log('');
    printFindings(findings, '  ');
  }
  console.log(`\n  Next: edit the file, then ${cyan('npm run db:promote')}\n`);
}

function draftsOnDisk(): { name: string; path: string; sql: string }[] {
  if (!existsSync(DRAFTS_DIR)) return [];
  return readdirSync(DRAFTS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({
      name: f.replace(/\.sql$/, ''),
      path: join(DRAFTS_DIR, f),
      sql: readFileSync(join(DRAFTS_DIR, f), 'utf8'),
    }));
}

/**
 * Move a reviewed draft into `prisma/migrations`.
 *
 * This is the gate that matters, because it is the only one that also protects
 * CI and production: after this, the file is applied by plain
 * `prisma migrate deploy` with no script of ours in the loop.
 */
function cmdPromote(argv: string[]): void {
  const drafts = draftsOnDisk();
  if (drafts.length === 0) {
    console.log(`\n${green('✔')} No drafts in prisma/drafts — nothing to promote.\n`);
    return;
  }

  const wanted = argv.find((a) => !a.startsWith('-'));
  const chosen = wanted
    ? drafts.filter((d) => d.name === wanted || d.name.endsWith(`_${wanted}`))
    : drafts;

  if (chosen.length === 0) {
    die(`No draft matching "${wanted}".`, `Available: ${drafts.map((d) => d.name).join(', ')}`);
  }

  for (const draft of chosen) {
    const findings = analyse(draft.sql);
    const blocking = findings.filter((f) => f.level === 'blocking');
    const ack = acknowledgement(draft.sql);

    console.log(`\n${bold(draft.name)}`);
    if (findings.length > 0) printFindings(findings, '  ');

    if (blocking.length > 0 && !ack) {
      die(
        `Refusing to promote ${draft.name} — destructive SQL with no acknowledgement.`,
        'The draft stays in prisma/drafts, where nothing can apply it.',
        '',
        'Either rewrite the statements so the data survives (ALTER TABLE ... RENAME',
        'COLUMN, or ADD + UPDATE-backfill + DROP), or record why the loss is fine:',
        '',
        '    -- @destructive-ok: dropped after backfilling into remarks',
        '',
        'Once promoted this file is applied by plain `prisma migrate deploy` in every',
        'environment, with no further prompt — which is why the gate is here.',
      );
    }

    const dir = join(MIGRATIONS_DIR, draft.name);
    if (existsSync(dir)) die(`${dir} already exists — rename the draft.`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'migration.sql'), draft.sql, 'utf8');
    rmSync(draft.path);

    console.log(`  ${green('✔')} promoted to ${cyan(join(dir, 'migration.sql'))}`);
    if (ack) console.log(`  ${dim(`@destructive-ok: ${ack}`)}`);
  }

  console.log(`\n  Next: ${cyan('npm run db:apply')}\n`);
}

/** Put each finding in the file as a comment, directly above its statement. */
function annotate(sql: string, findings: Finding[]): string {
  const byLine = new Map<number, Finding[]>();
  for (const f of findings) {
    const list = byLine.get(f.line);
    if (list) list.push(f);
    else byLine.set(f.line, [f]);
  }

  const out: string[] = [];
  sql.split('\n').forEach((line, index) => {
    for (const f of byLine.get(index + 1) ?? []) {
      out.push(`-- ${f.level === 'blocking' ? '🔴 BLOCKING' : '⚠️ REVIEW'} [${f.id}] ${f.why}`);
    }
    out.push(line);
  });
  return out.join('\n');
}

async function cmdApply(argv: string[]): Promise<void> {
  const skipBackup = argv.includes('--no-backup');
  const url = databaseUrl();
  console.log(`\n${bold('Target')}  ${cyan(describeTarget(url))}`);

  const applied = await appliedMigrationNames(url);
  const pending = pendingMigrations(migrationsOnDisk(), applied);

  if (pending.length === 0) {
    console.log(`\n${green('✔')} No pending migrations.`);
    if (!isEmptySql(diffToSchema(false))) {
      console.log(
        `  ${yellow('The schema files have drifted from the database.')}` +
          `\n  Run ${cyan('npm run db:draft -- <name>')} first — apply never improvises.\n`,
      );
    } else {
      console.log('');
    }
    return;
  }

  heading(`${pending.length} migration(s) to apply`);

  let refused = false;
  for (const m of pending) {
    const findings = analyse(m.sql);
    const blocking = findings.filter((f) => f.level === 'blocking');
    const ack = acknowledgement(m.sql);

    const status =
      blocking.length === 0
        ? green('safe')
        : ack
          ? yellow('destructive, acknowledged')
          : red('destructive, NOT acknowledged');
    console.log(`  ${m.name}  ${status}`);
    if (findings.length > 0) printFindings(findings, '    ');
    if (ack) console.log(`    ${dim(`@destructive-ok: ${ack}`)}`);
    if (blocking.length > 0 && !ack) refused = true;
  }

  if (refused) {
    die(
      'Refusing to apply — destructive SQL with no acknowledgement.',
      'Nothing has touched the database.',
      '',
      'For each migration marked NOT acknowledged, either:',
      '  • rewrite the statement so the data survives (RENAME COLUMN, or',
      '    ADD + UPDATE-backfill + DROP), or',
      '  • add a line to that migration.sql recording why the loss is fine:',
      '',
      '      -- @destructive-ok: dropped after backfilling into remarks',
      '',
      'The marker is committed with the SQL, so the reason outlives the decision.',
    );
  }

  if (skipBackup) {
    console.log(`\n${yellow('⚠ --no-backup')} — applying with no restore point.`);
  } else {
    heading('Backup');
    const file = backup(url, 'pre-apply');
    if (file === null) {
      die(
        'pg_dump not found — nothing was applied.',
        'Install PostgreSQL client tools, or set PG_DUMP to the executable, or',
        'pass --no-backup to proceed without a restore point.',
      );
    }
    console.log(`  ${green('✔')} ${file}`);
  }

  heading('Applying (prisma migrate deploy)');
  // `deploy` runs exactly the SQL in the files: never resets, never diffs,
  // never improvises. It is the only command here that writes to the database.
  if (runPrisma(['migrate', 'deploy'], false).code !== 0) {
    die('migrate deploy failed. The database is unchanged past the last successful migration.');
  }

  heading('Regenerating the Prisma client');
  if (runPrisma(['generate'], false).code !== 0) {
    die('prisma generate failed — the database is updated but the client is stale.');
  }

  heading('Verifying');
  const remaining = diffToSchema(false);
  if (isEmptySql(remaining)) {
    console.log(`  ${green('✔')} database and prisma/schema agree\n`);
  } else {
    console.log(`  ${yellow('still drifted')} — these differences remain:\n`);
    console.log(
      remaining
        .split('\n')
        .map((l) => `    ${dim(l)}`)
        .join('\n'),
    );
    console.log(`\n  Run ${cyan('npm run db:draft -- <name>')} for another round.\n`);
  }
}

function cmdBackup(): void {
  const url = databaseUrl();
  console.log(`\n${bold('Target')}  ${cyan(describeTarget(url))}\n`);
  const file = backup(url, 'manual');
  if (file === null) {
    die('pg_dump not found.', 'Install PostgreSQL client tools or set PG_DUMP to the executable.');
  }
  console.log(`\n${green('✔')} ${file}`);
  console.log(`  ${dim(`restore with: pg_restore --clean --if-exists -d <url> "${file}"`)}\n`);
}

/** `db push` and `migrate dev` both wipe data. Explain, then refuse. */
function cmdBlocked(which: string): never {
  const detail =
    which === 'push'
      ? [
          '`prisma db push` diffs the schema FILES against the live database and issues',
          'whatever DDL closes the gap — ignoring prisma/migrations entirely. Anything in',
          'the database but not in your schema files is something it removes, and an',
          'additive-looking push can still destroy data one migration later. It did, on',
          '2026-07-25: every organization lost its owner.',
        ]
      : [
          '`prisma migrate dev` offers to RESET the database whenever it detects drift,',
          'and this dev database drifts routinely because it is shared across branches.',
        ];

  console.error(`\n${red('✖')} ${bold(`This project does not use \`${which}\`.`)}\n`);
  for (const line of detail) console.error(`  ${line}`);
  console.error(`\n  ${bold('Use instead:')}`);
  console.error(`    ${cyan('npm run db:status')}           what is pending and what has drifted`);
  console.error(
    `    ${cyan('npm run db:draft -- <name>')}  write SQL to prisma/drafts (applies nothing)`,
  );
  console.error(
    `    ${cyan('npm run db:promote')}          draft → prisma/migrations, once reviewed`,
  );
  console.error(`    ${cyan('npm run db:apply')}            backup → deploy → generate → verify`);
  console.error(
    `\n  ${dim(`This is a speed bump, not a wall: \`npx prisma ${which}\` still exists.`)}`,
  );
  console.error(`  ${dim('Take a backup first — `npm run db:backup`.')}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);

  switch (command) {
    case 'status':
      await cmdStatus();
      return;
    case 'draft':
      cmdDraft(argv);
      return;
    case 'promote':
      cmdPromote(argv);
      return;
    case 'apply':
      await cmdApply(argv);
      return;
    case 'backup':
      cmdBackup();
      return;
    case 'blocked':
      cmdBlocked(argv[0] ?? 'that command');
      return;
    default:
      die(
        `Unknown command ${command ? `"${command}"` : ''}`.trim(),
        'status | draft <name> | promote [name] | apply | backup',
      );
  }
}

await main();
