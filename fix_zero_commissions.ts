import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "./src/lib/db";
import { services, therapistCommissions, patientVisits } from "./src/lib/db/schema";
import { eq } from "drizzle-orm";
import { calculateTherapistCommission } from "./src/lib/commission";

async function run() {
  const allSvcs = await db.select().from(services);
  const zeroSvcs = allSvcs.filter(s => s.globalCommission === 0);
  
  let updatedCount = 0;
  let updatedVisitsCount = 0;
  
  for (const zs of zeroSvcs) {
    const baseName = zs.name.replace(/[^a-zA-Z]/g, '').toLowerCase();
    
    const duplicates = allSvcs.filter(s => 
      s.id !== zs.id && 
      s.name.replace(/[^a-zA-Z]/g, '').toLowerCase() === baseName
    );
    
    if (duplicates.length > 0) {
      const maxGc = Math.max(...duplicates.map(d => d.globalCommission));
      
      if (maxGc > 0) {
        console.log(`Updating "${zs.name}" (ID: ${zs.id}) from 0 to ${maxGc}...`);
        await db.update(services).set({ globalCommission: maxGc }).where(eq(services.id, zs.id));
        updatedCount++;
        
        // Also fix past commissions for this service
        const visits = await db.select().from(patientVisits).where(eq(patientVisits.serviceId, zs.id));
        for (const visit of visits) {
            if (visit.therapistId) {
                // We use db directly here as the transaction
                const commAmount = await calculateTherapistCommission(db, visit.therapistId, zs.id);
                // Update the therapistCommissions table
                await db.update(therapistCommissions)
                        .set({ amount: commAmount })
                        .where(eq(therapistCommissions.visitId, visit.id));
                updatedVisitsCount++;
                console.log(`  -> Fixed commission for visit ${visit.id} to ${commAmount}`);
            }
        }
      }
    }
  }
  
  console.log(`\nDone! Updated ${updatedCount} zero-commission services to match their duplicates.`);
  console.log(`Fixed ${updatedVisitsCount} visit commissions.`);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
