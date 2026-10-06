import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config.js";
import { onnotice } from "./pgNotice.js";

const client = postgres(config.databaseUrl, { onnotice });
export const db = drizzle(client);
