import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { classesVisibles } from "@/lib/eleves";
import { dateFr } from "@/lib/dates";
import { feuilleDeNotes, LIBELLES_ETAT, lignesIncompletes } from "@/lib/notes";
import { actionEnregistrerNotes, actionEtatFeuille } from "@/app/actions/notes";
import { GrilleNotes } from "@/components/notes/grille";
import { BoutonAction } from "@/components/formulaires/bouton-action";
import { Pastille, TON_ETAT } from "@/components/pastille";
import { Alerte } from "@/components/ui";

export const metadata: Metadata = { title: "Notes" };

const NOMS_FEUILLE = { CP: "NOTES CP", CE1: "NOTES CE1", CE2_CM1: "NOTES CE2-CM1", CM2: "NOTES CM2" } as const;

export default async function Notes({ searchParams }: PageProps<"/notes">) {
  const u = await exigerUtilisateur();
  const sp = await searchParams;
  const classes = await classesVisibles(db(), u);
  if (!classes.length)
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold">Notes</h1>
        <Alerte type="info">Aucune classe ne vous est attribuée pour l&apos;instant.</Alerte>
      </div>
    );
  const classeId = classes.find((c) => c.id === sp.classe)?.id ?? classes[0].id;
  const numero = [1, 2, 3, 4].includes(Number(sp.eval)) ? Number(sp.eval) : 1;
  const f = (await feuilleDeNotes(db(), u, classeId, numero))!;
  const evaluations = await db().assessment.findMany({
    where: { academicYearId: f.classe.academicYearId, track: f.evaluation.track },
    orderBy: { number: "asc" },
  });
  const manquantes = lignesIncompletes(f);
  const directeur = u.role === "DIRECTOR";
  const onglet = (actif: boolean) => `rounded-full px-3 py-1.5 text-sm ${actif ? "bg-principal text-white" : "border border-bordure bg-surface"}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Notes · {f.classe.name}</h1>
        <p className="text-attenue">
          {NOMS_FEUILLE[f.feuille]} · {f.evaluation.label} du {dateFr(f.evaluation.date)}
        </p>
      </div>
      {classes.length > 1 && (
        <nav aria-label="Classes" className="flex flex-wrap gap-2">
          {classes.map((c) => (
            <Link key={c.id} href={`/notes?classe=${c.id}&eval=${numero}`} className={onglet(c.id === classeId)}>{c.name}</Link>
          ))}
        </nav>
      )}
      <nav aria-label="Évaluations" className="flex flex-wrap gap-2">
        {evaluations.map((e) => (
          <Link key={e.id} href={`/notes?classe=${classeId}&eval=${e.number}`} className={onglet(e.number === numero)}>{e.label}</Link>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Pastille ton={TON_ETAT[f.etat]}>{LIBELLES_ETAT[f.etat]}</Pastille>
        <span className="text-attenue">
          {f.lignes.filter((l) => l.statut === "PRESENT").length - manquantes.length}/{f.lignes.filter((l) => l.statut === "PRESENT").length} élèves notés
        </span>
        {f.etat === "OPEN" && (
          <BoutonAction action={actionEtatFeuille.bind(null, classeId, numero, "valider")} libelle="Valider la feuille" className="btn-secondaire text-sm" confirmation="Valider la feuille ? L'enseignant ne pourra plus la modifier." />
        )}
        {directeur && f.etat !== "LOCKED" && (
          <BoutonAction action={actionEtatFeuille.bind(null, classeId, numero, "verrouiller")} libelle="Verrouiller" className="btn-secondaire text-sm" confirmation="Verrouiller la feuille ? Plus personne ne pourra la modifier sans la rouvrir." />
        )}
        {directeur && f.etat !== "OPEN" && <BoutonAction action={actionEtatFeuille.bind(null, classeId, numero, "rouvrir")} libelle="Rouvrir à la saisie" className="btn-secondaire text-sm" />}
      </div>

      <p className="max-w-4xl text-sm text-attenue">
        {f.feuille === "CP"
          ? "Notes sur 10 par matière ; moyenne pondérée par les coefficients."
          : `Chaque matière a son barème ; moyenne = total ÷ barème des matières notées × ${f.echelle}.`}{" "}
        « Présent ? » à NON : l&apos;élève compte 0 pour cette évaluation (règle du classeur).
        {f.neutraliser && " « NON justifiée » : l'évaluation ne compte pas pour cet élève (réglage de l'école)."}
        {!f.modifiable && (f.etat === "LOCKED" ? " Feuille verrouillée par le directeur." : " Feuille validée : seul le directeur peut encore la corriger.")}
      </p>

      <GrilleNotes
        action={actionEnregistrerNotes.bind(null, classeId, numero)}
        lignes={f.lignes.map(({ moyenne: _m, total: _t, ...l }) => l)}
        matieres={f.matieres}
        feuille={f.feuille}
        echelle={f.echelle}
        neutraliser={f.neutraliser}
        modifiable={f.modifiable}
        empreinte={f.empreinte}
      />
    </div>
  );
}
