import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/lib/db";
import { therapistCommissions, patientVisits } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";
import { calculateTherapistCommission } from "../src/lib/commission";

async function main() {
  console.log("Memulai sinkronisasi ulang komisi...");

  // Ambil semua komisi beserta data layanannya
  const commissions = await db
    .select({
      id: therapistCommissions.id,
      therapistId: therapistCommissions.therapistId,
      visitId: therapistCommissions.visitId,
      amount: therapistCommissions.amount,
      serviceId: patientVisits.serviceId,
    })
    .from(therapistCommissions)
    .innerJoin(patientVisits, eq(therapistCommissions.visitId, patientVisits.id));

  let fixedCount = 0;

  for (const c of commissions) {
    if (!c.serviceId || !c.therapistId) continue;

    // Kalkulasi ulang menggunakan rule terbaru (Override > Global > Flat)
    const correctAmount = await calculateTherapistCommission(
      db,
      c.therapistId,
      c.serviceId,
      1
    );

    if (c.amount !== correctAmount) {
      console.log(`Fixing komisi ${c.id}: Rp ${c.amount} -> Rp ${correctAmount}`);
      await db
        .update(therapistCommissions)
        .set({ amount: correctAmount })
        .where(eq(therapistCommissions.id, c.id));
      fixedCount++;
    }
  }

  console.log(`\nSelesai! Berhasil memperbaiki ${fixedCount} data komisi.`);
}

main().catch(console.error).finally(() => process.exit(0));
