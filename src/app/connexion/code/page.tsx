import Link from "next/link";
import { redirect } from "next/navigation";
import { CadrePublic } from "@/components/cadre";
import { FormCodeSms } from "@/components/formulaires/code-sms";
import { SmsSimule } from "@/components/sms-simule";
import { actionConfirmerConnexion, actionRenvoyerCode } from "@/app/actions/auth";
import { lireAttente } from "@/lib/auth/next";
import { masquerTelephone } from "@/lib/auth/telephone";

export default async function CodeConnexion() {
  const a = await lireAttente("LOGIN");
  if (!a) redirect("/connexion");
  return (
    <CadrePublic
      titre="Code de connexion"
      sousTitre={`Saisissez le code à 6 chiffres envoyé au ${masquerTelephone(a.phone)}.`}
      pied={<Link href="/connexion" className="lien">Revenir à la connexion</Link>}
    >
      <SmsSimule phone={a.phone} />
      <FormCodeSms action={actionConfirmerConnexion} renvoi={actionRenvoyerCode.bind(null, "LOGIN")} libelle="Se connecter" />
    </CadrePublic>
  );
}
