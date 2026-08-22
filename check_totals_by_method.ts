import { Pool } from "pg";
import { config } from "dotenv";
config({ path: ".env.local" }); 

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const res = await pool.query(`
    SELECT payment_method, SUM(amount) as total
    FROM finance_transactions
    WHERE branch_id = 'radja-bekam-mustika-jaya'
      AND date LIKE '2026-07-26%'
      AND type = 'INCOME'
    GROUP BY payment_method
  `);
  
  console.log("Current Totals in Finance Transactions:");
  for (const row of res.rows) {
    console.log(`${row.payment_method}: ${row.total}`);
  }

  const res2 = await pool.query(`
    SELECT payment_method, SUM(grand_total) as total
    FROM invoices
    WHERE branch_id = 'radja-bekam-mustika-jaya'
      AND created_at LIKE '2026-07-26%'
    GROUP BY payment_method
  `);
  
  console.log("\nCurrent Totals in Invoices:");
  for (const row of res2.rows) {
    console.log(`${row.payment_method}: ${row.total}`);
  }
  
  await pool.end();
}

run().then(() => process.exit(0)).catch(console.error);
