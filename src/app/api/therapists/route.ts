import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { therapists, patientVisits, therapistCommissions, services, therapistServiceCommissions } from "@/lib/db/schema";
import { eq, desc, and, like } from "drizzle-orm";
import { getSession, getActiveBranchFilter } from "@/lib/auth";
import { calculateTherapistCommission } from "@/lib/commission";
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const branchFilter = await getActiveBranchFilter();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const therapistsConditions: any[] = [];
    if (branchFilter) {
      therapistsConditions.push(eq(therapists.branchId, branchFilter));
    }

    const allTherapists = await db
      .select()
      .from(therapists)
      .where(therapistsConditions.length > 0 ? and(...therapistsConditions) : undefined)
      .orderBy(desc(therapists.joinedAt));

    // Bulan ini: format YYYY-MM
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Ambil semua kunjungan bulan ini (untuk patientsHandled dan komisi)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const visitsConditions: any[] = [
      like(patientVisits.visitDate, `${currentMonth}%`),
    ];
    if (branchFilter) {
      visitsConditions.push(eq(patientVisits.branchId, branchFilter));
    }
    const allVisitsWithCommissions = await db
      .select({
        id: patientVisits.id,
        visitDate: patientVisits.visitDate,
        visitTime: patientVisits.visitTime,
        patientId: patientVisits.patientId,
        serviceId: patientVisits.serviceId,
        status: patientVisits.status,
        mainTherapistId: patientVisits.therapistId,
        commissionAmount: therapistCommissions.amount,
        commissionTherapistId: therapistCommissions.therapistId,
        serviceGlobalCommission: services.globalCommission,
      })
      .from(patientVisits)
      .leftJoin(therapistCommissions, eq(patientVisits.id, therapistCommissions.visitId))
      .leftJoin(services, eq(patientVisits.serviceId, services.id))
      .where(and(...visitsConditions));

    const enriched = await Promise.all(allTherapists.map(async t => {
      // Find all rows relevant to this therapist
      const relevantRows = allVisitsWithCommissions.filter(v => v.mainTherapistId === t.id || v.commissionTherapistId === t.id);
      
      const groupedVisits = new Map<string, any>();
      
      for (const v of relevantRows) {
         if (v.commissionTherapistId !== null && v.commissionTherapistId !== t.id) {
            continue; // commission belongs to someone else
         }

         let actualCommission = v.commissionAmount;
         if (actualCommission === null || actualCommission === undefined) {
             if (v.mainTherapistId !== t.id) continue;
             
             // BUG-05 FIX: Using the strict rule function!
             actualCommission = await calculateTherapistCommission(
               db,
               t.id,
               v.serviceId,
               1
             );
         }

         const key = `${v.visitDate}_${v.visitTime}_${v.patientId}`;
         if (groupedVisits.has(key)) {
             const existing = groupedVisits.get(key);
             if (!existing.visitedIds.has(v.id)) {
                 existing.commissionAmount = (existing.commissionAmount || 0) + (actualCommission || 0);
                 existing.visitedIds.add(v.id);
             } else if (v.commissionAmount !== null) {
                 existing.commissionAmount = (existing.commissionAmount || 0) + (v.commissionAmount || 0);
             }
             if (v.status === "in_progress") {
                 existing.status = "in_progress";
             }
         } else {
             groupedVisits.set(key, {
                 commissionAmount: actualCommission,
                 visitedIds: new Set([v.id]),
                 status: v.status
             });
         }
      }
      
      // patientsHandled should be number of completed groups (matches history page logic)
      let patientsHandled = 0;
      let totalCommission = 0;
      for (const group of groupedVisits.values()) {
         totalCommission += (group.commissionAmount || 0);
         if (group.status === "completed") {
             patientsHandled++;
         }
      }

      return { ...t, patientsHandled, totalCommission };
    }));

    return NextResponse.json(enriched);
  } catch (error) {
    console.error("Failed to fetch therapists:", error);
    return NextResponse.json({ error: "Failed to fetch therapists" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, specialization, phone, gender, baseSalary, commissionRate, isActive, branchId, photoUrl, birthDate, pinCode, contractStartDate, contractEndDate } = body;

    if (!name || !specialization || !phone || !gender) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Enforce branch for branch admin
    const finalBranchId = session.role === "BRANCH_ADMIN" ? session.branchId : (branchId || null);

    const newTherapist = {
      id: crypto.randomUUID(),
      name,
      specialization,
      phone,
      gender,
      branchId: finalBranchId,
      baseSalary: baseSalary ? parseInt(baseSalary) : 0,
      commissionRate: commissionRate ? parseInt(commissionRate) : 0,
      photoUrl: photoUrl || null,
      birthDate: birthDate || null,
      pinCode: pinCode || null,
      contractStartDate: contractStartDate || null,
      contractEndDate: contractEndDate || null,
      isActive: isActive !== undefined ? isActive : true,
      joinedAt: new Date().toISOString(),
    };

    await db.insert(therapists).values(newTherapist);

    // Auto-Komisi Terapis Baru: Salin komisi dari terapis lain
    const existingTherapist = await db.select().from(therapists).where(eq(therapists.isActive, true)).limit(1);
    
    if (existingTherapist.length > 0) {
      const templateTherapistId = existingTherapist[0].id;
      
      const existingCommissions = await db
        .select()
        .from(therapistServiceCommissions)
        .where(eq(therapistServiceCommissions.therapistId, templateTherapistId));
        
      if (existingCommissions.length > 0) {
        const newCommissions = existingCommissions.map(c => ({
          id: crypto.randomUUID(),
          therapistId: newTherapist.id,
          serviceId: c.serviceId,
          commissionAmount: c.commissionAmount
        }));
        
        await db.insert(therapistServiceCommissions).values(newCommissions);
      }
    }

    return NextResponse.json(newTherapist, { status: 201 });
  } catch (error) {
    console.error("Failed to create therapist:", error);
    return NextResponse.json({ error: "Failed to create therapist" }, { status: 500 });
  }
}
