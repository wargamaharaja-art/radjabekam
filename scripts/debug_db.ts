import { db } from "../src/lib/db";
import { services, therapists, therapistServiceCommissions, patientVisits, therapistCommissions } from "../src/lib/db/schema";
import { eq, like, desc } from "drizzle-orm";

async function main() {
  console.log("=== LATEST PATIENT VISITS WITH COMMISSIONS ===");
  const recentVisits = await db
    .select({
      visitId: patientVisits.id,
      patientId: patientVisits.patientId,
      serviceId: patientVisits.serviceId,
      therapistId: patientVisits.therapistId,
      paymentStatus: patientVisits.paymentStatus,
      commissionAmount: therapistCommissions.amount,
      serviceName: services.name,
      servicePrice: services.price,
      serviceGlobalCommission: services.globalCommission
    })
    .from(patientVisits)
    .leftJoin(therapistCommissions, eq(patientVisits.id, therapistCommissions.visitId))
    .leftJoin(services, eq(patientVisits.serviceId, services.id))
    .orderBy(desc(patientVisits.createdAt))
    .limit(5);

  console.log(recentVisits);

  console.log("\n=== THERAPISTS ===");
  const t = await db.select({ id: therapists.id, name: therapists.name, commissionRate: therapists.commissionRate }).from(therapists);
  console.log(t);

  console.log("\n=== OVERRIDES ===");
  const o = await db.select().from(therapistServiceCommissions);
  console.log(o);
}

main().catch(console.error).finally(() => process.exit(0));
