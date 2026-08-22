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
      AND (description LIKE '%ADI%' OR description LIKE '%MAHMUD%' OR description LIKE '%TRI HANDAYANI%')
  `);
  
  console.log("Finance transactions for the 3 patients:");
  console.log(res.rows);
  
  await pool.end();
}

run().then(() => process.exit(0)).catch(console.error);
