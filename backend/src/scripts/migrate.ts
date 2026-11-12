/**
 * migrate.ts
 *
 * Applies sql/schema.sql to the database in DATABASE_URL.
 * Pass --seed to also load the demo data in sql/seed.sql.
 *
 * Usage:
 *   npm run migrate
 *   npm run migrate -- --seed
 *
 * Run this against an empty database only: the schema uses plain CREATE TABLE.
 */

import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

async function migrate(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const client = new Client({
    connectionString: url,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();

  const sqlDir = path.resolve(__dirname, '../../sql');
  const files = ['schema.sql', ...(process.argv.includes('--seed') ? ['seed.sql'] : [])];

  try {
    for (const file of files) {
      console.log(`Running ${file}…`);
      await client.query(fs.readFileSync(path.join(sqlDir, file), 'utf-8'));
    }
    console.log('Migration complete.');
  } finally {
    await client.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
