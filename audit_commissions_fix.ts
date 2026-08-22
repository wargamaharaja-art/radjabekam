/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  AUDIT & REKALKULASI KOMISI TERAPIS — RADJA BEKAM                  ║
 * ║  Mendeteksi dan memperbaiki komisi yang salah akibat BUG-01/02     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Jalankan: npx tsx audit_commissions_fix.ts
 * 
 * Mode:
 *   DRY_RUN = true  → Hanya laporan, tidak mengubah database
 *   DRY_RUN = false → Terapkan perbaikan ke database
 *
 * Apa yang dilakukan script ini:
 * 1. Scan SELURUH record `therapistCommissions`
 * 2. Hitung ulang komisi yang seharusnya berdasarkan hierarki benar:
 *    - Prioritas 1: Override per terapis per layanan (therapistServiceCommissions)
 *    - Prioritas 2: Global commission per layanan (services.globalCommission)
 *    - Prioritas 3: Flat rate default terapis (therapists.commissionRate)
 * 3. Bandingkan dengan nominal yang tercatat
 * 4. Jika berbeda → perbaiki:
 *    a. Record therapistCommissions
 *    b. Record financeTransactions (EXPENSE "Bagi Hasil Terapis")
 *    c. Record journalLines (debit Beban Komisi + kredit Kas)
 *    d. Record therapistMonthlyReports (akumulasi per bulan)
 * 5. Juga fix status PENDING → PAID untuk komisi POS lama (BUG-03 historis)
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./src/lib/db/schema";
import {
  therapists,
  therapistCommissions,
  therapistServiceCommissions,
  services,
  patientVisits,
  financeTransactions,
  journalEntries,
  journalLines,
  therapistMonthlyReports,
} from "./src/lib/db/schema";
import { eq, and, like, inArray, gte, lte } from "drizzle-orm";

// Buat koneksi database langsung (bukan import dari src/lib/db)
// agar dotenv.config() pasti sudah selesai sebelum Pool dibuat
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const db = drizzle(pool, { schema });

// ══════════════════════════════════════════════════════════════
// KONFIGURASI
// ══════════════════════════════════════════════════════════════
const DRY_RUN = false; // Ubah ke false untuk menerapkan perbaikan
const COA_BEBAN_KOMISI = "acc_501";
const COA_KAS = "acc_101";

// ══════════════════════════════════════════════════════════════
// TIPE & STATISTIK
// ══════════════════════════════════════════════════════════════
interface Discrepancy {
  commissionId: string;
  visitId: string;
  therapistId: string;
  therapistName: string;
  serviceId: string;
  serviceName: string;
  visitDate: string;
  recordedAmount: number;
  correctAmount: number;
  diff: number;
  source: string; // Sumber komisi yang benar
  statusIssue: boolean; // Apakah status juga perlu difix
}

const stats = {
  totalCommissions: 0,
  totalChecked: 0,
  totalCorrect: 0,
  totalMismatch: 0,
  totalStatusFix: 0,
  totalOverpaid: 0,
  totalUnderpaid: 0,
  totalDiffAmount: 0,
  totalFixed: 0,
  monthlyReportsUpdated: 0,
};

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════
function formatRupiah(amount: number): string {
  const prefix = amount < 0 ? "-" : "";
  return `${prefix}Rp ${Math.abs(amount).toLocaleString("id-ID")}`;
}

function colorize(text: string, color: "red" | "green" | "yellow" | "cyan" | "dim"): string {
  const codes: Record<string, string> = {
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
  };
  return `${codes[color]}${text}\x1b[0m`;
}

