import { config } from "dotenv";
config({ path: ".env.local" }); 
import { Pool } from "pg";

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const res = await pool.query(`
    SELECT * FROM invoices WHERE invoice_number = 'INV-RAD-20260726-150'
  `);
  
  console.log(res.rows);
  
  await pool.end();
}

run().then(() => process.exit(0)).catch(console.error);
