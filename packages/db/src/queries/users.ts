import { DB_ERROR_CODES, DbError } from "../errors.mjs";
import type { DbClient } from "../types";

/** Resolve a user's E.164 phone number by user id. */
export async function loadUserPhoneE164ById(
  db: DbClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("users")
    .select("phone_e164")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new DbError(DB_ERROR_CODES.QUERY_FAILED, "Unable to resolve user phone number.", {
      status: 500,
      cause: error,
      context: { user_id: userId, table: "users" },
    });
  }

  if (!data?.phone_e164) {
    return null;
  }

  return data.phone_e164;
}

/** Resolve a user id by phone number. */
export async function loadUserIdByPhoneE164(
  db: DbClient,
  phoneE164: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("users")
    .select("id")
    .eq("phone_e164", phoneE164)
    .maybeSingle();

  if (error) {
    throw new DbError(DB_ERROR_CODES.QUERY_FAILED, "Unable to resolve user id by phone.", {
      status: 500,
      cause: error,
      context: { phone_e164: phoneE164, table: "users" },
    });
  }

  return data?.id ?? null;
}
