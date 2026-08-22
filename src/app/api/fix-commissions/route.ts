import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { therapistCommissions, patientVisits, services } from "@/lib/db/schema";
import { calculateTherapistCommission } from "@/lib/commission";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";

export const maxDuration = 60;

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== "SUPER_ADMIN" && session.role !== "BRANCH_ADMIN") {
      return NextResponse.json({ error: "Unauthorized. Admin only." }, { status: 403 });
    }

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
      .leftJoin(services, eq(patientVisits.serviceId, services.id));

    let fixedCount = 0;
    const details = [];
    
    const cache = {
      services: new Map<string, { gc: number | null; price: number; name: string }>()
    };

    for (const c of allComms) {
      const expected = await calculateTherapistCommission(db, c.therapistId, c.serviceId, 1, cache);
      
      if (expected !== c.currentAmount) {
        // Fix the amount in DB
        await db
          .update(therapistCommissions)
          .set({ amount: expected })
          .where(eq(therapistCommissions.id, c.commId));
          
        details.push({
          visitId: c.visitId,
          serviceName: c.serviceName,
          oldAmount: c.currentAmount,
          newAmount: expected,
          status: c.status
        });
        
        fixedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Berhasil memperbaiki ${fixedCount} data komisi terapis.`,
      fixedCount,
      details
    });

  } catch (error: any) {
    console.error("Error fixing commissions:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
