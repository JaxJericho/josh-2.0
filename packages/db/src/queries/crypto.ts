import { DB_ERROR_CODES, DbError } from "../errors.mjs";
import type { DbClient } from "../types";

/** Encrypt sms body text with the Postgres rpc helper. */
export async function encryptSmsBody(
  db: DbClient,
  input: {
    plaintext: string;
    key: string;
  },
): Promise<string> {
  const { data, error } = await db.rpc("encrypt_sms_body", {
    plaintext: input.plaintext,
    key: input.key,
  });

  if (error || typeof data !== "string" || data.length === 0) {
    throw new DbError(DB_ERROR_CODES.QUERY_FAILED, "Unable to encrypt sms body.", {
      status: 500,
      cause: error ?? undefined,
      context: { rpc: "encrypt_sms_body" },
    });
  }

  return data;
}

/** Decrypt sms body text with the Postgres rpc helper. */
export async function decryptSmsBody(
  db: DbClient,
  input: {
    ciphertext: string;
    key: string;
  },
): Promise<string> {
  const { data, error } = await db.rpc("decrypt_sms_body", {
    ciphertext: input.ciphertext,
    key: input.key,
  });

  if (error || typeof data !== "string" || data.length === 0) {
    throw new DbError(DB_ERROR_CODES.QUERY_FAILED, "Unable to decrypt sms body.", {
      status: 500,
      cause: error ?? undefined,
      context: { rpc: "decrypt_sms_body" },
    });
  }

  return data;
}
