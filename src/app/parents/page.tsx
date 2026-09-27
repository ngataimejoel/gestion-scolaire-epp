import Link from "next/link";
import type { Metadata } from "next";
import { CadrePublic } from "@/components/cadre";
import { FormParent } from "@/components/formulaires/parent";

export const metadata: Metadata = { title: "Espace parents" };

export default function Parents() {
  return (
    <CadrePublic
      titre="Espace parents"
      sousTitre="Pas de mot de passe : saisissez le matricule école (ex. CP1-001-26) ou le matricule DESPS de votre enfant, et sa date de naissance."
      pied={<>Directeur ou enseignant ? <Link href="/connexion" className="lien">Se connecter</Link></>}
    >
      <FormParent />
    </CadrePublic>
  );
}
