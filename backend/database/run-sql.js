// One-off SQL runner (no psql required). Loads backend/.env and executes a .sql file.
// Usage (from project root):
//   node backend/database/run-sql.js backend/database/migration_admin_readers.sql
import fs from 'fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: 'backend/.env' });

const file = process.argv[2];
if (!file) {
    console.error('Usage: node backend/database/run-sql.js <path-to.sql>');
    process.exit(1);
}

const sql = fs.readFileSync(file, 'utf8');
const pool = new pg.Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
});

try {
    await pool.query(sql);
    console.log(`✅ Applied ${file}`);
} catch (e) {
    console.error(`❌ Failed: ${e.message}`);
    process.exitCode = 1;
} finally {
    await pool.end();
}