// ══════════════════════════════════════════════════════════════
// LANGKAH 1: Muat semua data referensi
// ══════════════════════════════════════════════════════════════
async function loadReferenceData() {
  console.log("\n📦 Memuat data referensi...");

  const allTherapists = await db.select().from(therapists);
  const allServices = await db.select().from(services);
  const allOverrides = await db.select().from(therapistServiceCommissions);

  const therapistMap = new Map(allTherapists.map(t => [t.id, t]));
  const serviceMap = new Map(allServices.map(s => [s.id, s]));

  // Override map: key = "therapistId::serviceId"
  const overrideMap = new Map<string, number>();
  for (const o of allOverrides) {
    overrideMap.set(`${o.therapistId}::${o.serviceId}`, o.commissionAmount);
  }

  console.log(`  ✓ ${allTherapists.length} terapis`);
  console.log(`  ✓ ${allServices.length} layanan`);
  console.log(`  ✓ ${allOverrides.length} override komisi`);

  return { therapistMap, serviceMap, overrideMap };
}

// ══════════════════════════════════════════════════════════════
// LANGKAH 2: Hitung komisi yang seharusnya
// ══════════════════════════════════════════════════════════════
function calculateCorrectCommission(
  therapistId: string,
  serviceId: string,
  therapistMap: Map<string, typeof therapists.$inferSelect>,
  serviceMap: Map<string, typeof services.$inferSelect>,
  overrideMap: Map<string, number>
): { amount: number; source: string } {
  // Prioritas 1: Override per terapis per layanan
  const overrideKey = `${therapistId}::${serviceId}`;
  if (overrideMap.has(overrideKey)) {
    const amt = overrideMap.get(overrideKey)!;
    return { amount: amt, source: "Override Terapis" };
  }

  // Prioritas 2: Global commission dari services
  const service = serviceMap.get(serviceId);
  if (service && service.globalCommission > 0) {
    return { amount: service.globalCommission, source: "Global Commission (services)" };
  }

  // Prioritas 3: Flat rate default terapis
  const therapist = therapistMap.get(therapistId);
  if (therapist && therapist.commissionRate > 0) {
    return { amount: therapist.commissionRate, source: "Flat Rate Terapis" };
  }

  return { amount: 0, source: "Tidak Ada Komisi" };
}

// ══════════════════════════════════════════════════════════════
// LANGKAH 3: Scan & Bandingkan
// ══════════════════════════════════════════════════════════════
async function scanCommissions(
  therapistMap: Map<string, typeof therapists.$inferSelect>,
  serviceMap: Map<string, typeof services.$inferSelect>,
  overrideMap: Map<string, number>
): Promise<Discrepancy[]> {
  console.log("\n🔍 Scanning seluruh record komisi...\n");

  const allCommissions = await db
    .select({
      id: therapistCommissions.id,
      therapistId: therapistCommissions.therapistId,
      visitId: therapistCommissions.visitId,
      amount: therapistCommissions.amount,
      status: therapistCommissions.status,
      createdAt: therapistCommissions.createdAt,
    })
    .from(therapistCommissions);

  stats.totalCommissions = allCommissions.length;

  // Preload all visits for these commissions
  const visitIds = [...new Set(allCommissions.map(c => c.visitId))];
  
  // Batch load visits (in chunks to avoid query size limits)
  const visitMap = new Map<string, typeof patientVisits.$inferSelect>();
  const chunkSize = 500;
  for (let i = 0; i < visitIds.length; i += chunkSize) {
    const chunk = visitIds.slice(i, i + chunkSize);
    const visits = await db
      .select()
      .from(patientVisits)
      .where(inArray(patientVisits.id, chunk));
    for (const v of visits) {
      visitMap.set(v.id, v);
    }
  }

  const discrepancies: Discrepancy[] = [];

  for (const commission of allCommissions) {
    stats.totalChecked++;

    const visit = visitMap.get(commission.visitId);
    if (!visit) {
      // Orphan commission — visit sudah tidak ada
      console.log(colorize(`  ⚠ ORPHAN: Komisi ${commission.id} mereferensikan visit ${commission.visitId} yang tidak ada`, "yellow"));
      continue;
    }

    const therapist = therapistMap.get(commission.therapistId);
    const service = serviceMap.get(visit.serviceId);

    const { amount: correctAmount, source } = calculateCorrectCommission(
      commission.therapistId,
      visit.serviceId,
      therapistMap,
      serviceMap,
      overrideMap
    );

    const isAmountWrong = commission.amount !== correctAmount;
    const isStatusWrong = commission.status === "PENDING" && visit.paymentStatus === "PAID";

    if (isAmountWrong || isStatusWrong) {
      const disc: Discrepancy = {
        commissionId: commission.id,
        visitId: commission.visitId,
        therapistId: commission.therapistId,
        therapistName: therapist?.name || "Unknown",
        serviceId: visit.serviceId,
        serviceName: service?.name || visit.serviceId,
        visitDate: visit.visitDate,
        recordedAmount: commission.amount,
        correctAmount,
        diff: correctAmount - commission.amount,
        source,
        statusIssue: isStatusWrong,
      };
      discrepancies.push(disc);

      if (isAmountWrong) {
        stats.totalMismatch++;
        stats.totalDiffAmount += disc.diff;
        if (disc.diff > 0) stats.totalUnderpaid++;
        if (disc.diff < 0) stats.totalOverpaid++;
      }
      if (isStatusWrong) {
        stats.totalStatusFix++;
      }
    } else {
      stats.totalCorrect++;
    }
  }

  return discrepancies;
}

