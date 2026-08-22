import { db } from "../src/lib/db";
import { patients, patientVisits } from "../src/lib/db/schema";
import { eq, ilike } from "drizzle-orm";

async function main() {
  const pts = await db.select().from(patients).where(ilike(patients.name, "%stefanus%"));
  console.log("Patients:", pts);
  if (pts.length > 0) {
    const visits = await db.select().from(patientVisits).where(eq(patientVisits.patientId, pts[0].id));
    console.log("Visits for", pts[0].name, visits);
  }
}
main().catch(console.error).then(() => process.exit(0));
