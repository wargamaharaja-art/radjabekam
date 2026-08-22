const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres.sjsrhuvcigxxhgjebatr:radjabekam2024@aws-1-ap-south-1.pooler.supabase.com:6543/postgres' });
async function check() {
  try {
    const res2 = await pool.query("SELECT pv.id, pv.visit_date, pv.visit_time, s.name, tc.amount FROM patient_visits pv LEFT JOIN therapist_commissions tc ON pv.id = tc.visit_id LEFT JOIN services s ON pv.service_id = s.id WHERE pv.patient_id = 'P-1784020905536'");
    console.log("Visits for Ibu Wiyanti:", res2.rows);
    pool.end();
  } catch(e) {
    console.error(e);
    pool.end();
  }
}
check();
