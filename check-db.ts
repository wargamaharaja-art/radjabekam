import { db } from "./src/lib/db";
import { invoices } from "./src/lib/db/schema";
import { like } from "drizzle-orm";

async function run() {
  const data = await db.select().from(invoices).where(like(invoices.patientName, "%BAPAK%"));
  data.forEach(d => {
    if (d.patientName.includes("DAVIN") || d.patientName.includes("DEDI")) {
      console.log(`${d.patientName} -> Subtotal: ${d.subtotal}, Discount: ${d.discount}, GrandTotal: ${d.grandTotal}`);
      console.log(`Items: ${d.items}`);
    }
  });
  process.exit(0);
}

run().catch(console.error);
