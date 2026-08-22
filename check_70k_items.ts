import { Pool } from "pg";
import { config } from "dotenv";
config({ path: ".env.local" }); 

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const res = await pool.query(`
    SELECT invoice_number, patient_name, items, notes
    FROM invoices
    WHERE branch_id = 'radja-bekam-mustika-jaya'
      AND created_at LIKE '2026-07-26%'
      AND payment_method = 'CASH'
      AND grand_total = 70000
  `);
  
  console.log("Invoices with 70.000 CASH today:");
  for (const row of res.rows) {
    console.log(row.invoice_number, row.patient_name, row.items, row.notes);
  }
  
  await pool.end();
}

run().then(() => process.exit(0)).catch(console.error);
