import type { Cellule, Etat } from "@/lib/etats";
import { EnteteOfficiel, Signature, TableOfficielle, type EnteteEcole } from "./documents";

const afficher = (v: Cellule) => {
  if (v == null) return "";
  if (typeof v === "object") return v.pct == null ? "—" : `${(v.pct * 100).toFixed(1).replace(".", ",")} %`;
  if (typeof v === "number") return String(Math.round(v * 100) / 100).replace(".", ",");
  return v;
};

/** Rendu d'un état officiel : en-tête, tableaux, textes rédigés (en lecture, pour l'impression), signature. */
export function EtatDoc({ etat, ecole, annee, textes, formulaire }: { etat: Etat; ecole: EnteteEcole; annee: string; textes: Record<string, string>; formulaire?: React.ReactNode }) {
  return (
    <article className={`page-imprimee carte space-y-5 bg-surface print:bg-white ${etat.paysage ? "paysage" : ""}`}>
      <EnteteOfficiel ecole={ecole} annee={annee} titre={etat.titre} sousTitre={etat.sousTitre} />
      {etat.tableaux.map((t, i) => (
        <section key={i} className="space-y-2">
          {t.titre && <h3 className="font-semibold">{t.titre}</h3>}
          <TableOfficielle>
            <thead>
              {t.entetes.map((r, j) => (
                <tr key={j}>
                  {r.map((c, k) => (
                    <th key={k} colSpan={c.c} rowSpan={c.r}>{c.t}</th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {t.lignes.map((l, j) => (
                <tr key={j} className={l.total ? "total" : undefined}>
                  {l.cellules.map((v, k) => (
                    <td key={k} className={`${k < (l.gauche ?? 1) && typeof v === "string" ? "gauche" : ""} tabular-nums`}>{afficher(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </TableOfficielle>
          {t.note && <p className="text-xs text-attenue print:text-black">{t.note}</p>}
        </section>
      ))}
      {formulaire ? (
        <div className="print:hidden">{formulaire}</div>
      ) : null}
      {etat.redaction.length > 0 && (
        <div className={`space-y-3 ${formulaire ? "hidden print:block" : ""}`}>
          {etat.redaction.map((r) => (
            <section key={r.cle}>
              <h3 className="font-semibold">{r.titre}</h3>
              <p className="min-h-10 whitespace-pre-line text-sm">{textes[r.cle] || "……………………………………………………………"}</p>
            </section>
          ))}
        </div>
      )}
      <Signature ecole={ecole} />
    </article>
  );
}
