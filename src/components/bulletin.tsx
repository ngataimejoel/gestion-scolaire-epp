import type { Bulletin } from "@/lib/bulletin";
import { dateFr } from "@/lib/dates";
import { f2, nombre, rangTexte } from "@/lib/format";
import { EnteteOfficiel, Signature, TableOfficielle } from "./documents";

/** Bulletin de notes imprimable (une page A4). */
export function BulletinDoc({ b }: { b: Bulletin }) {
  const r = b.resultat;
  const e = b.eleve;
  const cp = b.classe.niveau === "CP1" || b.classe.niveau === "CP2";
  return (
    <article className="page-imprimee carte space-y-4 bg-surface print:bg-white">
      <EnteteOfficiel ecole={b.ecole} annee={b.annee.label} titre="Bulletin de notes" sousTitre={`Classe de ${b.classe.nom} · Enseignant : ${b.enseignant ?? "—"}`} />
      <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 print:grid-cols-2">
        <span>Nom et prénoms : <b>{e.fullName}</b></span>
        <span>Matricule école : <b>{e.schoolMatricule}</b></span>
        <span>Sexe : {e.sex} · Né(e) le {dateFr(e.birthDate)}{e.locality ? ` à ${e.locality}` : ""}</span>
        <span>Matricule DESPS : {e.despsId ?? "—"}</span>
        <span>Redoublant : {b.inscription.isRepeating ? "OUI" : "NON"}</span>
      </div>
      <TableOfficielle>
        <thead>
          <tr>
            <th className="gauche">Matière</th>
            {b.evaluations.map((ev) => (
              <th key={ev.id}>{ev.libelle}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.matieres.map((m) => (
            <tr key={m.nom}>
              <td className="gauche">{m.nom}</td>
              {m.notes.map((n, k) => (
                <td key={k} className="tabular-nums">
                  {!n.prevue ? "—" : n.absent ? <b>Absent</b> : n.valeur == null ? "—" : `${nombre(n.valeur)}${n.max ? ` / ${nombre(n.max)}` : ""}`}
                </td>
              ))}
            </tr>
          ))}
          <tr className="total">
            <td className="gauche">Moyenne /{cp ? 10 : b.classe.bareme}</td>
            {r.moyennes.map((m, k) => (
              <td key={k} className="tabular-nums">{f2(m)}</td>
            ))}
          </tr>
        </tbody>
      </TableOfficielle>
      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4 print:grid-cols-4">
        {[
          ["MGA", `${f2(r.mga)} / ${b.classe.bareme}`],
          ["Rang", r.rang == null ? "—" : `${rangTexte(r.rang, r.sexe)} sur ${b.effectifClasse}`],
          ["Décision", r.decision || "—"],
          ["Observation", r.observation || "—"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-bordure p-2 print:rounded-none print:border-black">
            <span className="block text-xs text-attenue print:text-black">{k}</span>
            <b className="text-lg">{v}</b>
          </div>
        ))}
      </div>
      <p className="text-sm">
        Absences : {nombre(b.absences.jours)} jour(s) · Retards : {b.absences.retards}
      </p>
      <Signature ecole={b.ecole} date={new Date()} />
    </article>
  );
}
