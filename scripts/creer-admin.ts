/**
 * Crée le compte administrateur de la plateforme (offres, prix, abonnements des écoles).
 * Usage : ADMIN_TELEPHONE=07xxxxxxxx ADMIN_MOT_DE_PASSE='…' ADMIN_NOM='…' npm run admin:creer
 * La connexion se fait ensuite sur /connexion avec ce numéro, ce mot de passe et un code SMS.
 */
import "dotenv/config";
import { creerClient } from "../src/lib/db";
import { creerAdministrateur } from "../src/lib/abonnement/admin";
import { initialiserOffres } from "../src/lib/abonnement";

async function main() {
  const db = creerClient();
  const [telephone, motDePasse] = [process.env.ADMIN_TELEPHONE ?? "", process.env.ADMIN_MOT_DE_PASSE ?? ""];
  if (!telephone || !motDePasse) throw new Error("Renseignez ADMIN_TELEPHONE et ADMIN_MOT_DE_PASSE.");
  const r = await creerAdministrateur(db, { telephone, motDePasse, nom: process.env.ADMIN_NOM ?? "Administrateur" });
  if (!r.ok) throw new Error(r.erreur);
  const n = await initialiserOffres(db);
  console.log(`Administrateur créé.${n ? ` ${n} offres de départ chargées.` : ""}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
