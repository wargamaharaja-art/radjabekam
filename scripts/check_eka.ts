import "dotenv/config";
import { db } from "../src/lib/db";
import { therapists, therapistCommissions, patientVisits, services, patients } from "../src/lib/db/schema";
import { eq, like } from "drizzle-orm";

async function check() {
  const ekaList = await db.select().from(therapists).where(like(therapists.name, "%Eka Agung%"));
  if (ekaList.length === 0) {
    console.log("Eka not found");
    return;
  }
  const eka = ekaList[0];
  console.log("Therapist Eka:", eka.id, eka.name);

  const visits = await db.select({
      visitId: patientVisits.id,
      patientName: patients.name,
      serviceName: services.name,
      servicePrice: services.price,
      status: patientVisits.status,
      paymentStatus: patientVisits.paymentStatus,
      commAmount: therapistCommissions.amount,
      commStatus: therapistCommissions.status,
      commId: therapistCommissions.id,
      therapistId: therapistCommissions.therapistId
  })
  .from(patientVisits)
  .leftJoin(patients, eq(patientVisits.patientId, patients.id))
  .leftJoin(services, eq(patientVisits.serviceId, services.id))
  .leftJoin(therapistCommissions, eq(patientVisits.id, therapistCommissions.visitId))
  .where(eq(patientVisits.therapistId, eka.id));

  for (const v of visits) {
    if (v.patientName?.includes("ALFATIH") || v.patientName?.includes("Diki")) {
      console.log(v);
    }
  }
  
  // also check if commissions exist for Eka but visits are not his
  const ekaComms = await db.select({
      commId: therapistCommissions.id,
      visitId: therapistCommissions.visitId,
      amount: therapistCommissions.amount,
  })
  .from(therapistCommissions)
  .where(eq(therapistCommissions.therapistId, eka.id));
  
  for (const c of ekaComms) {
    const v = await db.select({
      visitId: patientVisits.id,
      patientName: patients.name,
      serviceName: services.name,
      therapistId: patientVisits.therapistId
    })
    .from(patientVisits)
    .leftJoin(patients, eq(patientVisits.patientId, patients.id))
    .leftJoin(services, eq(patientVisits.serviceId, services.id))
    .where(eq(patientVisits.id, c.visitId));
    
    if (v.length > 0 && (v[0].patientName?.includes("ALFATIH") || v[0].patientName?.includes("Diki"))) {
       console.log("Commission for Eka:", c, "Visit:", v[0]);
    }
  }
}

check().catch(console.error).finally(() => process.exit(0));
