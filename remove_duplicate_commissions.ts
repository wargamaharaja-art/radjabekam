import { db } from "./src/lib/db";
import { therapistCommissions, patientVisits, financeTransactions, journalEntries, journalLines, therapistMonthlyReports } from "./src/lib/db/schema";
import { eq, and, sql, like, desc, inArray } from "drizzle-orm";

async function run() {
  console.log("Mencari duplikasi komisi...");
  
  // 1. Dapatkan semua komisi
  const allCommissions = await db.select().from(therapistCommissions).orderBy(therapistCommissions.createdAt);
  
  const visitCounts: Record<string, typeof allCommissions> = {};
  
  for (const comm of allCommissions) {
    if (!visitCounts[comm.visitId]) {
      visitCounts[comm.visitId] = [];
    }
    visitCounts[comm.visitId].push(comm);
  }
  
  const duplicateVisitIds = Object.keys(visitCounts).filter(id => visitCounts[id].length > 1);
  console.log(`Ditemukan ${duplicateVisitIds.length} visitId yang memiliki komisi ganda.`);
  
  const therapistsToRecalculate = new Set<string>();
  let totalDeletedAmount = 0;
  let totalDeletedCount = 0;

  for (const visitId of duplicateVisitIds) {
    const comms = visitCounts[visitId];
    // Keep the first one, delete the rest
    const keep = comms[0];
    const duplicates = comms.slice(1);
    
    console.log(`Visit ID: ${visitId} memiliki ${comms.length} entri komisi. Menyimpan 1, menghapus ${duplicates.length}.`);
    
    for (const dup of duplicates) {
      // 1. Delete duplicate therapist commission
      await db.delete(therapistCommissions).where(eq(therapistCommissions.id, dup.id));
      
      // Also get the visit to know the month
      const visits = await db.select().from(patientVisits).where(eq(patientVisits.id, visitId));
      if (visits.length > 0) {
        const month = visits[0].visitDate.substring(0, 7);
        therapistsToRecalculate.add(`${dup.therapistId}_${month}`);
      }
      
      totalDeletedAmount += dup.amount;
      totalDeletedCount++;
    }
    
    // 2. Delete duplicate finance transactions for this visitId
    // Since we don't have a direct link between therapistCommissions and financeTransactions except referenceId=visitId
    const fTxs = await db.select().from(financeTransactions)
      .where(and(
        eq(financeTransactions.referenceId, visitId),
        eq(financeTransactions.category, "Bagi Hasil Terapis")
      ))
      .orderBy(financeTransactions.date);
      
    if (fTxs.length > 1) {
      const fTxsDuplicates = fTxs.slice(1);
      for (const dupFtx of fTxsDuplicates) {
        // Find journal entries
        const jEntries = await db.select().from(journalEntries).where(eq(journalEntries.referenceId, dupFtx.id));
        for (const je of jEntries) {
          // Delete journal lines
          await db.delete(journalLines).where(eq(journalLines.entryId, je.id));
          // Delete journal entry
          await db.delete(journalEntries).where(eq(journalEntries.id, je.id));
        }
        // Delete finance transaction
        await db.delete(financeTransactions).where(eq(financeTransactions.id, dupFtx.id));
      }
    }
  }

  // Recalculate therapist monthly reports
  console.log("\n--- Menghitung Ulang Laporan Bulanan Terapis ---");
  for (const tm of therapistsToRecalculate) {
    const [therapistId, month] = tm.split("_");
    
    const monthCommissions = await db.select({ amount: therapistCommissions.amount })
      .from(therapistCommissions)
      .innerJoin(patientVisits, eq(therapistCommissions.visitId, patientVisits.id))
      .where(and(
        eq(therapistCommissions.therapistId, therapistId),
        like(patientVisits.visitDate, `${month}%`)
      ));
      
    const totalCommissions = monthCommissions.reduce((sum, c) => sum + c.amount, 0);
    
    const reports = await db.select().from(therapistMonthlyReports)
      .where(and(
        eq(therapistMonthlyReports.therapistId, therapistId),
        eq(therapistMonthlyReports.month, month)
      ));
      
    if (reports.length > 0) {
      const report = reports[0];
      const newTakeHomePay = report.baseSalary + totalCommissions + report.allowances + report.bonuses - report.deductions;
      
      await db.update(therapistMonthlyReports)
        .set({
          commissions: totalCommissions,
          takeHomePay: newTakeHomePay,
          updatedAt: new Date().toISOString()
        })
        .where(eq(therapistMonthlyReports.id, report.id));
        
      console.log(`Laporan bulan ${month} untuk terapis ${therapistId} diperbarui. Total Komisi baru: Rp ${totalCommissions}`);
    }
  }

  console.log(`\nPembersihan selesai!`);
  console.log(`- Jumlah duplikat dihapus: ${totalDeletedCount}`);
  console.log(`- Total nilai komisi ganda yang dibersihkan: Rp ${totalDeletedAmount}`);

  process.exit(0);
}

run().catch(console.error);
