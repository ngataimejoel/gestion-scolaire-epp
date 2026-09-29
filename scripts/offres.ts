/** Charge les offres de départ (prisma/offres-initiales.json) si la table des offres est vide. Usage : npm run db:offres */
import "dotenv/config";
import { creerClient } from "../src/lib/db";
import { initialiserOffres } from "../src/lib/abonnement";

async function main() {
  const db = creerClient();
  const n = await initialiserOffres(db);
  console.log(n ? `${n} offres chargées.` : "Des offres existent déjà : rien n'a été modifié.");
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
