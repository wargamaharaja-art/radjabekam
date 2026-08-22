const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  const c = await pool.connect();
  const res = await c.query("SELECT amount, description, category, branch_id FROM finance_transactions WHERE type = 'EXPENSE' AND date LIKE '2026-07-19%' ORDER BY amount DESC");
  console.log('Radja Bekam Expenses on 19 Jul:');
  console.table(res.rows);
  
  const sumRes = await c.query("SELECT SUM(amount) FROM finance_transactions WHERE type = 'EXPENSE' AND date LIKE '2026-07-19%'");
  console.log('Total:', sumRes.rows[0].sum);
  c.release(); pool.end();
}
check();
