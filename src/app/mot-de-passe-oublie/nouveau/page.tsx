import { redirect } from "next/navigation";
import { CadrePublic } from "@/components/cadre";
import { FormReinitialiser } from "@/components/formulaires/mot-de-passe";
import { SmsSimule } from "@/components/sms-simule";
import { actionRenvoyerCode } from "@/app/actions/auth";
import { lireAttente } from "@/lib/auth/next";
import { masquerTelephone } from "@/lib/auth/telephone";

export default async function NouveauMotDePasse() {
  const a = await lireAttente("PASSWORD_RESET");
  if (!a) redirect("/mot-de-passe-oublie");
  return (
    <CadrePublic titre="Nouveau mot de passe" sousTitre={`Si ce numéro a un compte, un code a été envoyé au ${masquerTelephone(a.phone)}.`}>
      <SmsSimule phone={a.phone} />
      <FormReinitialiser renvoi={actionRenvoyerCode.bind(null, "PASSWORD_RESET")} />
    </CadrePublic>
  );
}
