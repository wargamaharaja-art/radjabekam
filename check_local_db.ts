import { Pool } from "pg";

async function run() {
  try {
    const pool = new Pool({
      connectionString: "postgres://postgres:postgres@localhost:5432/radja-bekam"
    });

    const res = await pool.query(`SELECT count(*) FROM invoices`);
    console.log(`Local DB invoices count:`, res.rows[0].count);
    await pool.end();
  } catch (e) {
    console.error("Local DB error:", (e as Error).message);
  }
}

run().then(() => process.exit(0)).catch(console.error);
