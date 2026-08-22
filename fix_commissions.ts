import { db } from "./src/lib/db";
import { services, therapistServiceCommissions, therapists, therapistCommissions, patientVisits, financeTransactions, journalEntries, journalLines, therapistMonthlyReports } from "./src/lib/db/schema";
import { eq, and, sql, like } from "drizzle-orm";

async function fixCommissions() {
  console.log("Starting commission fix...");

  // 1. Get latest sync targets
  const allServices = await db.select().from(services);
  const allOverrides = await db.select().from(therapistServiceCommissions);
  const latestCommissions: Record<string, {name: string, amount: number}> = {};
  
  for (const service of allServices) {
    const overridesForService = allOverrides.filter(o => o.serviceId === service.id);
    let amountToUse = service.globalCommission;
    
    if (overridesForService.length > 0) {
      const counts: Record<number, number> = {};
      let maxCount = 0;
      let mostCommon = amountToUse;
      
      for (const override of overridesForService) {
        counts[override.commissionAmount] = (counts[override.commissionAmount] || 0) + 1;
        if (counts[override.commissionAmount] > maxCount) {
          maxCount = counts[override.commissionAmount];
          mostCommon = override.commissionAmount;
        }
      }
      
      if (maxCount > 0) {
          amountToUse = mostCommon;
      }
    }
    
    latestCommissions[service.id] = { name: service.name, amount: amountToUse };
  }

  const activeTherapists = await db.select().from(therapists).where(eq(therapists.isActive, true));

  // 2. Sync therapistServiceCommissions for all active therapists
  console.log("\n--- Syncing Therapist Service Commissions ---");
  for (const therapist of activeTherapists) {
    for (const service of allServices) {
      const targetAmount = latestCommissions[service.id].amount;
      const currentOverride = allOverrides.find(
          o => o.therapistId === therapist.id && o.serviceId === service.id
      );
      
      if (!currentOverride) {
        await db.insert(therapistServiceCommissions).values({
          id: `TC-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
          therapistId: therapist.id,
          serviceId: service.id,
          commissionAmount: targetAmount
        });
      } else if (currentOverride.commissionAmount !== targetAmount) {
        await db.update(therapistServiceCommissions)
          .set({ commissionAmount: targetAmount })
          .where(eq(therapistServiceCommissions.id, currentOverride.id));
      }
    }
  }
  console.log("Successfully synced commission settings for all therapists.");

  // 3. Fix Past Commissions
  console.log("\n--- Fixing Past Commissions ---");
  const pastCommissions = await db
    .select({
      id: therapistCommissions.id,
      therapistId: therapistCommissions.therapistId,
      visitId: therapistCommissions.visitId,
      amount: therapistCommissions.amount,
      serviceId: patientVisits.serviceId,
      visitDate: patientVisits.visitDate
    })
    .from(therapistCommissions)
    .innerJoin(patientVisits, eq(therapistCommissions.visitId, patientVisits.id));

  const updatedTherapistMonths = new Set<string>();

  for (const comm of pastCommissions) {
    const targetInfo = latestCommissions[comm.serviceId];
    if (targetInfo && comm.amount !== targetInfo.amount) {
      console.log(`Fixing Visit ${comm.visitId}: ${comm.amount} -> ${targetInfo.amount}`);
      
      // Update commission record
      await db.update(therapistCommissions)
        .set({ amount: targetInfo.amount })
        .where(eq(therapistCommissions.id, comm.id));
        
      // Update finance transactions
      const fTxs = await db.select().from(financeTransactions)
        .where(and(
          eq(financeTransactions.referenceId, comm.visitId),
          eq(financeTransactions.category, "Bagi Hasil Terapis")
        ));
        
      for (const fTx of fTxs) {
        await db.update(financeTransactions)
          .set({ amount: targetInfo.amount })
          .where(eq(financeTransactions.id, fTx.id));
          
        // Update journal entries
        const jEntries = await db.select().from(journalEntries)
          .where(eq(journalEntries.referenceId, fTx.id));
          
        for (const jE of jEntries) {
          const jLines = await db.select().from(journalLines)
            .where(eq(journalLines.entryId, jE.id));
            
          for (const line of jLines) {
            if (line.debit > 0) {
              await db.update(journalLines).set({ debit: targetInfo.amount }).where(eq(journalLines.id, line.id));
            }
            if (line.credit > 0) {
              await db.update(journalLines).set({ credit: targetInfo.amount }).where(eq(journalLines.id, line.id));
            }
          }
        }
      }
      
      // Mark therapist month for recalculation
      const month = comm.visitDate.substring(0, 7);
      updatedTherapistMonths.add(`${comm.therapistId}_${month}`);
    }
  }

  // 4. Recalculate Monthly Reports
  console.log("\n--- Recalculating Monthly Reports ---");
  for (const therapistMonth of updatedTherapistMonths) {
    const [therapistId, month] = therapistMonth.split("_");
    
    // Get new total commissions
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
        
      console.log(`Updated Monthly Report for Therapist ${therapistId} (${month}): Total Commission = ${totalCommissions}`);
    }
  }
  
  console.log("\nAll fixes applied successfully!");
  process.exit(0);
}

fixCommissions().catch(err => {
    console.error(err);
    process.exit(1);
});