// ══════════════════════════════════════════════════════════════
// LANGKAH 4: Terapkan Perbaikan
// ══════════════════════════════════════════════════════════════
async function applyFixes(discrepancies: Discrepancy[]) {
  if (DRY_RUN) {
    console.log(colorize("\n⏸  DRY RUN — Tidak ada perubahan yang diterapkan ke database.", "yellow"));
    console.log(colorize("   Ubah DRY_RUN = false di script untuk menerapkan perbaikan.\n", "dim"));
    return;
  }

  console.log(colorize("\n🔧 Menerapkan perbaikan ke database...\n", "cyan"));

  // Kelompokkan per bulan + terapis untuk update therapistMonthlyReports di akhir
  const monthlyDiffs = new Map<string, number>(); // key: "therapistId::YYYY-MM", value: total diff

  for (const disc of discrepancies) {
    try {
      const isAmountChanged = disc.recordedAmount !== disc.correctAmount;

      // A. Fix therapistCommissions record
      const updateData: Record<string, any> = {};
      if (isAmountChanged) {
        updateData.amount = disc.correctAmount;
      }
      if (disc.statusIssue) {
        updateData.status = "PAID";
        updateData.paidAt = new Date().toISOString();
      }

      if (Object.keys(updateData).length > 0) {
        await db
          .update(therapistCommissions)
          .set(updateData)
          .where(eq(therapistCommissions.id, disc.commissionId));
      }

      // B. Fix financeTransactions (EXPENSE "Bagi Hasil Terapis" mereferensikan visitId)
      if (isAmountChanged) {
        const relatedExpenses = await db
          .select()
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.referenceId, disc.visitId),
              eq(financeTransactions.category, "Bagi Hasil Terapis"),
              eq(financeTransactions.type, "EXPENSE")
            )
          );

        for (const expense of relatedExpenses) {
          // Hanya update jika amount match (hindari update yang sudah benar / multi-item)
          if (expense.amount === disc.recordedAmount) {
            await db
              .update(financeTransactions)
              .set({ amount: disc.correctAmount })
              .where(eq(financeTransactions.id, expense.id));

            // C. Fix journal lines terkait
            const relatedJournals = await db
              .select({ id: journalEntries.id })
              .from(journalEntries)
              .where(eq(journalEntries.referenceId, expense.id));

            for (const journal of relatedJournals) {
              // Update debit line (Beban Komisi)
              await db
                .update(journalLines)
                .set({ debit: disc.correctAmount })
                .where(
                  and(
                    eq(journalLines.entryId, journal.id),
                    eq(journalLines.accountId, COA_BEBAN_KOMISI)
                  )
                );

              // Update credit line (Kas)
              await db
                .update(journalLines)
                .set({ credit: disc.correctAmount })
                .where(
                  and(
                    eq(journalLines.entryId, journal.id),
                    eq(journalLines.accountId, COA_KAS)
                  )
                );
            }

            break; // Hanya fix satu expense per discrepancy
          }
        }

        // Track monthly diff untuk update laporan bulanan
        const visitMonth = disc.visitDate.substring(0, 7);
        const monthKey = `${disc.therapistId}::${visitMonth}`;
        monthlyDiffs.set(monthKey, (monthlyDiffs.get(monthKey) || 0) + disc.diff);
      }

      stats.totalFixed++;
      process.stdout.write(`\r  ✓ Fixed ${stats.totalFixed}/${discrepancies.length}`);
    } catch (err) {
      console.error(`\n  ✗ Gagal fix komisi ${disc.commissionId}:`, err);
    }
  }

  console.log(""); // New line after progress

  // D. Update therapistMonthlyReports berdasarkan akumulasi diff per bulan
  if (monthlyDiffs.size > 0) {
    console.log(`\n📊 Memperbarui ${monthlyDiffs.size} laporan bulanan terapis...`);

    for (const [key, diff] of monthlyDiffs) {
      const [therapistId, month] = key.split("::");

      const reports = await db
        .select()
        .from(therapistMonthlyReports)
        .where(
          and(
            eq(therapistMonthlyReports.therapistId, therapistId),
            eq(therapistMonthlyReports.month, month)
          )
        )
        .limit(1);

      if (reports.length > 0) {
        const report = reports[0];
        const newCommissions = Math.max(0, report.commissions + diff);
        const newTakeHomePay = report.baseSalary + newCommissions + report.allowances + report.bonuses - report.deductions;

        await db
          .update(therapistMonthlyReports)
          .set({
            commissions: newCommissions,
            takeHomePay: Math.max(0, newTakeHomePay),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(therapistMonthlyReports.id, report.id));

        stats.monthlyReportsUpdated++;
        console.log(`  ✓ ${therapistId.substring(0, 8)}... bulan ${month}: komisi ${formatRupiah(report.commissions)} → ${formatRupiah(newCommissions)} (diff: ${formatRupiah(diff)})`);
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════
// LANGKAH 5: Cetak Laporan
// ══════════════════════════════════════════════════════════════
function printReport(discrepancies: Discrepancy[]) {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║              LAPORAN AUDIT KOMISI TERAPIS                   ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // Detail per discrepancy
  if (discrepancies.length > 0) {
    console.log("─── DETAIL KETIDAKSESUAIAN ────────────────────────────────────\n");

    // Group by therapist
    const byTherapist = new Map<string, Discrepancy[]>();
    for (const d of discrepancies) {
      if (!byTherapist.has(d.therapistName)) {
        byTherapist.set(d.therapistName, []);
      }
      byTherapist.get(d.therapistName)!.push(d);
    }

    for (const [name, discs] of byTherapist) {
      const totalDiff = discs.reduce((s, d) => s + d.diff, 0);
      const amountIssues = discs.filter(d => d.recordedAmount !== d.correctAmount);
      const statusIssues = discs.filter(d => d.statusIssue);

      console.log(colorize(`  👤 ${name}`, "cyan") + ` — ${discs.length} masalah (selisih total: ${formatRupiah(totalDiff)})`);

      if (amountIssues.length > 0) {
        // Show up to 10 examples
        const showItems = amountIssues.slice(0, 10);
        for (const d of showItems) {
          const diffStr = d.diff > 0
            ? colorize(`+${formatRupiah(d.diff)}`, "red")     // underpaid = klinik kurang bayar
            : colorize(`${formatRupiah(d.diff)}`, "green");    // overpaid = klinik lebih bayar

          console.log(`     ${d.visitDate} | ${d.serviceName.padEnd(35)} | Tercatat: ${formatRupiah(d.recordedAmount).padStart(12)} → Seharusnya: ${formatRupiah(d.correctAmount).padStart(12)} | ${diffStr} | ${colorize(d.source, "dim")}`);
        }
        if (amountIssues.length > 10) {
          console.log(colorize(`     ... dan ${amountIssues.length - 10} masalah nominal lainnya`, "dim"));
        }
      }

      if (statusIssues.length > 0) {
        console.log(colorize(`     📋 ${statusIssues.length} komisi PENDING yang seharusnya PAID`, "yellow"));
      }

      console.log("");
    }
  } else {
    console.log(colorize("  ✅ Tidak ditemukan ketidaksesuaian komisi! Semua data benar.\n", "green"));
  }

  // Summary
  console.log("─── RINGKASAN ────────────────────────────────────────────────\n");
  console.log(`  Total record komisi           : ${stats.totalCommissions}`);
  console.log(`  Diperiksa                     : ${stats.totalChecked}`);
  console.log(`  ${colorize("Benar", "green")}                         : ${stats.totalCorrect}`);
  console.log(`  ${colorize("Nominal salah", "red")}                  : ${stats.totalMismatch}`);
  console.log(`    ├─ Terapis kurang dibayar    : ${stats.totalUnderpaid}`);
  console.log(`    └─ Terapis lebih dibayar     : ${stats.totalOverpaid}`);
  console.log(`  Status perlu fix (PENDING→PAID): ${stats.totalStatusFix}`);
  console.log(`  Total selisih nominal          : ${formatRupiah(stats.totalDiffAmount)}`);

  if (!DRY_RUN) {
    console.log(`\n  Record diperbaiki              : ${stats.totalFixed}`);
    console.log(`  Laporan bulanan diperbarui     : ${stats.monthlyReportsUpdated}`);
  }

  // Interpretasi selisih
  if (stats.totalDiffAmount > 0) {
    console.log(colorize(`\n  ⚠ Klinik KURANG membayar komisi terapis sebesar ${formatRupiah(stats.totalDiffAmount)}`, "red"));
  } else if (stats.totalDiffAmount < 0) {
    console.log(colorize(`\n  ⚠ Klinik LEBIH membayar komisi terapis sebesar ${formatRupiah(Math.abs(stats.totalDiffAmount))}`, "yellow"));
  } else if (stats.totalMismatch === 0) {
    console.log(colorize(`\n  ✅ Tidak ada selisih nominal.`, "green"));
  }

  console.log(`\n  Mode: ${DRY_RUN ? colorize("DRY RUN (tidak ada perubahan diterapkan)", "yellow") : colorize("LIVE — perubahan sudah diterapkan ke database", "green")}`);
  console.log("");
}

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  AUDIT & REKALKULASI KOMISI TERAPIS — RADJA BEKAM          ║");
  console.log(`║  Mode: ${DRY_RUN ? "DRY RUN (Laporan Saja)" : "⚡ LIVE (Akan Mengubah Database)"}${DRY_RUN ? "                              ║" : "               ║"}`);
  console.log(`║  Waktu: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}${" ".repeat(Math.max(0, 37 - new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }).length))}║`);
  console.log("╚══════════════════════════════════════════════════════════════╝");

  try {
    // 1. Muat data referensi
    const { therapistMap, serviceMap, overrideMap } = await loadReferenceData();

    // 2. Scan & bandingkan
    const discrepancies = await scanCommissions(therapistMap, serviceMap, overrideMap);

    // 3. Cetak laporan
    printReport(discrepancies);

    // 4. Terapkan perbaikan (jika bukan dry run)
    if (discrepancies.length > 0) {
      await applyFixes(discrepancies);

      if (!DRY_RUN) {
        console.log(colorize("\n✅ Perbaikan selesai diterapkan.", "green"));
        console.log("   Silakan verifikasi melalui halaman admin dan laporan keuangan.\n");
      }
    }
  } catch (err) {
    console.error("\n❌ Error saat menjalankan audit:", err);
  }

  await pool.end();
  process.exit(0);
}

main();
