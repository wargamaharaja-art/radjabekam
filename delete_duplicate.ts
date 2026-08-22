import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "./src/lib/db";
import { 
  invoices, patientVisits, therapistCommissions, 
  financeTransactions, journalEntries, journalLines 
} from "./src/lib/db/schema";
import { eq, inArray, or } from "drizzle-orm";

async function run() {
  const invoiceNum = "INV-RAD-20260726-091";
  
  await db.transaction(async (tx) => {
    // 1. Get invoice
    const invs = await tx.select().from(invoices).where(eq(invoices.invoiceNumber, invoiceNum));
    if (invs.length === 0) {
      console.log("Invoice not found:", invoiceNum);
      return;
    }
    const inv = invs[0];
    const invoiceId = inv.id;
    const visitId = inv.visitId;

    console.log(`Deleting duplicate data for invoice: ${invoiceNum}`);
    console.log(`Invoice ID: ${invoiceId}, Visit ID: ${visitId}`);

    // 2. Find finance transactions related to this invoice OR visit (commissions)
    const refIds = [invoiceId];
    if (visitId) refIds.push(visitId);

    const finTxs = await tx.select().from(financeTransactions).where(inArray(financeTransactions.referenceId, refIds));
    const finTxIds = finTxs.map(t => t.id);

    console.log(`Found ${finTxIds.length} finance transactions.`);

    // 3. Find and delete journal entries & lines
    if (finTxIds.length > 0) {
      const jEntries = await tx.select().from(journalEntries).where(inArray(journalEntries.referenceId, finTxIds));
      const jEntryIds = jEntries.map(e => e.id);
      
      console.log(`Found ${jEntryIds.length} journal entries.`);

      if (jEntryIds.length > 0) {
        await tx.delete(journalLines).where(inArray(journalLines.entryId, jEntryIds));
        await tx.delete(journalEntries).where(inArray(journalEntries.id, jEntryIds));
        console.log("Deleted journal entries and lines.");
      }

      await tx.delete(financeTransactions).where(inArray(financeTransactions.id, finTxIds));
      console.log("Deleted finance transactions.");
    }

    // 4. Delete therapist commissions
    if (visitId) {
      const comms = await tx.select().from(therapistCommissions).where(eq(therapistCommissions.visitId, visitId));
      if (comms.length > 0) {
        await tx.delete(therapistCommissions).where(eq(therapistCommissions.visitId, visitId));
        console.log(`Deleted ${comms.length} therapist commissions.`);
      }
    }

    // 5. Delete invoice
    await tx.delete(invoices).where(eq(invoices.id, invoiceId));
    console.log("Deleted invoice.");

    // 6. Delete visit
    if (visitId) {
      await tx.delete(patientVisits).where(eq(patientVisits.id, visitId));
      console.log("Deleted patient visit.");
    }

    console.log("SUCCESS: Duplicate data removed.");
  });
}

run().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
