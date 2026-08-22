import { db } from "./src/lib/db";
import { financeTransactions, invoices, patientVisits, services } from "./src/lib/db/schema";
import { sql, eq } from "drizzle-orm";

async function run() {
  const month = "2026-08";

  const totalFinance = await db
    .select({
      total: sql<number>`SUM(${financeTransactions.amount})`
    })
    .from(financeTransactions)
    .where(
      sql`type = 'INCOME' AND to_char(${financeTransactions.date}::timestamp, 'YYYY-MM') = ${month}`
    );

  const totalInvoices = await db
    .select({
      total: sql<number>`SUM(${invoices.grandTotal})`,
      totalItems: sql<number>`SUM(${invoices.subtotal})`
    })
    .from(invoices)
    .where(
      sql`to_char(${invoices.createdAt}::timestamp, 'YYYY-MM') = ${month}`
    );

  console.log("Finance Income Total:", totalFinance[0].total);
  console.log("Invoices Grand Total:", totalInvoices[0].total);
  console.log("Invoices Subtotal:", totalInvoices[0].totalItems);
  
  process.exit(0);
}

run().catch(console.error);
