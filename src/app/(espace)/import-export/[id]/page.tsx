import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { estEnseignant } from "@/lib/regles";
import { apercuImport, STATUT_IMPORT } from "@/lib/classeur/service";
import { actionAnnulerImport, actionConfirmerImport } from "@/app/actions/import";
import { FormConfirmerImport } from "@/components/formulaires/import";
import { BoutonAction } from "@/components/formulaires/bouton-action";
import { Pastille } from "@/components/pastille";

export const metadata: Metadata = { title: "Aperçu de l'import" };

const STATUT_ELEVE: Record<string, string> = { PRESENT: "Présent", ABANDON: "Abandon", TRANSFERE: "Transféré" };

function Tableau({ entetes, lignes }: { entetes: string[]; lignes: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-attenue">
          <tr>{entetes.map((e) => <th key={e} className="px-3 py-2 font-medium">{e}</th>)}</tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i} className="border-t border-bordure">{l.map((c, j) => <td key={j} className="px-3 py-2 align-top">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Liste repliable : les longues listes (64 élèves…) ne masquent pas le résumé. */
function Liste({ titre, n, ouvert = false, children }: { titre: string; n: number; ouvert?: boolean; children: ReactNode }) {
  if (!n) return null;
  return (
    <details className="carte" open={ouvert}>
      <summary className="cursor-pointer text-lg font-semibold">{titre} ({n})</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export default async function ApercuImport({ params }: PageProps<"/import-export/[id]">) {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const { id } = await params;
  const r = await apercuImport(db(), u, id);
  if (!r) notFound();
  const { job, analyse, apercu, rapport } = r;
  const aConfirmer = job.status === "ANALYZED";
  const chiffres: [string, number][] = apercu
    ? [
        ["Élèves nouveaux", apercu.nouveauxEleves.length],
        ["Élèves déjà présents", apercu.doublonsEleves.length],
        ["Agents nouveaux", apercu.nouveauxAgents.length],
        ["Notes", apercu.notes],
        ["Absences et retards", apercu.evenements],
        ["Erreurs et avertissements", apercu.problemes.length],
      ]
    : [];
  const ignores = apercu?.problemes.filter((p) => p.ignore).length ?? 0;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href="/import-export" className="lien text-sm">Import et sauvegarde</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{aConfirmer ? "Aperçu de l'import" : "Rapport d'import"}</h1>
          <Pastille ton={STATUT_IMPORT[job.status][1]}>{STATUT_IMPORT[job.status][0]}</Pastille>
        </div>
        <p className="text-attenue">{job.filename}</p>
      </div>

      {analyse.feuillesManquantes.length > 0 && (
        <p className="carte text-sm">Feuilles absentes du fichier (ignorées) : {analyse.feuillesManquantes.join(", ")}.</p>
      )}

      {apercu && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {chiffres.map(([l, n]) => (
            <div key={l} className="carte">
              <p className="text-2xl font-bold">{n}</p>
              <p className="text-sm text-attenue">{l}</p>
            </div>
          ))}
        </section>
      )}

      {rapport && (
        <section className="carte space-y-2">
          <h2 className="text-lg font-semibold">Import terminé</h2>
          <p className="text-sm">
            {rapport.eleves} élève{rapport.eleves > 1 ? "s" : ""}, {rapport.agents} agent{rapport.agents > 1 ? "s" : ""}, {rapport.notes} notes et {rapport.evenements} absences ou retards enregistrés.
            {rapport.parametres > 0 && ` ${rapport.parametres} réglage${rapport.parametres > 1 ? "s" : ""} remplacé${rapport.parametres > 1 ? "s" : ""}.`}
            {rapport.comptes > 0 && ` ${rapport.comptes} compte${rapport.comptes > 1 ? "s" : ""} enseignant${rapport.comptes > 1 ? "s" : ""} créé${rapport.comptes > 1 ? "s" : ""}.`}
          </p>
          {rapport.comparaison && (
            <p className="text-sm">
              {rapport.comparaison.ecarts.length === 0 ? (
                <Pastille ton="ok">Résultats identiques au fichier</Pastille>
              ) : (
                <Pastille ton="erreur">{rapport.comparaison.ecarts.length} résultat{rapport.comparaison.ecarts.length > 1 ? "s" : ""} différent{rapport.comparaison.ecarts.length > 1 ? "s" : ""}</Pastille>
              )}{" "}
              MGA, décision et rang recalculés par le site pour {rapport.comparaison.comparees} élèves et comparés à ceux du classeur : {rapport.comparaison.identiques} identiques.
            </p>
          )}
          {rapport.comparaison && rapport.comparaison.ecarts.length > 0 && (
            <Tableau
              entetes={["Élève", "Classeur (MGA, décision, rang)", "Site (MGA, décision, rang)"]}
              lignes={rapport.comparaison.ecarts.map((e) => [e.nom, `${e.fichier.mga ?? "-"} · ${e.fichier.decision ?? "-"} · ${e.fichier.rang ?? "-"}`, `${e.site.mga ?? "-"} · ${e.site.decision ?? "-"} · ${e.site.rang ?? "-"}`])}
            />
          )}
          <div className="flex flex-wrap gap-4 text-sm">
            <Link href="/eleves" className="lien">Voir les élèves</Link>
            <Link href="/resultats" className="lien">Voir les résultats</Link>
          </div>
        </section>
      )}

      {apercu && (
        <>
          <Liste titre="Erreurs et avertissements" n={apercu.problemes.length} ouvert>
            {ignores > 0 && <p className="mb-2 text-sm">{ignores} ligne{ignores > 1 ? "s" : ""} ou note{ignores > 1 ? "s" : ""} ne {ignores > 1 ? "seront" : "sera"} pas importée{ignores > 1 ? "s" : ""}. Corrigez le fichier puis envoyez-le à nouveau, ou saisissez-les dans le site.</p>}
            <Tableau
              entetes={["Feuille", "Ligne", "Message", ""]}
              lignes={apercu.problemes.map((p) => [p.feuille, p.ligne, p.message, p.ignore ? <Pastille key="i" ton="erreur">Ignoré</Pastille> : <Pastille key="i" ton="alerte">Importé</Pastille>])}
            />
          </Liste>
          <Liste titre="Réglages différents de ceux de l'école" n={apercu.ecartsParametres.length} ouvert={aConfirmer}>
            <Tableau entetes={["Réglage", "Dans l'école", "Dans le fichier"]} lignes={apercu.ecartsParametres.map((e) => [e.libelle, e.ecole, e.fichier])} />
          </Liste>
          <Liste titre="Élèves nouveaux" n={apercu.nouveauxEleves.length}>
            <Tableau entetes={["Nom et prénoms", "Classe", "Matricule école", "Statut"]} lignes={apercu.nouveauxEleves.map((e) => [e.nom, e.classe, e.matricule, STATUT_ELEVE[e.statut] ?? e.statut])} />
          </Liste>
          <Liste titre="Élèves déjà enregistrés (non importés)" n={apercu.doublonsEleves.length}>
            <Tableau entetes={["Nom et prénoms", "Classe", "Déjà enregistré sous", "Raison"]} lignes={apercu.doublonsEleves.map((e) => [e.nom, e.classe, e.matriculeEcole, e.raison])} />
          </Liste>
          <Liste titre="Agents nouveaux" n={apercu.nouveauxAgents.length}>
            <Tableau entetes={["Nom et prénoms", "Fonction", "Classe"]} lignes={apercu.nouveauxAgents.map((a) => [a.nom, a.fonction, a.classe || "-"])} />
          </Liste>
          <Liste titre="Agents déjà enregistrés (non importés)" n={apercu.doublonsAgents.length}>
            <Tableau entetes={["Nom et prénoms", "Raison"]} lignes={apercu.doublonsAgents.map((a) => [a.nom, a.raison])} />
          </Liste>
          {(apercu.notesIgnoreesExistants > 0 || apercu.evenementsDejaPresents > 0) && (
            <p className="text-sm text-attenue">
              Déjà dans le site, donc non importés : les notes de {apercu.notesIgnoreesExistants} élèves déjà enregistrés et {apercu.evenementsDejaPresents} absences ou retards.
            </p>
          )}
        </>
      )}

      {aConfirmer && apercu && (
        <section className="carte space-y-3">
          <h2 className="text-lg font-semibold">Confirmer</h2>
          <p className="text-sm">Tout est enregistré en une seule fois : en cas d&apos;erreur, rien n&apos;est écrit. Aucune donnée existante n&apos;est modifiée.</p>
          <FormConfirmerImport
            action={actionConfirmerImport.bind(null, job.id)}
            ecarts={apercu.ecartsParametres.length}
            enseignants={apercu.nouveauxAgents.filter((a) => a.telephone && estEnseignant(a.fonction)).length}
          />
          <BoutonAction action={actionAnnulerImport.bind(null, job.id)} libelle="Annuler cet import" confirmation="Annuler cet import ? Le fichier envoyé sera effacé." />
        </section>
      )}
    </div>
  );
}
