import * as dotenv from "dotenv";
dotenv.config();

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  therapistCommissions,
  services,
  patientVisits,
  invoices,
  therapistMonthlyReports,
} from "../src/lib/db/schema";
import { eq, and, inArray, gte, lte } from "drizzle-orm";
import { calculateCommissionAmount } from "../src/lib/commission";
import crypto from "crypto";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const db = drizzle(pool);

async function repairHistoricalCommissions() {
  console.log("=================================================================");
  console.log("  REPARASI SELURUH HISTORI KOMISI & BUKU PASIEN (RADJA BEKAM)   ");
  console.log("=================================================================\n");

  console.log("Memuat data database ke memori...");
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

  const serviceMap = new Map(allServices.map((s) => [s.id, s]));
  const visitById = new Map(allVisits.map((v) => [v.id, { ...v }]));

  const affectedTherapistMonths = new Set<string>(); // "therapistId|YYYY-MM"

  // 1. Group existing commissions by visitId
  const commsByVisitId = new Map<string, typeof allComms>();
  allComms.forEach((c) => {
    if (!commsByVisitId.has(c.visitId)) commsByVisitId.set(c.visitId, []);
    commsByVisitId.get(c.visitId)!.push({ ...c });
  });

  const commsToDelete: string[] = [];
  const commsToUpdate: { id: string; amount: number }[] = [];
  const commsToInsert: typeof therapistCommissions.$inferInsert[] = [];

  let duplicateCommsCount = 0;
  let zeroCommsDeletedCount = 0;
  let incorrectCommsFixedCount = 0;

  // 2. Scan and clean duplicate & incorrect commissions on all existing visitIds
  for (const [visitId, commList] of commsByVisitId.entries()) {
    const visit = visitById.get(visitId);
    if (!visit) {
      // Orphan commission without visit -> delete
      for (const c of commList) {
        commsToDelete.push(c.id);
      }
      continue;
    }

    const svc = serviceMap.get(visit.serviceId || "");
    const expectedCommission = calculateCommissionAmount({
      serviceGlobalCommission: svc ? svc.globalCommission : 0,
      servicePrice: svc ? svc.price : 0,
      qty: 1,
    });

    const monthStr = (visit.visitDate || visit.createdAt || "").substring(0, 7);
    const therapistId = visit.therapistId || commList[0]?.therapistId;

    if (expectedCommission <= 0) {
      // 0 Commission service (e.g. Buku Pasien / Member) -> delete all commissions
      for (const c of commList) {
        commsToDelete.push(c.id);
        zeroCommsDeletedCount++;
      }
      if (therapistId && monthStr) {
        affectedTherapistMonths.add(`${therapistId}|${monthStr}`);
      }
    } else {
      // Has commission: keep only the first valid commission, delete the duplicates
      if (commList.length > 1) {
        for (let i = 1; i < commList.length; i++) {
          commsToDelete.push(commList[i].id);
          duplicateCommsCount++;
        }
        if (therapistId && monthStr) {
          affectedTherapistMonths.add(`${therapistId}|${monthStr}`);
        }
      }

      const primaryComm = commList[0];
      if (primaryComm.amount !== expectedCommission || primaryComm.status !== "PAID") {
        commsToUpdate.push({ id: primaryComm.id, amount: expectedCommission });
        incorrectCommsFixedCount++;
        if (therapistId && monthStr) {
          affectedTherapistMonths.add(`${therapistId}|${monthStr}`);
        }
      }
    }
  }

  // 3. Scan all completed paid visits that should have a commission but don't
  let missingCommsAddedCount = 0;
  for (const v of visitById.values()) {
    if (v.paymentStatus === "PAID" && v.status === "completed" && v.therapistId && v.serviceId) {
      const existingComms = commsByVisitId.get(v.id) || [];
      const validComms = existingComms.filter((c) => !commsToDelete.includes(c.id));

      const svc = serviceMap.get(v.serviceId);
      const expectedCommission = calculateCommissionAmount({
        serviceGlobalCommission: svc ? svc.globalCommission : 0,
        servicePrice: svc ? svc.price : 0,
        qty: 1,
      });

      const monthStr = (v.visitDate || v.createdAt || "").substring(0, 7);

      if (expectedCommission > 0 && validComms.length === 0) {
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
        missingCommsAddedCount++;
        if (monthStr) affectedTherapistMonths.add(`${v.therapistId}|${monthStr}`);
      }
    }
  }

  console.log("=== RINGKASAN TINDAKAN REPARASI ===");
  console.log(`- Komisi Duplikat yang akan dihapus        : ${duplicateCommsCount}`);
  console.log(`- Komisi Layanan Nol (Buku) yang dihapus   : ${zeroCommsDeletedCount}`);
  console.log(`- Total ID Komisi yang akan dihapus        : ${commsToDelete.length}`);
  console.log(`- Komisi yang dikoreksi nominalnya         : ${commsToUpdate.length}`);
  console.log(`- Komisi baru yang diterbitkan (hilang)    : ${missingCommsAddedCount}`);
  console.log(`- Terapis & Bulan yang terpengaruh         : ${affectedTherapistMonths.size}\n`);

  // 4. Eksekusi Batch ke Database
  console.log("Menerapkan perubahan ke database dalam batch...");
  const BATCH = 100;

  // Batch Delete Duplicate / Zero Commissions
  if (commsToDelete.length > 0) {
    for (let i = 0; i < commsToDelete.length; i += BATCH) {
      const chunk = commsToDelete.slice(i, i + BATCH);
      await db.delete(therapistCommissions).where(inArray(therapistCommissions.id, chunk));
    }
    console.log(`✓ ${commsToDelete.length} baris komisi tidak valid berhasil dihapus.`);
  }

  // Batch Update Incorrect Amounts
  if (commsToUpdate.length > 0) {
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
    console.log(`✓ ${commsToUpdate.length} komisi berhasil dikoreksi nominalnya.`);
  }

  // Batch Insert Missing Commissions
  if (commsToInsert.length > 0) {
    for (let i = 0; i < commsToInsert.length; i += BATCH) {
      const chunk = commsToInsert.slice(i, i + BATCH);
      await db.insert(therapistCommissions).values(chunk);
    }
    console.log(`✓ ${commsToInsert.length} komisi baru berhasil diterbitkan.`);
  }

  // 5. Sinkronisasi Seluruh Laporan Bulanan Terapis
  console.log(`\nSinkronisasi ${affectedTherapistMonths.size} laporan bulanan terapis...`);
  let syncedReports = 0;

  for (const entry of affectedTherapistMonths) {
    const [therapistId, month] = entry.split("|");
    if (!therapistId || !month) continue;

    const [year, m] = month.split("-");
    const monthStart = `${year}-${m}-01`;
    const lastDay = new Date(parseInt(year), parseInt(m), 0).getDate();
    const monthEnd = `${year}-${m}-${String(lastDay).padStart(2, "0")}`;

    // Hitung total komisi terapis di bulan ini
    const comms = await db
      .select({ amount: therapistCommissions.amount })
      .from(therapistCommissions)
      .innerJoin(patientVisits, eq(therapistCommissions.visitId, patientVisits.id))
      .where(
        and(
          eq(therapistCommissions.therapistId, therapistId),
          gte(patientVisits.visitDate, monthStart),
          lte(patientVisits.visitDate, monthEnd)
        )
      );

    const totalCommissions = comms.reduce((sum, c) => sum + (c.amount || 0), 0);

    const reports = await db
      .select()
      .from(therapistMonthlyReports)
      .where(eq(therapistMonthlyReports.therapistId, therapistId));

    const matchingReports = reports.filter((r) => {
      if (r.month === month) return true;
      if (r.startDate && r.endDate) {
        return r.startDate <= monthEnd && r.endDate >= monthStart;
      }
      return false;
    });

    for (const rep of matchingReports) {
      let reportTotalComm = totalCommissions;
      if (rep.startDate && rep.endDate && !rep.month) {
        const rangeComms = await db
          .select({ amount: therapistCommissions.amount })
          .from(therapistCommissions)
          .innerJoin(patientVisits, eq(therapistCommissions.visitId, patientVisits.id))
          .where(
            and(
              eq(therapistCommissions.therapistId, therapistId),
              gte(patientVisits.visitDate, rep.startDate),
              lte(patientVisits.visitDate, rep.endDate)
            )
          );
        reportTotalComm = rangeComms.reduce((sum, c) => sum + (c.amount || 0), 0);
      }

      const takeHomePay =
        (rep.baseSalary || 0) +
        reportTotalComm +
        (rep.allowances || 0) +
        (rep.bonuses || 0) -
        (rep.deductions || 0);

      await db
        .update(therapistMonthlyReports)
        .set({
          commissions: reportTotalComm,
          takeHomePay,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(therapistMonthlyReports.id, rep.id));

      syncedReports++;
    }
  }

  console.log("\n=================================================================");
  console.log("                    HASIL PERBAIKAN HISTORIS                     ");
  console.log("=================================================================");
  console.log(`✓ Komisi Duplikat Dihapus                   : ${duplicateCommsCount}`);
  console.log(`✓ Komisi Layanan 0 (Buku) Dihapus           : ${zeroCommsDeletedCount}`);
  console.log(`✓ Komisi Terapis yang Diperbaiki Nilainya   : ${incorrectCommsFixedCount}`);
  console.log(`✓ Komisi Terapis Baru Diterbitkan           : ${missingCommsAddedCount}`);
  console.log(`✓ Laporan Bulanan Terapis Disinkronkan      : ${syncedReports}`);
  console.log("=================================================================\n");

  process.exit(0);
}

repairHistoricalCommissions().catch((err) => {
  console.error("Gagal memperbaiki histori komisi:", err);
  process.exit(1);
});
