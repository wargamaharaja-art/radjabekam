import { Pool } from "pg";
import { config } from "dotenv";
config({ path: ".env.local" }); 

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const res = await pool.query(`
    SELECT patient_name, grand_total, count(*) as count
    FROM invoices
    WHERE branch_id = 'radja-bekam-mustika-jaya'
      AND created_at LIKE '2026-07-26%'
    GROUP BY patient_name, grand_total
    HAVING count(*) > 1
  `);
  
  console.log("Duplicate data:");
  console.log(res.rows);
  
  await pool.end();
}

run().then(() => process.exit(0)).catch(console.error);
