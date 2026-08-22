const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres.vpngoxdalvklmmoulmtp:radjabekam2024@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres', ssl: { rejectUnauthorized: false } });

async function check() {
  const c = await pool.connect();
  const res = await c.query("SELECT amount, description, category FROM finance_transactions WHERE type = 'EXPENSE' AND date LIKE '2026-07-19%' AND branch_id = 'B01' ORDER BY amount DESC");
  console.log('Navara Reflexology B01 Expenses on 19 Jul:');
  console.table(res.rows);
  c.release(); pool.end();
}
check();
