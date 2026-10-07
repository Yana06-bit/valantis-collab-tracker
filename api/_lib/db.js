// Database access (Supabase Postgres).
//
// We use the "service role" key, which only ever lives on the server (Vercel env vars).
// Row Level Security is switched on for every table with no public policies, so even if
// someone found the public Supabase URL they could read nothing. Only this server can.
import { createClient } from "@supabase/supabase-js";

let client = null;

export function db() {
  // Tests inject an in-memory fake here.
  if (globalThis.__TEST_DB__) return globalThis.__TEST_DB__;
  if (!client) {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set.");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

// Throw a readable error if Supabase returned one.
export function check({ data, error }, what) {
  if (error) {
    const e = new Error(`Database error while ${what}: ${error.message}`);
    e.cause = error;
    throw e;
  }
  return data;
}
