import { db } from "../src/lib/db";
import { services, therapists, therapistServiceCommissions } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";

async function main() {
  console.log("Checking services...");
  const s = await db.select().from(services);
  console.log(s);

  console.log("Checking therapists...");
  const t = await db.select().from(therapists);
  console.log(t);

  console.log("Checking overrides...");
  const o = await db.select().from(therapistServiceCommissions);
  console.log(o);
}

main().catch(console.error).finally(() => process.exit(0));
