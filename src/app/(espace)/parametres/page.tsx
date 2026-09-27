import type { Metadata } from "next";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { lireParametres } from "@/lib/parametres/service";
import { LIBELLES_LISTES, MOIS } from "@/lib/parametres/defauts";
import * as a from "@/app/actions/parametres";
import { FormSection } from "@/components/formulaires/section";
import { BoutonAction } from "@/components/formulaires/bouton-action";
import type { ChoiceList, GradeSheet } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Paramètres" };

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const nombre = (v: unknown) => String(Number(v)).replace(".", ",");

function Section({ id, titre, aide, children }: { id: string; titre: string; aide?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="carte scroll-mt-4">
      <h2 className="text-lg font-semibold">{titre}</h2>
      {aide && <p className="mt-1 text-sm text-attenue">{aide}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Texte({ label, name, defaultValue, type = "text", requis }: { label: string; name: string; defaultValue?: string | null; type?: string; requis?: boolean }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input name={name} type={type} defaultValue={defaultValue ?? ""} required={requis} className="champ" />
    </label>
  );
}

const cellule = "champ mt-0 w-20 px-2 py-1.5 text-right tabular-nums";

const FEUILLES: { sheet: Exclude<GradeSheet, "PRESCHOOL">; titre: string; aide: string }[] = [
  { sheet: "CP", titre: "NOTES CP (CP1-CP2)", aide: "Coefficients ; notes sur 10. 0 = matière ignorée." },
  { sheet: "CE1", titre: "NOTES CE1", aide: "Barème de chaque matière ; moyenne = total ÷ barèmes × 10." },
  { sheet: "CE2_CM1", titre: "NOTES CE2-CM1", aide: "Barème de chaque matière ; moyenne = total ÷ barèmes × 10." },
  { sheet: "CM2", titre: "NOTES CM2", aide: "Barème de chaque matière ; moyenne = total ÷ barèmes × 20. Épreuves physiques aux examens blancs." },
];

export default async function Parametres() {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const { school, annee, niveaux, matieres, listes } = await lireParametres(db(), u.schoolId!);
  const s = school.settings;
  const evaluations = annee?.assessments ?? [];
  const eval_ = (track: "STANDARD" | "CM2", n: number) => evaluations.find((e) => e.track === track && e.number === n);
  const moisTries = [...(annee?.months ?? [])].sort((x, y) => ((x.month + 3) % 12) - ((y.month + 3) % 12));

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Paramètres de l&apos;établissement</h1>
        <p className="text-attenue">
          Comme la feuille PARAMETRES du classeur : tout le reste de l&apos;application s&apos;alimente ici. Chaque modification est
          enregistrée dans l&apos;historique.
        </p>
        <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {[["identite", "Identité"], ["annee", "Année scolaire"], ["seuils", "Seuils"], ["calendrier", "Calendrier"], ["jours", "Jours de classe"], ["matieres", "Matières"], ["classes", "Classes"], ["listes", "Listes de choix"]].map(([id, t]) => (
            <a key={id} href={`#${id}`} className="lien">{t}</a>
          ))}
        </nav>
      </div>

      <Section id="identite" titre="Identité" aide="Imprimée en tête de tous les états officiels.">
        <FormSection action={a.actionIdentite}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Texte label="Nom de l'établissement" name="name" defaultValue={school.name} requis />
            <Texte label="Code établissement" name="code" defaultValue={school.code} requis />
            <div className="sm:col-span-2"><Texte label="Ministère" name="ministry" defaultValue={school.ministry} requis /></div>
            <div className="sm:col-span-2"><Texte label="Direction régionale (DREN)" name="regionalDirectorate" defaultValue={school.regionalDirectorate} /></div>
            <Texte label="Inspection (IEPP)" name="inspectorate" defaultValue={school.inspectorate} />
            <Texte label="Secteur pédagogique" name="sector" defaultValue={school.sector} />
            <Texte label="Localité" name="locality" defaultValue={school.locality} />
            <Texte label="Nom du directeur (sur les états)" name="directorName" defaultValue={s?.directorName} />
          </div>
        </FormSection>
      </Section>

      <Section id="annee" titre={`Année scolaire ${annee?.label ?? ""}`}>
        <FormSection action={a.actionAnnee}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Texte label="Date de référence des âges" name="ageReferenceDate" type="date" defaultValue={iso(annee?.ageReferenceDate)} requis />
            <Texte label="Date d'édition des états" name="reportDate" type="date" defaultValue={iso(s?.reportDate)} requis />
            <Texte label="Nouveaux inscrits CP1 attendus (année suivante)" name="expectedNewCp1" type="number" defaultValue={String(s?.expectedNewCp1 ?? 0)} requis />
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="teacherLoginOtp" defaultChecked={s?.teacherLoginOtp} className="mt-1 size-4 accent-principal" />
            <span>Demander aussi un code SMS aux enseignants à chaque connexion (toujours demandé au directeur).</span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="neutralizeJustifiedAbsence" defaultChecked={s?.neutralizeJustifiedAbsence} className="mt-1 size-4 accent-principal" />
            <span>
              Ne pas compter 0 à un élève absent avec justificatif à une évaluation.
              <span className="block text-attenue">Désactivé = règle du classeur : tout élève absent à une évaluation a 0 pour celle-ci.</span>
            </span>
          </label>
        </FormSection>
      </Section>

      <Section id="seuils" titre="Seuils d'admission par classe" aide="CP1 à CM1 : moyennes sur 10, admis si MGA ≥ 5. CM2 : moyennes sur 20, admis (entrée en 6e) si MGA ≥ 10.">
        <FormSection action={a.actionSeuils}>
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead className="text-left text-attenue">
                <tr><th className="py-2 pr-6 font-medium">Classe</th><th className="py-2 pr-6 font-medium">Moyenne de passage</th><th className="py-2 font-medium">Barème</th></tr>
              </thead>
              <tbody>
                {niveaux.map((n) => (
                  <tr key={n.id}>
                    <td className="py-1.5 pr-6 font-semibold">{n.code}</td>
                    <td className="py-1.5 pr-6"><input name={`passMark.${n.id}`} defaultValue={nombre(n.passMark)} inputMode="decimal" className={cellule} aria-label={`Moyenne de passage ${n.code}`} /></td>
                    <td className="py-1.5">
                      <select name={`scale.${n.id}`} defaultValue={String(n.scale)} className="champ mt-0 w-24 py-1.5" aria-label={`Barème ${n.code}`}>
                        <option value="10">/10</option>
                        <option value="20">/20</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FormSection>
      </Section>

      <Section id="calendrier" titre="Calendrier des évaluations" aide="Dates provisoires à remplacer par celles arrêtées par l'IEPP. Le rapport mensuel retient l'évaluation dont la date tombe dans le mois.">
        <FormSection action={a.actionCalendrier}>
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead className="text-left text-attenue">
                <tr><th className="py-2 pr-6 font-medium">Évaluation</th><th className="py-2 pr-6 font-medium">CP1 à CM1</th><th className="py-2 font-medium">CM2</th></tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4].map((n) => {
                  const st = eval_("STANDARD", n);
                  const cm = eval_("CM2", n);
                  return (
                    <tr key={n}>
                      <td className="py-1.5 pr-6">{n} – {st?.label}{cm && cm.label !== st?.label ? ` / ${cm.label} CM2` : ""}</td>
                      <td className="py-1.5 pr-6">{st && <input type="date" name={`date.${st.id}`} defaultValue={iso(st.date)} className="champ mt-0 py-1.5" aria-label={`${st.label} CP1 à CM1`} />}</td>
                      <td className="py-1.5">{cm && <input type="date" name={`date.${cm.id}`} defaultValue={iso(cm.date)} className="champ mt-0 py-1.5" aria-label={`${cm.label} CM2`} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </FormSection>
      </Section>

      <Section id="jours" titre="Jours de classe par mois" aide="Taux de fréquentation = 1 − jours d'absence ÷ (effectif × jours de classe).">
        <FormSection action={a.actionJours}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {moisTries.map((m) => (
              <label key={m.id} className="block text-sm font-medium">
                {MOIS[m.month]} {m.year}
                <input name={`jours.${m.month}`} defaultValue={nombre(m.schoolDays)} inputMode="decimal" className="champ tabular-nums" />
              </label>
            ))}
          </div>
        </FormSection>
      </Section>

      <Section id="matieres" titre="Coefficients et barèmes des matières" aide="Un barème ne peut pas descendre sous une note déjà saisie.">
        <FormSection action={a.actionMatieres} className="space-y-6">
          {FEUILLES.map((f) => {
            const liste = matieres.filter((m) => m.gradeSheet === f.sheet);
            const noms = [...new Set(liste.map((m) => m.name))];
            const libelles = f.sheet === "CM2" ? ["Compo 1", "Compo 2", "Examen blanc 1", "Examen blanc 2"] : ["Compo 1", "Compo 2", "Compo 3", "Passage"];
            return (
              <div key={f.sheet}>
                <h3 className="font-semibold">{f.titre}</h3>
                <p className="text-xs text-attenue">{f.aide}</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="text-sm">
                    <thead className="text-left text-attenue">
                      <tr><th className="py-1.5 pr-4 font-medium">Matière</th>{libelles.map((l) => <th key={l} className="py-1.5 pr-3 font-medium whitespace-nowrap">{l}</th>)}</tr>
                    </thead>
                    <tbody>
                      {noms.map((nom) => (
                        <tr key={nom}>
                          <td className="py-1 pr-4 whitespace-nowrap">{nom}</td>
                          {[1, 2, 3, 4].map((e) => {
                            const m = liste.find((x) => x.name === nom && x.assessmentNumber === e);
                            return (
                              <td key={e} className="py-1 pr-3">
                                {m ? <input name={`matiere.${m.id}`} defaultValue={nombre(f.sheet === "CP" ? m.coefficient : m.maxScore)} inputMode="decimal" className={cellule} aria-label={`${nom} ${libelles[e - 1]}`} /> : <span className="text-attenue">—</span>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </FormSection>
      </Section>

      <Section id="classes" titre={`Classes ${annee?.label ?? ""}`} aide="Une classe par niveau par défaut. Ajoutez une division (ex. CM1 B) si un niveau a plusieurs classes.">
        <ul className="divide-y divide-bordure text-sm">
          {annee?.classrooms.map((c) => {
            const seule = annee.classrooms.filter((x) => x.levelId === c.levelId).length === 1;
            return (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                <span><b>{c.name}</b> <span className="text-attenue">· niveau {c.level.code} · {c._count.enrollments} élève(s)</span></span>
                {!seule && c._count.enrollments === 0 && (
                  <BoutonAction action={a.actionSupprimerClasse.bind(null, c.id)} libelle="Supprimer" confirmation={`Supprimer la classe ${c.name} ?`} />
                )}
              </li>
            );
          })}
        </ul>
        <div className="mt-4 border-t border-bordure pt-4">
          <FormSection action={a.actionAjouterClasse} bouton="Ajouter la classe" viderApresSucces className="flex flex-wrap items-end gap-3">
            <label className="block text-sm font-medium">
              Niveau
              <select name="levelId" className="champ" required>
                {niveaux.map((n) => <option key={n.id} value={n.id}>{n.code}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Nom de la classe
              <input name="name" required placeholder="CM1 B" className="champ" />
            </label>
          </FormSection>
        </div>
      </Section>

      <Section id="listes" titre="Listes de choix" aide="Une valeur par ligne. Elles alimentent les menus déroulants de saisie.">
        <div className="grid gap-6 md:grid-cols-2">
          {(Object.keys(LIBELLES_LISTES) as ChoiceList[]).map((l) => (
            <FormSection key={l} action={a.actionListe.bind(null, l)}>
              <label className="block text-sm font-medium">
                {LIBELLES_LISTES[l]}
                <textarea
                  name="valeurs"
                  rows={Math.min(10, listes.filter((x) => x.list === l).length + 1)}
                  defaultValue={listes.filter((x) => x.list === l).map((x) => x.value).join("\n")}
                  className="champ font-mono text-sm"
                />
              </label>
            </FormSection>
          ))}
        </div>
        <p className="mt-4 text-sm text-attenue">Fixes, comme dans le classeur : classes CP1 à CM2, sexe M/F, statut PRESENT / ABANDON / TRANSFERE.</p>
      </Section>
    </div>
  );
}
