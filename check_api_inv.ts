import { config } from "dotenv";
config({ path: ".env.local" }); 

async function run() {
  const { db } = await import("./src/lib/db");
  const { invoices } = await import("./src/lib/db/schema");
  const { like, eq, and } = await import("drizzle-orm");

  const invs = await db.select().from(invoices).where(
    and(
      like(invoices.createdAt, "2026-07-26%"),
      eq(invoices.branchId, "radja-bekam-mustika-jaya")
    )
  );
  console.log(`Total invoices: ${invs.length}`);
  
  let total = 0;
  for (const inv of invs) {
    total += inv.grandTotal;
    if (inv.grandTotal === 254000) {
      console.log(`FOUND 254000: ${inv.id}, ${inv.patientName}, ${inv.createdAt}, ${inv.branchId}`);
    }
  }
  console.log(`Grand Total Sum: ${total}`);
}

run().then(() => process.exit(0)).catch(console.error);
