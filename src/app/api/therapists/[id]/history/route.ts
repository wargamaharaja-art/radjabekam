import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { therapists, patientVisits, patients, services, therapistCommissions } from "@/lib/db/schema";
import { eq, and, gte, lte, or, inArray } from "drizzle-orm";
import { getSession, checkBranchAccess, getActiveBranchFilter } from "@/lib/auth";
import { calculateTherapistCommission } from "@/lib/commission";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month"); // YYYY-MM format
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");

    let filterStartDate = "";
    let filterEndDate = "";

    if (startDateParam && endDateParam) {
      filterStartDate = startDateParam;
      filterEndDate = endDateParam;
    } else if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [year, m] = month.split("-");
      filterStartDate = `${year}-${m}-01`;
      const lastDay = new Date(parseInt(year), parseInt(m), 0).getDate();
      filterEndDate = `${year}-${m}-${String(lastDay).padStart(2, "0")}`;
    } else {
      return NextResponse.json({ error: "Parameter 'startDate' & 'endDate' atau 'month' diperlukan" }, { status: 400 });
    }

    // Get therapist info to verify existence and access
    const therapistData = await db.select().from(therapists).where(eq(therapists.id, id)).limit(1);
    
    if (therapistData.length === 0) {
      return NextResponse.json({ error: "Terapis tidak ditemukan" }, { status: 404 });
    }

    const therapist = therapistData[0];

    // Authorization checks
    if (session.role === "THERAPIST") {
      // Allow if the session name matches the therapist name or if they have the same phone
      if (session.name !== therapist.name && session.username !== therapist.phone) {
        return NextResponse.json({ error: "Forbidden: Anda hanya bisa melihat data Anda sendiri" }, { status: 403 });
      }
    } else {
      const isAllowed = await checkBranchAccess(therapist.branchId);
      if (!isAllowed) {
        return NextResponse.json({ error: "Forbidden: Anda tidak memiliki akses ke data cabang ini" }, { status: 403 });
      }
    }

    const branchFilter = await getActiveBranchFilter();
    
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const visitConditions: any[] = [
      gte(patientVisits.visitDate, filterStartDate),
      lte(patientVisits.visitDate, filterEndDate)
    ];

    if (branchFilter) {
      visitConditions.push(eq(patientVisits.branchId, branchFilter));
    }

    // Fetch all visits in this month for this branch first
    const allVisits = await db
      .select({
        id: patientVisits.id,
        visitDate: patientVisits.visitDate,
        visitTime: patientVisits.visitTime,
        status: patientVisits.status,
        paymentStatus: patientVisits.paymentStatus,
        patientName: patients.name,
        serviceName: services.name,
        servicePrice: services.price,
        serviceId: patientVisits.serviceId,
        mainTherapistId: patientVisits.therapistId,
        serviceGlobalCommission: services.globalCommission,
      })
      .from(patientVisits)
      .leftJoin(patients, eq(patientVisits.patientId, patients.id))
      .leftJoin(services, eq(patientVisits.serviceId, services.id))
      .where(and(...visitConditions));

    const visitIds = allVisits.map((v) => v.id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let comms: any[] = [];
    if (visitIds.length > 0) {
      comms = await db
        .select()
        .from(therapistCommissions)
        .where(
          and(
            inArray(therapistCommissions.visitId, visitIds),
            eq(therapistCommissions.therapistId, id)
          )
        );
    }

    const commsByVisitId = new Map<string, any[]>();
    for (const c of comms) {
      if (!commsByVisitId.has(c.visitId)) {
        commsByVisitId.set(c.visitId, []);
      }
      commsByVisitId.get(c.visitId)!.push(c);
    }

    // Filter visits only for this therapist (either main therapist or has commission)
    const visits = allVisits
      .filter((v) => v.mainTherapistId === id || commsByVisitId.has(v.id))
      .map((v) => {
        const visitComms = commsByVisitId.get(v.id) || [];
        return {
          ...v,
          commissions: visitComms,
        };
      });

    // Group visits by date, time, and patient to avoid duplicate rows for multiple services
    const groupedVisits = new Map<string, any>();
    
    for (const v of visits) {
      const key = `${v.visitDate}_${v.visitTime}_${v.patientName}`;
      
      if (!groupedVisits.has(key)) {
        groupedVisits.set(key, {
          ...v,
          serviceName: "",
          servicePrice: 0,
          commissionAmount: 0,
          commissionStatus: null,
          visitedIds: new Set(),
          dbCommissionIds: new Set(),
        });
      }
      
      const existing = groupedVisits.get(key);
      
      if (!existing.visitedIds.has(v.id)) {
        existing.serviceName += existing.serviceName ? `, ${v.serviceName}` : (v.serviceName || "");
        existing.servicePrice += (v.servicePrice || 0);
        existing.visitedIds.add(v.id);
        
        if (v.status === "in_progress") {
          existing.status = "in_progress";
        }
      }
      
      if (v.commissions && v.commissions.length > 0) {
        for (const c of v.commissions) {
          if (!existing.dbCommissionIds.has(c.id)) {
            existing.dbCommissionIds.add(c.id);
            existing.commissionAmount += c.amount;
            if (c.status === "PAID") {
              existing.commissionStatus = "PAID";
            } else if (!existing.commissionStatus) {
              existing.commissionStatus = c.status;
            }
          }
        }
      } else if (v.paymentStatus !== "PAID" && v.mainTherapistId === id) {
        const dynamicComm = await calculateTherapistCommission(
          db,
          id,
          v.serviceId,
          1
        );
        existing.commissionAmount += dynamicComm;
        if (!existing.commissionStatus) {
          existing.commissionStatus = "PENDING";
        }
      }
    }
    
    for (const group of groupedVisits.values()) {
      delete group.visitedIds;
      delete group.dbCommissionIds;
      delete group.commissions;
    }
    
    const combinedVisits = Array.from(groupedVisits.values());

    // Sort descending by date and time
    combinedVisits.sort((a, b) => {
      const dateA = new Date(`${a.visitDate}T${(a.visitTime || '00:00').replace('.', ':')}`);
      const dateB = new Date(`${b.visitDate}T${(b.visitTime || '00:00').replace('.', ':')}`);
      return dateB.getTime() - dateA.getTime();
    });

    const totalTreatments = combinedVisits.filter(v => v.status === "completed").length;
    const totalCommissions = combinedVisits.reduce((sum, v) => sum + (v.commissionAmount || 0), 0);

    return NextResponse.json({
      therapist: {
        id: therapist.id,
        name: therapist.name,
        specialization: therapist.specialization,
      },
      period: {
        month,
        startDate: filterStartDate,
        endDate: filterEndDate,
      },
      summary: {
        totalTreatments,
        totalCommissions,
      },
      data: combinedVisits,
    });
  } catch (error) {
    console.error("GET /api/therapists/[id]/history error:", error);
    return NextResponse.json({ error: "Gagal mengambil riwayat pasien terapis" }, { status: 500 });
  }
}
