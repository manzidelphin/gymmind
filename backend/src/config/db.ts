import mysql from 'mysql2/promise';
import { env } from './env';

// Create a connection pool. All queries go through this pool.
// pool.query() automatically acquires and releases connections.
export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Return JS Date objects for DATE/DATETIME columns
  dateStrings: false,
  timezone: '+00:00',
});
