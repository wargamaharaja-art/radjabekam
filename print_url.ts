import { config } from "dotenv";
config({ path: ".env.local" }); 
console.log("DB URL:", process.env.DATABASE_URL);
