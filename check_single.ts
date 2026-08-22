import { db } from './src/lib/db';
import { therapistCommissions, patientVisits, services } from './src/lib/db/schema';
import { calculateTherapistCommission } from './src/lib/commission';
import { eq, like } from 'drizzle-orm';

async function main() {
  const allComms = await db.select({
    commId: therapistCommissions.id,
    visitId: therapistCommissions.visitId,
    currentAmount: therapistCommissions.amount,
    therapistId: therapistCommissions.therapistId,
    serviceId: patientVisits.serviceId,
    serviceName: services.name
  }).from(therapistCommissions)
  .innerJoin(patientVisits, eq(therapistCommissions.visitId, patientVisits.id))
  .innerJoin(services, eq(patientVisits.serviceId, services.id))
  .where(like(services.name, '%Bekam Kepala%'))
  .limit(10);
  
  for (const c of allComms) {
    const expected = await calculateTherapistCommission(db, c.therapistId, c.serviceId, 1);
    console.log(c.serviceName, 'Current:', c.currentAmount, 'Expected:', expected);
  }
  process.exit(0);
}
main().catch(console.error);
