import { creerClient, type Db } from "../../src/lib/db";

export const baseDisponible = !!process.env.TEST_DATABASE_URL;

let client: Db | undefined;
export function baseDeTest(): Db {
  client ??= creerClient(process.env.TEST_DATABASE_URL);
  return client;
}

/** Vide toutes les tables (sauf l'historique des migrations). */
export async function viderBase(db: Db) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}
