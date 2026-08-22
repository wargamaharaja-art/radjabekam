import { config } from "dotenv";
config({ path: ".env.local" }); 
import { Pool } from "pg";

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const res = await pool.query(`
    SELECT "invoice_number", "patient_name", "grand_total" 
    FROM "invoices" 
    WHERE "created_at" LIKE '2026-07-26%' 
      AND "branch_id" = 'radja-bekam-mustika-jaya'
  `);
  
  console.log(`Raw PG query returned: ${res.rows.length} rows.`);
  let sum = 0;
  for (const row of res.rows) {
    sum += parseFloat(row.grand_total);
  }
  console.log(`Raw sum: ${sum}`);
  
  const hasMbaDwi = res.rows.some(r => r.patient_name === 'MBA DWI');
  console.log(`Has MBA DWI: ${hasMbaDwi}`);
  
  await pool.end();
}

run().then(() => process.exit(0)).catch(console.error);
