import { config } from "dotenv";
config({ path: ".env.local" }); 
import { Pool } from "pg";

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const res = await pool.query(`
    SELECT * FROM "patient_visits" LIMIT 1
  `);
  
  console.log(`patient_visits columns:`, Object.keys(res.rows[0]));
  
  await pool.end();
}

run().then(() => process.exit(0)).catch(console.error);
