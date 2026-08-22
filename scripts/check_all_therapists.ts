import "dotenv/config";
import { db } from "../src/lib/db";
import { patientVisits, therapistCommissions } from "../src/lib/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { calculateTherapistCommission } from "../src/lib/commission";
import crypto from "crypto";

async function run() {
  console.log("Checking all therapists for missing commissions...");
  
  const visits = await db.select({
    id: patientVisits.id,
    serviceId: patientVisits.serviceId,
    therapistId: patientVisits.therapistId,
    commId: therapistCommissions.id
  })
  .from(patientVisits)
  .leftJoin(therapistCommissions, eq(patientVisits.id, therapistCommissions.visitId))
  .where(
    and(
      isNotNull(patientVisits.therapistId),
      eq(patientVisits.paymentStatus, "PAID")
    )
  );

  let missingCount = 0;
  
  for(const v of visits) {
    if (!v.commId && v.therapistId && v.serviceId) {
      const amount = await calculateTherapistCommission(db, v.therapistId, v.serviceId, 1);
      
      if (amount > 0) {
        console.log(`Missing comm found! Visit: ${v.id}, Therapist: ${v.therapistId}, Service: ${v.serviceId}, Amount: ${amount}`);
        
        await db.insert(therapistCommissions).values({
          id: crypto.randomUUID(),
          therapistId: v.therapistId,
          visitId: v.id,
          amount,
          status: "PAID",
          paidAt: new Date().toISOString()
        });
        
        missingCount++;
      }
    }
  }
  
  console.log(`Finished checking all therapists. Restored ${missingCount} missing commissions.`);
}

run().catch(console.error).finally(()=>process.exit(0));
