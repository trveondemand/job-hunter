import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/database.types";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required");
}

export const supabase = createClient<Database>(url, key);
