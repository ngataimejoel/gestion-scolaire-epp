import * as XLSX from "xlsx";
import type { Eleve } from "./api";

// Exporte un tableau d'objets en fichier Excel (la fenêtre d'enregistrement s'ouvre).
export function exporterExcel(nomFichier: string, lignes: Record<string, unknown>[], feuille = "Feuille1") {
  const ws = XLSX.utils.json_to_sheet(lignes);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, feuille.slice(0, 31));
  XLSX.writeFile(wb, nomFichier.endsWith(".xlsx") ? nomFichier : `${nomFichier}.xlsx`);
}

const normaliser = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

function versIso(v: unknown): string {
  if (typeof v === "number" && v > 0) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v ?? "").trim();
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (fr) return `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

// Reconnaît les colonnes usuelles (fichiers SmartIEPP ou listes faites à la main).
const COLONNES: [keyof Eleve | "nom_complet", (n: string) => boolean][] = [
  ["matricule", (n) => n.startsWith("matricule")],
  ["nom_complet", (n) => n.startsWith("nometprenom") || n === "nomprenoms" || n === "nomsetprenoms"],
  ["nom", (n) => n === "nom" || n === "noms"],
  ["prenoms", (n) => n.startsWith("prenom")],
  ["sexe", (n) => n === "sexe" || n === "genre"],
  ["date_naissance", (n) => n.startsWith("datedenaiss") || n.startsWith("datenaiss") || n === "nele"],
  ["lieu_naissance", (n) => n.startsWith("lieu")],
  ["redoublant", (n) => n.startsWith("redoubl") || n === "statut"],
  ["nom_parent", (n) => n.startsWith("nomduparent") || n.startsWith("nomparent") || n === "parent" || n === "tuteur"],
  ["contact_parent", (n) => n.startsWith("contact") || n.startsWith("telephone") || n === "tel"],
];

export async function lireElevesExcel(fichier: File): Promise<Partial<Eleve>[]> {
  const wb = XLSX.read(await fichier.arrayBuffer());
  const ws = wb.Sheets[wb.SheetNames[0]];
  const lignes = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
  // La ligne d'en-tête est la première qui contient une colonne « nom ».
  const iEntete = lignes.findIndex((l) => l.some((c) => normaliser(c).startsWith("nom")));
  if (iEntete < 0) throw new Error("Colonne « Nom » introuvable dans le fichier.");
  const entete = lignes[iEntete].map(normaliser);
  const index = new Map<string, number>();
  for (const [cle, test] of COLONNES) {
    const i = entete.findIndex((n) => test(n));
    if (i >= 0 && !index.has(cle)) index.set(cle, i);
  }
  const val = (l: unknown[], cle: string) => (index.has(cle) ? l[index.get(cle)!] : "");
  return lignes
    .slice(iEntete + 1)
    .map((l) => {
      let nom = String(val(l, "nom") ?? "").trim();
      let prenoms = String(val(l, "prenoms") ?? "").trim();
      const complet = String(val(l, "nom_complet") ?? "").trim().replace(/\s+/g, " ");
      if (!nom && complet) {
        const [premier, ...reste] = complet.split(" ");
        nom = premier;
        prenoms = reste.join(" ");
      }
      const red = normaliser(val(l, "redoublant"));
      return {
        matricule: String(val(l, "matricule") ?? "").trim(),
        nom,
        prenoms,
        sexe: normaliser(val(l, "sexe")).startsWith("f") ? "F" : "M",
        date_naissance: versIso(val(l, "date_naissance")),
        lieu_naissance: String(val(l, "lieu_naissance") ?? "").trim(),
        redoublant: red === "oui" || red === "1" || red === "r" || red.startsWith("redoub") ? 1 : 0,
        nom_parent: String(val(l, "nom_parent") ?? "").trim(),
        contact_parent: String(val(l, "contact_parent") ?? "").trim(),
      } as Partial<Eleve>;
    })
    .filter((e) => e.nom);
}
