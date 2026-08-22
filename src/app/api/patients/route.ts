import { db } from "@/lib/db";
import { patients } from "@/lib/db/schema";
import { eq, or, isNull } from "drizzle-orm";
import { getActiveBranchFilter } from "@/lib/auth";

export async function GET() {
  try {
    const branchFilter = await getActiveBranchFilter();
    
    let result;
    if (branchFilter) {
      result = await db
        .select()
        .from(patients)
        .where(
          or(
            eq(patients.branchId, branchFilter),
            isNull(patients.branchId)
          )
        );
    } else {
      result = await db.select().from(patients);
    }
    
    return Response.json({ data: result });
  } catch (error) {
    console.error("GET /api/patients error:", error);
    return Response.json({ error: "Gagal mengambil data pasien" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, phone, address, gender } = body;

    if (!name || !phone) {
      return Response.json({ error: "Nama dan nomor telepon wajib diisi" }, { status: 400 });
    }

    const branchFilter = await getActiveBranchFilter();
    const newId = `P-${Date.now()}`;
    const result = await db.insert(patients).values({
      id: newId,
      name,
      phone,
      address,
      gender,
      branchId: branchFilter || null,
    }).returning();

    return Response.json({ data: result[0] });
  } catch (error) {
    console.error("POST /api/patients error:", error);
    return Response.json({ error: "Gagal menambah data pasien" }, { status: 500 });
  }
}
