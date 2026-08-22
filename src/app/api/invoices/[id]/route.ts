import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { invoices, financeTransactions, therapistCommissions, therapistMonthlyReports, patientVisits, journalEntries, journalLines, branches } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { logSystemAction } from "@/lib/logger";
import { getSession } from "@/lib/auth";

// GET: Public endpoint - fetch invoice detail by ID (no auth required)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const result = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json({ error: "Struk tidak ditemukan" }, { status: 404 });
    }

    const invoice = result[0];

    const branchResult = await db.select({
      mapUrl: branches.mapUrl,
      whatsappNumber: branches.whatsappNumber
    }).from(branches).where(eq(branches.id, invoice.branchId)).limit(1);

    return NextResponse.json({
      data: {
        ...invoice,
        items: JSON.parse(invoice.items),
        branchMapUrl: branchResult[0]?.mapUrl || "",
        branchWhatsapp: branchResult[0]?.whatsappNumber || "",
      }
    });
  } catch (error) {
    console.error("GET /api/invoices/[id] error:", error);
    return NextResponse.json({ error: "Gagal memuat struk" }, { status: 500 });
  }
}

// PUT: Edit an existing invoice (admin only)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Fetch existing invoice
    const existing = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (existing.length === 0) {
      return NextResponse.json({ error: "Struk tidak ditemukan" }, { status: 404 });
    }

    const body = await request.json();
    const {
      paymentMethod,
      amountPaid,
      discount,
      tax,
      notes,
      patientName,
      patientPhone,
      therapistName,
    } = body;

    const current = existing[0];

    // Recalculate totals if discount/tax changed
    const newDiscount = discount !== undefined ? Number(discount) : current.discount;
    const newTax = tax !== undefined ? Number(tax) : current.tax;
    const newGrandTotal = current.subtotal - newDiscount + newTax;
    const newAmountPaid = amountPaid !== undefined ? Number(amountPaid) : current.amountPaid;
    const newChangeAmount = Math.max(0, newAmountPaid - newGrandTotal);

    const updateData: Record<string, unknown> = {
      paymentMethod: paymentMethod || current.paymentMethod,
      amountPaid: newAmountPaid,
      changeAmount: newChangeAmount,
      discount: newDiscount,
      tax: newTax,
      grandTotal: newGrandTotal,
      notes: notes !== undefined ? notes : current.notes,
      patientName: patientName || current.patientName,
      patientPhone: patientPhone || current.patientPhone,
      therapistName: therapistName !== undefined ? therapistName : current.therapistName,
    };

    await db.update(invoices).set(updateData).where(eq(invoices.id, id));

    // Also update the linked finance transaction's paymentMethod if it changed
    if (paymentMethod && paymentMethod !== current.paymentMethod) {
      await db
        .update(financeTransactions)
        .set({ paymentMethod })
        .where(eq(financeTransactions.referenceId, id));
    }

    // Fetch updated invoice
    const updated = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);

    return NextResponse.json({
      success: true,
      data: {
        ...updated[0],
        items: JSON.parse(updated[0].items),
      },
    });
  } catch (error) {
    console.error("PUT /api/invoices/[id] error:", error);
    return NextResponse.json({ error: "Gagal mengupdate struk" }, { status: 500 });
  }
}

// DELETE: Delete an existing invoice and its linked finance transaction (admin only)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Check if invoice exists
    const existing = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (existing.length === 0) {
      return NextResponse.json({ error: "Struk tidak ditemukan" }, { status: 404 });
    }

    const invoice = existing[0];
    const visitId = invoice.visitId;

    // BUG-05 FIX: Hapus semua data terkait secara lengkap (cascade)
    // Kumpulkan semua referenceId yang perlu dihapus
    const referenceIdsToSearch = [id]; // invoiceId
    if (visitId) referenceIdsToSearch.push(visitId);

    // 1. Hapus komisi terapis terkait dan update laporan bulanan
    if (visitId) {
      const commissions = await db.select().from(therapistCommissions).where(eq(therapistCommissions.visitId, visitId));
      
      if (commissions.length > 0) {
        // Update laporan bulanan terapis (kurangi komisi yang dibatalkan)
        const therapistIds = [...new Set(commissions.map(c => c.therapistId))];
        
        for (const tId of therapistIds) {
          const totalCommissionToRemove = commissions
            .filter(c => c.therapistId === tId)
            .reduce((sum, c) => sum + c.amount, 0);
          
          // Cari visit untuk mendapatkan bulan
          const visitRecords = await db.select().from(patientVisits).where(eq(patientVisits.id, visitId)).limit(1);
          if (visitRecords.length > 0) {
            const visitMonth = visitRecords[0].visitDate.substring(0, 7);
            const reports = await db
              .select()
              .from(therapistMonthlyReports)
              .where(
                and(
                  eq(therapistMonthlyReports.therapistId, tId),
                  eq(therapistMonthlyReports.month, visitMonth)
                )
              )
              .limit(1);

            if (reports.length > 0) {
              const report = reports[0];
              const newCommissions = Math.max(0, report.commissions - totalCommissionToRemove);
              const newTakeHomePay = Math.max(0, report.baseSalary + newCommissions + report.allowances + report.bonuses - report.deductions);

              await db
                .update(therapistMonthlyReports)
                .set({
                  commissions: newCommissions,
                  takeHomePay: newTakeHomePay,
                  updatedAt: new Date().toISOString(),
                })
                .where(eq(therapistMonthlyReports.id, report.id));
            }
          }
        }

        // Hapus record komisi
        await db.delete(therapistCommissions).where(eq(therapistCommissions.visitId, visitId));
      }
    }

    // 2. Hapus transaksi keuangan dan jurnal terkait
    const relatedFinanceTxs = await db.select({ id: financeTransactions.id })
      .from(financeTransactions)
      .where(inArray(financeTransactions.referenceId, referenceIdsToSearch));

    const financeTxIds = relatedFinanceTxs.map(tx => tx.id);

    if (financeTxIds.length > 0) {
      // Hapus jurnal terkait
      const relatedJournals = await db.select({ id: journalEntries.id })
        .from(journalEntries)
        .where(inArray(journalEntries.referenceId, financeTxIds));

      const journalIds = relatedJournals.map(j => j.id);

      if (journalIds.length > 0) {
        await db.delete(journalLines).where(inArray(journalLines.entryId, journalIds));
        await db.delete(journalEntries).where(inArray(journalEntries.id, journalIds));
      }

      // Hapus transaksi keuangan
      await db.delete(financeTransactions).where(inArray(financeTransactions.id, financeTxIds));
    }

    // 3. Delete the invoice
    await db.delete(invoices).where(eq(invoices.id, id));

    await logSystemAction("DELETE_INVOICE", "invoice", id, `Struk dihapus: ${invoice.invoiceNumber} - ${invoice.patientName} (${invoice.grandTotal}) beserta komisi dan jurnal terkait`);

    return NextResponse.json({ success: true, message: "Transaksi berhasil dihapus beserta data keuangan terkait" });
  } catch (error) {
    console.error("DELETE /api/invoices/[id] error:", error);
    return NextResponse.json({ error: "Gagal menghapus transaksi" }, { status: 500 });
  }
}

