import { db } from "./src/lib/db";
import { therapistCommissions, patientVisits, services } from "./src/lib/db/schema";
import { calculateTherapistCommission } from "./src/lib/commission";
import { eq } from "drizzle-orm";

async function main() {
  console.log("Checking all commissions...");
  
  const allComms = await db
    .select({
      commId: therapistCommissions.id,
      visitId: therapistCommissions.visitId,
      therapistId: therapistCommissions.therapistId,
      currentAmount: therapistCommissions.amount,
      serviceId: patientVisits.serviceId,
      serviceName: services.name
    })
    .from(therapistCommissions)
    .innerJoin(patientVisits, eq(therapistCommissions.visitId, patientVisits.id))
    .innerJoin(services, eq(patientVisits.serviceId, services.id));
    
  let discrepancyCount = 0;
  for (const c of allComms) {
    const expected = await calculateTherapistCommission(db, c.therapistId, c.serviceId, 1);
    
    if (expected !== c.currentAmount) {
      console.log(`Mismatch found! Visit: ${c.visitId}, Service: ${c.serviceName} (${c.serviceId})`);
      console.log(`  Current Amount: ${c.currentAmount}`);
      console.log(`  Expected Amount: ${expected}`);
      discrepancyCount++;
    }
  }
  
  console.log(`Total discrepancies found: ${discrepancyCount}`);
  process.exit(0);
}

main().catch(console.error);
