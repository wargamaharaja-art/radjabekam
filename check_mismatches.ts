import { db } from './src/lib/db';
import { therapistCommissions, patientVisits, services } from './src/lib/db/schema';
import { calculateTherapistCommission } from './src/lib/commission';
import { eq } from 'drizzle-orm';

async function main() {
  const allComms = await db
      .select({
        commId: therapistCommissions.id,
        visitId: therapistCommissions.visitId,
        therapistId: therapistCommissions.therapistId,
        currentAmount: therapistCommissions.amount,
        status: therapistCommissions.status,
        serviceId: patientVisits.serviceId,
        serviceName: services.name
      })
      .from(therapistCommissions)
      .innerJoin(patientVisits, eq(therapistCommissions.visitId, patientVisits.id))
      .innerJoin(services, eq(patientVisits.serviceId, services.id));
      
  let discrepancies = 0;
  for (const c of allComms) {
    const expected = await calculateTherapistCommission(db, c.therapistId, c.serviceId, 1);
    if (expected !== c.currentAmount) {
        discrepancies++;
        console.log(`Mismatch: Visit ${c.visitId}, Service: ${c.serviceName}. Current: ${c.currentAmount}, Expected: ${expected}`);
    }
  }
  console.log(`Found ${discrepancies} discrepancies.`);
  process.exit(0);
}
main().catch(console.error);
