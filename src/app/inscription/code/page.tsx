import Link from "next/link";
import { redirect } from "next/navigation";
import { CadrePublic } from "@/components/cadre";
import { FormCodeSms } from "@/components/formulaires/code-sms";
import { SmsSimule } from "@/components/sms-simule";
import { actionConfirmerInscription, actionRenvoyerCode } from "@/app/actions/auth";
import { lireAttente } from "@/lib/auth/next";
import { masquerTelephone } from "@/lib/auth/telephone";

export default async function CodeInscription() {
  const a = await lireAttente("SIGNUP");
  if (!a) redirect("/inscription");
  return (
    <CadrePublic
      titre="Validez votre numéro"
      sousTitre={`Saisissez le code à 6 chiffres envoyé au ${masquerTelephone(a.phone)}. Il est valable 5 minutes.`}
      pied={<Link href="/inscription" className="lien">Modifier mes informations</Link>}
    >
      <SmsSimule phone={a.phone} />
      <FormCodeSms action={actionConfirmerInscription} renvoi={actionRenvoyerCode.bind(null, "SIGNUP")} libelle="Créer mon compte" />
    </CadrePublic>
  );
}
