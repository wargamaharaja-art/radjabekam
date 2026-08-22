import fs from 'fs';

let content = fs.readFileSync('src/lib/db/schema.ts', 'utf8');

// Replace imports
content = content.replace(
  'import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";',
  'import { pgTable, text, integer, boolean } from "drizzle-orm/pg-core";'
);

// Replace sqliteTable with pgTable
content = content.replaceAll('sqliteTable', 'pgTable');

// Replace integer mode boolean with boolean
content = content.replaceAll('integer("is_active", { mode: "boolean" })', 'boolean("is_active")');

fs.writeFileSync('src/lib/db/schema.ts', content);
console.log('Done!');
