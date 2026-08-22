import { Pool } from "pg";
import { config } from "dotenv";
config({ path: ".env.local" }); 
import { randomUUID } from "crypto";

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const now = "2026-07-26T14:14:15.000Z";
  const therapistId = "0a6c422e-e9d8-415b-a960-c1aff5fe9d1c";
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert the patient if not exists
    const patientCheck = await client.query(`SELECT id FROM patients WHERE id = 'P-1785073151821'`);
    if (patientCheck.rows.length === 0) {
      await client.query(`
        INSERT INTO patients (id, name, phone, branch_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, ["P-1785073151821", "MBA DWI", "0812345678", "radja-bekam-mustika-jaya", now, now]);
    }

    // Insert the visit with a valid service ID and therapist ID
    await client.query(`
      INSERT INTO patient_visits (
        id, patient_id, service_id, branch_id, therapist_id, visit_date, visit_time,
        status, payment_status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      )
    `, [
      "V-1785073167195-2015", "P-1785073151821", "SRV-1783585074200", 
      "radja-bekam-mustika-jaya", therapistId, "2026-07-26", "14:00",
      "completed", "PAID", now, now
    ]);
    
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
    const invoiceId = randomUUID();

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
      therapistId, "Abdul Hafid Alansori", "radja-bekam-mustika-jaya", "Radja Bekam Mustika Jaya", 
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
      randomUUID(), "INCOME", "Pendapatan Layanan", 254000, "Struk " + invoiceNumber + " - MBA DWI", invoiceId, "radja-bekam-mustika-jaya", "QRIS", now
    ]);
    
    // Also add therapist commission
    await client.query(`
      INSERT INTO therapist_commissions (
        id, therapist_id, visit_id, amount, status, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6
      )
    `, [
      randomUUID(), therapistId, "V-1785073167195-2015", 60000, "PENDING", now
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
