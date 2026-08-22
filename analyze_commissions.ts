import { db } from "./src/lib/db";
import { services, therapistServiceCommissions, therapists, branches, therapistCommissions, patientVisits } from "./src/lib/db/schema";
import { eq, isNull, and } from "drizzle-orm";

async function analyzeCommissions() {
  console.log("Analyzing commission configurations...");
  
  // 1. Get all active therapists with their branches
  const activeTherapists = await db
    .select({
      id: therapists.id,
      name: therapists.name,
      branchId: therapists.branchId,
      branchName: branches.name,
    })
    .from(therapists)
    .leftJoin(branches, eq(therapists.branchId, branches.id))
    .where(eq(therapists.isActive, true));

  console.log(`Found ${activeTherapists.length} active therapists.`);

  // 2. Get all services to see their global commission setting
  const allServices = await db.select().from(services);
  
  // Also check therapistServiceCommissions to find the "latest synchronized values"
  const allOverrides = await db.select().from(therapistServiceCommissions);
  
  // Deduce "latest synced value" for each service based on the most common override, 
  // or just use services.globalCommission
  const latestCommissions: Record<string, {name: string, amount: number}> = {};
  
  for (const service of allServices) {
    const overridesForService = allOverrides.filter(o => o.serviceId === service.id);
    let amountToUse = service.globalCommission;
    
    // If there are overrides, check if they are uniform
    if (overridesForService.length > 0) {
      // Find most common amount
      const counts: Record<number, number> = {};
      let maxCount = 0;
      let mostCommon = amountToUse;
      
      for (const override of overridesForService) {
        counts[override.commissionAmount] = (counts[override.commissionAmount] || 0) + 1;
        if (counts[override.commissionAmount] > maxCount) {
          maxCount = counts[override.commissionAmount];
          mostCommon = override.commissionAmount;
        }
      }
      
      // If the most common override is applied to most active therapists, we consider it the "sync" value
      if (maxCount > 0) {
          amountToUse = mostCommon;
      }
    }
    
    latestCommissions[service.id] = { name: service.name, amount: amountToUse };
  }
  
  console.log("Target commission values per service:");
  for (const [serviceId, info] of Object.entries(latestCommissions)) {
    console.log(`- ${info.name}: Rp ${info.amount}`);
  }
  
  // 3. Check for therapists missing the latest commission sync
  console.log("\n--- Checking Therapists Missing Latest Commission Settings ---");
  for (const therapist of activeTherapists) {
    let missingOrMismatched = 0;
    
    for (const service of allServices) {
        const targetAmount = latestCommissions[service.id].amount;
        const currentOverride = allOverrides.find(
            o => o.therapistId === therapist.id && o.serviceId === service.id
        );
        
        if (!currentOverride || currentOverride.commissionAmount !== targetAmount) {
            missingOrMismatched++;
        }
    }
    
    if (missingOrMismatched > 0) {
        console.log(`[!] Therapist ${therapist.name} (${therapist.branchName}) has ${missingOrMismatched} services out of sync.`);
    }
  }

  // 4. Check past therapist commissions that need adjustment
  console.log("\n--- Checking Past Commissions Needing Adjustment ---");
  
  const pastCommissions = await db
    .select({
      id: therapistCommissions.id,
      therapistId: therapistCommissions.therapistId,
      visitId: therapistCommissions.visitId,
      amount: therapistCommissions.amount,
      serviceId: patientVisits.serviceId,
      therapistName: therapists.name
    })
    .from(therapistCommissions)
    .innerJoin(patientVisits, eq(therapistCommissions.visitId, patientVisits.id))
    .innerJoin(therapists, eq(therapistCommissions.therapistId, therapists.id));

  let discrepancies = 0;
  let totalDiscrepancyAmount = 0;
  
  for (const comm of pastCommissions) {
    const targetInfo = latestCommissions[comm.serviceId];
    if (targetInfo && comm.amount !== targetInfo.amount) {
      console.log(`[DISCREPANCY] Visit ${comm.visitId} - Therapist ${comm.therapistName} | Recorded: Rp ${comm.amount}, Target: Rp ${targetInfo.amount}`);
      discrepancies++;
      totalDiscrepancyAmount += (targetInfo.amount - comm.amount);
    }
  }
  
  console.log(`\nTotal discrepancies found: ${discrepancies}`);
  console.log(`Total amount difference: Rp ${totalDiscrepancyAmount}`);
  
  process.exit(0);
}

analyzeCommissions().catch(err => {
    console.error(err);
    process.exit(1);
});
