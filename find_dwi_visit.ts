import { Pool } from "pg";
import { config } from "dotenv";
config({ path: ".env.local" }); 

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const res = await pool.query(`
    SELECT pv.id, pv.visit_date, p.name as patient_name
    FROM patient_visits pv
    JOIN patients p ON pv.patient_id = p.id
    WHERE pv.visit_date LIKE '2026-07-26%'
      AND p.name LIKE '%DWI%'
      AND pv.branch_id = 'radja-bekam-mustika-jaya'
  `);
  
  console.log("Visits found:");
  console.log(res.rows);
  
  await pool.end();
}

run().then(() => process.exit(0)).catch(console.error);
