import type { Metadata } from "next";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { etatAbonnement, FONCTIONS, LIBELLES_STATUT, utilisation } from "@/lib/abonnement";
import { paiementsEcole } from "@/lib/paiement";
import { fournisseursActifs } from "@/lib/paiement/fournisseurs";
import { actionPayer } from "@/app/actions/abonnement";
import { FormSection } from "@/components/formulaires/section";
import { Pastille } from "@/components/pastille";
import { dateFr } from "@/lib/dates";

export const metadata: Metadata = { title: "Abonnement" };

const fcfa = (n: number) => (n === 0 ? "Gratuit" : `${n.toLocaleString("fr-FR")} FCFA`);
const duree = (j: number) => (j % 365 === 0 ? `${j / 365} an${j > 365 ? "s" : ""}` : j % 30 === 0 ? `${j / 30} mois` : `${j} jours`);
const STATUT_PAIEMENT = { PENDING: ["En attente", "neutre"], SUCCEEDED: ["Payé", "ok"], FAILED: ["Échoué", "erreur"], CANCELLED: ["Annulé", "neutre"] } as const;

export default async function Abonnement() {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const schoolId = u.schoolId!;
  const [etat, usage, offres, paiements] = await Promise.all([
    etatAbonnement(db(), schoolId),
    utilisation(db(), schoolId),
    db().plan.findMany({ where: { isActive: true }, orderBy: { position: "asc" } }),
    paiementsEcole(db(), schoolId),
  ]);
  const fournisseurs = fournisseursActifs();
  const payantes = offres.filter((o) => !o.isTrial && o.priceXof > 0);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Abonnement</h1>
        <p className="text-attenue">Accès de l&apos;école à la plateforme. À l&apos;échéance, le site passe en lecture seule : aucune donnée n&apos;est supprimée.</p>
      </div>

      <section className="carte">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{etat.plan ? `Offre ${etat.plan.name}` : "Aucune offre"}</h2>
          {etat.actif ? <Pastille ton="ok">{LIBELLES_STATUT.ACTIVE}</Pastille> : <Pastille ton="erreur">Expiré : lecture seule</Pastille>}
          {etat.paiementsEnAttente > 0 && <Pastille ton="alerte">{etat.paiementsEnAttente} paiement(s) en attente</Pastille>}
        </div>
        <dl className="mt-4 grid gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-sm text-attenue">{etat.actif ? "Valable jusqu'au" : "Terminé le"}</dt>
            <dd className="text-xl font-semibold tabular-nums">{etat.finLe ? dateFr(etat.finLe) : "-"}</dd>
          </div>
          <div>
            <dt className="text-sm text-attenue">Jours restants</dt>
            <dd className="text-xl font-semibold tabular-nums">{etat.joursRestants}</dd>
          </div>
          <div>
            <dt className="text-sm text-attenue">Élèves inscrits</dt>
            <dd className="text-xl font-semibold tabular-nums">
              {usage.eleves}
              <span className="text-base font-normal text-attenue"> / {etat.plan?.maxStudents ?? "illimité"}</span>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-attenue">Comptes enseignants</dt>
            <dd className="text-xl font-semibold tabular-nums">
              {usage.enseignants}
              <span className="text-base font-normal text-attenue"> / {etat.plan?.maxTeachers ?? "illimité"}</span>
            </dd>
          </div>
        </dl>
      </section>

      <section className="carte">
        <h2 className="text-lg font-semibold">{etat.actif && !etat.essai ? "Renouveler ou changer d'offre" : "Choisir une offre"}</h2>
        <p className="mt-1 text-sm text-attenue">
          Le montant est celui de l&apos;offre enregistrée sur la plateforme. Un renouvellement payé avant l&apos;échéance s&apos;ajoute à la suite de la
          période en cours ; un paiement pendant l&apos;essai démarre l&apos;offre tout de suite.
        </p>
        {payantes.length === 0 || fournisseurs.length === 0 ? (
          <p className="mt-4 text-sm">Le paiement en ligne n&apos;est pas encore ouvert. Contactez l&apos;administrateur de la plateforme.</p>
        ) : (
          <FormSection action={actionPayer} bouton="Payer" className="mt-4 space-y-5">
            <fieldset>
              <legend className="text-sm font-medium">Offre</legend>
              <div className="mt-2 grid gap-3 md:grid-cols-3">
                {payantes.map((o, i) => (
                  <label key={o.id} className="flex cursor-pointer flex-col rounded-xl border border-bordure p-4 has-[:checked]:border-principal has-[:checked]:ring-2 has-[:checked]:ring-principal/30">
                    <span className="flex items-center gap-2">
                      <input type="radio" name="planId" value={o.id} defaultChecked={i === 0} required />
                      <span className="font-semibold">{o.name}</span>
                    </span>
                    <span className="mt-2 text-2xl font-bold tabular-nums">{fcfa(o.priceXof)}</span>
                    <span className="text-sm text-attenue">pour {duree(o.durationDays)}</span>
                    <span className="mt-2 text-sm">
                      {o.maxStudents ? `Jusqu'à ${o.maxStudents} élèves` : "Élèves illimités"} · {o.maxTeachers ? `${o.maxTeachers} enseignants` : "enseignants illimités"}
                    </span>
                    <ul className="mt-2 list-disc pl-5 text-sm text-attenue">
                      {o.features.filter((f) => f in FONCTIONS).map((f) => (
                        <li key={f}>{FONCTIONS[f]}</li>
                      ))}
                    </ul>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-sm font-medium">Moyen de paiement</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {fournisseurs.map((f, i) => (
                  <label key={f.nom} className="flex cursor-pointer items-center gap-2 rounded-lg border border-bordure px-3 py-2 text-sm has-[:checked]:border-principal">
                    <input type="radio" name="fournisseur" value={f.nom} defaultChecked={i === 0} required />
                    {f.libelle}
                  </label>
                ))}
              </div>
            </fieldset>
          </FormSection>
        )}
      </section>

      <section className="carte">
        <h2 className="text-lg font-semibold">Historique des paiements</h2>
        {paiements.length === 0 ? (
          <p className="mt-2 text-sm text-attenue">Aucun paiement pour l&apos;instant.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-attenue">
                <tr>
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Offre</th>
                  <th className="py-2 pr-3 text-right font-medium">Montant</th>
                  <th className="py-2 pr-3 font-medium">Moyen</th>
                  <th className="py-2 pr-3 font-medium">État</th>
                  <th className="py-2 font-medium">Période</th>
                </tr>
              </thead>
              <tbody>
                {paiements.map((p) => {
                  const [libelle, ton] = STATUT_PAIEMENT[p.status];
                  const s = p.subscription;
                  return (
                    <tr key={p.id} className="border-t border-bordure">
                      <td className="py-2 pr-3 tabular-nums">{dateFr(p.createdAt)}</td>
                      <td className="py-2 pr-3">{s.plan.name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fcfa(p.amountXof)}</td>
                      <td className="py-2 pr-3">{p.provider}</td>
                      <td className="py-2 pr-3">
                        <Pastille ton={ton}>{libelle}</Pastille>
                        {p.status === "PENDING" && (
                          <a className="lien ml-2" href={`/abonnement/retour?paiement=${p.id}`}>Vérifier</a>
                        )}
                      </td>
                      <td className="py-2 tabular-nums">{s.startsAt && s.endsAt && p.status === "SUCCEEDED" ? `${dateFr(s.startsAt)} au ${dateFr(s.endsAt)}` : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
