/**
 * migrate.ts
 *
 * Drops and recreates the gymmind database, then runs schema.sql + seed.sql.
 *
 * Usage:
 *   npx ts-node src/scripts/migrate.ts
 *
 * WARNING: This destroys all existing data. Development use only.
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const DB_HOST     = process.env.DB_HOST     ?? 'localhost';
const DB_PORT     = Number(process.env.DB_PORT ?? 3306);
const DB_USER     = process.env.DB_USER     ?? 'root';
const DB_PASSWORD = process.env.DB_PASSWORD ?? '';
const DB_NAME     = process.env.DB_NAME     ?? 'gymmind';

async function runSqlFile(connection: mysql.Connection, filePath: string): Promise<void> {
  const sql = fs.readFileSync(filePath, 'utf-8');

  // Strip single-line comments, then split on semicolons
  const stripped = sql.replace(/--[^\n]*/g, '');
  const statements = stripped
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const statement of statements) {
    await connection.query(statement);
  }
}

async function migrate(): Promise<void> {
  // Connect without selecting a database so we can (re)create it
  const connection = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    multipleStatements: false,
  });

  try {
    console.log(`Dropping database '${DB_NAME}' if it exists…`);
    await connection.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);

    console.log(`Creating database '${DB_NAME}'…`);
    await connection.query(
      `CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );

    await connection.query(`USE \`${DB_NAME}\``);

    const sqlDir = path.join(__dirname, '../../sql');

    console.log('Running schema.sql…');
    await runSqlFile(connection, path.join(sqlDir, 'schema.sql'));

    console.log('Running seed.sql…');
    await runSqlFile(connection, path.join(sqlDir, 'seed.sql'));

    console.log('✅  Migration complete.');
  } finally {
    await connection.end();
  }
}

migrate().catch(err => {
  console.error('❌  Migration failed:', err.message);
  process.exit(1);
});
