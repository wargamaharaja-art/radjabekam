import { Pool } from "pg";
import { config } from "dotenv";
config({ path: ".env.local" }); 

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Update invoice
    const invRes = await client.query(`
      UPDATE invoices
      SET payment_method = 'QRIS'
      WHERE invoice_number = 'INV-RAD-20260726-118'
      RETURNING id, patient_name
    `);
    
    console.log("Updated invoice:", invRes.rows);
    
    // Update finance transaction for the income
    const finRes = await client.query(`
      UPDATE finance_transactions
      SET payment_method = 'QRIS'
      WHERE description LIKE 'Struk INV-RAD-20260726-118%'
      RETURNING id, description
    `);
    
    console.log("Updated finance transaction:", finRes.rows);

    await client.query('COMMIT');
    console.log("Successfully changed BAPAK ADI 70.000 to QRIS.");
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Error updating:", e);
  } finally {
    client.release();
    await pool.end();
  }
}

run().then(() => process.exit(0)).catch(console.error);
