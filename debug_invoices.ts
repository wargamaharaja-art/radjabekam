import { config } from "dotenv";
config({ path: ".env.local" }); // Run first

async function run() {
  const { db } = await import("./src/lib/db");
  const { invoices } = await import("./src/lib/db/schema");
  const { inArray } = await import("drizzle-orm");

  const invs = await db.select().from(invoices).where(
    inArray(invoices.invoiceNumber, ["INV-RAD-20260726-089", "INV-RAD-20260726-091"])
  );
  
  console.log(JSON.stringify(invs, null, 2));
}

run().then(() => process.exit(0));
