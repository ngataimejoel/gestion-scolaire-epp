/**
 * École de démonstration : charge les données d'exemple du classeur (EPP LIGUIYO) dans la base.
 * Usage : npm run db:seed (variables facultatives DEMO_TELEPHONE et DEMO_MOT_DE_PASSE).
 * Ne touche à rien si l'école de démonstration existe déjà.
 */
import "dotenv/config";
import donnees from "../tests/fixtures/donnees-classeur.json";
import { creerClient } from "../src/lib/db";
import { chargerClasseur, type DonneesClasseur } from "../src/lib/demo/classeur";
import { initialiserOffres } from "../src/lib/abonnement";

async function main() {
  const db = creerClient();
  const offres = await initialiserOffres(db);
  if (offres) console.log(`${offres} offres de départ chargées (modifiables dans /admin).`);
  const code = "DEMO-LIGUIYO";
  if (await db.school.findUnique({ where: { code } })) {
    console.log("L'école de démonstration existe déjà : rien à faire.");
    return;
  }
  const telephone = process.env.DEMO_TELEPHONE ?? "0730908035";
  const motDePasse = process.env.DEMO_MOT_DE_PASSE ?? "Demo2026";
  const { school } = await chargerClasseur(db, donnees as unknown as DonneesClasseur, { telephoneDirecteur: telephone, motDePasse, code });
  console.log(`École de démonstration créée : ${school.name}. Directeur : ${telephone} / ${motDePasse}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
