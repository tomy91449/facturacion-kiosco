import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { PrismaClient } from "./generated/client";

/**
 * Aplica las migraciones pendientes de prisma/migrations sin la CLI de Prisma
 * (el programa instalado no la incluye). Usa la misma tabla _prisma_migrations
 * que `prisma migrate deploy`, así una base sirve tanto en Docker como en el .exe.
 */
export async function applyMigrations(databaseUrl: string, migrationsDir: string): Promise<string[]> {
  // Una sola conexión: los PRAGMA de las migraciones valen por conexión
  const url    = databaseUrl + (databaseUrl.includes("?") ? "&" : "?") + "connection_limit=1";
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id"                  TEXT PRIMARY KEY NOT NULL,
      "checksum"            TEXT NOT NULL,
      "finished_at"         DATETIME,
      "migration_name"      TEXT NOT NULL,
      "logs"                TEXT,
      "rolled_back_at"      DATETIME,
      "started_at"          DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
    )`);

    const rows = await prisma.$queryRawUnsafe<{ migration_name: string; finished_at: unknown }[]>(
      `SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`
    );
    const failed = rows.find((r) => r.finished_at === null);
    if (failed) {
      throw new Error(`La migración ${failed.migration_name} quedó a medias en un arranque anterior. Restaurá un respaldo de la base.`);
    }
    const applied = new Set(rows.map((r) => r.migration_name));

    const pending = fs.readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !applied.has(d.name))
      .map((d) => d.name)
      .sort();

    for (const name of pending) {
      const sql = fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8");
      const id  = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, applied_steps_count) VALUES (?, ?, ?, ?, 0)`,
        id, createHash("sha256").update(sql).digest("hex"), name, Date.now()
      );
      for (const statement of splitStatements(sql)) {
        await prisma.$executeRawUnsafe(statement);
      }
      await prisma.$executeRawUnsafe(
        `UPDATE "_prisma_migrations" SET finished_at = ?, applied_steps_count = 1 WHERE id = ?`,
        Date.now(), id
      );
    }
    return pending;
  } finally {
    await prisma.$disconnect();
  }
}

// Las migraciones generadas por Prisma terminan cada sentencia con ";" al final de línea
// y no usan ";" dentro de textos, así que alcanza con cortar ahí.
function splitStatements(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}
