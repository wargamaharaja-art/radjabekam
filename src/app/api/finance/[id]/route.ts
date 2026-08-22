import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { financeTransactions, journalEntries, journalLines } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Hapus jurnal terkait (journal lines → journal entries) agar tidak orphan
    const relatedJournals = await db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(eq(journalEntries.referenceId, id));

    const journalIds = relatedJournals.map((j) => j.id);

    if (journalIds.length > 0) {
      await db.delete(journalLines).where(inArray(journalLines.entryId, journalIds));
      await db.delete(journalEntries).where(inArray(journalEntries.id, journalIds));
    }

    // 2. Hapus transaksi keuangan
    await db.delete(financeTransactions).where(eq(financeTransactions.id, id));

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete finance transaction:", error);
    return NextResponse.json({ error: "Failed to delete transaction" }, { status: 500 });
  }
}
