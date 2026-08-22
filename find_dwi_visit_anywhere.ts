import { Pool } from "pg";
import { config } from "dotenv";
config({ path: ".env.local" }); 

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const res = await pool.query(`
    SELECT pv.id, pv.visit_date, p.name as patient_name, pv.branch_id
    FROM patient_visits pv
    JOIN patients p ON pv.patient_id = p.id
    WHERE p.name LIKE '%DWI%'
  `);
  
  console.log("Visits found for DWI anywhere:");
  console.log(res.rows);
  
  await pool.end();
}

run().then(() => process.exit(0)).catch(console.error);
