import { execSync } from "node:child_process";

/** Applique les migrations sur la base de test (TEST_DATABASE_URL) avant les tests d'intégration. */
export default function preparation() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn("TEST_DATABASE_URL non défini : les tests de base de données sont ignorés.");
    return;
  }
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
