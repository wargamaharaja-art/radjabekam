const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres.vpngoxdalvklmmoulmtp:radjabekam2024@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres', ssl: { rejectUnauthorized: false } });

async function check() {
  const c = await pool.connect();
  const sumRes = await c.query("SELECT SUM(amount) FROM finance_transactions WHERE type = 'EXPENSE' AND date LIKE '2026-07-19%'");
  console.log('Total Navara Expense:', sumRes.rows[0].sum);
  const incRes = await c.query("SELECT SUM(amount) FROM finance_transactions WHERE type = 'INCOME' AND date LIKE '2026-07-19%'");
  console.log('Total Navara Income:', incRes.rows[0].sum);
  
  const res = await c.query("SELECT amount, description, category, branch_id FROM finance_transactions WHERE type = 'EXPENSE' AND date LIKE '2026-07-19%' ORDER BY amount DESC LIMIT 5");
  console.table(res.rows);
  c.release(); pool.end();
}
check();
