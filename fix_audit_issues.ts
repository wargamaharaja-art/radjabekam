import { db } from "./src/lib/db";
import { 
  therapistCommissions, patientVisits, financeTransactions, 
  journalEntries, journalLines, therapistMonthlyReports 
} from "./src/lib/db/schema";
import { eq, and, inArray, like } from "drizzle-orm";

async function run() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║      PERBAIKAN DATA KEUANGAN - RADJA BEKAM                 ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // ========== FIX A1: Bersihkan Jurnal Orphan ==========
  console.log("═══ [A1] MEMBERSIHKAN JURNAL ORPHAN ═══");
  
  const allJournals = await db.select().from(journalEntries);
  const allFinTxIds = new Set(
    (await db.select({ id: financeTransactions.id }).from(financeTransactions)).map(f => f.id)
  );
  
  let orphanJournalCount = 0;
  for (const je of allJournals) {
    if (je.referenceId && !allFinTxIds.has(je.referenceId)) {
      // Delete journal lines first
      await db.delete(journalLines).where(eq(journalLines.entryId, je.id));
      // Delete journal entry
      await db.delete(journalEntries).where(eq(journalEntries.id, je.id));
      orphanJournalCount++;
      console.log(`  Hapus jurnal orphan: ${je.id} (ref: ${je.referenceId})`);
    }
  }
  console.log(`  ✅ ${orphanJournalCount} jurnal orphan dibersihkan.\n`);

  // ========== FIX A2: Bersihkan Komisi Tanpa Terapis ==========
  console.log("═══ [A2] MEMBERSIHKAN KOMISI TANPA TERAPIS ═══");
  
  const allCommissions = await db.select().from(therapistCommissions);
  let cleanedCommCount = 0;
  const therapistMonthsToRecalc = new Set<string>();
  
  for (const comm of allCommissions) {
    const visit = await db.select().from(patientVisits)
      .where(eq(patientVisits.id, comm.visitId)).limit(1);
    
    if (visit.length > 0 && !visit[0].therapistId) {
      console.log(`  Komisi ${comm.id} → visit ${comm.visitId} tanpa terapis (Rp ${comm.amount.toLocaleString('id-ID')})`);
      
      // 1. Hapus finance transaction terkait (Bagi Hasil Terapis)
      const relatedFtxs = await db.select().from(financeTransactions)
        .where(and(
          eq(financeTransactions.referenceId, comm.visitId),
          eq(financeTransactions.category, "Bagi Hasil Terapis")
        ));
      
      for (const ftx of relatedFtxs) {
        // Hapus jurnal terkait
        const jEntries = await db.select().from(journalEntries)
          .where(eq(journalEntries.referenceId, ftx.id));
        for (const je of jEntries) {
          await db.delete(journalLines).where(eq(journalLines.entryId, je.id));
          await db.delete(journalEntries).where(eq(journalEntries.id, je.id));
        }
        // Hapus finance transaction
        await db.delete(financeTransactions).where(eq(financeTransactions.id, ftx.id));
      }
      
      // 2. Track for monthly report recalc
      const month = visit[0].visitDate.substring(0, 7);
      therapistMonthsToRecalc.add(`${comm.therapistId}_${month}`);
      
      // 3. Hapus komisi
      await db.delete(therapistCommissions).where(eq(therapistCommissions.id, comm.id));
      cleanedCommCount++;
    }
  }
  console.log(`  ✅ ${cleanedCommCount} komisi tanpa terapis dibersihkan.\n`);

  // Recalculate monthly reports for affected therapists
  if (therapistMonthsToRecalc.size > 0) {
    console.log("  Menghitung ulang laporan bulanan terapis terdampak...");
    for (const tm of therapistMonthsToRecalc) {
      const [therapistId, month] = tm.split("_");
      
      const monthComms = await db.select({ amount: therapistCommissions.amount })
        .from(therapistCommissions)
        .innerJoin(patientVisits, eq(therapistCommissions.visitId, patientVisits.id))
        .where(and(
          eq(therapistCommissions.therapistId, therapistId),
          like(patientVisits.visitDate, `${month}%`)
        ));
      const totalComms = monthComms.reduce((s, c) => s + c.amount, 0);
      
      const reports = await db.select().from(therapistMonthlyReports)
        .where(and(
          eq(therapistMonthlyReports.therapistId, therapistId),
          eq(therapistMonthlyReports.month, month)
        ));
      
      if (reports.length > 0) {
        const r = reports[0];
        const newTHP = r.baseSalary + totalComms + r.allowances + r.bonuses - r.deductions;
        await db.update(therapistMonthlyReports)
          .set({ commissions: totalComms, takeHomePay: newTHP, updatedAt: new Date().toISOString() })
          .where(eq(therapistMonthlyReports.id, r.id));
        console.log(`  → Terapis ${therapistId} bulan ${month}: komisi diupdate ke Rp ${totalComms.toLocaleString('id-ID')}`);
      }
    }
  }

  console.log("\n✅ Semua perbaikan data selesai!");
  process.exit(0);
}

run().catch(err => { console.error("ERROR:", err); process.exit(1); });
