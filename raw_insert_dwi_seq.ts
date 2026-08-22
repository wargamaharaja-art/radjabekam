import { config } from "dotenv";
config({ path: ".env.local" }); 
import { Pool } from "pg";
import { randomUUID } from "crypto";

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const now = "2026-07-26T14:14:15.000Z";
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const invoiceId = randomUUID();
    const finTrxId = randomUUID();
    
    // Check if MBA DWI already exists in invoices (just in case)
    const check = await client.query(`SELECT id FROM invoices WHERE patient_name = 'MBA DWI' AND created_at LIKE '2026-07-26%'`);
    if (check.rows.length > 0) {
      console.log("Already exists!");
      await client.query('ROLLBACK');
      return;
    }
    
    // Find highest invoice sequence across ALL branches for today
    const seqCheck = await client.query(`
      SELECT invoice_number FROM invoices 
      WHERE invoice_number LIKE 'INV-RAD-20260726-%'
    `);
    
    let maxSeq = 0;
    for (const r of seqCheck.rows) {
      const parts = r.invoice_number.split('-');
      const num = parseInt(parts[parts.length - 1]);
      if (num > maxSeq) maxSeq = num;
    }
    const nextSeq = String(maxSeq + 1).padStart(3, "0");
    const invoiceNumber = `INV-RAD-20260726-${nextSeq}`;

    await client.query(`
      INSERT INTO invoices (
        id, invoice_number, visit_id, patient_id, patient_name, patient_phone,
        therapist_id, therapist_name, branch_id, branch_name, branch_address, branch_phone,
        items, subtotal, discount, tax, grand_total, payment_method, amount_paid, change_amount,
        notes, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
      )
    `, [
      invoiceId, invoiceNumber, "V-1785073167195-2015", "P-1785073151821", "MBA DWI", "0812345678",
      "cm67x001o001e30m8fcyu38er", "Erlina", "radja-bekam-mustika-jaya", "Radja Bekam Mustika Jaya", 
      "Alamat", "Phone", 
      JSON.stringify([
        {"id":"34df37f4-2795-4eb8-b986-cd8201a3cdfd","name":"Bekam Estetika / Bekam Jerawat","price":135000,"komisi":35000,"type":"Treatment","duration":60,"komisiTerapis":35000},
        {"id":"1340a6b7-a89c-48be-8eb4-9db2c1a601bb","name":"Totok Wajah","price":70000,"komisi":15000,"type":"Treatment","duration":30,"komisiTerapis":15000},
        {"id":"cb8d9dc1-37fa-4467-9c98-ed37699d45e5","name":"Gua Sha Wajah","price":49000,"komisi":10000,"type":"Treatment","duration":20,"komisiTerapis":10000}
      ]),
      254000, 0, 0, 254000, "QRIS", 254000, 0, "Rekap ulang otomatis dari visit", now
    ]);

    await client.query(`
      INSERT INTO finance_transactions (
        id, type, category, amount, description, reference_id, branch_id, payment_method, date
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      )
    `, [
      finTrxId, "INCOME", "Pendapatan Layanan", 254000, "Struk " + invoiceNumber + " - MBA DWI", invoiceId, "radja-bekam-mustika-jaya", "QRIS", now
    ]);
    
    // Also add therapist commission
    await client.query(`
      INSERT INTO therapist_commissions (
        id, therapist_id, visit_id, amount, status, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6
      )
    `, [
      randomUUID(), "cm67x001o001e30m8fcyu38er", "V-1785073167195-2015", 60000, "PENDING", now
    ]);
    
    await client.query('COMMIT');
    console.log(`Raw insert success! Invoice ${invoiceNumber}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Error inserting:", e);
  } finally {
    client.release();
    await pool.end();
  }
}

run().then(() => process.exit(0)).catch(console.error);
