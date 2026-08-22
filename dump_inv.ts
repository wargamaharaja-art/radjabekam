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
  
  console.log(`Total DB invoices: ${invs.length}`);
  let sum = 0;
  for (const inv of invs) {
    sum += inv.grandTotal;
    console.log(`${inv.invoiceNumber}: ${inv.patientName} - ${inv.grandTotal}`);
  }
  console.log(`Total SUM: ${sum}`);
}

run().then(() => process.exit(0)).catch(console.error);
