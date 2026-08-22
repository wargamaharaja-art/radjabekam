import { db } from "@/lib/db";
import { services, therapists, therapistServiceCommissions, patientVisits, therapistCommissions } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const s = await db.select().from(services);
    const t = await db.select().from(therapists);
    const overrides = await db.select().from(therapistServiceCommissions);
    
    const recentCommissions = await db
      .select()
      .from(therapistCommissions)
      .orderBy(desc(therapistCommissions.paidAt))
      .limit(10);

    return NextResponse.json({
      services: s,
      therapists: t,
      overrides,
      recentCommissions,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
