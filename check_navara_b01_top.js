const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres.vpngoxdalvklmmoulmtp:radjabekam2024@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres', ssl: { rejectUnauthorized: false } });

async function check() {
  const c = await pool.connect();
  const res1 = await c.query("SELECT category, SUM(amount) FROM finance_transactions WHERE type = 'EXPENSE' AND date LIKE '2026-07-19%' AND branch_id = 'B01' GROUP BY category ORDER BY SUM(amount) DESC");
  console.log('Categories for B01 Expenses on 19 Jul:');
  console.table(res1.rows);
  
  const res2 = await c.query("SELECT amount, description, category FROM finance_transactions WHERE type = 'EXPENSE' AND date LIKE '2026-07-19%' AND branch_id = 'B01' ORDER BY amount DESC LIMIT 10");
  console.log('Top 10 Largest Expenses for B01 on 19 Jul:');
  console.table(res2.rows);
  
  c.release(); pool.end();
}
check();
