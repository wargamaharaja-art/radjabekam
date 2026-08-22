import { db } from "./src/lib/db";
import { 
  branches, services, therapists, therapistCommissions, therapistServiceCommissions, 
  patientVisits, financeTransactions, journalEntries, journalLines, accounts, 
  therapistMonthlyReports, invoices, patients
} from "./src/lib/db/schema";
import { eq, and, like, sql, inArray, gte, lte, desc } from "drizzle-orm";

interface Issue {
  severity: "CRITICAL" | "WARNING" | "INFO";
  area: string;
  branch: string;
  description: string;
  details?: string;
}

const issues: Issue[] = [];

function addIssue(severity: Issue["severity"], area: string, branch: string, description: string, details?: string) {
  issues.push({ severity, area, branch, description, details });
}

async function run() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║        AUDIT KEUANGAN MENYELURUH - RADJA BEKAM             ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // ========== STEP 0: Load All Branches ==========
  const allBranches = await db.select().from(branches).where(eq(branches.isActive, true));
  console.log(`Cabang aktif: ${allBranches.length}`);
  allBranches.forEach(b => console.log(`  - ${b.name} (${b.id})`));

  // ========== STEP 1: Cek Duplikasi Komisi (residual) ==========
  console.log("\n═══ [1] CEK DUPLIKASI KOMISI TERSISA ═══");
  const allCommissions = await db.select().from(therapistCommissions);
  const visitCommCounts: Record<string, number> = {};
  allCommissions.forEach(c => {
    visitCommCounts[c.visitId] = (visitCommCounts[c.visitId] || 0) + 1;
  });
  const remainingDuplicates = Object.entries(visitCommCounts).filter(([_, count]) => count > 1);
  if (remainingDuplicates.length > 0) {
    remainingDuplicates.forEach(([visitId, count]) => {
      addIssue("CRITICAL", "Duplikasi Komisi", "Semua", `Visit ${visitId} masih memiliki ${count} entri komisi (seharusnya 1)`, "");
    });
    console.log(`  ❌ Masih ada ${remainingDuplicates.length} duplikasi komisi!`);
  } else {
    console.log("  ✅ Tidak ada duplikasi komisi tersisa.");
  }

  // ========== STEP 2: Sinkronisasi Komisi vs Finance Transactions ==========
  console.log("\n═══ [2] CEK KONSISTENSI KOMISI ↔ TRANSAKSI KEUANGAN ═══");
  for (const branch of allBranches) {
    const branchVisits = await db.select().from(patientVisits)
      .where(eq(patientVisits.branchId, branch.id));
    const branchVisitIds = branchVisits.map(v => v.id);
    
    if (branchVisitIds.length === 0) continue;

    // Get all commission records for this branch's visits
    const branchCommissions = allCommissions.filter(c => branchVisitIds.includes(c.visitId));
    
    // Get all "Bagi Hasil Terapis" finance transactions for this branch
    const bagiHasilTxs = await db.select().from(financeTransactions)
      .where(and(
        eq(financeTransactions.branchId, branch.id),
        eq(financeTransactions.category, "Bagi Hasil Terapis")
      ));
    
    const totalCommission = branchCommissions.reduce((s, c) => s + c.amount, 0);
    const totalBagiHasil = bagiHasilTxs.reduce((s, t) => s + t.amount, 0);
    
    if (totalCommission !== totalBagiHasil) {
      addIssue("CRITICAL", "Komisi vs Finance", branch.name, 
        `Total komisi terapis: Rp ${totalCommission.toLocaleString('id-ID')}, Total beban bagi hasil: Rp ${totalBagiHasil.toLocaleString('id-ID')} (selisih Rp ${Math.abs(totalCommission - totalBagiHasil).toLocaleString('id-ID')})`,
        `Komisi records: ${branchCommissions.length}, Finance txs: ${bagiHasilTxs.length}`);
      console.log(`  ❌ ${branch.name}: Selisih Rp ${Math.abs(totalCommission - totalBagiHasil).toLocaleString('id-ID')}`);
    } else {
      console.log(`  ✅ ${branch.name}: Komisi & Beban Bagi Hasil sinkron (Rp ${totalCommission.toLocaleString('id-ID')})`);
    }
  }

  // ========== STEP 3: Cek Konsistensi Pendapatan (INCOME vs Invoice) ==========
  console.log("\n═══ [3] CEK KONSISTENSI INCOME ↔ INVOICE ═══");
  for (const branch of allBranches) {
    const branchInvoices = await db.select().from(invoices).where(eq(invoices.branchId, branch.id));
    const totalInvoiceGrand = branchInvoices.reduce((s, inv) => s + inv.grandTotal, 0);
    
    const branchIncome = await db.select().from(financeTransactions)
      .where(and(
        eq(financeTransactions.branchId, branch.id),
        eq(financeTransactions.type, "INCOME"),
        eq(financeTransactions.category, "Pendapatan Layanan")
      ));
    const totalFinanceIncome = branchIncome.reduce((s, t) => s + t.amount, 0);
    
    // Also check income from pay route (visits without invoice but paid via /pay)
    const paidVisitsNoInvoice = await db.select({ id: patientVisits.id })
      .from(patientVisits)
      .where(and(
        eq(patientVisits.branchId, branch.id),
        eq(patientVisits.paymentStatus, "PAID")
      ));
    
    if (Math.abs(totalInvoiceGrand - totalFinanceIncome) > 1000) {
      addIssue("WARNING", "Income vs Invoice", branch.name,
        `Total Invoice: Rp ${totalInvoiceGrand.toLocaleString('id-ID')}, Total Finance Income: Rp ${totalFinanceIncome.toLocaleString('id-ID')} (selisih Rp ${Math.abs(totalInvoiceGrand - totalFinanceIncome).toLocaleString('id-ID')})`,
        `Invoices: ${branchInvoices.length}, Income txs: ${branchIncome.length}, Paid Visits: ${paidVisitsNoInvoice.length}`);
      console.log(`  ⚠️  ${branch.name}: Selisih income Rp ${Math.abs(totalInvoiceGrand - totalFinanceIncome).toLocaleString('id-ID')}`);
    } else {
      console.log(`  ✅ ${branch.name}: Income & Invoice sinkron (Rp ${totalFinanceIncome.toLocaleString('id-ID')})`);
    }
  }

  // ========== STEP 4: Cek Double-Entry Jurnal Balanced ==========
  console.log("\n═══ [4] CEK BALANCE JURNAL (DOUBLE-ENTRY) ═══");
  const allJournals = await db.select().from(journalEntries);
  const allJournalLines = await db.select().from(journalLines);
  
  let unbalancedCount = 0;
  for (const journal of allJournals) {
    const lines = allJournalLines.filter(l => l.entryId === journal.id);
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    
    if (totalDebit !== totalCredit) {
      unbalancedCount++;
      addIssue("CRITICAL", "Jurnal Tidak Balance", "Semua",
        `Jurnal ${journal.id}: Debit ${totalDebit} ≠ Credit ${totalCredit}`,
        journal.description);
    }
  }
  if (unbalancedCount > 0) {
    console.log(`  ❌ ${unbalancedCount} jurnal tidak balance!`);
  } else {
    console.log(`  ✅ Semua ${allJournals.length} jurnal balance (Debit = Credit).`);
  }

  // ========== STEP 5: Finance Transaction tanpa Jurnal ==========
  console.log("\n═══ [5] CEK TRANSAKSI KEUANGAN TANPA JURNAL ═══");
  const allFinTxs = await db.select().from(financeTransactions);
  let orphanTxCount = 0;
  
  for (const ftx of allFinTxs) {
    const relatedJournals = allJournalLines.filter(jl => {
      const je = allJournals.find(j => j.id === jl.entryId);
      return je && je.referenceId === ftx.id;
    });
    if (relatedJournals.length === 0) {
      orphanTxCount++;
      if (orphanTxCount <= 5) {
        addIssue("WARNING", "Transaksi Tanpa Jurnal", "Semua",
          `Transaksi ${ftx.id} (${ftx.category}, Rp ${ftx.amount.toLocaleString('id-ID')}) tidak memiliki jurnal terkait`,
          ftx.description);
      }
    }
  }
  if (orphanTxCount > 0) {
    console.log(`  ⚠️  ${orphanTxCount} transaksi keuangan tidak memiliki jurnal terkait.`);
  } else {
    console.log(`  ✅ Semua transaksi keuangan memiliki jurnal.`);
  }

  // ========== STEP 6: Jurnal Orphan (tanpa Finance Transaction) ==========
  console.log("\n═══ [6] CEK JURNAL ORPHAN (TANPA TRANSAKSI) ═══");
  let orphanJournalCount = 0;
  const allFinTxIds = new Set(allFinTxs.map(f => f.id));
  
  for (const je of allJournals) {
    if (je.referenceId && !allFinTxIds.has(je.referenceId)) {
      orphanJournalCount++;
    }
  }
  if (orphanJournalCount > 0) {
    addIssue("WARNING", "Jurnal Orphan", "Semua", `${orphanJournalCount} jurnal mereferensikan transaksi yang sudah tidak ada`);
    console.log(`  ⚠️  ${orphanJournalCount} jurnal mereferensikan transaksi yang sudah tidak ada.`);
  } else {
    console.log(`  ✅ Tidak ada jurnal orphan.`);
  }

  // ========== STEP 7: Cek Laporan Bulanan Terapis vs Komisi Aktual ==========
  console.log("\n═══ [7] CEK LAPORAN BULANAN TERAPIS vs KOMISI AKTUAL ═══");
  const allReports = await db.select().from(therapistMonthlyReports);
  const activeTherapists = await db.select().from(therapists).where(eq(therapists.isActive, true));
  
  let reportMismatchCount = 0;
  for (const report of allReports) {
    if (!report.month) continue;
    
    const actualComms = await db.select({ amount: therapistCommissions.amount })
      .from(therapistCommissions)
      .innerJoin(patientVisits, eq(therapistCommissions.visitId, patientVisits.id))
      .where(and(
        eq(therapistCommissions.therapistId, report.therapistId),
        like(patientVisits.visitDate, `${report.month}%`)
      ));
    
    const actualTotal = actualComms.reduce((s, c) => s + c.amount, 0);
    
    if (report.commissions !== actualTotal) {
      reportMismatchCount++;
      const therapist = activeTherapists.find(t => t.id === report.therapistId);
      addIssue("CRITICAL", "Laporan Bulanan", therapist?.name || report.therapistId,
        `Bulan ${report.month}: Komisi di laporan Rp ${report.commissions.toLocaleString('id-ID')} vs aktual Rp ${actualTotal.toLocaleString('id-ID')} (selisih Rp ${Math.abs(report.commissions - actualTotal).toLocaleString('id-ID')})`,
        `Report ID: ${report.id}`);
    }
  }
  if (reportMismatchCount > 0) {
    console.log(`  ❌ ${reportMismatchCount} laporan bulanan memiliki komisi tidak sinkron!`);
  } else {
    console.log(`  ✅ Semua ${allReports.length} laporan bulanan sinkron dengan komisi aktual.`);
  }

  // ========== STEP 8: Cek Visit PAID tanpa Finance Transaction ==========
  console.log("\n═══ [8] CEK VISIT PAID TANPA PEMASUKAN ═══");
  let visitNoIncome = 0;
  for (const branch of allBranches) {
    const paidVisits = await db.select().from(patientVisits)
      .where(and(
        eq(patientVisits.branchId, branch.id),
        eq(patientVisits.paymentStatus, "PAID")
      ));
    
    for (const visit of paidVisits) {
      // Check if there's an income transaction referencing this visit
      const incomeForVisit = allFinTxs.filter(f => 
        f.referenceId === visit.id && f.type === "INCOME"
      );
      // Also check if there's an invoice for this visit
      const invoiceForVisit = await db.select({ id: invoices.id }).from(invoices)
        .where(eq(invoices.visitId, visit.id));
      
      const invoiceIds = invoiceForVisit.map(i => i.id);
      const incomeViaInvoice = invoiceIds.length > 0 
        ? allFinTxs.filter(f => invoiceIds.includes(f.referenceId!) && f.type === "INCOME")
        : [];
      
      if (incomeForVisit.length === 0 && incomeViaInvoice.length === 0) {
        visitNoIncome++;
        if (visitNoIncome <= 5) {
          addIssue("WARNING", "Visit PAID Tanpa Income", branch.name,
            `Visit ${visit.id} (${visit.visitDate}) berstatus PAID tapi tidak ada transaksi pemasukan`,
            `Service: ${visit.serviceId}`);
        }
      }
    }
  }
  if (visitNoIncome > 0) {
    console.log(`  ⚠️  ${visitNoIncome} kunjungan berstatus PAID tanpa transaksi pemasukan.`);
  } else {
    console.log(`  ✅ Semua kunjungan PAID memiliki pemasukan terkait.`);
  }

  // ========== STEP 9: Finance [id] DELETE tanpa hapus jurnal ==========
  console.log("\n═══ [9] CEK FINANCE DELETE ENDPOINT (KODE) ═══");
  // This is a code review finding - the DELETE endpoint doesn't clean up journals
  addIssue("CRITICAL", "Bug Kode: Finance DELETE", "Semua",
    "Endpoint DELETE /api/finance/[id] menghapus transaksi tanpa menghapus jurnal terkait → data jurnal orphan akan menumpuk",
    "File: src/app/api/finance/[id]/route.ts");
  console.log(`  ❌ Finance DELETE endpoint tidak membersihkan jurnal (akan menyebabkan jurnal orphan).`);

  // ========== STEP 10: Cek Komisi Terapis untuk Visit tanpa Terapis ==========
  console.log("\n═══ [10] CEK KOMISI UNTUK VISIT TANPA TERAPIS ═══");
  let commNoTherapist = 0;
  for (const comm of allCommissions) {
    const visit = await db.select().from(patientVisits).where(eq(patientVisits.id, comm.visitId)).limit(1);
    if (visit.length > 0 && !visit[0].therapistId) {
      commNoTherapist++;
      if (commNoTherapist <= 3) {
        addIssue("WARNING", "Komisi Tanpa Terapis", "Semua",
          `Komisi ${comm.id} terhubung ke visit ${comm.visitId} yang tidak ada terapis`,
          `Amount: Rp ${comm.amount.toLocaleString('id-ID')}`);
      }
    }
  }
  if (commNoTherapist > 0) {
    console.log(`  ⚠️  ${commNoTherapist} komisi terhubung ke visit tanpa terapis.`);
  } else {
    console.log(`  ✅ Semua komisi terhubung ke visit yang memiliki terapis.`);
  }

  // ========== STEP 11: Ringkasan Keuangan Per Cabang ==========
  console.log("\n═══ [11] RINGKASAN KEUANGAN PER CABANG ═══");
  for (const branch of allBranches) {
    const branchFinTxs = allFinTxs.filter(f => f.branchId === branch.id);
    const totalIncome = branchFinTxs.filter(f => f.type === "INCOME").reduce((s, f) => s + f.amount, 0);
    const totalExpense = branchFinTxs.filter(f => f.type === "EXPENSE").reduce((s, f) => s + f.amount, 0);
    const netProfit = totalIncome - totalExpense;
    
    const branchVisitsPaid = await db.select().from(patientVisits)
      .where(and(eq(patientVisits.branchId, branch.id), eq(patientVisits.paymentStatus, "PAID")));
    
    console.log(`  📊 ${branch.name}:`);
    console.log(`     Pemasukan: Rp ${totalIncome.toLocaleString('id-ID')}`);
    console.log(`     Pengeluaran: Rp ${totalExpense.toLocaleString('id-ID')}`);
    console.log(`     Laba Bersih: Rp ${netProfit.toLocaleString('id-ID')}`);
    console.log(`     Visit Lunas: ${branchVisitsPaid.length}`);
  }

  // ========== FINAL SUMMARY ==========
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║                     RINGKASAN AUDIT                        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  
  const critical = issues.filter(i => i.severity === "CRITICAL");
  const warnings = issues.filter(i => i.severity === "WARNING");
  const infos = issues.filter(i => i.severity === "INFO");
  
  console.log(`\n🔴 CRITICAL: ${critical.length}`);
  critical.forEach(i => console.log(`   [${i.area}] ${i.branch}: ${i.description}`));
  
  console.log(`\n🟡 WARNING: ${warnings.length}`);
  warnings.forEach(i => console.log(`   [${i.area}] ${i.branch}: ${i.description}`));
  
  console.log(`\n🔵 INFO: ${infos.length}`);
  infos.forEach(i => console.log(`   [${i.area}] ${i.branch}: ${i.description}`));
  
  console.log(`\nTotal issues: ${issues.length}`);

  process.exit(0);
}

run().catch(err => {
  console.error("AUDIT ERROR:", err);
  process.exit(1);
});
