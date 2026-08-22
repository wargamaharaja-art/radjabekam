import { Pool } from "pg";
import { config } from "dotenv";
config({ path: ".env.local" }); 

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const res = await pool.query(`
    SELECT pv.id, pv.notes, i.patient_name, i.payment_method
    FROM invoices i
    JOIN patient_visits pv ON i.visit_id = pv.id
    WHERE i.branch_id = 'radja-bekam-mustika-jaya'
      AND i.created_at LIKE '2026-07-26%'
      AND i.payment_method = 'CASH'
      AND i.grand_total = 70000
  `);
  
  console.log("Visit notes for 70k CASH:");
  console.log(res.rows);
  
  await pool.end();
}

run().then(() => process.exit(0)).catch(console.error);
