import { config } from "dotenv";
config({ path: ".env.local" }); 
import { Pool } from "pg";

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const res = await pool.query(`
    SELECT "invoice_number", "patient_name", "grand_total", "created_at", "payment_method"
    FROM "invoices" 
    WHERE "branch_id" = 'radja-bekam-mustika-jaya'
      AND "created_at" >= '2026-07-25 17:00:00Z'
      AND "created_at" <= '2026-07-26 17:00:00Z'
  `);
  
  console.log(`Raw PG query with time range returned: ${res.rows.length} rows.`);
  let sum = 0;
  for (const row of res.rows) {
    console.log(`${row.invoice_number}: ${row.patient_name} - ${row.grand_total} (${row.created_at}) [${row.payment_method}]`);
    sum += parseFloat(row.grand_total);
  }
  console.log(`Raw sum: ${sum}`);
  
  const hasMbaDwi = res.rows.some(r => r.patient_name === 'MBA DWI');
  console.log(`Has MBA DWI: ${hasMbaDwi}`);
  
  await pool.end();
}

run().then(() => process.exit(0)).catch(console.error);
