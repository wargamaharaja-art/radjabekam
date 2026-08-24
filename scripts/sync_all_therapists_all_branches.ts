import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

import { calculateCommissionAmount } from '../src/lib/commission';
import crypto from 'crypto';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log("=================================================================");
  console.log("   SINKRONISASI SELURUH KOMISI & RAPOR TERAPIS SEMUA CABANG     ");
  console.log("=================================================================\n");

  const client = await pool.connect();
  try {
    // 1. Fetch Master Services
    const servicesRes = await client.query("SELECT * FROM services");
    const serviceMap = new Map(servicesRes.rows.map(s => [s.id, s]));
    console.log(`✓ Master Services dimuat: ${servicesRes.rows.length} layanan`);

    // 2. Fetch All Patient Visits & Therapist Commissions
    const visitsRes = await client.query(`
      SELECT pv.*, p.name as patient_name, s.name as service_name, s.global_commission, s.price as service_price
      FROM patient_visits pv
      LEFT JOIN patients p ON pv.patient_id = p.id
      LEFT JOIN services s ON pv.service_id = s.id
    `);
    console.log(`✓ Data Kunjungan Pasien dimuat: ${visitsRes.rows.length} kunjungan`);

    const commsRes = await client.query("SELECT * FROM therapist_commissions");
    console.log(`✓ Data Komisi Terapis saat ini: ${commsRes.rows.length} baris\n`);

    // Group commissions by visit_id
    const commsByVisitId = new Map<string, any[]>();
    for (const c of commsRes.rows) {
      if (!commsByVisitId.has(c.visit_id)) commsByVisitId.set(c.visit_id, []);
      commsByVisitId.get(c.visit_id)!.push(c);
    }

    const visitById = new Map(visitsRes.rows.map(v => [v.id, v]));

    let duplicateDeleted = 0;
    let zeroDeleted = 0;
    let fixedAmounts = 0;
    let newCommissions = 0;

    const commIdsToDelete: string[] = [];
    const commsToUpdate: { id: string; amount: number }[] = [];
    const commsToInsert: any[] = [];

    // 3. Scan existing commissions for duplicates, zero items, and invalid amounts
    for (const [visitId, commList] of commsByVisitId.entries()) {
      const visit = visitById.get(visitId);
      if (!visit) {
        for (const c of commList) commIdsToDelete.push(c.id);
        continue;
      }

      const svc = serviceMap.get(visit.service_id);
      const expectedCommission = calculateCommissionAmount({
        serviceGlobalCommission: svc ? svc.global_commission : 0,
        servicePrice: svc ? svc.price : 0,
        qty: 1,
      });

      if (expectedCommission <= 0) {
        for (const c of commList) {
          commIdsToDelete.push(c.id);
          zeroDeleted++;
        }
      } else {
        if (commList.length > 1) {
          for (let i = 1; i < commList.length; i++) {
            commIdsToDelete.push(commList[i].id);
            duplicateDeleted++;
          }
        }
        const primary = commList[0];
        if (primary.amount !== expectedCommission || primary.status !== 'PAID') {
          commsToUpdate.push({ id: primary.id, amount: expectedCommission });
          fixedAmounts++;
        }
      }
    }

    // 4. Scan all completed + PAID visits missing commission rows
    for (const v of visitsRes.rows) {
      if (v.status === 'completed' && v.payment_status === 'PAID' && v.therapist_id && v.service_id) {
        const existingList = commsByVisitId.get(v.id) || [];
        const validList = existingList.filter(c => !commIdsToDelete.includes(c.id));

        const svc = serviceMap.get(v.service_id);
        const expectedCommission = calculateCommissionAmount({
          serviceGlobalCommission: svc ? svc.global_commission : 0,
          servicePrice: svc ? svc.price : 0,
          qty: 1,
        });

        if (expectedCommission > 0 && validList.length === 0) {
          commsToInsert.push({
            id: crypto.randomUUID(),
            therapist_id: v.therapist_id,
            visit_id: v.id,
            amount: expectedCommission,
            status: 'PAID',
            paid_at: v.created_at || new Date().toISOString(),
            created_at: v.created_at || new Date().toISOString(),
          });
          newCommissions++;
        }
      }
    }

    // Apply DB changes
    console.log("Menerapkan perbaikan komisi ke database...");
    if (commIdsToDelete.length > 0) {
      await client.query("DELETE FROM therapist_commissions WHERE id = ANY($1)", [commIdsToDelete]);
      console.log(`✓ Dihapus ${commIdsToDelete.length} komisi tidak valid / duplikat.`);
    }

    if (commsToUpdate.length > 0) {
      for (const u of commsToUpdate) {
        await client.query("UPDATE therapist_commissions SET amount = $1, status = 'PAID' WHERE id = $2", [u.amount, u.id]);
      }
      console.log(`✓ Dikoreksi ${commsToUpdate.length} nominal komisi.`);
    }

    if (commsToInsert.length > 0) {
      for (const ins of commsToInsert) {
        await client.query(`
          INSERT INTO therapist_commissions (id, therapist_id, visit_id, amount, status, paid_at, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [ins.id, ins.therapist_id, ins.visit_id, ins.amount, ins.status, ins.paid_at, ins.created_at]);
      }
      console.log(`✓ Diterbitkan ${commsToInsert.length} komisi baru.`);
    }

    // 5. Update and synchronize ALL saved reports in therapist_monthly_reports
    console.log("\nMensinkronkan seluruh rapor dan slip gaji yang tersimpan...");
    const savedReportsRes = await client.query("SELECT * FROM therapist_monthly_reports");
    let syncedReportsCount = 0;

    for (const r of savedReportsRes.rows) {
      let filterStartDate = r.start_date;
      let filterEndDate = r.end_date;

      if (!filterStartDate || !filterEndDate) {
        if (r.month) {
          const [year, m] = r.month.split("-");
          filterStartDate = `${year}-${m}-01`;
          const lastDay = new Date(parseInt(year), parseInt(m), 0).getDate();
          filterEndDate = `${year}-${m}-${String(lastDay).padStart(2, "0")}`;
        }
      }

      if (!filterStartDate || !filterEndDate) continue;

      // Hitung komisi aktual
      const commsSumRes = await client.query(`
        SELECT COALESCE(SUM(tc.amount), 0) as total_comm
        FROM therapist_commissions tc
        INNER JOIN patient_visits pv ON tc.visit_id = pv.id
        WHERE tc.therapist_id = $1
        AND pv.visit_date >= $2 AND pv.visit_date <= $3
      `, [r.therapist_id, filterStartDate, filterEndDate]);

      const actualComm = parseInt(commsSumRes.rows[0]?.total_comm) || 0;

      // Hitung total treatment aktual (dikelompokkan berdasarkan visitDate, visitTime, patientName/Id)
      const visitsCountRes = await client.query(`
        SELECT pv.visit_date, pv.visit_time, pv.patient_id, p.name as patient_name, pv.id
        FROM patient_visits pv
        LEFT JOIN patients p ON pv.patient_id = p.id
        LEFT JOIN therapist_commissions tc ON pv.id = tc.visit_id
        WHERE (pv.therapist_id = $1 OR tc.therapist_id = $1)
        AND pv.status = 'completed'
        AND pv.visit_date >= $2 AND pv.visit_date <= $3
      `, [r.therapist_id, filterStartDate, filterEndDate]);

      const uniqueVisits = new Set(visitsCountRes.rows.map(v => `${v.visit_date}_${v.visit_time}_${v.patient_name || v.patient_id || v.id}`));
      const actualTreatments = uniqueVisits.size;

      const newTakeHomePay = (r.base_salary || 0) + actualComm + (r.allowances || 0) + (r.bonuses || 0) - (r.deductions || 0);

      await client.query(`
        UPDATE therapist_monthly_reports
        SET commissions = $1, total_treatments = $2, take_home_pay = $3, updated_at = NOW()
        WHERE id = $4
      `, [actualComm, actualTreatments, newTakeHomePay, r.id]);

      syncedReportsCount++;
    }
    console.log(`✓ Berhasil mensinkronkan ${syncedReportsCount} rapor tersimpan.`);

    // 6. Comprehensive Verification for Period 2026-07-15 to 2026-08-14 across all branches
    console.log("\n=================================================================");
    console.log("   VERIFIKASI KONSISTENSI DATA TERAPIS (15 JUL 2026 - 14 AGU 2026)");
    console.log("=================================================================\n");

    const therapists = await client.query(`
      SELECT t.id, t.name, t.branch_id, b.name as branch_name, t.base_salary
      FROM therapists t
      LEFT JOIN branches b ON t.branch_id = b.id
      WHERE t.is_active = true
      ORDER BY b.name, t.name
    `);

    const checkPeriodStart = '2026-07-15';
    const checkPeriodEnd = '2026-08-14';

    const verificationResults: any[] = [];
    let matchCount = 0;

    for (const t of therapists.rows) {
      // 1. History Calculation
      const historyVisitsRes = await client.query(`
        SELECT 
          pv.id,
          pv.visit_date,
          pv.visit_time,
          pv.status,
          pv.payment_status,
          p.name as patient_name,
          pv.patient_id,
          s.name as service_name,
          s.price as service_price,
          s.global_commission,
          tc.id as comm_id,
          tc.amount as comm_amount,
          tc.status as comm_status
        FROM patient_visits pv
        LEFT JOIN patients p ON pv.patient_id = p.id
        LEFT JOIN services s ON pv.service_id = s.id
        LEFT JOIN therapist_commissions tc ON tc.visit_id = pv.id AND tc.therapist_id = $1
        WHERE (pv.therapist_id = $1 OR tc.therapist_id = $1)
        AND pv.visit_date >= $2 AND pv.visit_date <= $3
      `, [t.id, checkPeriodStart, checkPeriodEnd]);

      const groupedHistory = new Map();
      for (const v of historyVisitsRes.rows) {
        const key = `${v.visit_date}_${v.visit_time}_${v.patient_name || v.patient_id || v.id}`;
        if (!groupedHistory.has(key)) {
          groupedHistory.set(key, {
            status: v.status,
            commAmount: 0,
            visitedIds: new Set(),
            visitedCommVisitIds: new Set(),
            dbCommissionIds: new Set(),
          });
        }
        const g = groupedHistory.get(key);
        if (!g.visitedIds.has(v.id)) {
          g.visitedIds.add(v.id);
          if (v.status === 'in_progress') g.status = 'in_progress';
        }
        if (v.comm_id) {
          if (!g.visitedCommVisitIds.has(v.id)) {
            g.visitedCommVisitIds.add(v.id);
            if (!g.dbCommissionIds.has(v.comm_id)) {
              g.dbCommissionIds.add(v.comm_id);
              g.commAmount += (v.comm_amount || 0);
            }
          }
        }
      }

      const historyItems = Array.from(groupedHistory.values());
      const historyTreatments = historyItems.filter(v => v.status === 'completed').length;
      const historyCommissions = historyItems.reduce((s, i) => s + i.commAmount, 0);

      // 2. Reports Calculation
      const reportsCommRes = await client.query(`
        SELECT COALESCE(SUM(tc.amount), 0) as total_comm
        FROM therapist_commissions tc
        INNER JOIN patient_visits pv ON tc.visit_id = pv.id
        WHERE tc.therapist_id = $1
        AND pv.visit_date >= $2 AND pv.visit_date <= $3
      `, [t.id, checkPeriodStart, checkPeriodEnd]);
      const reportCommissions = parseInt(reportsCommRes.rows[0]?.total_comm) || 0;

      const reportVisitsRes = await client.query(`
        SELECT pv.visit_date, pv.visit_time, pv.patient_id, p.name as patient_name, pv.id
        FROM patient_visits pv
        LEFT JOIN patients p ON pv.patient_id = p.id
        LEFT JOIN therapist_commissions tc ON pv.id = tc.visit_id
        WHERE (pv.therapist_id = $1 OR tc.therapist_id = $1)
        AND pv.status = 'completed'
        AND pv.visit_date >= $2 AND pv.visit_date <= $3
      `, [t.id, checkPeriodStart, checkPeriodEnd]);
      const uniqueReportVisits = new Set(reportVisitsRes.rows.map(v => `${v.visit_date}_${v.visit_time}_${v.patient_name || v.patient_id || v.id}`));
      const reportTreatments = uniqueReportVisits.size;

      const isMatch = (historyTreatments === reportTreatments && historyCommissions === reportCommissions);
      if (isMatch) matchCount++;

      verificationResults.push({
        Cabang: t.branch_name || '-',
        Terapis: t.name,
        'Riwayat Pasien': `${historyTreatments} Tindakan`,
        'Slip Gaji Pasien': `${reportTreatments} Tindakan`,
        'Riwayat Komisi': `Rp ${historyCommissions.toLocaleString('id-ID')}`,
        'Slip Gaji Komisi': `Rp ${reportCommissions.toLocaleString('id-ID')}`,
        Status: isMatch ? '✓ SINKRON' : '✗ BEDA',
      });
    }

    console.table(verificationResults);
    console.log(`\nHasil Verifikasi: ${matchCount} dari ${therapists.rows.length} terapis 100% SINKRON.`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
