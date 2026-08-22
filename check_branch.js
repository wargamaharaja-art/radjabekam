const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool1 = new Pool({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false } });
const pool2 = new Pool({ connectionString: 'postgresql://postgres.vpngoxdalvklmmoulmtp:radjabekam2024@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres', ssl: { rejectUnauthorized: false } });

async function check() {
  const c1 = await pool1.connect();
  const res1 = await c1.query("SELECT branch_id, type, SUM(amount) FROM finance_transactions WHERE date LIKE '2026-07-19%' GROUP BY branch_id, type");
  console.log('Radja Bekam 19 Jul by branch:');
  console.table(res1.rows);
  c1.release(); pool1.end();
  
  const c2 = await pool2.connect();
  const res2 = await c2.query("SELECT branch_id, type, SUM(amount) FROM finance_transactions WHERE date LIKE '2026-07-19%' GROUP BY branch_id, type");
  console.log('Navara Reflexology 19 Jul by branch:');
  console.table(res2.rows);
  c2.release(); pool2.end();
}
check();
