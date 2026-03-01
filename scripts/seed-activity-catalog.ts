/**
 * Ticket 16.3 — Seed activity_catalog
 * Deterministic, idempotent upsert by activity_key.
 */

import { createClient } from "@supabase/supabase-js";
import { activityCatalogSeed } from "../docs/seed/activity_catalog_seed";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function run() {
  console.log("Seeding activity_catalog...");

  for (const activity of activityCatalogSeed) {
    const { error } = await supabase.from("activity_catalog").upsert(activity, {
      onConflict: "activity_key",
    });

    if (error) {
      console.error(`Failed upserting ${activity.activity_key}`, error);
      process.exit(1);
    }

    console.log(`Upserted: ${activity.activity_key}`);
  }

  console.log("Seeding complete.");
}

run().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});
