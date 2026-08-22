import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { db } from "../src/lib/db";
import { services, therapists, therapistServiceCommissions, patientVisits, therapistCommissions } from "../src/lib/db/schema";
import { eq, like, desc } from "drizzle-orm";

async function main() {
  console.log("=== SERVICES ===");
  const s = await db.select({ name: services.name, price: services.price, globalCommission: services.globalCommission }).from(services).where(like(services.name, "%Bekam Holistik%"));
  console.log(s);

  console.log("\n=== LATEST PAID COMMISSIONS ===");
  const recentVisits = await db
    .select({
      visitId: patientVisits.id,
      patientName: patientVisits.patientId, // roughly
      serviceName: services.name,
      paymentStatus: patientVisits.paymentStatus,
      commissionAmount: therapistCommissions.amount,
      serviceGlobalCommission: services.globalCommission
    })
    .from(patientVisits)
    .innerJoin(therapistCommissions, eq(patientVisits.id, therapistCommissions.visitId))
    .innerJoin(services, eq(patientVisits.serviceId, services.id))
    .orderBy(desc(patientVisits.createdAt))
    .limit(5);

  console.log(recentVisits);
}

main().catch(console.error).finally(() => process.exit(0));
