import * as dotenv from "dotenv";
dotenv.config();

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/lib/db/schema";
import {
  therapists,
  therapistCommissions,
  services,
  patientVisits,
  invoices,
  therapistMonthlyReports,
} from "../src/lib/db/schema";
import { eq, and, like, inArray } from "drizzle-orm";
import { calculateCommissionAmount } from "../src/lib/commission";
import crypto from "crypto";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const db = drizzle(pool, { schema });

async function repairHistoricalCommissions() {
  console.log("=================================================================");
  console.log("  REPARASI SELURUH HISTORI KOMISI & BUKU PASIEN (RADJA BEKAM)   ");
  console.log("=================================================================\n");

  console.log("Memuat data ke memori...");
  const [allServices, allInvoices, allVisits, allComms, allReports] = await Promise.all([
    db.select().from(services),
    db.select().from(invoices).orderBy(invoices.createdAt),
    db.select().from(patientVisits),
    db.select().from(therapistCommissions),
    db.select().from(therapistMonthlyReports),
  ]);

  console.log(`✓ Master Services: ${allServices.length}`);
  console.log(`✓ Invoices: ${allInvoices.length}`);
  console.log(`✓ Patient Visits: ${allVisits.length}`);
  console.log(`✓ Existing Commissions: ${allComms.length}`);
  console.log(`✓ Monthly Reports: ${allReports.length}\n`);

  // Build In-Memory Indexes
  const serviceMap = new Map(allServices.map((s) => [s.id, s]));
  
  // Index visits by "patientId|visitDate"
  const visitsByPatientDate = new Map<string, typeof allVisits>();
  allVisits.forEach((v) => {
    const key = `${v.patientId}|${v.visitDate}`;
    if (!visitsByPatientDate.has(key)) visitsByPatientDate.set(key, []);
    visitsByPatientDate.get(key)!.push({ ...v });
  });

  // Index visits by id
  const visitById = new Map(allVisits.map((v) => [v.id, { ...v }]));

  // Index commissions by visitId
  const commsByVisitId = new Map<string, typeof allComms>();
  allComms.forEach((c) => {
    if (!commsByVisitId.has(c.visitId)) commsByVisitId.set(c.visitId, []);
    commsByVisitId.get(c.visitId)!.push({ ...c });
  });

  const affectedTherapistMonths = new Set<string>(); // "therapistId|YYYY-MM"

  const visitsToUpdatePaid: { id: string; therapistId?: string | null; updatedAt: string }[] = [];
  const visitsToInsert: typeof patientVisits.$inferInsert[] = [];
  const commsToInsert: typeof therapistCommissions.$inferInsert[] = [];
  const commsToUpdate: { id: string; amount: number }[] = [];
  const commsToDelete: string[] = [];

  for (const inv of allInvoices) {
    if (!inv.items) continue;

    let items: any[] = [];
    try {
      items = JSON.parse(inv.items);
    } catch {
      continue;
    }

    if (!Array.isArray(items) || items.length === 0) continue;

    const invDateStr = inv.createdAt ? inv.createdAt.substring(0, 10) : "";
    const therapistId = inv.therapistId;
    const patientId = inv.patientId;
    const branchId = inv.branchId;

    if (!patientId || !invDateStr) continue;

    const patientDateKey = `${patientId}|${invDateStr}`;
    const patientVisitsForDay = visitsByPatientDate.get(patientDateKey) || [];

    // 1. Cek kunjungan yang masih UNPAID
    for (const v of patientVisitsForDay) {
      if (v.paymentStatus === "UNPAID" || v.status !== "completed") {
        v.paymentStatus = "PAID";
        v.status = "completed";
        if (therapistId && !v.therapistId) v.therapistId = therapistId;
        visitsToUpdatePaid.push({
          id: v.id,
          therapistId: v.therapistId || therapistId,
          updatedAt: inv.createdAt,
        });
      }
    }

    // 2. Petakan setiap item di invoice ke visit
    const availableVisits = [...patientVisitsForDay];

    for (const item of items) {
      const serviceId = item.serviceId;
      if (!serviceId) continue;

      let matchedVisitId = "";
      const vIdx = availableVisits.findIndex((v) => v.serviceId === serviceId);
      if (vIdx >= 0) {
        matchedVisitId = availableVisits.splice(vIdx, 1)[0].id;
      } else {
        // Buat record visit baru untuk item ini jika belum ada
        matchedVisitId = `V-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        const newVisit: typeof patientVisits.$inferInsert = {
          id: matchedVisitId,
          patientId: patientId,
          serviceId: serviceId,
          branchId: branchId,
          therapistId: therapistId || null,
          visitDate: invDateStr,
          visitTime: inv.createdAt.split("T")[1]?.substring(0, 5) || "12:00",
          status: "completed",
          paymentStatus: "PAID",
          createdAt: inv.createdAt,
          updatedAt: inv.createdAt,
        };
        visitsToInsert.push(newVisit);
        patientVisitsForDay.push(newVisit as any);
        visitById.set(matchedVisitId, newVisit as any);
      }

      // 3. Hitung komisi
      if (therapistId) {
        const svc = serviceMap.get(serviceId);
        const expectedCommission = calculateCommissionAmount({
          serviceGlobalCommission: svc ? svc.globalCommission : 0,
          servicePrice: svc ? svc.price : 0,
          qty: item.qty || 1,
        });

        const monthStr = invDateStr.substring(0, 7);
        const existingComms = commsByVisitId.get(matchedVisitId) || [];

        if (expectedCommission > 0) {
          if (existingComms.length === 0) {
            const newComm: typeof therapistCommissions.$inferInsert = {
              id: crypto.randomUUID(),
              therapistId,
              visitId: matchedVisitId,
              amount: expectedCommission,
              status: "PAID",
              paidAt: inv.createdAt,
              createdAt: inv.createdAt,
            };
            commsToInsert.push(newComm);
            commsByVisitId.set(matchedVisitId, [newComm as any]);
            affectedTherapistMonths.add(`${therapistId}|${monthStr}`);
          } else {
            const firstComm = existingComms[0];
            if (firstComm.amount !== expectedCommission || firstComm.status !== "PAID") {
              commsToUpdate.push({ id: firstComm.id, amount: expectedCommission });
              firstComm.amount = expectedCommission;
              firstComm.status = "PAID";
              affectedTherapistMonths.add(`${therapistId}|${monthStr}`);
            }
          }
        } else if (expectedCommission === 0) {
          // Buku Pasien / item komisi 0
          if (existingComms.length > 0 && existingComms[0].amount > 0) {
            commsToDelete.push(existingComms[0].id);
            existingComms.splice(0, 1);
            affectedTherapistMonths.add(`${therapistId}|${monthStr}`);
          }
        }
      }
    }
  }

  // 4. Scan kunjungan yang sudah PAID tapi belum punya komisi
  for (const v of visitById.values()) {
    if (v.paymentStatus === "PAID" && v.status === "completed" && v.therapistId && v.serviceId) {
      const svc = serviceMap.get(v.serviceId);
      const expectedCommission = calculateCommissionAmount({
        serviceGlobalCommission: svc ? svc.globalCommission : 0,
        servicePrice: svc ? svc.price : 0,
        qty: 1,
      });

      const monthStr = (v.visitDate || v.createdAt || "").substring(0, 7);
      const existingComms = commsByVisitId.get(v.id) || [];

      if (expectedCommission > 0 && existingComms.length === 0) {
        const newComm: typeof therapistCommissions.$inferInsert = {
          id: crypto.randomUUID(),
          therapistId: v.therapistId,
          visitId: v.id,
          amount: expectedCommission,
          status: "PAID",
          paidAt: v.createdAt || new Date().toISOString(),
          createdAt: v.createdAt || new Date().toISOString(),
        };
        commsToInsert.push(newComm);
        commsByVisitId.set(v.id, [newComm as any]);
        if (monthStr) affectedTherapistMonths.add(`${v.therapistId}|${monthStr}`);
      } else if (existingComms.length > 0 && existingComms[0].amount !== expectedCommission && expectedCommission > 0) {
        commsToUpdate.push({ id: existingComms[0].id, amount: expectedCommission });
        existingComms[0].amount = expectedCommission;
        if (monthStr) affectedTherapistMonths.add(`${v.therapistId}|${monthStr}`);
      }
    }
  }

  console.log(`\n=== PERUBAHAN DATABASE YANG AKAN DILAKUKAN ===`);
  console.log(`- Kunjungan UNPAID diubah ke PAID: ${visitsToUpdatePaid.length}`);
  console.log(`- Kunjungan Layanan Baru dibuat  : ${visitsToInsert.length}`);
  console.log(`- Komisi Baru diterbitkan        : ${commsToInsert.length}`);
  console.log(`- Komisi diperbaiki nilainya     : ${commsToUpdate.length}`);
  console.log(`- Komisi salah (Buku) dihapus    : ${commsToDelete.length}\n`);

  // Eksekusi BATCH ke Database
  console.log("Menerapkan perubahan ke database dalam batch...");

  // Batch Update Visits to PAID
  const BATCH = 100;
  for (let i = 0; i < visitsToUpdatePaid.length; i += BATCH) {
    const chunk = visitsToUpdatePaid.slice(i, i + BATCH);
    await Promise.all(
      chunk.map((v) =>
        db
          .update(patientVisits)
          .set({
            paymentStatus: "PAID",
            status: "completed",
            updatedAt: v.updatedAt,
            ...(v.therapistId && { therapistId: v.therapistId }),
          })
          .where(eq(patientVisits.id, v.id))
      )
    );
  }

  // Batch Insert Visits
  for (let i = 0; i < visitsToInsert.length; i += BATCH) {
    const chunk = visitsToInsert.slice(i, i + BATCH);
    await db.insert(patientVisits).values(chunk);
  }

  // Batch Insert Commissions
  for (let i = 0; i < commsToInsert.length; i += BATCH) {
    const chunk = commsToInsert.slice(i, i + BATCH);
    await db.insert(therapistCommissions).values(chunk);
  }

  // Batch Update Commissions
  for (let i = 0; i < commsToUpdate.length; i += BATCH) {
    const chunk = commsToUpdate.slice(i, i + BATCH);
    await Promise.all(
      chunk.map((c) =>
        db
          .update(therapistCommissions)
          .set({ amount: c.amount, status: "PAID" })
          .where(eq(therapistCommissions.id, c.id))
      )
    );
  }

  // Batch Delete Incorrect Commissions
  if (commsToDelete.length > 0) {
    for (let i = 0; i < commsToDelete.length; i += BATCH) {
      const chunk = commsToDelete.slice(i, i + BATCH);
      await db.delete(therapistCommissions).where(inArray(therapistCommissions.id, chunk));
    }
  }

  // Sinkronisasi Laporan Bulanan Terapis
  console.log(`\nSinkronisasi ${affectedTherapistMonths.size} laporan bulanan terapis...`);
  let syncedReports = 0;

  for (const entry of affectedTherapistMonths) {
    const [therapistId, month] = entry.split("|");
    if (!therapistId || !month) continue;

    // Hitung total komisi terapis di bulan ini
    const comms = await db
      .select({ amount: therapistCommissions.amount })
      .from(therapistCommissions)
      .innerJoin(patientVisits, eq(therapistCommissions.visitId, patientVisits.id))
      .where(
        and(
          eq(therapistCommissions.therapistId, therapistId),
          like(patientVisits.visitDate, `${month}%`)
        )
      );

    const totalCommissions = comms.reduce((sum, c) => sum + (c.amount || 0), 0);

    const reports = await db
      .select()
      .from(therapistMonthlyReports)
      .where(
        and(
          eq(therapistMonthlyReports.therapistId, therapistId),
          eq(therapistMonthlyReports.month, month)
        )
      );

    if (reports.length > 0) {
      for (const rep of reports) {
        const takeHomePay =
          (rep.baseSalary || 0) +
          totalCommissions +
          (rep.allowances || 0) +
          (rep.bonuses || 0) -
          (rep.deductions || 0);

        await db
          .update(therapistMonthlyReports)
          .set({
            commissions: totalCommissions,
            takeHomePay,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(therapistMonthlyReports.id, rep.id));

        syncedReports++;
      }
    }
  }

  console.log("\n=================================================================");
  console.log("                    HASIL PERBAIKAN HISTORIS                     ");
  console.log("=================================================================");
  console.log(`✓ Kunjungan Menggantung Diperbaiki (UNPAID -> PAID): ${visitsToUpdatePaid.length}`);
  console.log(`✓ Record Kunjungan Layanan Baru Dibuat            : ${visitsToInsert.length}`);
  console.log(`✓ Komisi Terapis Baru Diterbitkan                  : ${commsToInsert.length}`);
  console.log(`✓ Komisi Terapis yang Diperbaiki Nilainya          : ${commsToUpdate.length}`);
  console.log(`✓ Laporan Bulanan Terapis Berhasil Disinkronkan    : ${syncedReports}`);
  console.log("=================================================================\n");

  pool.end();
}

repairHistoricalCommissions().catch((err) => {
  console.error("Gagal memperbaiki histori komisi:", err);
  pool.end();
  process.exit(1);
});
