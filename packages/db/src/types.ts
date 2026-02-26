import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../supabase/types/database";

export type DbClient = SupabaseClient<Database>;
export type DbSchema = Database["public"];
export type DbTables = DbSchema["Tables"];
export type DbEnums = DbSchema["Enums"];

export type DbTableName = keyof DbTables;

export type DbRow<T extends DbTableName> = DbTables[T]["Row"];
export type DbInsert<T extends DbTableName> = DbTables[T]["Insert"];
export type DbUpdate<T extends DbTableName> = DbTables[T]["Update"];
export type ConversationMode = DbEnums["conversation_mode"];

export type { Database };
