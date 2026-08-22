require("dotenv").config({ path: ".env.local" });
import { db } from "./src/lib/db";
import { financeCategories } from "./src/lib/db/schema";
import crypto from "crypto";

async function run() {
  console.log("🌱 Inserting categories...");

  const categories = [
    { name: 'biaya penyusutan sewa ruko', type: 'EXPENSE' },
    { name: 'biaya sistem kasir', type: 'EXPENSE' }
  ] as const;

  for (const cat of categories) {
    await db.insert(financeCategories).values({
      id: crypto.randomUUID(),
      name: cat.name,
      type: cat.type,
      isActive: true,
    });
    console.log(`Inserted ${cat.name}`);
  }

  console.log("✅ Done");
  process.exit(0);
}

run().catch(console.error);
