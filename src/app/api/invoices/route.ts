import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  invoices,
  branches,
  patients,
  therapists,
  services,
  patientVisits,
} from "@/lib/db/schema";
import { eq, and, like, desc, inArray, gte, lte } from "drizzle-orm";
import { getSession, getActiveBranchFilter } from "@/lib/auth";
import { getServicePrice, SERVICES_LIST } from "@/lib/pricing";
import { createJournalEntry, COA } from "@/lib/accounting";
import {
  financeTransactions,
  therapistCommissions,
  therapistServiceCommissions,
  journalEntries,
  journalLines,
  therapistMonthlyReports,
} from "@/lib/db/schema";
import crypto from "crypto";
import { logSystemAction } from "@/lib/logger";
import { calculateTherapistCommission } from "@/lib/commission";

// Helper: Generate invoice number format INV-BRANCH_CODE-YYYYMMDD-SEQ
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateInvoiceNumber(
  branchId: string,
  tx?: any,
): Promise<string> {
  const now = new Date();
  const dateStr = now
    .toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" })
    .replace(/-/g, "");

  // Get branch code (first 3 letters uppercase)
  const dbInstance = tx || db;
  const branchRecords = await dbInstance
    .select()
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
  const branchCode =
    branchRecords.length > 0
      ? branchRecords[0].name.substring(0, 3).toUpperCase()
      : branchId.substring(0, 3).toUpperCase();

  const prefix = `INV-${branchCode}-${dateStr}`;

  // Find the latest invoice with this prefix to get the next sequence
  const existing = await dbInstance
    .select()
    .from(invoices)
    .where(like(invoices.invoiceNumber, `${prefix}%`))
    .orderBy(desc(invoices.invoiceNumber));

  let seq = 1;
  if (existing.length > 0) {
    const lastNum = existing[0].invoiceNumber;
    const lastSeq = parseInt(lastNum.split("-").pop() || "0");
    seq = lastSeq + 1;
  }

  return `${prefix}-${seq.toString().padStart(3, "0")}`;
}

// GET: List invoices by date and/or branch
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date"); // YYYY-MM-DD
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const branchFilter = await getActiveBranchFilter();

    const conditions = [];
    if (branchFilter) {
      conditions.push(eq(invoices.branchId, branchFilter));
    }
    
    if (startDate) {
      const startObj = new Date(startDate);
      startObj.setHours(0, 0, 0, 0);
      conditions.push(gte(invoices.createdAt, startObj.toISOString()));
    }
    if (endDate) {
      const endObj = new Date(endDate);
      endObj.setHours(23, 59, 59, 999);
      conditions.push(lte(invoices.createdAt, endObj.toISOString()));
    }
    
    if (!startDate && !endDate && dateParam) {
      // Match invoices created on this date (createdAt starts with dateParam)
      conditions.push(like(invoices.createdAt, `${dateParam}%`));
    }

    const result = await db
      .select({
        invoice: invoices,
        patientGender: patients.gender,
      })
      .from(invoices)
      .leftJoin(patients, eq(invoices.patientId, patients.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(invoices.createdAt));

    const formatted = result.map((r) => ({
      ...r.invoice,
      patientGender: r.patientGender,
    }));

    return NextResponse.json({ data: formatted });
  } catch (error: unknown) {
    const err = error as Error;
    if (err.message === "Cabang tidak ditemukan") {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error("GET /api/invoices error:", error);
    return NextResponse.json(
      { error: "Gagal memuat data struk" },
      { status: 500 },
    );
  }
}

