import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { formaterTelephone } from "@/lib/auth/telephone";
import { classesVisibles, ficheEleve } from "@/lib/eleves";
import { actionEnregistrerEleve, actionSupprimerEleve } from "@/app/actions/eleves";
import { FormEleve } from "@/components/formulaires/eleve";
import { BoutonAction } from "@/components/formulaires/bouton-action";
import { dateFr, jourIso } from "@/lib/dates";
import { Alerte } from "@/components/ui";

export const metadata: Metadata = { title: "Fiche élève" };

const STATUTS = { PRESENT: "Présent", ABANDON: "Abandon", TRANSFERE: "Transféré" } as const;
const LIENS = { PERE: "Père", MERE: "Mère", TUTEUR: "Tuteur" } as const;

export default async function FicheEleve({ params, searchParams }: PageProps<"/eleves/[id]">) {
  const u = await exigerUtilisateur();
  const [{ id }, { inscrit }] = await Promise.all([params, searchParams]);
  const e = await ficheEleve(db(), u, id);
  if (!e) notFound();
  const c = e.courante;
  const parent = (r: keyof typeof LIENS) => e.guardians.find((g) => g.relation === r);

  const entete = (
    <div>
      <Link href="/eleves" className="lien text-sm">← Élèves</Link>
      <h1 className="mt-1 text-2xl font-bold">{e.fullName}</h1>
      <p className="text-attenue">
        {e.schoolMatricule}
        {e.despsId && <> · DESPS {e.despsId}</>}
        {c && <> · {c.classroom.name} · {STATUTS[c.status]}</>}
        {e.age != null && <> · {e.age} ans{e.surAge && " (sur-âge)"}</>}
      </p>
    </div>
  );

  if (u.role !== "DIRECTOR") {
    const ligne = (l: string, v: React.ReactNode) => (
      <div>
        <dt className="text-xs text-attenue">{l}</dt>
        <dd className="font-medium">{v || "—"}</dd>
      </div>
    );
    return (
      <div className="max-w-4xl space-y-5">
        {entete}
        <dl className="carte grid gap-4 sm:grid-cols-3">
          {ligne("Sexe", e.sex)}
          {ligne("Date de naissance", dateFr(e.birthDate))}
          {ligne("Lieu de naissance", [e.locality, e.subPrefecture].filter(Boolean).join(", "))}
          {ligne("Nationalité", e.nationality)}
          {ligne("Extrait", e.hasBirthCertificate ? `OUI${e.certificateNumber ? ` · Acte N° ${e.certificateNumber} du ${dateFr(e.certificateDate)}` : ""}` : "NON")}
          {ligne("Orphelin", e.isOrphan ? `OUI (${e.orphanOf})` : "NON")}
          {ligne("Redoublant", c?.isRepeating ? "OUI" : "NON")}
          {(["PERE", "MERE", "TUTEUR"] as const).map((r) => {
            const p = parent(r);
            return ligne(LIENS[r], p && [p.fullName, p.phone && formaterTelephone(p.phone)].filter(Boolean).join(" · "));
          })}
          {ligne("Observations", c?.notes)}
        </dl>
        <p className="text-sm text-attenue">Seul le directeur peut modifier une fiche élève.</p>
      </div>
    );
  }

  const [classes, listes] = await Promise.all([
    classesVisibles(db(), u),
    db().choiceItem.findMany({ where: { schoolId: u.schoolId!, list: { in: ["NATIONALITY", "ORPHAN_OF"] } }, orderBy: { position: "asc" } }),
  ]);
  const p = (r: keyof typeof LIENS) => {
    const g = parent(r);
    return g ? { fullName: g.fullName, profession: g.profession, residence: g.residence, phone: g.phone ? formaterTelephone(g.phone) : "" } : undefined;
  };
  return (
    <div className="max-w-4xl space-y-5">
      {entete}
      {typeof inscrit === "string" && <Alerte type="succes">Élève inscrit avec le matricule {inscrit}.</Alerte>}
      {!c && <Alerte type="info">Cet élève n&apos;est pas inscrit dans une classe de l&apos;année en cours.</Alerte>}
      <section className="carte">
        <FormEleve
          action={actionEnregistrerEleve.bind(null, e.id)}
          classes={classes.map((x) => [x.id, x.name])}
          nationalites={listes.filter((l) => l.list === "NATIONALITY").map((l) => l.value)}
          orphelins={listes.filter((l) => l.list === "ORPHAN_OF").map((l) => l.value)}
          matricule={e.schoolMatricule}
          valeurs={{
            classroomId: c?.classroomId,
            despsId: e.despsId,
            fullName: e.fullName,
            sex: e.sex,
            birthDate: jourIso(e.birthDate),
            nationality: e.nationality,
            locality: e.locality,
            subPrefecture: e.subPrefecture,
            hasBirthCertificate: e.hasBirthCertificate,
            certificateNumber: e.certificateNumber,
            certificateDate: jourIso(e.certificateDate),
            civilRegistryCenter: e.civilRegistryCenter,
            isOrphan: e.isOrphan,
            orphanOf: e.orphanOf,
            isRepeating: c?.isRepeating,
            status: c?.status,
            statusDate: jourIso(c?.statusDate),
            notes: c?.notes,
            parents: { pere: p("PERE"), mere: p("MERE"), tuteur: p("TUTEUR") },
          }}
        />
      </section>
      <section className="carte space-y-2">
        <h2 className="font-semibold">Supprimer la fiche</h2>
        <p className="text-sm text-attenue">
          Réservé à une fiche saisie par erreur. Un élève qui quitte l&apos;école garde sa fiche : indiquez plutôt « Abandon » ou « Transféré ».
          La suppression est refusée dès qu&apos;il existe des notes ou des absences.
        </p>
        <BoutonAction action={actionSupprimerEleve.bind(null, e.id)} libelle="Supprimer cette fiche" confirmation={`Supprimer définitivement la fiche de ${e.fullName} ?`} />
      </section>
    </div>
  );
}
