import { Pool } from "pg";
import { config } from "dotenv";
config({ path: ".env.local" }); 

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const res = await pool.query(`
    SELECT id, name FROM therapists LIMIT 10
  `);
  
  console.log("Therapists:");
  console.log(res.rows);
  
  await pool.end();
}

run().then(() => process.exit(0)).catch(console.error);