// POST: Create a new invoice (POS transaction)
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      patientPhone,
      patientName,
      patientAddress,
      patientGender,
      branchId,
      therapistId,
      items, // Array of {serviceId, name, qty, price, subtotal}
      discount = 0,
      tax = 0,
      paymentMethod = "CASH",
      splitPayments = null,
      amountPaid = 0,
      notes,
      // If linking to an existing visit
      visitId,
      visitIds,
    } = body;

    if (
      !patientPhone ||
      !patientName ||
      !branchId ||
      !items ||
      items.length === 0
    ) {
      return NextResponse.json(
        { error: "Data tidak lengkap" },
        { status: 400 },
      );
    }

    // Enforce branch context for branch admin
    const finalBranchId =
      session.role === "BRANCH_ADMIN" || session.role === "CASHIER"
        ? session.branchId
        : branchId;
    if (!finalBranchId) {
      return NextResponse.json(
        { error: "Cabang wajib ditentukan" },
        { status: 400 },
      );
    }

    const txResult = await db.transaction(async (tx) => {
      // 1. Upsert patient
      let patientId = "";
      const existingPatient = await tx
        .select()
        .from(patients)
        .where(eq(patients.phone, patientPhone))
        .limit(1);

      if (existingPatient.length > 0) {
        patientId = existingPatient[0].id;
        // Update name if changed
        if (existingPatient[0].name !== patientName) {
          await tx
            .update(patients)
            .set({ name: patientName, updatedAt: new Date().toISOString() })
            .where(eq(patients.id, patientId));
        }
      } else {
        patientId = `P-${Date.now()}`;
        await tx.insert(patients).values({
          id: patientId,
          name: patientName,
          phone: patientPhone,
          address: patientAddress || null,
          gender: patientGender || null,
        });
      }

      // 2. Get branch info
      const branchRecords = await tx
        .select()
        .from(branches)
        .where(eq(branches.id, finalBranchId))
        .limit(1);
      const branch = branchRecords[0];
      if (!branch) {
        throw new Error("Cabang tidak ditemukan");
      }

      // 3. Get therapist info
      let therapistName = null;
      if (therapistId) {
        const therapistRecords = await tx
          .select()
          .from(therapists)
          .where(eq(therapists.id, therapistId))
          .limit(1);
        if (therapistRecords.length > 0) {
          therapistName = therapistRecords[0].name;
        }
      }

      // 4. Calculate totals
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subtotal = items.reduce(
        (sum: number, item: any) =>
          sum + (item.subtotal || item.price * item.qty),
        0,
      );
      const grandTotal = subtotal - discount + tax;

      // 5. Generate invoice number
      const invoiceNumber = await generateInvoiceNumber(finalBranchId, tx);

      // 6. Resolve Transaction Date
      let transactionDate = new Date().toISOString();
      let visitDateStr = transactionDate.split("T")[0]; // default to today

      if (visitId) {
        const existingVisits = await tx
          .select()
          .from(patientVisits)
          .where(eq(patientVisits.id, visitId))
          .limit(1);
        if (existingVisits.length > 0) {
          visitDateStr = existingVisits[0].visitDate;
          // Gunakan tanggal dari kunjungan, tapi pertahankan waktu saat ini agar tidak error timezone/format
          const timePart = transactionDate.split("T")[1];
          transactionDate = `${visitDateStr}T${timePart}`;
        }
      } else if (body.transactionDate) {
        transactionDate = body.transactionDate;
        visitDateStr = transactionDate.split("T")[0];
      }

      const invoiceId = crypto.randomUUID();
      const now = transactionDate; // Gunakan transactionDate sebagai acuan waktu

      // CLEANUP LAMA (Mencegah Duplikasi Data):
      // Jika resubmit dari POS, hapus komisi dan invoice lama yang terkait dengan kunjungan ini.
      const visitsToCheck =
        visitIds && visitIds.length > 0 ? visitIds : visitId ? [visitId] : [];

      if (visitId) {
        // Hapus invoice lama
        const oldInvs = await tx
          .select()
          .from(invoices)
          .where(eq(invoices.visitId, visitId));
        if (oldInvs.length > 0) {
          const oldInvIds = oldInvs.map((i) => i.id);
          const fTxs = await tx
            .select()
            .from(financeTransactions)
            .where(inArray(financeTransactions.referenceId, oldInvIds));
          if (fTxs.length > 0) {
            const fTxIds = fTxs.map((t) => t.id);
            const jEntries = await tx
              .select()
              .from(journalEntries)
              .where(inArray(journalEntries.referenceId, fTxIds));
            if (jEntries.length > 0) {
              const jEntryIds = jEntries.map((j) => j.id);
              await tx
                .delete(journalLines)
                .where(inArray(journalLines.entryId, jEntryIds));
              await tx
                .delete(journalEntries)
                .where(inArray(journalEntries.id, jEntryIds));
            }
            await tx
              .delete(financeTransactions)
              .where(inArray(financeTransactions.id, fTxIds));
          }
          await tx.delete(invoices).where(inArray(invoices.id, oldInvIds));
        }
      }

      if (visitsToCheck.length > 0) {
        // Hapus komisi lama
        const oldComms = await tx
          .select()
          .from(therapistCommissions)
          .where(inArray(therapistCommissions.visitId, visitsToCheck));
        if (oldComms.length > 0) {
          const commIds = oldComms.map((c) => c.id);
          const commFTxs = await tx
            .select()
            .from(financeTransactions)
            .where(inArray(financeTransactions.referenceId, visitsToCheck));
          const fTxsToDelete = commFTxs
            .filter(
              (tx) =>
                tx.category === "Bagi Hasil Terapis" || tx.type === "EXPENSE",
            )
            .map((tx) => tx.id);

          if (fTxsToDelete.length > 0) {
            const jEntries = await tx
              .select()
              .from(journalEntries)
              .where(inArray(journalEntries.referenceId, fTxsToDelete));
            if (jEntries.length > 0) {
              const entryIds = jEntries.map((e) => e.id);
              await tx
                .delete(journalLines)
                .where(inArray(journalLines.entryId, entryIds));
              await tx
                .delete(journalEntries)
                .where(inArray(journalEntries.id, entryIds));
            }
            await tx
              .delete(financeTransactions)
              .where(inArray(financeTransactions.id, fTxsToDelete));
          }
          await tx
            .delete(therapistCommissions)
            .where(inArray(therapistCommissions.id, commIds));
        }
      }

      let primaryVisitId = visitsToCheck[0] || (visitId ? visitId : null);

      await tx.insert(invoices).values({
        id: invoiceId,
        invoiceNumber,
        visitId: primaryVisitId || null,
        patientId,
        patientName,
        patientPhone,
        therapistId: therapistId || null,
        therapistName,
        branchId: finalBranchId,
        branchName: branch.name,
        branchAddress: branch.address,
        branchPhone: branch.phone,
        items: JSON.stringify(items),
        subtotal,
        discount,
        tax,
        grandTotal,
        paymentMethod:
          splitPayments && splitPayments.length > 1 ? "SPLIT" : paymentMethod,
        splitPayments: splitPayments ? JSON.stringify(splitPayments) : null,
        amountPaid: amountPaid || grandTotal,
        changeAmount: Math.max(0, (amountPaid || grandTotal) - grandTotal),
        notes: notes || null,
        createdAt: now,
      });

      // 7. Create finance transaction (INCOME)
      if (splitPayments && splitPayments.length > 1) {
        for (const sp of splitPayments) {
          if (sp.amount <= 0) continue;
          const finTrxId = crypto.randomUUID();
          await tx.insert(financeTransactions).values({
            id: finTrxId,
            type: "INCOME",
            category: "Pendapatan Layanan",
            amount: sp.amount,
            description: `Struk ${invoiceNumber} - ${patientName} (${sp.method})`,
            referenceId: invoiceId,
            branchId: finalBranchId,
            paymentMethod: sp.method,
            date: now,
          });

          // 8. Create journal entry
          await createJournalEntry({
            date: now,
            description: `[POS] ${invoiceNumber} - ${patientName} (${sp.method})`,
            referenceId: finTrxId,
            debitAccountId: COA.KAS,
            creditAccountId: COA.PENDAPATAN_LAYANAN,
            amount: sp.amount,
            tx,
          });
        }
      } else {
        const finTrxId = crypto.randomUUID();
        await tx.insert(financeTransactions).values({
          id: finTrxId,
          type: "INCOME",
          category: "Pendapatan Layanan",
          amount: grandTotal,
          description: `Struk ${invoiceNumber} - ${patientName}`,
          referenceId: invoiceId,
          branchId: finalBranchId,
          paymentMethod,
          date: now,
        });

        // 8. Create journal entry
        await createJournalEntry({
          date: now,
          description: `[POS] ${invoiceNumber} - ${patientName}`,
          referenceId: finTrxId,
          debitAccountId: COA.KAS,
          creditAccountId: COA.PENDAPATAN_LAYANAN,
          amount: grandTotal,
          tx,
        });
      }

      // 9. Sync patientVisits with POS items
      // Kita HANYA memperbarui visit original utama, atau membuat satu visit jika standalone.
      const visitsToMark =
        visitIds && visitIds.length > 0 ? visitIds : visitId ? [visitId] : [];
      const finalVisitIds: string[] = [];
      // primaryVisitId sudah dideklarasikan di atas

      let visitsDetails: (typeof patientVisits.$inferSelect)[] = [];

      if (visitsToMark.length > 0) {
        finalVisitIds.push(...visitsToMark);
        visitsDetails = await tx
          .select()
          .from(patientVisits)
          .where(inArray(patientVisits.id, visitsToMark));

        await tx
          .update(patientVisits)
          .set({
            status: "completed",
            paymentStatus: "PAID",
            updatedAt: now,
            ...(therapistId && { therapistId }),
          })
          .where(inArray(patientVisits.id, visitsToMark));
      } else {
        // POS standalone
        primaryVisitId = `V-${Date.now()}`;
        finalVisitIds.push(primaryVisitId);
        visitsDetails = [
          {
            id: primaryVisitId,
            serviceId: items[0]?.serviceId || "MANUAL",
          } as any,
        ];
        await tx.insert(patientVisits).values({
          id: primaryVisitId,
          patientId: patientId,
          serviceId: items[0]?.serviceId || "MANUAL",
          branchId: finalBranchId,
          therapistId: therapistId || null,
          visitDate: visitDateStr,
          visitTime: transactionDate.split("T")[1]?.substring(0, 5) || "00:00",
          status: "completed",
          paymentStatus: "PAID",
        });
      }

      // 10. Create therapist commission if applicable
      if (therapistId && finalVisitIds.length > 0) {
        primaryVisitId = finalVisitIds[0];
        const therapistRecords = await tx
          .select()
          .from(therapists)
          .where(eq(therapists.id, therapistId))
          .limit(1);
        if (therapistRecords.length > 0) {
          const therapist = therapistRecords[0];

          let totalCommission = 0;
          const commissionDetails = [];

          // Calculate TOTAL commission for ALL items
          const availableVisits = [...visitsDetails];
          for (const item of items) {
            const serviceId = item.serviceId;
            if (!serviceId) continue;

            const commissionAmount = await calculateTherapistCommission(
              tx,
              therapistId,
              serviceId,
              item.qty || 1,
            );

            if (commissionAmount > 0) {
              totalCommission += commissionAmount;
              commissionDetails.push(item.name || serviceId);

              const vIdx = availableVisits.findIndex(
                (v) => v.serviceId === serviceId,
              );
              const assignedVisitId =
                vIdx >= 0
                  ? availableVisits.splice(vIdx, 1)[0].id
                  : primaryVisitId;

              await tx.insert(therapistCommissions).values({
                id: crypto.randomUUID(),
                therapistId,
                visitId: assignedVisitId,
                amount: commissionAmount,
                status: "PAID",
                paidAt: now,
              });
            }
          }

          if (totalCommission > 0) {
            // C. Sinkronisasi ke Laporan Bulanan Terapis — ambil data SEBELUM INSERT
            const visitMonth = visitDateStr.substring(0, 7); // YYYY-MM
            let savedReport: (typeof therapistMonthlyReports.$inferSelect)[] =
              [];
            let prevTotalCommissions = 0;
            try {
              savedReport = await tx
                .select()
                .from(therapistMonthlyReports)
                .where(
                  and(
                    eq(therapistMonthlyReports.therapistId, therapistId),
                    eq(therapistMonthlyReports.month, visitMonth),
                  ),
                )
                .limit(1);

              if (savedReport.length > 0) {
                const existingCommissions = await tx
                  .select({ amount: therapistCommissions.amount })
                  .from(therapistCommissions)
                  .innerJoin(
                    patientVisits,
                    eq(therapistCommissions.visitId, patientVisits.id),
                  )
                  .where(
                    and(
                      eq(therapistCommissions.therapistId, therapistId),
                      like(patientVisits.visitDate, `${visitMonth}%`),
                    ),
                  );
                prevTotalCommissions = existingCommissions.reduce(
                  (s, c) => s + c.amount,
                  0,
                );
              }
            } catch (syncErr) {
              console.error(
                "Pre-fetch therapist monthly report error (non-fatal):",
                syncErr,
              );
            }

            // Langsung catat komisi sebagai pengeluaran / beban di sistem keuangan
            const commTrxId = crypto.randomUUID();
            await tx.insert(financeTransactions).values({
              id: commTrxId,
              type: "EXPENSE",
              category: "Bagi Hasil Terapis",
              amount: totalCommission,
              description: `Bagi Hasil Terapis (${therapist.name}) untuk layanan ${commissionDetails.join(", ")} pasien ${patientName}`,
              referenceId: primaryVisitId,
              branchId: finalBranchId,
              paymentMethod: "CASH", // Asumsi disisihkan via kas
              date: now,
            });

            // Otomatisasi Jurnal (Debet: Beban Komisi, Kredit: Kas)
            await createJournalEntry({
              date: now,
              description: `[Auto] Beban Bagi Hasil Terapis: ${therapist.name} - ${commissionDetails.join(", ")}`,
              referenceId: commTrxId,
              debitAccountId: COA.BEBAN_KOMISI,
              creditAccountId: COA.KAS,
              amount: totalCommission,
              tx,
            });

            // Update laporan bulanan dengan total yang dihitung sebelum INSERT + totalCommission
            if (savedReport.length > 0) {
              try {
                const report = savedReport[0];
                const newTotalCommissions =
                  prevTotalCommissions + totalCommission;
                const newTakeHomePay =
                  report.baseSalary +
                  newTotalCommissions +
                  report.allowances +
                  report.bonuses -
                  report.deductions;

                await tx
                  .update(therapistMonthlyReports)
                  .set({
                    commissions: newTotalCommissions,
                    takeHomePay: newTakeHomePay,
                    updatedAt: now,
                  })
                  .where(eq(therapistMonthlyReports.id, report.id));
              } catch (syncErr) {
                console.error(
                  "Sync therapist monthly report error (non-fatal):",
                  syncErr,
                );
              }
            }
          }
        }
      }

      return {
        id: invoiceId,
        invoiceNumber,
        grandTotal,
        changeAmount: Math.max(0, (amountPaid || grandTotal) - grandTotal),
      };
    });

    await logSystemAction(
      "CREATE_INVOICE",
      "invoice",
      txResult.id,
      `Struk baru dibuat: ${txResult.invoiceNumber} sebesar Rp ${txResult.grandTotal.toLocaleString("id-ID")}`,
    );

    return NextResponse.json(
      {
        success: true,
        data: txResult,
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    console.error("POST /api/invoices error:", error);
    return NextResponse.json(
      { error: `Gagal membuat struk: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
