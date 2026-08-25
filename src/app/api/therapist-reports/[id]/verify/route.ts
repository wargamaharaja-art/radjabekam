import { db } from "@/lib/db";
import { therapistMonthlyReports, therapists, branches, therapistCommissions, patientVisits, patients, services } from "@/lib/db/schema";
import { eq, and, or, like, gte, lte, inArray } from "drizzle-orm";
import { calculateTherapistCommission } from "@/lib/commission";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { pin } = body;

    if (!pin) {
      return Response.json({ error: "PIN keamanan wajib diisi" }, { status: 400 });
    }

    // Fetch report joined with therapist and branch info
    const reportData = await db
      .select({
        reportId: therapistMonthlyReports.id,
        therapistId: therapistMonthlyReports.therapistId,
        month: therapistMonthlyReports.month,
        startDate: therapistMonthlyReports.startDate,
        endDate: therapistMonthlyReports.endDate,
        totalTreatments: therapistMonthlyReports.totalTreatments,
        attendancePresent: therapistMonthlyReports.attendancePresent,
        attendanceLate: therapistMonthlyReports.attendanceLate,
        attendanceAbsent: therapistMonthlyReports.attendanceAbsent,
        attendancePermit: therapistMonthlyReports.attendancePermit,
        baseSalary: therapistMonthlyReports.baseSalary,
        commissions: therapistMonthlyReports.commissions,
        allowances: therapistMonthlyReports.allowances,
        bonuses: therapistMonthlyReports.bonuses,
        deductions: therapistMonthlyReports.deductions,
        takeHomePay: therapistMonthlyReports.takeHomePay,
        notesStrengths: therapistMonthlyReports.notesStrengths,
        notesImprovements: therapistMonthlyReports.notesImprovements,
        notesTargets: therapistMonthlyReports.notesTargets,
        rating: therapistMonthlyReports.rating,
        
        therapistName: therapists.name,
        specialization: therapists.specialization,
        pinCode: therapists.pinCode,
        birthDate: therapists.birthDate,
        branchName: branches.name,
      })
      .from(therapistMonthlyReports)
      .innerJoin(therapists, eq(therapistMonthlyReports.therapistId, therapists.id))
      .leftJoin(branches, eq(therapists.branchId, branches.id))
      .where(eq(therapistMonthlyReports.id, id))
      .limit(1);

    if (reportData.length === 0) {
      return Response.json({ error: "Laporan tidak ditemukan" }, { status: 404 });
    }

    const report = reportData[0];

    // PIN Verification Logic
    let isValid = false;
    
    if (report.pinCode && pin === report.pinCode) {
      isValid = true;
    } else if (report.birthDate) {
      // birthDate is expected in YYYY-MM-DD
      const parts = report.birthDate.split("-");
      if (parts.length === 3) {
        const yyyy = parts[0];
        const mm = parts[1];
        const dd = parts[2];
        const defaultPin = `${dd}${mm}${yyyy.substring(2)}`; // DDMMYY format
        if (pin === defaultPin) {
          isValid = true;
        }
      }
    }

    if (!isValid) {
      return Response.json({ error: "PIN keamanan salah. Silakan coba lagi atau hubungi HR." }, { status: 401 });
    }

    // Hitung ulang komisi & treatment aktual dari DB secara tersinkronisasi
    const dateConditions = [];
    if (report.startDate && report.endDate) {
      dateConditions.push(
        gte(patientVisits.visitDate, report.startDate),
        lte(patientVisits.visitDate, report.endDate)
      );
    } else if (report.month) {
      const [year, m] = report.month.split("-");
      const monthStart = `${year}-${m}-01`;
      const lastDay = new Date(parseInt(year), parseInt(m), 0).getDate();
      const monthEnd = `${year}-${m}-${String(lastDay).padStart(2, "0")}`;
      dateConditions.push(
        gte(patientVisits.visitDate, monthStart),
        lte(patientVisits.visitDate, monthEnd)
      );
    }

    const allVisits = await db
      .select({
        id: patientVisits.id,
        therapistId: patientVisits.therapistId,
        visitDate: patientVisits.visitDate,
        visitTime: patientVisits.visitTime,
        patientId: patientVisits.patientId,
        patientName: patients.name,
        serviceId: patientVisits.serviceId,
        servicePrice: services.price,
        serviceName: services.name,
        status: patientVisits.status,
        paymentStatus: patientVisits.paymentStatus,
      })
      .from(patientVisits)
      .leftJoin(patients, eq(patientVisits.patientId, patients.id))
      .leftJoin(services, eq(patientVisits.serviceId, services.id))
      .where(and(...dateConditions));

    const visitIds = allVisits.map((v) => v.id);

    let comms: any[] = [];
    if (visitIds.length > 0) {
      comms = await db
        .select()
        .from(therapistCommissions)
        .where(
          and(
            inArray(therapistCommissions.visitId, visitIds),
            eq(therapistCommissions.therapistId, report.therapistId)
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

    // Filter kunjungan terapis ini
    const tVisits = allVisits.filter(
      (v) => v.therapistId === report.therapistId || commsByVisitId.has(v.id)
    );

    const groupedVisits = new Map<string, any>();
    for (const v of tVisits) {
      const key = `${v.visitDate}_${v.visitTime}_${v.patientName || v.patientId || v.id}`;
      if (!groupedVisits.has(key)) {
        groupedVisits.set(key, {
          id: v.id,
          visitDate: v.visitDate,
          visitTime: v.visitTime,
          patientName: v.patientName,
          serviceName: "",
          servicePrice: 0,
          status: v.status,
          commissionAmount: 0,
          commissionStatus: null,
          visitedIds: new Set(),
          visitedCommVisitIds: new Set(),
          dbCommissionIds: new Set(),
        });
      }
      const grp = groupedVisits.get(key)!;
      if (!grp.visitedIds.has(v.id)) {
        grp.serviceName += grp.serviceName ? `, ${v.serviceName}` : (v.serviceName || "");
        grp.servicePrice += (v.servicePrice || 0);
        grp.visitedIds.add(v.id);
        if (v.status === "in_progress") grp.status = "in_progress";
        else if (v.status === "completed" && grp.status !== "in_progress") grp.status = "completed";
      }

      const visitComms = commsByVisitId.get(v.id) || [];
      if (visitComms.length > 0) {
        if (!grp.visitedCommVisitIds.has(v.id)) {
          grp.visitedCommVisitIds.add(v.id);
          const c = visitComms[0];
          if (!grp.dbCommissionIds.has(c.id)) {
            grp.dbCommissionIds.add(c.id);
            grp.commissionAmount += c.amount;
            if (c.status === "PAID") grp.commissionStatus = "PAID";
            else if (!grp.commissionStatus) grp.commissionStatus = c.status;
          }
        }
      } else if (v.therapistId === report.therapistId && v.serviceId && v.status === "completed") {
        if (!grp.visitedCommVisitIds.has(v.id)) {
          grp.visitedCommVisitIds.add(v.id);
          const dynamicComm = await calculateTherapistCommission(db, report.therapistId, v.serviceId, 1);
          grp.commissionAmount += dynamicComm;
          if (!grp.commissionStatus) grp.commissionStatus = v.paymentStatus === "PAID" ? "PAID" : "PENDING";
        }
      }
    }

    for (const group of groupedVisits.values()) {
      delete group.visitedIds;
      delete group.visitedCommVisitIds;
      delete group.dbCommissionIds;
    }

    const combinedVisits = Array.from(groupedVisits.values());
    // Sort descending by date and time
    combinedVisits.sort((a, b) => {
      const dateA = new Date(`${a.visitDate}T${(a.visitTime || '00:00').replace('.', ':')}`);
      const dateB = new Date(`${b.visitDate}T${(b.visitTime || '00:00').replace('.', ':')}`);
      return dateB.getTime() - dateA.getTime();
    });

    const completedVisits = combinedVisits.filter((v) => v.status === "completed");
    const actualTreatments = completedVisits.length;
    const actualCommissions = completedVisits.reduce((sum, v) => sum + (v.commissionAmount || 0), 0);

    const actualTakeHomePay = report.baseSalary + actualCommissions + report.allowances + report.bonuses - report.deductions;

    // Strip sensitive fields before sending response
    const { pinCode, birthDate, ...safePayload } = report;

    return Response.json({
      success: true,
      data: {
        ...safePayload,
        commissions: actualCommissions,
        totalTreatments: actualTreatments,
        takeHomePay: actualTakeHomePay,
        treatmentList: completedVisits,
      },
    });
  } catch (error) {
    console.error("POST /api/therapist-reports/[id]/verify error:", error);
    return Response.json({ error: "Gagal memverifikasi PIN" }, { status: 500 });
  }
}
