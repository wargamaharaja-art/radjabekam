import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  therapistCommissions,
  patientVisits,
  therapistMonthlyReports,
  services,
  patients,
} from "@/lib/db/schema";
import { eq, and, isNotNull, gte, lte, inArray } from "drizzle-orm";
import crypto from "crypto";
import { calculateCommissionAmount } from "@/lib/commission";
import { getSession } from "@/lib/auth";

// Allow up to 60s for this recalculation operation
export const maxDuration = 60;

export async function POST() {
  try {
    const session = await getSession();
    if (!session || session.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("Memulai sinkronisasi ulang dan deduplikasi komisi historis...");

    // 1. Ambil data master services
    const allServices = await db.select().from(services);
    const serviceMap = new Map(allServices.map((s) => [s.id, s]));

    // 2. Ambil semua komisi yang ada
    const allComms = await db
      .select({
        id: therapistCommissions.id,
        therapistId: therapistCommissions.therapistId,
        visitId: therapistCommissions.visitId,
        amount: therapistCommissions.amount,
        status: therapistCommissions.status,
        serviceId: patientVisits.serviceId,
        visitDate: patientVisits.visitDate,
        paymentStatus: patientVisits.paymentStatus,
        visitStatus: patientVisits.status,
      })
      .from(therapistCommissions)
      .innerJoin(
        patientVisits,
        eq(therapistCommissions.visitId, patientVisits.id),
      );

    // Group commissions by visitId
    const commsByVisitId = new Map<string, typeof allComms>();
    allComms.forEach((c) => {
      if (!commsByVisitId.has(c.visitId)) {
        commsByVisitId.set(c.visitId, []);
      }
      commsByVisitId.get(c.visitId)!.push(c);
    });

    let fixedCount = 0;
    let deletedDupCount = 0;
    let deletedZeroCount = 0;
    let newCount = 0;
    const fixedDetails: string[] = [];
    const affectedMonths = new Set<string>(); // Format: therapistId|YYYY-MM

    const commIdsToDelete: string[] = [];
    const commsToUpdate: { id: string; amount: number }[] = [];

    // 3. Proses deduplikasi dan validasi nominal
    for (const [visitId, commList] of commsByVisitId.entries()) {
      const first = commList[0];
      const svc = serviceMap.get(first.serviceId || "");
      const expectedAmount = calculateCommissionAmount({
        serviceGlobalCommission: svc ? svc.globalCommission : 0,
        servicePrice: svc ? svc.price : 0,
        qty: 1,
      });

      const month = (first.visitDate || "").substring(0, 7);

      if (expectedAmount <= 0) {
        // Layanan komisi 0 (misal Buku Pasien/Member) -> hapus seluruh baris komisi
        for (const c of commList) {
          commIdsToDelete.push(c.id);
          deletedZeroCount++;
        }
        if (first.therapistId && month) {
          affectedMonths.add(`${first.therapistId}|${month}`);
        }
      } else {
        // Jika ada baris duplikat, simpan baris pertama dan hapus sisanya
        if (commList.length > 1) {
          for (let i = 1; i < commList.length; i++) {
            commIdsToDelete.push(commList[i].id);
            deletedDupCount++;
          }
          if (first.therapistId && month) {
            affectedMonths.add(`${first.therapistId}|${month}`);
          }
        }

        // Periksa apakah baris pertama nominalnya sesuai
        if (first.amount !== expectedAmount) {
          commsToUpdate.push({ id: first.id, amount: expectedAmount });
          fixedCount++;
          fixedDetails.push(
            `Diperbarui komisi visit ${visitId}: Rp ${first.amount} -> Rp ${expectedAmount}`,
          );
          if (first.therapistId && month) {
            affectedMonths.add(`${first.therapistId}|${month}`);
          }
        }
      }
    }

    // 4. Batch Delete Duplicates & Zero Commissions
    const BATCH_SIZE = 100;
    if (commIdsToDelete.length > 0) {
      for (let i = 0; i < commIdsToDelete.length; i += BATCH_SIZE) {
        const chunk = commIdsToDelete.slice(i, i + BATCH_SIZE);
        await db.delete(therapistCommissions).where(inArray(therapistCommissions.id, chunk));
      }
    }

    // 5. Batch Update Incorrect Amounts
    if (commsToUpdate.length > 0) {
      for (let i = 0; i < commsToUpdate.length; i += BATCH_SIZE) {
        const chunk = commsToUpdate.slice(i, i + BATCH_SIZE);
        await Promise.all(
          chunk.map((c) =>
            db
              .update(therapistCommissions)
              .set({ amount: c.amount, status: "PAID" })
              .where(eq(therapistCommissions.id, c.id)),
          ),
        );
      }
    }

    // 6. CARI KUNJUNGAN YANG SUDAH DIBAYAR TAPI TIDAK PUNYA KOMISI
    const allPaidVisits = await db
      .select({
        visitId: patientVisits.id,
        therapistId: patientVisits.therapistId,
        serviceId: patientVisits.serviceId,
        visitDate: patientVisits.visitDate,
        paymentStatus: patientVisits.paymentStatus,
        status: patientVisits.status,
      })
      .from(patientVisits)
      .where(
        and(
          eq(patientVisits.paymentStatus, "PAID"),
          eq(patientVisits.status, "completed"),
          isNotNull(patientVisits.therapistId),
        ),
      );

    const commsToInsert: (typeof therapistCommissions.$inferInsert)[] = [];

    for (const v of allPaidVisits) {
      if (!v.therapistId || !v.serviceId) continue;
      const existing = commsByVisitId.get(v.visitId);
      if (!existing || existing.length === 0) {
        const svc = serviceMap.get(v.serviceId);
        const commissionAmount = calculateCommissionAmount({
          serviceGlobalCommission: svc ? svc.globalCommission : 0,
          servicePrice: svc ? svc.price : 0,
          qty: 1,
        });

        if (commissionAmount > 0) {
          const newId = crypto.randomUUID();
          commsToInsert.push({
            id: newId,
            therapistId: v.therapistId,
            visitId: v.visitId,
            amount: commissionAmount,
            status: "PAID",
            paidAt: new Date().toISOString(),
          });
          newCount++;
          fixedDetails.push(
            `Dibuat komisi baru untuk kunjungan ${v.visitId} sebesar Rp ${commissionAmount}`,
          );

          if (v.visitDate) {
            const month = v.visitDate.substring(0, 7);
            affectedMonths.add(`${v.therapistId}|${month}`);
          }
        }
      }
    }

    if (commsToInsert.length > 0) {
      for (let i = 0; i < commsToInsert.length; i += BATCH_SIZE) {
        const chunk = commsToInsert.slice(i, i + BATCH_SIZE);
        await db.insert(therapistCommissions).values(chunk);
      }
    }

    // 7. Sync reports - update all saved reports (month-based and date-range-based)
    const allReports = await db.select().from(therapistMonthlyReports);
    let syncedReportsCount = 0;

    for (const r of allReports) {
      const dateConditions = [];
      if (r.startDate && r.endDate) {
        dateConditions.push(
          gte(patientVisits.visitDate, r.startDate),
          lte(patientVisits.visitDate, r.endDate)
        );
      } else if (r.month) {
        const [year, m] = r.month.split("-");
        const monthStart = `${year}-${m}-01`;
        const lastDay = new Date(parseInt(year), parseInt(m), 0).getDate();
        const monthEnd = `${year}-${m}-${String(lastDay).padStart(2, "0")}`;
        dateConditions.push(
          gte(patientVisits.visitDate, monthStart),
          lte(patientVisits.visitDate, monthEnd)
        );
      }

      if (dateConditions.length === 0) continue;

      const reportVisits = await db
        .select({
          id: patientVisits.id,
          therapistId: patientVisits.therapistId,
          visitDate: patientVisits.visitDate,
          visitTime: patientVisits.visitTime,
          patientId: patientVisits.patientId,
          patientName: patients.name,
          serviceId: patientVisits.serviceId,
          status: patientVisits.status,
        })
        .from(patientVisits)
        .leftJoin(patients, eq(patientVisits.patientId, patients.id))
        .where(and(...dateConditions));

      const visitIds = reportVisits.map((v) => v.id);

      let comms: any[] = [];
      if (visitIds.length > 0) {
        comms = await db
          .select()
          .from(therapistCommissions)
          .where(
            and(
              inArray(therapistCommissions.visitId, visitIds),
              eq(therapistCommissions.therapistId, r.therapistId)
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

      const tVisits = reportVisits.filter(
        (v) => v.therapistId === r.therapistId || commsByVisitId.has(v.id)
      );

      const groupedVisits = new Map<string, any>();
      for (const v of tVisits) {
        const key = `${v.visitDate}_${v.visitTime}_${v.patientName || v.patientId || v.id}`;
        if (!groupedVisits.has(key)) {
          groupedVisits.set(key, {
            status: v.status,
            commissionAmount: 0,
            visitedIds: new Set(),
            visitedCommVisitIds: new Set(),
            dbCommissionIds: new Set(),
          });
        }
        const grp = groupedVisits.get(key)!;
        if (!grp.visitedIds.has(v.id)) {
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
            }
          }
        } else if (v.therapistId === r.therapistId && v.serviceId && v.status === "completed") {
          if (!grp.visitedCommVisitIds.has(v.id)) {
            grp.visitedCommVisitIds.add(v.id);
            const svc = serviceMap.get(v.serviceId);
            const dynamicComm = calculateCommissionAmount({
              serviceGlobalCommission: svc ? svc.globalCommission : 0,
              servicePrice: svc ? svc.price : 0,
              qty: 1,
            });
            grp.commissionAmount += dynamicComm;
          }
        }
      }

      const combinedVisits = Array.from(groupedVisits.values());
      const totalTreatments = combinedVisits.filter((v) => v.status === "completed").length;
      const reportTotalComm = combinedVisits
        .filter((v) => v.status === "completed")
        .reduce((s, v) => s + (v.commissionAmount || 0), 0);

      const newThp =
        (r.baseSalary || 0) +
        reportTotalComm +
        (r.allowances || 0) +
        (r.bonuses || 0) -
        (r.deductions || 0);

      await db
        .update(therapistMonthlyReports)
        .set({
          commissions: reportTotalComm,
          totalTreatments,
          takeHomePay: newThp,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(therapistMonthlyReports.id, r.id));

      syncedReportsCount++;
    }

    return NextResponse.json({
      success: true,
      message: `Berhasil membersihkan ${deletedDupCount} komisi duplikat, menghapus ${deletedZeroCount} komisi 0, mengoreksi ${fixedCount} komisi tidak valid, menerbitkan ${newCount} komisi baru, dan mensinkronisasi ${syncedReportsCount} laporan bulanan.`,
      details: fixedDetails,
    });
  } catch (error: unknown) {
    console.error("Gagal sinkronisasi komisi:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 },
    );
  }
}
