import { Pool } from "pg";
import { config } from "dotenv";
config({ path: ".env.local" }); 

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const res = await pool.query(`
    SELECT description, payment_method, amount
    FROM finance_transactions
    WHERE branch_id = 'radja-bekam-mustika-jaya'
      AND date LIKE '2026-07-26%'
      AND payment_method = 'DEBIT'
  `);
  
  console.log("DEBIT transactions today:");
  console.log(res.rows);
  
  await pool.end();
}

run().then(() => process.exit(0)).catch(console.error);
