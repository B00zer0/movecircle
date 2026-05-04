import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(root, "movecircle.db");
const outDir = path.join(root, "sql");
const outFile = path.join(outDir, "seed.sql");

const db = new DatabaseSync(dbPath);

const tables = [
  { name: "users", columns: ["id", "name", "username", "email", "password_hash", "bio", "is_admin", "banned_at", "created_at"] },
  { name: "user_metrics", columns: ["user_id", "steps", "calories", "goal", "source_type", "source_status", "updated_at"] },
  { name: "friendships", columns: ["id", "user_low", "user_high", "created_at"] },
  { name: "friend_requests", columns: ["id", "sender_id", "recipient_id", "status", "created_at"] },
  { name: "teams", columns: ["id", "name", "description", "owner_id", "created_at"] },
  { name: "team_members", columns: ["id", "team_id", "user_id", "role", "joined_at"] },
  { name: "direct_messages", columns: ["id", "sender_id", "recipient_id", "body", "created_at"] },
  { name: "assistant_messages", columns: ["id", "user_id", "role", "body", "created_at"] },
  { name: "sync_keys", columns: ["sync_key", "user_id"] }
];

fs.mkdirSync(outDir, { recursive: true });

const chunks = [
  "-- MoveCircle cloud seed",
  "-- Generated from local SQLite database",
  "PRAGMA foreign_keys = OFF;",
  "BEGIN TRANSACTION;"
];

for (const table of tables) {
  const existingColumns = getExistingColumns(table.name);
  const columns = table.columns.filter((column) => existingColumns.has(column));
  if (!columns.length) continue;

  const rows = db.prepare(`SELECT ${columns.join(", ")} FROM ${table.name}`).all();
  if (!rows.length) continue;

  for (const row of rows) {
    const values = columns.map((column) => toSqlValue(row[column]));
    chunks.push(`INSERT INTO ${table.name} (${columns.join(", ")}) VALUES (${values.join(", ")});`);
  }
}

chunks.push("COMMIT;");
chunks.push("PRAGMA foreign_keys = ON;");
chunks.push("");

fs.writeFileSync(outFile, chunks.join("\n"), "utf8");
console.log(`Seed written to ${outFile}`);

function toSqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function getExistingColumns(tableName) {
  const rows = db.prepare(`SELECT name FROM pragma_table_info('${tableName}')`).all();
  return new Set(rows.map((row) => row.name));
}
