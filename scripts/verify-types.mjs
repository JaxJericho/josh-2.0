import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const CWD = process.cwd();
const TYPES_PATH = path.join(CWD, "supabase", "types", "database.ts");
const TMP_PATH = path.join(CWD, "supabase", "types", ".tmp-database.ts");

function exitWith(message) {
  console.error(message);
  process.exitCode = 1;
}

function run() {
  if (!fs.existsSync(TYPES_PATH)) {
    exitWith(
      "FAIL: Missing supabase/types/database.ts. Run pnpm db:gen-types to create it."
    );
    return;
  }

  const result = spawnSync(
    "supabase",
    ["gen", "types", "typescript", "--local"],
    { encoding: "utf8" }
  );

  if (result.error) {
    exitWith(`FAIL: supabase CLI not available: ${result.error.message}`);
    return;
  }

  if (result.status !== 0) {
    exitWith(
      `FAIL: supabase gen types failed (exit ${result.status}).\n${
        result.stderr || result.stdout
      }`
    );
    return;
  }

  try {
    fs.writeFileSync(TMP_PATH, result.stdout);
    const expected = fs.readFileSync(TYPES_PATH, "utf8");
    const actual = fs.readFileSync(TMP_PATH, "utf8");

    if (expected !== actual) {
      exitWith(
        "FAIL: Generated types are out of date. Run pnpm db:gen-types and commit the update."
      );
      return;
    }

    console.log("PASS: Generated types are up to date.");
  } finally {
    if (fs.existsSync(TMP_PATH)) {
      fs.unlinkSync(TMP_PATH);
    }
  }
}

run();
