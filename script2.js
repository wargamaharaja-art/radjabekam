const fs = require('fs');
let c = fs.readFileSync('src/lib/db/schema.ts', 'utf8');

c = c.replace(
  'import { pgTable, text, integer, boolean } from "drizzle-orm/pg-core";',
  'import { pgTable, text, integer, boolean, json } from "drizzle-orm/pg-core";'
);

c = c.replace(
  'operatingHours: text("operating_hours").notNull().default("09:00 - 21:00 WIB"),',
  'operatingHours: text("operating_hours").notNull().default("09:00 - 21:00 WIB"),\n  operatingHoursWeekend: text("operating_hours_weekend").notNull().default("09:00 - 21:00 WIB"),'
);

c = c.replace(
  'gender: text("gender", { enum: ["L", "P"] }),',
  'gender: text("gender", { enum: ["L", "P"] }),\n  bloodPressure: text("blood_pressure"),'
);

c = c.replace(
  'mapUrl: text("map_url"),',
  'mapUrl: text("map_url"),\n  aboutPageContent: json("about_page_content"),'
);

c = c.replace(
  'paymentMethod: text("payment_method").notNull().default("CASH"),',
  'paymentMethod: text("payment_method").notNull().default("CASH"),\n  splitPayments: text("split_payments"),'
);

fs.writeFileSync('src/lib/db/schema.ts', c);
console.log('Schema updated successfully');
