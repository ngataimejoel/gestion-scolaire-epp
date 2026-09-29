/**
 * Lecture du classeur GESTION_SCOLAIRE_EPP (.xlsm ou .xlsx) : PARAMETRES, REGISTRE ELEVES, PERSONNEL, les quatre
 * feuilles NOTES, ABSENCES ELEVES / PERSONNEL, et les valeurs calculées de RESULTATS pour comparaison.
 * Les colonnes sont retrouvées par leur intitulé (ligne d'en-tête), pas par leur position : une colonne déplacée
 * ne fausse pas la lecture. Les macros ne sont jamais exécutées ; seules les valeurs des cellules sont lues.
 */
import ExcelJS from "exceljs";
import type { DonneesClasseur } from "../demo/classeur";

export type Valeur = string | number | null;
export interface AttenduEleve {
  mga: number | null;
  decision: string | null;
  rang: number | null;
}
export interface LectureClasseur {
  donnees: DonneesClasseur;
  attendus: Record<string, AttenduEleve>;
  feuillesLues: string[];
  feuillesManquantes: string[];
}

export const FEUILLES = {
  parametres: "PARAMETRES",
  eleves: "REGISTRE ELEVES",
  personnel: "PERSONNEL",
  notesCP: "NOTES CP",
  notesCE1: "NOTES CE1",
  notesCEM: "NOTES CE2-CM1",
  notesCM2: "NOTES CM2",
  absEleves: "ABSENCES ELEVES",
  absPersonnel: "ABSENCES PERSONNEL",
  resultats: "RESULTATS",
  resultatsCM2: "RESULTATS CM2",
} as const;

export const CLE_FEUILLE_NOTES = { [FEUILLES.notesCP]: "CP", [FEUILLES.notesCE1]: "CE1", [FEUILLES.notesCEM]: "CEM", [FEUILLES.notesCM2]: "CM2" } as const;

export const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** Valeur affichée d'une cellule : résultat des formules, texte enrichi, dates ; erreurs et vides → null. */
function brut(cell: ExcelJS.Cell): string | number | Date | null {
  let v: unknown = cell.value;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    if ("result" in o) v = o.result;
    else if ("richText" in o) v = (o.richText as { text: string }[]).map((r) => r.text).join("");
    else if ("text" in o) v = o.text;
    else v = null;
  }
  if (v && typeof v === "object" && !(v instanceof Date)) return null; // { error: "#N/A" }…
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "boolean") return v ? "OUI" : "NON";
  return (v as string | number | Date | null | undefined) ?? null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function texte(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return iso(v);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return String(v).trim() || null;
}

/** Date au format AAAA-MM-JJ ; accepte une date Excel, « JJ/MM/AAAA » ou « AAAA-MM-JJ ». Renvoie undefined si illisible. */
export function dateIso(v: unknown): string | null | undefined {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : iso(v);
  if (typeof v === "number" && v > 1000 && v < 80000) return iso(new Date(Date.UTC(1899, 11, 30) + v * 86_400_000));
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return undefined;
}

