import Link from "next/link";
import type { Metadata } from "next";
import { CadrePublic } from "@/components/cadre";
import { FormInscription } from "@/components/formulaires/inscription";

export const metadata: Metadata = { title: "Inscription du directeur" };

export default function Inscription() {
  return (
    <CadrePublic
      titre="Inscrire mon école"
      sousTitre="Réservé au directeur. Les comptes des enseignants seront créés ensuite depuis votre espace."
      pied={<>Déjà inscrit ? <Link href="/connexion" className="lien">Se connecter</Link></>}
    >
      <FormInscription />
    </CadrePublic>
  );
}
