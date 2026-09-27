import Link from "next/link";
import type { Metadata } from "next";
import { CadrePublic } from "@/components/cadre";
import { FormConnexion } from "@/components/formulaires/connexion";

export const metadata: Metadata = { title: "Connexion" };

export default async function Connexion({ searchParams }: PageProps<"/connexion">) {
  const { reinitialise } = await searchParams;
  return (
    <CadrePublic
      titre="Connexion"
      sousTitre="Directeur : un code SMS vous sera demandé après le mot de passe."
      pied={
        <div className="space-y-2">
          <p><Link href="/mot-de-passe-oublie" className="lien">Mot de passe oublié ?</Link></p>
          <p>Nouvelle école ? <Link href="/inscription" className="lien">Inscrire mon école</Link></p>
          <p>Parent d&apos;élève ? <Link href="/parents" className="lien">Espace parents</Link></p>
        </div>
      }
    >
      {reinitialise && <p role="status" className="mb-4 rounded-lg bg-succes-fond px-3 py-2.5 text-sm text-principal">Mot de passe modifié. Connectez-vous avec le nouveau.</p>}
      <FormConnexion />
    </CadrePublic>
  );
}
