import { Pool } from "pg";
import { config } from "dotenv";
config({ path: ".env.local" }); 

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const res = await pool.query(`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'patient_name'
  `);
  
  console.log(res.rows);
  await pool.end();
}

run().then(() => process.exit(0)).catch(console.error);
