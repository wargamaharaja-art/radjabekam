import "dotenv/config";
import { db } from "../src/lib/db";
import { invoices, therapistCommissions, financeTransactions, journalEntries, journalLines, patientVisits } from "../src/lib/db/schema";
import { eq, desc, inArray } from "drizzle-orm";

async function run() {
  console.log("Starting data cleanup...");

  // 1. Cleanup Therapist Commissions
  console.log("Fetching therapist commissions...");
  const commissions = await db.select().from(therapistCommissions).orderBy(desc(therapistCommissions.createdAt));
  
  const commByVisit = new Map<string, typeof commissions[0][]>();
  for (const comm of commissions) {
    if (!comm.visitId) continue;
    if (!commByVisit.has(comm.visitId)) {
      commByVisit.set(comm.visitId, []);
    }
    commByVisit.get(comm.visitId)!.push(comm);
  }

  const commissionsToDelete: string[] = [];
  const visitsWithDuplicateCommissions: string[] = [];
  
  for (const [visitId, comms] of commByVisit.entries()) {
    if (comms.length > 1) {
      console.log(`Visit ${visitId} has ${comms.length} commissions. Keeping the latest one.`);
      visitsWithDuplicateCommissions.push(visitId);
      // Keep the first (latest), delete the rest
      for (let i = 1; i < comms.length; i++) {
        commissionsToDelete.push(comms[i].id);
      }
    }
  }

  if (commissionsToDelete.length > 0) {
    console.log(`Deleting ${commissionsToDelete.length} duplicate commissions...`);
    // Delete commissions
    await db.delete(therapistCommissions).where(inArray(therapistCommissions.id, commissionsToDelete));
    
    // For these visits, since we kept 1 commission, let's ensure there's only 1 finance transaction for the commission
    for (const visitId of visitsWithDuplicateCommissions) {
      const fTxs = await db.select().from(financeTransactions)
        .where(eq(financeTransactions.referenceId, visitId));
      
      const commTxs = fTxs.filter(tx => tx.category === "Bagi Hasil Terapis" || tx.type === "EXPENSE");
      
      if (commTxs.length > 1) {
        // sort by date desc
        commTxs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const txsToDelete = commTxs.slice(1).map(tx => tx.id);
        
        console.log(`Deleting ${txsToDelete.length} duplicate commission finance transactions for visit ${visitId}...`);
        
        // Find journal entries
        for (const txId of txsToDelete) {
          const jEntries = await db.select().from(journalEntries).where(eq(journalEntries.referenceId, txId));
          if (jEntries.length > 0) {
            const entryIds = jEntries.map(je => je.id);
            // delete journal lines
            await db.delete(journalLines).where(inArray(journalLines.entryId, entryIds));
            // delete journal entries
            await db.delete(journalEntries).where(inArray(journalEntries.id, entryIds));
          }
        }
        
        // delete finance transactions
        await db.delete(financeTransactions).where(inArray(financeTransactions.id, txsToDelete));
      }
    }
  } else {
    console.log("No duplicate commissions found.");
  }

  // 2. Cleanup Invoices
  console.log("Fetching invoices...");
  const allInvoices = await db.select().from(invoices).orderBy(desc(invoices.createdAt));
  const invByVisit = new Map<string, typeof allInvoices[0][]>();
  for (const inv of allInvoices) {
    if (!inv.visitId) continue;
    if (!invByVisit.has(inv.visitId)) {
      invByVisit.set(inv.visitId, []);
    }
    invByVisit.get(inv.visitId)!.push(inv);
  }

  const invoicesToDelete: string[] = [];
  
  for (const [visitId, invs] of invByVisit.entries()) {
    if (invs.length > 1) {
      console.log(`Visit ${visitId} has ${invs.length} invoices. Keeping the latest one.`);
      // Keep the first (latest), delete the rest
      for (let i = 1; i < invs.length; i++) {
        invoicesToDelete.push(invs[i].id);
      }
    }
  }

  if (invoicesToDelete.length > 0) {
    console.log(`Deleting ${invoicesToDelete.length} duplicate invoices...`);
    
    for (const invId of invoicesToDelete) {
      const fTxs = await db.select().from(financeTransactions).where(eq(financeTransactions.referenceId, invId));
      if (fTxs.length > 0) {
        const txIds = fTxs.map(tx => tx.id);
        for (const txId of txIds) {
          const jEntries = await db.select().from(journalEntries).where(eq(journalEntries.referenceId, txId));
          if (jEntries.length > 0) {
            const entryIds = jEntries.map(je => je.id);
            await db.delete(journalLines).where(inArray(journalLines.entryId, entryIds));
            await db.delete(journalEntries).where(inArray(journalEntries.id, entryIds));
          }
        }
        await db.delete(financeTransactions).where(inArray(financeTransactions.id, txIds));
      }
    }
    
    await db.delete(invoices).where(inArray(invoices.id, invoicesToDelete));
  } else {
    console.log("No duplicate invoices found.");
  }

  console.log("Cleanup completed!");
}

run().catch(console.error).finally(() => process.exit(0));
