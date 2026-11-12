import { Pool, types } from 'pg';
import { env } from './env';

// All timestamps are stored and read as UTC.
process.env.TZ = 'UTC';

// COUNT(*) and SUM(int) come back as BIGINT; return them as JS numbers.
types.setTypeParser(types.builtins.INT8, (v) => parseInt(v, 10));

const isLocal = /localhost|127\.0\.0\.1/.test(env.DATABASE_URL);

const pgPool = new Pool({
  connectionString: env.DATABASE_URL,
  // Supabase requires TLS. Set DATABASE_CA_CERT to also verify the server certificate.
  ssl: isLocal
    ? undefined
    : env.DATABASE_CA_CERT
      ? { ca: env.DATABASE_CA_CERT }
      : { rejectUnauthorized: false },
  // Serverless instances each hold their own pool, so keep it small.
  max: 5,
  idleTimeoutMillis: 10_000,
});

export interface WriteResult {
  insertId: number;
  affectedRows: number;
}

/** Convert `?` placeholders to Postgres `$1, $2, …`, skipping quoted strings. */
function toPositional(sql: string): string {
  let n = 0;
  let inString = false;
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") inString = !inString;
    out += ch === '?' && !inString ? `$${++n}` : ch;
  }
  return out;
}

/**
 * Run a query. Resolves to a one-element tuple so callers can destructure:
 *   const [rows]   = await pool.query<any[]>('SELECT …', [params]);
 *   const [result] = await pool.query<any>('INSERT …', [params]);  // result.insertId
 */
async function query<T = any>(sql: string, params: unknown[] = []): Promise<[T]> {
  let text = toPositional(sql);
  const isInsert = /^\s*INSERT\b/i.test(text);
  if (isInsert && !/\bRETURNING\b/i.test(text)) text += ' RETURNING id';

  const res = await pgPool.query(text, params as any[]);

  if (res.command === 'SELECT') return [res.rows as unknown as T];

  const result: WriteResult = {
    insertId: isInsert ? res.rows[0]?.id ?? 0 : 0,
    affectedRows: res.rowCount ?? 0,
  };
  return [result as unknown as T];
}

export const pool = { query, end: () => pgPool.end() };
