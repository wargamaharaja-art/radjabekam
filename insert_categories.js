const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const crypto = require('crypto');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function run() {
  const categories = [
    { name: 'biaya penyusutan sewa ruko', type: 'EXPENSE' },
    { name: 'biaya sistem kasir', type: 'EXPENSE' }
  ];
  
  for (const cat of categories) {
    const id = crypto.randomUUID();
    try {
      await pool.query(`INSERT INTO finance_categories (id, name, type, is_active) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING`, [id, cat.name, cat.type]);
      console.log(`Inserted ${cat.name}`);
    } catch (e) {
      console.error(`Failed to insert ${cat.name}:`, e.message);
    }
  }
  
  pool.end();
}
run();
