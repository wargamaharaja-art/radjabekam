import { Pool } from "pg";
import { config } from "dotenv";
config({ path: ".env.local" }); 

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const res = await pool.query(`
    SELECT SUM(amount) as total
    FROM finance_transactions
    WHERE branch_id = 'radja-bekam-mustika-jaya'
      AND payment_method = 'QRIS'
      AND date LIKE '2026-07-26%'
      AND type = 'INCOME'
  `);
  
  console.log("Total QRIS for Mustika Jaya today:", res.rows[0].total);
  
  await pool.end();
}

run().then(() => process.exit(0)).catch(console.error);
