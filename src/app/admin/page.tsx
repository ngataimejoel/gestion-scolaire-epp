import type { Metadata } from "next";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { ecolesDeLaPlateforme, FONCTIONS } from "@/lib/abonnement";
import { actionActiverManuellement, actionOffre } from "@/app/actions/abonnement";
import { FormSection } from "@/components/formulaires/section";
import { Pastille } from "@/components/pastille";
import { dateFr } from "@/lib/dates";
import { formaterTelephone } from "@/lib/auth/telephone";
import type { Plan } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Administration" };

function Nombre({ label, name, valeur, aide }: { label: string; name: string; valeur?: number | null; aide?: string }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input name={name} inputMode="numeric" defaultValue={valeur ?? ""} placeholder={aide} className="champ tabular-nums" />
    </label>
  );
}

function ChampsOffre({ o }: { o?: Plan }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {!o && (
          <label className="block text-sm font-medium">
            Code
            <input name="code" required className="champ uppercase" placeholder="ECOLE_PLUS" />
          </label>
        )}
        <label className="block text-sm font-medium sm:col-span-2">
          Nom
          <input name="name" required defaultValue={o?.name} className="champ" />
        </label>
        <Nombre label="Prix (FCFA)" name="priceXof" valeur={o?.priceXof ?? 0} />
        <Nombre label="Durée (jours)" name="durationDays" valeur={o?.durationDays ?? 365} />
        <Nombre label="Élèves max" name="maxStudents" valeur={o?.maxStudents} aide="illimité" />
        <Nombre label="Enseignants max" name="maxTeachers" valeur={o?.maxTeachers} aide="illimité" />
        <Nombre label="Ordre" name="position" valeur={o?.position ?? 9} />
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Fonctions incluses</legend>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {Object.entries(FONCTIONS).map(([cle, libelle]) => (
            <label key={cle} className="flex items-center gap-2">
              <input type="checkbox" name="features" value={cle} defaultChecked={o ? o.features.includes(cle) : true} />
              {libelle}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={o?.isActive ?? true} />
        Offre proposée aux écoles
      </label>
    </>
  );
}

export default async function Admin() {
  await exigerUtilisateur(["PLATFORM_ADMIN"]);
  const [offres, ecoles] = await Promise.all([db().plan.findMany({ orderBy: { position: "asc" } }), ecolesDeLaPlateforme(db())]);
  const payantes = offres.filter((o) => !o.isTrial);
  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Offres et abonnements</h1>
        <p className="text-attenue">Les prix, durées, limites et fonctions se règlent ici ; aucun n&apos;est écrit dans le code. Chaque modification est journalisée.</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Offres</h2>
        {offres.map((o) => (
          <div key={o.id} className="carte">
            <div className="mb-3 flex items-center gap-2">
              <span className="font-mono text-sm">{o.code}</span>
              {o.isTrial && <Pastille ton="alerte">Essai, ouvert à l&apos;inscription</Pastille>}
              {!o.isActive && <Pastille>Désactivée</Pastille>}
            </div>
            <FormSection action={actionOffre.bind(null, o.id)}>
              <ChampsOffre o={o} />
            </FormSection>
          </div>
        ))}
        <details className="carte">
          <summary className="cursor-pointer font-semibold">Créer une offre</summary>
          <FormSection action={actionOffre.bind(null, null)} bouton="Créer" className="mt-4 space-y-4">
            <ChampsOffre />
          </FormSection>
        </details>
      </section>

      <section className="carte">
        <h2 className="text-lg font-semibold">Écoles ({ecoles.length})</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-attenue">
              <tr>
                <th className="py-2 pr-3 font-medium">École</th>
                <th className="py-2 pr-3 font-medium">Directeur</th>
                <th className="py-2 pr-3 font-medium">Offre</th>
                <th className="py-2 pr-3 font-medium">Jusqu&apos;au</th>
                <th className="py-2 pr-3 text-right font-medium">Élèves</th>
                <th className="py-2 font-medium">Activer après paiement reçu hors ligne</th>
              </tr>
            </thead>
            <tbody>
              {ecoles.map((e) => (
                <tr key={e.id} className="border-t border-bordure align-top">
                  <td className="py-2 pr-3">
                    <p className="font-medium">{e.nom}</p>
                    <p className="text-xs text-attenue">{e.code} · inscrite le {dateFr(e.creeLe)}</p>
                  </td>
                  <td className="py-2 pr-3">
                    {e.directeurs.map((d) => (
                      <p key={d.phone}>
                        {d.fullName} <span className="text-attenue">{formaterTelephone(d.phone)}</span>
                      </p>
                    ))}
                  </td>
                  <td className="py-2 pr-3">
                    {e.etat.plan?.name ?? "-"} {e.etat.actif ? <Pastille ton="ok">Actif</Pastille> : <Pastille ton="erreur">Expiré</Pastille>}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{dateFr(e.etat.finLe)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{e.utilisation.eleves}</td>
                  <td className="py-2">
                    <FormSection action={actionActiverManuellement.bind(null, e.id)} bouton="Activer" className="flex flex-wrap items-end gap-2">
                      <select name="planId" className="champ mt-0 w-auto py-1.5" aria-label="Offre">
                        {payantes.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                      <input name="note" placeholder="Référence du reçu" className="champ mt-0 w-44 py-1.5" aria-label="Référence du paiement" />
                    </FormSection>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
