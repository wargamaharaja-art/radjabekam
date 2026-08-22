import { Pool } from "pg";
import { config } from "dotenv";
config({ path: ".env.local" }); 

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const res = await pool.query(`
    SELECT invoice_number, patient_name, grand_total, notes
    FROM invoices
    WHERE branch_id = 'radja-bekam-mustika-jaya'
      AND created_at LIKE '2026-07-26%'
      AND payment_method = 'CASH'
  `);
  
  console.log("All CASH invoices today:");
  console.log(res.rows);
  
  await pool.end();
}

run().then(() => process.exit(0)).catch(console.error);
