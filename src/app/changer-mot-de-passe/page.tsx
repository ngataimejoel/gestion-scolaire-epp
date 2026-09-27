import { CadrePublic } from "@/components/cadre";
import { FormChangerMotDePasse } from "@/components/formulaires/mot-de-passe";
import { exigerUtilisateur } from "@/lib/auth/next";

export default async function ChangerMotDePasse() {
  const u = await exigerUtilisateur(undefined, { autoriserChangementMdp: true });
  return (
    <CadrePublic
      titre="Changer de mot de passe"
      sousTitre={u.mustChangePassword ? "Première connexion : remplacez le mot de passe provisoire reçu par SMS avant de continuer." : undefined}
    >
      <FormChangerMotDePasse />
    </CadrePublic>
  );
}