export function nombre(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Ligne d'en-tête : première ligne (1 à 25) contenant la cellule repère. Renvoie les colonnes par intitulé normalisé. */
function entetes(ws: ExcelJS.Worksheet, repere = "NOM ET PRENOMS") {
  for (let r = 1; r <= Math.min(25, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const cols: { col: number; titre: string }[] = [];
    let trouve = false;
    for (let c = 1; c <= ws.columnCount; c++) {
      const cell = row.getCell(c);
      if (cell.isMerged && cell.master.address !== cell.address) continue;
      const t = brut(cell);
      if (t == null) continue;
      const titre = norm(t);
      cols.push({ col: c, titre });
      if (titre === repere) trouve = true;
    }
    if (trouve) return { ligne: r, cols };
  }
  return null;
}

/** Trouve une colonne : intitulé exact, ou préfixe si le motif finit par « * ». */
function colonne(cols: { col: number; titre: string }[], motif: string, apres = 0) {
  const prefixe = motif.endsWith("*");
  const m = prefixe ? motif.slice(0, -1) : motif;
  return cols.find((c) => c.col > apres && (prefixe ? c.titre.startsWith(m) : c.titre === m))?.col;
}

type Champ = { cle: string; motif: string; type?: "texte" | "date" | "entier" | "nombre" };

function lireTable(ws: ExcelJS.Worksheet, champs: Champ[], obligatoire: string, repere?: string, garderVides = false) {
  const e = entetes(ws, repere);
  if (!e) return [];
  const positions = champs.map((f) => ({ ...f, col: colonne(e.cols, f.motif) }));
  const lignes: Record<string, Valeur>[] = [];
  const colObligatoire = positions.find((p) => p.cle === obligatoire)?.col;
  for (let r = e.ligne + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    // Une cellule fusionnée marque la fin de la liste (bloc RECAPITULATIF sous le personnel).
    if (colObligatoire && row.getCell(colObligatoire).isMerged) break;
    const o: Record<string, Valeur> = {};
    for (const p of positions) {
      if (!p.col) {
        if (garderVides) o[p.cle] = null;
        continue;
      }
      const v = brut(row.getCell(p.col));
      let x: Valeur | undefined;
      if (p.type === "date") {
        const d = dateIso(v);
        x = d === undefined ? `!${texte(v)}` : d; // date illisible gardée pour le signaler
      } else if (p.type === "entier" || p.type === "nombre") x = nombre(v);
      else x = texte(v);
      if (x != null || garderVides) o[p.cle] = x ?? null;
    }
    if (o[obligatoire] == null) continue;
    lignes.push(o);
  }
  return lignes;
}

const CHAMPS_ELEVES: Champ[] = [
  { cle: "n", motif: "N°", type: "entier" },
  { cle: "mat", motif: "MATRICULE ECOLE" },
  { cle: "desps", motif: "MATRICULE DESPS*" },
  { cle: "nom", motif: "NOM ET PRENOMS" },
  { cle: "sexe", motif: "SEXE" },
  { cle: "classe", motif: "CLASSE" },
  { cle: "naiss", motif: "DATE DE NAISSANCE", type: "date" },
  { cle: "age", motif: "AGE", type: "entier" },
  { cle: "nat", motif: "NATIONALITE" },
  { cle: "loc", motif: "LOCALITE" },
  { cle: "sp", motif: "SOUS-PREFECTURE" },
  { cle: "extrait", motif: "EXTRAIT ?" },
  { cle: "acte", motif: "ACTE N°" },
  { cle: "acteDu", motif: "DU", type: "date" },
  { cle: "centre", motif: "CENTRE D'ETAT CIVIL*" },
  { cle: "orphelin", motif: "ORPHELIN" },
  { cle: "orphDe", motif: "ORPHELIN DE" },
  { cle: "pere", motif: "NOM ET PRENOMS DU PERE" },
  { cle: "pereProf", motif: "PROFESSION PERE" },
  { cle: "pereRes", motif: "RESIDENCE PERE" },
  { cle: "pereTel", motif: "TEL. PERE" },
  { cle: "mere", motif: "NOM ET PRENOMS DE LA MERE" },
  { cle: "mereProf", motif: "PROFESSION MERE" },
  { cle: "mereRes", motif: "RESIDENCE MERE" },
  { cle: "mereTel", motif: "TEL. MERE" },
  { cle: "tuteur", motif: "NOM ET PRENOMS DU TUTEUR*" },
  { cle: "tutProf", motif: "PROFESSION TUTEUR*" },
  { cle: "tutRes", motif: "RESIDENCE TUTEUR*" },
  { cle: "tutTel", motif: "TEL. TUTEUR*" },
  { cle: "redoublant", motif: "REDOUBLANT" },
  { cle: "statut", motif: "STATUT" },
  { cle: "obs", motif: "OBSERVATIONS" },
];

const CHAMPS_PERSONNEL: Champ[] = [
  { cle: "n", motif: "N°", type: "entier" },
  { cle: "mat", motif: "MATRICULE" },
  { cle: "nom", motif: "NOM ET PRENOMS" },
  { cle: "sexe", motif: "SEXE" },
  { cle: "naiss", motif: "DATE DE NAISSANCE", type: "date" },
  { cle: "age", motif: "AGE", type: "entier" },
  { cle: "fonction", motif: "FONCTION" },
  { cle: "grade", motif: "GRADE*" },
  { cle: "classe", motif: "CLASSE TENUE" },
  { cle: "diplome", motif: "DIPLOME*" },
  { cle: "priseService", motif: "DATE DE PRISE DE SERVICE", type: "date" },
  { cle: "anc", motif: "ANCIENNETE*", type: "entier" },
  { cle: "arrivee", motif: "DATE D'ARRIVEE*", type: "date" },
  { cle: "tel", motif: "TEL.*" },
  { cle: "sitMat", motif: "SITUATION MATRIMONIALE" },
  { cle: "obs", motif: "OBSERVATIONS" },
];

const champsAbsences = (matricule: string): Champ[] => [
  { cle: "date", motif: "DATE", type: "date" },
  { cle: "mat", motif: matricule },
  { cle: "nature", motif: "NATURE" },
  { cle: "jours", motif: "JOURS D'ABSENCE", type: "nombre" },
  { cle: "min", motif: "RETARD (MINUTES)", type: "nombre" },
  { cle: "motif", motif: "MOTIF" },
  { cle: "just", motif: "JUSTIFIE ?" },
  { cle: "obs", motif: "OBSERVATIONS" },
];

/** Feuille de notes : blocs « Présent ? » + matières (jusqu'au TOTAL ou à la MOYENNE), barèmes ou coefficients sur la ligne au-dessus. */
function lireNotes(ws: ExcelJS.Worksheet) {
  const e = entetes(ws);
  if (!e) return { cfg: [] as [string, number][][], lignes: {} as Record<string, (Valeur)[][]> };
  const presents = e.cols.filter((c) => c.titre === "PRESENT ?").map((c) => c.col);
  const blocs = presents.map((p, i) => {
    const fin = presents[i + 1] ?? Infinity;
    const matieres = [];
    for (const c of e.cols.filter((x) => x.col > p && x.col < fin)) {
      if (/^(TOTAL|MOYENNE|IDX)/.test(c.titre)) break;
      matieres.push(c);
    }
    return { present: p, matieres };
  });
  const ligneBareme = ws.getRow(e.ligne - 1);
  const titreBrut = (col: number) => String(brut(ws.getRow(e.ligne).getCell(col)) ?? "");
  const cfg = blocs.map((b) =>
    b.matieres.map((m) => [titreBrut(m.col).split(/\r?\n|\(\//)[0].trim().toUpperCase(), nombre(brut(ligneBareme.getCell(m.col))) ?? 0] as [string, number]),
  );
  const colMat = colonne(e.cols, "MATRICULE ECOLE");
  const lignes: Record<string, Valeur[][]> = {};
  if (!colMat) return { cfg, lignes };
  for (let r = e.ligne + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const mat = texte(brut(row.getCell(colMat)));
    if (!mat) continue;
    lignes[mat] = blocs.map((b) => {
      const presence = texte(brut(row.getCell(b.present)));
      const notes = b.matieres.map((m) => nombre(brut(row.getCell(m.col))));
      return [presence ? norm(presence) : null, ...notes];
    });
  }
  return { cfg, lignes };
}

/** PARAMETRES : libellés en colonne B, valeurs en C (et D) ; listes de choix dans les colonnes E à J. */
function lireParametres(ws: ExcelJS.Worksheet) {
  const cellule = (r: number, c: number) => brut(ws.getRow(r).getCell(c));
  const lignes: { r: number; libelle: string }[] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const l = cellule(r, 2);
    if (l != null) lignes.push({ r, libelle: norm(l) });
  }
  const val = (prefixe: string) => {
    const l = lignes.find((x) => x.libelle.startsWith(prefixe));
    return l ? cellule(l.r, 3) : null;
  };
  const apres = (libelle: string) => lignes.find((x) => x.libelle.startsWith(libelle))?.r ?? 0;
  const seuils: Record<string, [number, number]> = {};
  for (const niveau of ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"]) {
    const l = lignes.find((x) => x.libelle === niveau && x.r > apres("SEUILS"));
    if (l) seuils[niveau] = [nombre(cellule(l.r, 3)) ?? 0, nombre(cellule(l.r, 4)) ?? 0];
  }
  const calendrier: [string, string | null, string | null][] = [];
  const debutCal = apres("EVALUATION");
  for (let r = debutCal + 1; debutCal && r <= debutCal + 4; r++) {
    const l = cellule(r, 2);
    if (l == null) break;
    calendrier.push([String(l), dateIso(cellule(r, 3)) ?? null, dateIso(cellule(r, 4)) ?? null]);
  }
  const jours: [string, number, number][] = [];
  const debutJours = lignes.find((x) => x.libelle === "MOIS")?.r ?? 0;
  for (let r = debutJours + 1; debutJours && r <= debutJours + 12; r++) {
    const mois = nombre(cellule(r, 3));
    if (mois == null) break;
    jours.push([String(cellule(r, 2)), mois, nombre(cellule(r, 4)) ?? 0]);
  }
  const liste = (col: number, depart: number) => {
    const l: string[] = [];
    for (let r = depart; r <= ws.rowCount; r++) {
      const v = texte(cellule(r, col));
      if (!v) break;
      l.push(v);
    }
    return l;
  };
  const ligneFonctions = (() => {
    for (let r = 1; r <= ws.rowCount; r++) if (norm(cellule(r, 5)).startsWith("FONCTIONS")) return r;
    return 0;
  })();
  return {
    ministere: texte(val("MINISTERE")),
    dren: texte(val("DIRECTION REGIONALE")),
    iepp: texte(val("INSPECTION")),
    ecole: texte(val("NOM DE L'ETABLISSEMENT")),
    code: texte(val("CODE ETABLISSEMENT")),
    annee: texte(val("ANNEE SCOLAIRE")),
    localite: texte(val("LOCALITE")),
    directeur: texte(val("NOM DU DIRECTEUR")),
    dateEdition: dateIso(val("DATE D'EDITION")) ?? null,
    dateRefAge: dateIso(val("DATE DE REFERENCE")) ?? null,
    nouveauxCP1: nombre(val("NOUVEAUX INSCRITS")),
    secteur: texte(val("SECTEUR")),
    seuils,
    calendrier,
    jours,
    nationalites: liste(7, 3),
    fonctions: ligneFonctions ? liste(5, ligneFonctions + 1) : [],
    orphDe: liste(9, 3),
    statuts: liste(10, 3),
  };
}

function lireResultats(ws: ExcelJS.Worksheet, colMga: string) {
  const l = lireTable(
    ws,
    [
      { cle: "mat", motif: "MATRICULE ECOLE" },
      { cle: "mga", motif: colMga, type: "nombre" },
      { cle: "decision", motif: "DECISION" },
      { cle: "rang", motif: "RANG*", type: "entier" },
    ],
    "mat",
    undefined,
    true,
  );
  return Object.fromEntries(l.map((x) => [String(x.mat), { mga: x.mga as number | null, decision: x.decision as string | null, rang: x.rang as number | null }]));
}

/** Lit le classeur ; lève une erreur lisible si le fichier n'est pas un classeur Excel. */
export async function lireClasseur(fichier: ArrayBuffer | Buffer): Promise<LectureClasseur> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(fichier as ArrayBuffer);
  } catch {
    throw new Error("Ce fichier n'est pas un classeur Excel lisible (.xlsx ou .xlsm).");
  }
  const feuille = (nom: string) => wb.worksheets.find((w) => norm(w.name) === nom);
  const lues: string[] = [];
  const manquantes: string[] = [];
  const prendre = (nom: string) => {
    const ws = feuille(nom);
    (ws ? lues : manquantes).push(nom);
    return ws;
  };

  const wsPar = prendre(FEUILLES.parametres);
  const wsE = prendre(FEUILLES.eleves);
  const wsP = prendre(FEUILLES.personnel);
  const N: Record<string, Valeur[][]> = {};
  const CFG: Record<string, [string, number][][]> = {};
  for (const [nom, cle] of Object.entries(CLE_FEUILLE_NOTES)) {
    const ws = prendre(nom);
    if (!ws) continue;
    const n = lireNotes(ws);
    CFG[cle] = n.cfg;
    Object.assign(N, n.lignes);
  }
  const wsAE = prendre(FEUILLES.absEleves);
  const wsAP = prendre(FEUILLES.absPersonnel);
  const wsR = feuille(FEUILLES.resultats);
  const wsR2 = feuille(FEUILLES.resultatsCM2);
  if (!wsE && !wsP) throw new Error("Aucune feuille REGISTRE ELEVES ni PERSONNEL : ce n'est pas le classeur GESTION SCOLAIRE EPP.");

  const donnees = {
    E: wsE ? lireTable(wsE, CHAMPS_ELEVES, "nom") : [],
    N,
    CFG,
    P: wsP ? lireTable(wsP, CHAMPS_PERSONNEL, "nom") : [],
    AE: wsAE ? lireTable(wsAE, champsAbsences("MATRICULE ECOLE"), "date", undefined, true) : [],
    AP: wsAP ? lireTable(wsAP, champsAbsences("MATRICULE"), "date", undefined, true) : [],
    PAR: wsPar ? lireParametres(wsPar) : {},
  } as unknown as DonneesClasseur;
  return {
    donnees,
    attendus: { ...(wsR ? lireResultats(wsR, "MGA") : {}), ...(wsR2 ? lireResultats(wsR2, "MGA (/20)") : {}) },
    feuillesLues: lues,
    feuillesManquantes: manquantes,
  };
}
