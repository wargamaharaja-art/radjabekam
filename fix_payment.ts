import { config } from "dotenv";
config({ path: ".env.local" }); 

async function run() {
  const { db } = await import("./src/lib/db");
  const { invoices, financeTransactions } = await import("./src/lib/db/schema");
  const { eq, and } = await import("drizzle-orm");

  const invId = "f947dbbb-ef35-4221-872e-d8e7883447de";
  
  await db.transaction(async (tx) => {
    // 1. Update invoice to QRIS
    await tx.update(invoices).set({ paymentMethod: "QRIS" }).where(eq(invoices.id, invId));
    
    // 2. Update finance transactions to QRIS
    await tx.update(financeTransactions)
      .set({ paymentMethod: "QRIS" })
      .where(and(eq(financeTransactions.referenceId, invId), eq(financeTransactions.type, "INCOME")));
      
    console.log("Updated to QRIS successfully.");
  });
}

run().then(() => process.exit(0)).catch(console.error);
