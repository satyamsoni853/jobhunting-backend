import pg from 'pg';

// Optional Postgres storage (for example a free Neon database). Set DATABASE_URL in the host's env to turn it on.
// Without it everything keeps using files, which a free Render instance loses on every restart.
// The connection string holds a password: it lives only in env, never in code or in the repo.
let pool = null;

export const dbEnabled = () => pool !== null;

const logErr = (what) => (e) => console.error(`DB ${what} failed:`, e.message);

// injected: a ready pool, used by the tests with an in-memory Postgres
export async function initDb(injected) {
  if (injected) {
    pool = injected;
  } else if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL.trim());
    url.searchParams.delete('channel_binding'); // Neon adds it, node-postgres does not support it
    pool = new pg.Pool({ connectionString: url.toString(), max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 });
    pool.on('error', logErr('pool'));
  } else {
    return false;
  }
  await pool.query(
    'create table if not exists contacts (email text primary key, data jsonb not null, updated_at timestamptz not null default now())'
  );
  await pool.query(
    'create table if not exists leads (email text primary key, data jsonb not null, updated_at timestamptz not null default now())'
  );
  await pool.query('create table if not exists kv (key text primary key, value text not null, updated_at timestamptz not null default now())');
  console.log('🗄️ Database connected, data is kept across restarts');
  return true;
}

// ---- mailed contacts ----
export async function loadContacts() {
  return (await pool.query('select email, data from contacts')).rows;
}

// Writes are not awaited: the memory copy is the source for the running server, the database is the backup
export function saveContact(email, data) {
  pool
    .query(
      'insert into contacts (email, data) values ($1, $2) on conflict (email) do update set data = excluded.data, updated_at = now()',
      [email, JSON.stringify(data)]
    )
    .catch(logErr('save contact'));
}

// ---- every address ever found, whatever happened to it (queued, mailed, skipped, cancelled) ----
export async function loadLeads() {
  return (await pool.query('select email, data from leads')).rows;
}

export function saveLead(email, data) {
  pool
    .query('insert into leads (email, data) values ($1, $2) on conflict (email) do update set data = excluded.data, updated_at = now()', [email, JSON.stringify(data)])
    .catch(logErr('save lead'));
}

// ---- small settings (encrypted SMTP login, chosen job categories) ----
export async function getKv(key) {
  const r = await pool.query('select value from kv where key = $1', [key]);
  return r.rows[0]?.value ?? null;
}

export function setKv(key, value) {
  pool
    .query('insert into kv (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()', [key, value])
    .catch(logErr(`save ${key}`));
}

export function delKv(key) {
  pool.query('delete from kv where key = $1', [key]).catch(logErr(`delete ${key}`));
}
