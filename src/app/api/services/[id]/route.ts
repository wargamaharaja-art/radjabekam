import { db } from "@/lib/db";
import { services } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logSystemAction } from "@/lib/logger";
import { checkBranchAccess } from "@/lib/auth";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, description, price, durationMinutes, globalCommission, category, isActive, branchId } = body;

    const existing = await db.select().from(services).where(eq(services.id, id)).limit(1);
    if (existing.length === 0) {
      return Response.json({ error: "Layanan tidak ditemukan" }, { status: 404 });
    }
    
    if (existing[0].branchId) {
      const hasAccess = await checkBranchAccess(existing[0].branchId);
      if (!hasAccess) {
        return Response.json({ error: "Forbidden: You do not have access to modify this service" }, { status: 403 });
      }
    }

    const oldPrice = existing[0].price;

    const result = await db.update(services).set({
      name,
      description,
      price: price !== undefined ? Number(price) : undefined,
      durationMinutes: durationMinutes !== undefined ? Number(durationMinutes) : undefined,
      globalCommission: globalCommission !== undefined ? Number(globalCommission) : undefined,
      category: category !== undefined ? category : undefined,
      branchId: branchId !== undefined ? branchId : undefined,
      isActive: isActive !== undefined ? isActive : undefined,
    }).where(eq(services.id, id)).returning();

    if (result.length === 0) {
      return Response.json({ error: "Layanan tidak ditemukan" }, { status: 404 });
    }

    if (price !== undefined && Number(price) !== oldPrice) {
      await logSystemAction("UPDATE_PRICE", "service", id, `Harga layanan ${name || existing[0].name} diubah dari ${oldPrice} menjadi ${price}`);
    }

    return Response.json({ data: result[0] });
  } catch (error) {
    console.error("PUT /api/services/[id] error:", error);
    return Response.json({ error: "Gagal memperbarui layanan" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const existing = await db.select().from(services).where(eq(services.id, id)).limit(1);
    if (existing.length === 0) {
      return Response.json({ error: "Layanan tidak ditemukan" }, { status: 404 });
    }

    if (existing[0].branchId) {
      const hasAccess = await checkBranchAccess(existing[0].branchId);
      if (!hasAccess) {
        return Response.json({ error: "Forbidden: You do not have access to delete this service" }, { status: 403 });
      }
    }

    try {
      // Attempt hard delete first
      await db.delete(services).where(eq(services.id, id));
      await logSystemAction("DELETE_SERVICE", "service", id, `Layanan dihapus permanen: ${existing[0].name}`);
      return Response.json({ success: true, message: "Layanan berhasil dihapus" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (dbError: any) {
      // If it fails (likely due to foreign key constraint from patientVisits/reservations),
      // fallback to soft delete
      console.warn(`Hard delete failed for service ${id}, falling back to soft delete.`, dbError.message);
      
      const result = await db.update(services).set({
        isActive: false,
      }).where(eq(services.id, id)).returning();

      if (result.length === 0) {
        return Response.json({ error: "Layanan tidak ditemukan" }, { status: 404 });
      }

      await logSystemAction("DELETE_SERVICE", "service", id, `Layanan dinonaktifkan: ${existing[0].name}`);
      return Response.json({ success: true, message: "Layanan berhasil dihapus (dinonaktifkan karena memiliki riwayat transaksi)" });
    }
  } catch (error) {
    console.error("DELETE /api/services/[id] error:", error);
    return Response.json({ error: "Gagal menghapus layanan" }, { status: 500 });
  }
}
