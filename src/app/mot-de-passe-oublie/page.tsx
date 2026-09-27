import Link from "next/link";
import { CadrePublic } from "@/components/cadre";
import { FormMotDePasseOublie } from "@/components/formulaires/mot-de-passe";

export default function MotDePasseOublie() {
  return (
    <CadrePublic
      titre="Mot de passe oublié"
      sousTitre="Un code vous sera envoyé par SMS pour choisir un nouveau mot de passe. Enseignants : vous pouvez aussi demander un nouveau mot de passe à votre directeur."
      pied={<Link href="/connexion" className="lien">Revenir à la connexion</Link>}
    >
      <FormMotDePasseOublie />
    </CadrePublic>
  );
}
