/**
 * Export Excel (.xlsx) des états et listes : mêmes tableaux qu'à l'écran, en-tête officiel de l'école,
 * cellules fusionnées pour les en-têtes G / F / T, pourcentages au format Excel.
 */
import ExcelJS from "exceljs";
import type { Cellule, Tableau } from "./etats";

export interface EnteteClasseur {
  ecole: string;
  code: string;
  ministere: string;
  dren?: string | null;
  iepp?: string | null;
  annee: string;
}

const BORDURE = { style: "thin" as const, color: { argb: "FF000000" } };
const bordures = { top: BORDURE, left: BORDURE, bottom: BORDURE, right: BORDURE };

function ecrireTableau(ws: ExcelJS.Worksheet, t: Tableau, ligneDepart: number): number {
  let l = ligneDepart;
  if (t.titre) {
    ws.getCell(l, 1).value = t.titre;
    ws.getCell(l, 1).font = { bold: true };
    l++;
  }
  // En-têtes avec fusions (lignes et colonnes)
  const occupe = new Set<string>();
  t.entetes.forEach((rangee, i) => {
    let col = 1;
    for (const c of rangee) {
      while (occupe.has(`${l + i}:${col}`)) col++;
      const larg = c.c ?? 1;
      const haut = c.r ?? 1;
      const cell = ws.getCell(l + i, col);
      cell.value = c.t;
      if (larg > 1 || haut > 1) ws.mergeCells(l + i, col, l + i + haut - 1, col + larg - 1);
      for (let r = 0; r < haut; r++) for (let k = 0; k < larg; k++) occupe.add(`${l + i + r}:${col + k}`);
      col += larg;
    }
  });
  const nbColonnes = Math.max(...t.lignes.map((x) => x.cellules.length), ...t.entetes.map((r) => r.reduce((s, c) => s + (c.c ?? 1), 0)));
  for (let i = 0; i < t.entetes.length; i++)
    for (let c = 1; c <= nbColonnes; c++) {
      const cell = ws.getCell(l + i, c);
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
      cell.border = bordures;
    }
  l += t.entetes.length;
  for (const ligne of t.lignes) {
    ligne.cellules.forEach((v: Cellule, i) => {
      const cell = ws.getCell(l, i + 1);
      if (v && typeof v === "object") {
        cell.value = v.pct;
        cell.numFmt = "0.0%";
      } else cell.value = v;
      cell.border = bordures;
      if (ligne.total) cell.font = { bold: true };
    });
    l++;
  }
  if (t.note) {
    ws.getCell(l, 1).value = t.note;
    ws.getCell(l, 1).font = { italic: true, size: 9 };
    l++;
  }
  return l + 1;
}

/** Classeur d'une seule feuille : en-tête officiel, titre, puis les tableaux les uns sous les autres. */
export async function classeurExcel(e: EnteteClasseur, titre: string, sousTitre: string | undefined, tableaux: Tableau[], textes: [string, string][] = []) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GESTION SCOLAIRE EPP";
  const ws = wb.addWorksheet(titre.slice(0, 31).replace(/[\\/?*[\]:]/g, " "), { pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const entete = [e.ministere, e.dren, e.iepp, `${e.ecole} – Code : ${e.code}`].filter(Boolean) as string[];
  entete.forEach((t, i) => (ws.getCell(i + 1, 1).value = t));
  ws.getCell(1, 8).value = "République de Côte d'Ivoire";
  ws.getCell(2, 8).value = "Union – Discipline – Travail";
  ws.getCell(3, 8).value = `Année scolaire : ${e.annee}`;
  let l = entete.length + 2;
  ws.getCell(l, 1).value = titre.toUpperCase();
  ws.getCell(l, 1).font = { bold: true, size: 14 };
  l++;
  if (sousTitre) {
    ws.getCell(l, 1).value = sousTitre;
    l++;
  }
  l++;
  for (const t of tableaux) l = ecrireTableau(ws, t, l);
  for (const [k, v] of textes) {
    ws.getCell(l, 1).value = k;
    ws.getCell(l, 1).font = { bold: true };
    ws.getCell(l + 1, 1).value = v || "";
    l += 3;
  }
  ws.columns.forEach((c, i) => (c.width = i === 1 || i === 2 ? 26 : 11));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Nom de fichier sûr : lettres, chiffres et tirets. */
export const nomFichier = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
